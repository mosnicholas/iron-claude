/**
 * Daily compaction — per-user logic. Dispatched at 03:00 local time via
 * pg-boss `daily-compaction.tick` → `daily-compaction.user`.
 *
 * Distills the last 48h of chat into a carry-forward summary so each day
 * starts with a clean message buffer without losing context (pains, focus
 * areas, in-flight discussions). Without this, the prompt window rolls over
 * mid-conversation and the agent contradicts itself.
 *
 * Transcripts live in the `messages` table indefinitely; we just delete
 * messages older than the watermark we summarized to.
 */

import Anthropic from "@anthropic-ai/sdk";
import { formatTranscript, type StoredMessage } from "../bot/message-history.js";
import { getToday } from "../utils/date.js";
import type { Message } from "../db/schema.js";
import type { JobCtx } from "../jobs/handlers.js";

const SUMMARY_MODEL = "claude-haiku-4-5";
const COMPACTION_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function processDailyCompactionForUser({
  user,
  storage,
}: JobCtx): Promise<{ success: boolean; message?: string; error?: string }> {
  const timezone = user.timezone;
  const today = getToday(timezone);

  const cutoff = Date.now() - COMPACTION_WINDOW_MS;
  const rows = await storage.getMessagesSince(user.id, cutoff);
  if (rows.length === 0) {
    return { success: true, message: "No messages to compact" };
  }

  // Anchor the delete to the latest ts we summarized — any message added
  // concurrently between getMessagesSince and clearMessages will have a
  // newer ts and survive the prune.
  const watermark = rows.reduce(
    (latest, row) => (row.ts > latest ? row.ts : latest),
    rows[0].ts
  );

  const stored = rows.map(rowToStored);
  const previousSummaryRow = await storage.readConversationSummary(user.id);
  const previousSummary = previousSummaryRow?.body ?? null;

  const transcript = formatTranscript(stored);
  const summary = await summarizerImpl(transcript, previousSummary, today);

  await storage.writeConversationSummary(user.id, summary, today, rows.length);
  await storage.clearMessages(user.id, watermark);

  return {
    success: true,
    message: `Compacted ${rows.length} messages → conversation summary (${today})`,
  };
}

function rowToStored(row: Message): StoredMessage {
  return {
    text: row.text,
    timestamp: row.ts.toISOString(),
    isFromUser: row.role === "user",
  };
}

async function summarizeTranscript(
  transcript: string,
  previousSummary: string | null,
  today: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  const client = new Anthropic({ apiKey });

  const system = `You are a coaching memory compactor. Given a day's worth of chat between an athlete and their coach, distill the **forward-looking signal** the coach should carry into tomorrow.

Output format — short markdown with these sections (omit any that don't apply):

## Active threads
- One-line each: open questions, in-flight discussions, things the coach said they'd revisit.

## Body / recovery
- Pains, soreness, sleep, energy, illness, recovery markers worth tracking.

## Programming notes
- Decisions about the program: lifts that were "outgrown", anchors switching, deload calls, equipment changes, schedule shifts.

## Personal context
- Life stuff the athlete mentioned that affects training (travel, work crunch, family).

Rules:
- Be concise. Aim for ≤ 25 lines total.
- Capture decisions and state, NOT play-by-play of sets logged.
- Don't repeat what's already in workout files (sets, reps, weights live there).
- Drop chitchat. Keep what affects future coaching.
- If yesterday's summary is provided, evolve it: drop resolved threads, add new ones, update body/recovery state.`;

  const previousBlock = previousSummary
    ? `\n\nPrevious summary (from yesterday — evolve it):\n\n${previousSummary}`
    : "";

  const userMessage = `Today is ${today}. Transcript:\n\n${transcript}${previousBlock}`;

  const response = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Summarizer returned empty response");
  }
  return text;
}

// Test seam — stub the LLM call in tests via `__setSummarizerForTests`.
type Summarizer = (
  transcript: string,
  previousSummary: string | null,
  today: string
) => Promise<string>;

let summarizerImpl: Summarizer = summarizeTranscript;

export function __setSummarizerForTests(fn: Summarizer | null): void {
  summarizerImpl = fn ?? summarizeTranscript;
}
