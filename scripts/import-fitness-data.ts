#!/usr/bin/env tsx
/**
 * One-shot importer: walk a fitness-data GitHub repo and seed a fresh
 * IronClaude Postgres database for a single user.
 *
 * Usage:
 *   tsx scripts/import-fitness-data.ts \
 *     --phone +15555550123 \
 *     --repo owner/fitness-data \
 *     --github-token TOKEN \
 *     [--telegram-chat-id 12345] \
 *     [--display-name "Nick"] \
 *     [--timezone America/New_York] \
 *     [--dry-run]
 *
 * Assumes migrations have already been applied. Idempotent: re-running the
 * importer upserts existing rows rather than duplicating them.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import pc from "picocolors";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../src/db/client.js";
import {
  channelIdentities,
  prs as prsTable,
  users,
  workoutExercises,
  workoutSets,
  workouts as workoutsTable,
} from "../src/db/schema.js";
import { getStorage } from "../src/storage/db.js";
import { encryptSecret } from "../src/crypto/secrets.js";
import { parseFrontmatter } from "../src/integrations/storage.js";
import { calendarInfoFor, getToday, getTimezone } from "../src/utils/date.js";

// ─────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Args {
  phone: string;
  repo: string;
  githubToken: string;
  telegramChatId?: string;
  displayName?: string;
  timezone: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }

  const phone = typeof opts.phone === "string" ? opts.phone : "";
  const repo = typeof opts.repo === "string" ? opts.repo : "";
  const githubToken =
    typeof opts["github-token"] === "string"
      ? (opts["github-token"] as string)
      : (process.env.GITHUB_TOKEN ?? "");
  const telegramChatId =
    typeof opts["telegram-chat-id"] === "string" ? (opts["telegram-chat-id"] as string) : undefined;
  const displayName =
    typeof opts["display-name"] === "string" ? (opts["display-name"] as string) : undefined;
  const timezone =
    typeof opts.timezone === "string" ? (opts.timezone as string) : getTimezone();
  const dryRun = opts["dry-run"] === true;

  if (!phone) throw new Error("--phone is required");
  if (!repo) throw new Error("--repo is required (format: owner/name)");
  if (!githubToken) throw new Error("--github-token (or $GITHUB_TOKEN) is required");

  return { phone, repo, githubToken, telegramChatId, displayName, timezone, dryRun };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────────────────────────────────────

const log = {
  info: (msg: string): void => console.log(`${pc.cyan("[importer]")} ${msg}`),
  ok: (msg: string): void => console.log(`${pc.cyan("[importer]")} ${pc.green("✓")} ${msg}`),
  skip: (msg: string): void => console.log(`${pc.cyan("[importer]")} ${pc.dim("⊘")} ${msg}`),
  warn: (msg: string): void => console.log(`${pc.cyan("[importer]")} ${pc.yellow("!")} ${msg}`),
  err: (msg: string): void => console.log(`${pc.cyan("[importer]")} ${pc.red("✗")} ${msg}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Git clone
// ─────────────────────────────────────────────────────────────────────────────

function cloneRepo(repo: string, token: string): string {
  const dir = mkdtempSync(join(tmpdir(), "iron-claude-import-"));
  const url = `https://${token}@github.com/${repo}.git`;
  const result = spawnSync("git", ["clone", "--depth=1", url, dir], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`git clone failed: ${result.stderr || "unknown error"}`);
  }
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// User upsert
// ─────────────────────────────────────────────────────────────────────────────

interface FoundUser {
  id: string;
  created: boolean;
}

async function findOrCreateUser(args: Args): Promise<FoundUser> {
  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.phoneE164, args.phone)).limit(1);
  if (existing[0]) {
    return { id: existing[0].id, created: false };
  }
  const [created] = await db
    .insert(users)
    .values({
      phoneE164: args.phone,
      displayName: args.displayName,
      timezone: args.timezone,
    })
    .returning();
  return { id: created.id, created: true };
}

async function bindTelegram(userId: string, chatId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(channelIdentities)
    .values({ userId, channel: "telegram", externalId: chatId })
    .onConflictDoNothing();
}

// ─────────────────────────────────────────────────────────────────────────────
// Section importers
// ─────────────────────────────────────────────────────────────────────────────

function readMaybe(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

async function importProfile(userId: string, repoDir: string, dryRun: boolean): Promise<boolean> {
  const body = readMaybe(join(repoDir, "profile.md"));
  if (!body) {
    log.skip("profile.md (file missing)");
    return false;
  }
  if (!dryRun) await getStorage().writeProfile(userId, body);
  log.ok(`profile.md (${body.length} chars)`);
  return true;
}

async function importLearnings(userId: string, repoDir: string, dryRun: boolean): Promise<boolean> {
  const body = readMaybe(join(repoDir, "learnings.md"));
  if (!body) {
    log.skip("learnings.md (file missing)");
    return false;
  }
  if (!dryRun) await getStorage().writeLearnings(userId, body);
  log.ok(`learnings.md (${body.length} chars)`);
  return true;
}

interface PrYamlEntry {
  weight?: number;
  reps?: number;
  date?: string;
  estimated1RM?: number;
  workoutRef?: string;
}

interface PrYamlExercise {
  current?: PrYamlEntry;
  history?: PrYamlEntry[];
}

async function importPRs(userId: string, repoDir: string, dryRun: boolean): Promise<number> {
  const raw = readMaybe(join(repoDir, "prs.yaml"));
  if (!raw) {
    log.skip("prs.yaml (file missing)");
    return 0;
  }
  let parsed: Record<string, PrYamlExercise>;
  try {
    parsed = (parseYaml(raw) ?? {}) as Record<string, PrYamlExercise>;
  } catch (err) {
    log.err(`prs.yaml parse failed: ${(err as Error).message}`);
    return 0;
  }

  const db = getDb();
  let count = 0;

  for (const [exercise, bucket] of Object.entries(parsed)) {
    if (!bucket || typeof bucket !== "object") continue;

    const rows: { entry: PrYamlEntry; isCurrent: boolean }[] = [];
    if (bucket.current && typeof bucket.current === "object") {
      rows.push({ entry: bucket.current, isCurrent: true });
    }
    if (Array.isArray(bucket.history)) {
      for (const h of bucket.history) {
        if (h && typeof h === "object") rows.push({ entry: h, isCurrent: false });
      }
    }

    for (const { entry, isCurrent } of rows) {
      if (
        typeof entry.weight !== "number" ||
        typeof entry.reps !== "number" ||
        typeof entry.date !== "string"
      ) {
        log.warn(`prs.yaml: skipping malformed entry for "${exercise}"`);
        continue;
      }
      if (!dryRun) {
        await db
          .insert(prsTable)
          .values({
            userId,
            exercise,
            weight: entry.weight,
            reps: entry.reps,
            date: entry.date,
            estimated1Rm: typeof entry.estimated1RM === "number" ? entry.estimated1RM : null,
            isCurrent,
          })
          .onConflictDoNothing();
      }
      count++;
    }
  }
  if (count > 0) log.ok(`prs.yaml (${count} rows)`);
  else log.skip("prs.yaml (no rows)");
  return count;
}

// ── Workout body parsing ─────────────────────────────────────────────────────

interface ParsedSet {
  reps: number;
  weight: number | null;
  weightText: string | null;
  rpe: number | null;
}

interface ParsedExercise {
  name: string;
  notes: string | null;
  sets: ParsedSet[];
}

const SET_LINE = /^-\s*(.+?)\s*x\s*(\d+)(?:\s*\(RPE\s*([\d.]+)\))?\s*$/i;

function parseExercises(body: string): { exercises: ParsedExercise[]; summary: string | null } {
  const lines = body.split("\n");
  let i = 0;
  // Find ## Exercises
  while (i < lines.length && !/^##\s+Exercises\b/i.test(lines[i])) i++;
  if (i >= lines.length) {
    // No exercises section; try to extract summary anyway
    return { exercises: [], summary: extractSummary(lines, 0) };
  }
  i++;

  const exercises: ParsedExercise[] = [];
  let current: ParsedExercise | null = null;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // End of exercises section
    if (/^##\s+/.test(trimmed) && !/^###\s+/.test(trimmed)) break;

    // New exercise
    const exMatch = trimmed.match(/^###\s+(.+?)\s*$/);
    if (exMatch) {
      if (current) exercises.push(current);
      current = { name: exMatch[1].trim(), notes: null, sets: [] };
      continue;
    }
    if (!current) continue;

    // Set line
    const setMatch = trimmed.match(SET_LINE);
    if (setMatch) {
      const rawWeight = setMatch[1].trim();
      const reps = parseInt(setMatch[2], 10);
      const rpe = setMatch[3] != null ? parseFloat(setMatch[3]) : null;
      const weightNum = parseFloat(rawWeight);
      const isPureNumber = !Number.isNaN(weightNum) && /^-?\d+(\.\d+)?$/.test(rawWeight);
      current.sets.push({
        reps,
        weight: isPureNumber ? weightNum : null,
        weightText: isPureNumber ? null : rawWeight,
        rpe,
      });
      continue;
    }

    // Notes line (italic)
    const noteMatch = trimmed.match(/^_(.+)_$/);
    if (noteMatch) {
      current.notes = current.notes
        ? `${current.notes} ${noteMatch[1].trim()}`
        : noteMatch[1].trim();
    }
  }
  if (current) exercises.push(current);

  return { exercises, summary: extractSummary(lines, i) };
}

function extractSummary(lines: string[], startIdx: number): string | null {
  let i = startIdx;
  while (i < lines.length && !/^##\s+Summary\b/i.test(lines[i])) i++;
  if (i >= lines.length) return null;
  i++;
  const out: string[] = [];
  for (; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  const result = out.join("\n").trim();
  return result.length > 0 ? result : null;
}

// ── Weeks importer ───────────────────────────────────────────────────────────

interface WeekImportResult {
  plans: number;
  retros: number;
  workouts: number;
  exercises: number;
  sets: number;
  warnings: string[];
}

interface FrontmatterShape {
  date?: string;
  type?: string;
  status?: string;
  started?: string;
  finished?: string;
  duration_minutes?: number;
  energy_level?: number;
  location?: string;
  planned_day?: string;
  back_filled?: boolean;
  recovery_score?: number;
  sleep_hours?: number;
}

async function importWeeks(
  userId: string,
  repoDir: string,
  dryRun: boolean
): Promise<WeekImportResult> {
  const out: WeekImportResult = {
    plans: 0,
    retros: 0,
    workouts: 0,
    exercises: 0,
    sets: 0,
    warnings: [],
  };
  const weeksDir = join(repoDir, "weeks");
  if (!existsSync(weeksDir)) {
    log.skip("weeks/ (directory missing)");
    return out;
  }

  const storage = getStorage();
  const db = getDb();

  const weekDirs = readdirSync(weeksDir)
    .filter((name) => /^\d{4}-W\d{2}$/.test(name))
    .sort();

  for (const week of weekDirs) {
    const weekPath = join(weeksDir, week);
    if (!statSync(weekPath).isDirectory()) continue;

    // plan.md
    const planBody = readMaybe(join(weekPath, "plan.md"));
    if (planBody) {
      if (!dryRun) await storage.writeWeeklyPlan(userId, week, planBody);
      out.plans++;
    }

    // retro.md
    const retroBody = readMaybe(join(weekPath, "retro.md"));
    if (retroBody) {
      if (!dryRun) await storage.writeWeeklyRetro(userId, week, retroBody);
      out.retros++;
    }

    // YYYY-MM-DD.md workout files
    const files = readdirSync(weekPath).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    for (const file of files) {
      const path = join(weekPath, file);
      const raw = readFileSync(path, "utf-8");
      let frontmatter: FrontmatterShape;
      let content: string;
      try {
        const parsed = parseFrontmatter(raw);
        frontmatter = parsed.frontmatter as FrontmatterShape;
        content = parsed.content;
      } catch (err) {
        out.warnings.push(`${week}/${file}: frontmatter parse failed (${(err as Error).message})`);
        continue;
      }

      const date = frontmatter.date ?? file.replace(/\.md$/, "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        out.warnings.push(`${week}/${file}: invalid date "${date}"`);
        continue;
      }

      let isoWeek: string;
      try {
        isoWeek = calendarInfoFor(date).week;
      } catch (err) {
        out.warnings.push(`${week}/${file}: ${(err as Error).message}`);
        continue;
      }

      const type = frontmatter.type ?? "unknown";
      const status = frontmatter.status ?? "completed";

      const snapshot: Record<string, unknown> = {};
      if (typeof frontmatter.recovery_score === "number") {
        snapshot.recovery_score = frontmatter.recovery_score;
      }
      if (typeof frontmatter.sleep_hours === "number") {
        snapshot.sleep_hours = frontmatter.sleep_hours;
      }

      const { exercises, summary } = parseExercises(content);

      if (!dryRun) {
        await db.transaction(async (tx) => {
          // Upsert workout row.
          const [workoutRow] = await tx
            .insert(workoutsTable)
            .values({
              userId,
              date,
              isoWeek,
              type,
              status,
              location: frontmatter.location ?? null,
              plannedDay: frontmatter.planned_day ?? null,
              backFilled: frontmatter.back_filled === true,
              startedAt: frontmatter.started ?? null,
              finishedAt: frontmatter.finished ?? null,
              durationMinutes:
                typeof frontmatter.duration_minutes === "number"
                  ? frontmatter.duration_minutes
                  : null,
              energyLevel:
                typeof frontmatter.energy_level === "number" ? frontmatter.energy_level : null,
              summary,
              recoverySnapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
            })
            .onConflictDoUpdate({
              target: [workoutsTable.userId, workoutsTable.date],
              set: {
                isoWeek,
                type,
                status,
                location: frontmatter.location ?? null,
                plannedDay: frontmatter.planned_day ?? null,
                backFilled: frontmatter.back_filled === true,
                startedAt: frontmatter.started ?? null,
                finishedAt: frontmatter.finished ?? null,
                durationMinutes:
                  typeof frontmatter.duration_minutes === "number"
                    ? frontmatter.duration_minutes
                    : null,
                energyLevel:
                  typeof frontmatter.energy_level === "number" ? frontmatter.energy_level : null,
                summary,
                recoverySnapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
                updatedAt: new Date(),
              },
            })
            .returning();

          // Replace exercises + sets atomically.
          await tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, workoutRow.id));

          for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
            const ex = exercises[exIdx];
            const [exRow] = await tx
              .insert(workoutExercises)
              .values({
                workoutId: workoutRow.id,
                idx: exIdx,
                name: ex.name,
                notes: ex.notes,
              })
              .returning();

            if (ex.sets.length > 0) {
              await tx.insert(workoutSets).values(
                ex.sets.map((s, i) => ({
                  exerciseId: exRow.id,
                  idx: i,
                  reps: s.reps,
                  weight: s.weight,
                  weightText: s.weightText,
                  rpe: s.rpe,
                }))
              );
            }
          }
        });
      }

      out.workouts++;
      out.exercises += exercises.length;
      out.sets += exercises.reduce((acc, e) => acc + e.sets.length, 0);
    }
  }

  if (out.plans > 0) log.ok(`weekly plans (${out.plans})`);
  if (out.retros > 0) log.ok(`weekly retros (${out.retros})`);
  if (out.workouts > 0) {
    log.ok(`workouts (${out.workouts} files, ${out.exercises} exercises, ${out.sets} sets)`);
  } else {
    log.skip("workouts (no files)");
  }
  for (const w of out.warnings) log.warn(w);

  return out;
}

// ── Reminders ────────────────────────────────────────────────────────────────

interface ReminderJson {
  triggerDate?: string;
  trigger_date?: string;
  triggerHour?: number;
  trigger_hour?: number;
  message?: string;
  context?: string;
}

async function importReminders(
  userId: string,
  repoDir: string,
  dryRun: boolean
): Promise<number> {
  const path = join(repoDir, "state", "reminders.json");
  const raw = readMaybe(path);
  if (!raw) {
    log.skip("state/reminders.json (file missing)");
    return 0;
  }
  let parsed: ReminderJson[];
  try {
    const j = JSON.parse(raw);
    parsed = Array.isArray(j) ? j : Array.isArray(j?.reminders) ? j.reminders : [];
  } catch (err) {
    log.err(`reminders.json parse failed: ${(err as Error).message}`);
    return 0;
  }

  const storage = getStorage();
  let count = 0;
  for (const r of parsed) {
    const triggerDate = r.triggerDate ?? r.trigger_date;
    const triggerHour = r.triggerHour ?? r.trigger_hour;
    if (!triggerDate || typeof triggerHour !== "number" || !r.message) {
      log.warn(`reminders.json: skipping malformed entry`);
      continue;
    }
    if (!dryRun) {
      await storage.addReminder(userId, {
        triggerDate,
        triggerHour,
        message: r.message,
        context: r.context ?? null,
      });
    }
    count++;
  }
  if (count > 0) log.ok(`reminders (${count})`);
  else log.skip("reminders (none)");
  return count;
}

// ── Whoop tokens ─────────────────────────────────────────────────────────────

interface WhoopTokensJson {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string | number;
  scopes?: string | string[];
  externalUserId?: string | number;
  userId?: string | number;
  user_id?: string | number;
}

async function importWhoopTokens(
  userId: string,
  repoDir: string,
  dryRun: boolean
): Promise<boolean> {
  const path = join(repoDir, "state", "whoop", "tokens.json");
  const raw = readMaybe(path);
  if (!raw) {
    log.skip("state/whoop/tokens.json (file missing)");
    return false;
  }
  let tokens: WhoopTokensJson;
  try {
    tokens = JSON.parse(raw);
  } catch (err) {
    log.err(`whoop tokens.json parse failed: ${(err as Error).message}`);
    return false;
  }
  if (!tokens.accessToken) {
    log.warn("whoop tokens.json: no accessToken, skipping");
    return false;
  }

  const expiresAt = tokens.expiresAt
    ? new Date(typeof tokens.expiresAt === "number" ? tokens.expiresAt : tokens.expiresAt)
    : null;
  const scopes = Array.isArray(tokens.scopes)
    ? tokens.scopes.join(" ")
    : typeof tokens.scopes === "string"
      ? tokens.scopes
      : null;
  const externalRaw = tokens.externalUserId ?? tokens.userId ?? tokens.user_id;
  const externalUserId =
    externalRaw != null && externalRaw !== "" ? String(externalRaw) : null;

  if (!dryRun) {
    await getStorage().upsertIntegrationToken(userId, "whoop", {
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      externalUserId,
      scopes,
    });
  }
  log.ok(`whoop tokens (externalUserId=${externalUserId ?? "<null>"})`);
  return true;
}

// ── Conversation summary ─────────────────────────────────────────────────────

async function importConversationSummary(
  userId: string,
  repoDir: string,
  timezone: string,
  dryRun: boolean
): Promise<boolean> {
  const path = join(repoDir, "state", "conversation-summary.md");
  const body = readMaybe(path);
  if (!body) {
    log.skip("state/conversation-summary.md (file missing)");
    return false;
  }
  if (!dryRun) {
    await getStorage().writeConversationSummary(userId, body, getToday(timezone), 0);
  }
  log.ok(`conversation summary (${body.length} chars)`);
  return true;
}

// ── Transcripts (optional, best-effort) ─────────────────────────────────────

interface ParsedTranscriptMessage {
  role: "user" | "assistant";
  text: string;
  ts: Date;
}

const TRANSCRIPT_HEADER = /^###\s+(\S+)\s+—\s+\*\*(User|Coach)\*\*\s*$/;

function parseTranscript(raw: string): ParsedTranscriptMessage[] {
  const lines = raw.split("\n");
  const out: ParsedTranscriptMessage[] = [];
  let current: ParsedTranscriptMessage | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current) {
      current.text = buffer.join("\n").trim();
      if (current.text.length > 0) out.push(current);
    }
  };

  for (const line of lines) {
    const m = line.match(TRANSCRIPT_HEADER);
    if (m) {
      flush();
      const ts = new Date(m[1]);
      if (Number.isNaN(ts.getTime())) {
        current = null;
        buffer = [];
        continue;
      }
      current = {
        role: m[2].toLowerCase() === "user" ? "user" : "assistant",
        text: "",
        ts,
      };
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return out;
}

async function importTranscripts(
  userId: string,
  repoDir: string,
  dryRun: boolean
): Promise<number> {
  const dir = join(repoDir, "transcripts");
  if (!existsSync(dir)) {
    log.skip("transcripts/ (directory missing)");
    return 0;
  }
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  if (files.length === 0) {
    log.skip("transcripts (no files)");
    return 0;
  }
  const storage = getStorage();
  let total = 0;
  for (const file of files) {
    let parsed: ParsedTranscriptMessage[];
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      parsed = parseTranscript(raw);
    } catch (err) {
      log.warn(`transcripts/${file}: parse failed (${(err as Error).message})`);
      continue;
    }
    for (const msg of parsed) {
      if (!dryRun) {
        await storage.addMessage(userId, {
          role: msg.role,
          text: msg.text,
          channel: "telegram",
        });
      }
      total++;
    }
  }
  if (total > 0) log.ok(`transcripts (${total} messages from ${files.length} files)`);
  else log.skip("transcripts (no parseable messages)");
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.INTEGRATION_TOKEN_KEY) {
    throw new Error("INTEGRATION_TOKEN_KEY is not set (required to encrypt OAuth tokens)");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  log.info(`phone=${args.phone} repo=${args.repo} dryRun=${args.dryRun}`);

  log.info(`cloning ${args.repo}...`);
  const repoDir = cloneRepo(args.repo, args.githubToken);
  log.ok(`cloned to ${repoDir}`);

  try {
    log.info("resolving user...");
    const user = await findOrCreateUser(args);
    log.ok(`user.id=${user.id} (${user.created ? "created" : "existing"})`);

    if (args.telegramChatId) {
      if (!args.dryRun) await bindTelegram(user.id, args.telegramChatId);
      log.ok(`bound telegram chat_id=${args.telegramChatId}`);
    }

    const counts = {
      profile: 0,
      learnings: 0,
      prs: 0,
      plans: 0,
      retros: 0,
      workouts: 0,
      exercises: 0,
      sets: 0,
      reminders: 0,
      whoopTokens: 0,
      conversationSummary: 0,
      messages: 0,
    };

    try {
      counts.profile = (await importProfile(user.id, repoDir, args.dryRun)) ? 1 : 0;
    } catch (err) {
      log.err(`profile.md: ${(err as Error).message}`);
    }

    try {
      counts.learnings = (await importLearnings(user.id, repoDir, args.dryRun)) ? 1 : 0;
    } catch (err) {
      log.err(`learnings.md: ${(err as Error).message}`);
    }

    try {
      counts.prs = await importPRs(user.id, repoDir, args.dryRun);
    } catch (err) {
      log.err(`prs.yaml: ${(err as Error).message}`);
    }

    try {
      const w = await importWeeks(user.id, repoDir, args.dryRun);
      counts.plans = w.plans;
      counts.retros = w.retros;
      counts.workouts = w.workouts;
      counts.exercises = w.exercises;
      counts.sets = w.sets;
    } catch (err) {
      log.err(`weeks/: ${(err as Error).message}`);
    }

    try {
      counts.reminders = await importReminders(user.id, repoDir, args.dryRun);
    } catch (err) {
      log.err(`reminders.json: ${(err as Error).message}`);
    }

    try {
      counts.whoopTokens = (await importWhoopTokens(user.id, repoDir, args.dryRun)) ? 1 : 0;
    } catch (err) {
      log.err(`whoop tokens: ${(err as Error).message}`);
    }

    try {
      counts.conversationSummary = (await importConversationSummary(
        user.id,
        repoDir,
        args.timezone,
        args.dryRun
      ))
        ? 1
        : 0;
    } catch (err) {
      log.err(`conversation-summary: ${(err as Error).message}`);
    }

    try {
      counts.messages = await importTranscripts(user.id, repoDir, args.dryRun);
    } catch (err) {
      log.err(`transcripts/: ${(err as Error).message}`);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log.info(pc.bold(`Done in ${elapsed}s${args.dryRun ? " (dry-run)" : ""}`));
    log.info(`  profile=${counts.profile} learnings=${counts.learnings} prs=${counts.prs}`);
    log.info(`  plans=${counts.plans} retros=${counts.retros}`);
    log.info(
      `  workouts=${counts.workouts} exercises=${counts.exercises} sets=${counts.sets}`
    );
    log.info(
      `  reminders=${counts.reminders} whoopTokens=${counts.whoopTokens} convSummary=${counts.conversationSummary} messages=${counts.messages}`
    );
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    await closeDb();
  }
}

main().catch((err) => {
  console.error(pc.red(`[importer] fatal: ${err instanceof Error ? err.stack : String(err)}`));
  closeDb().finally(() => process.exit(1));
});
