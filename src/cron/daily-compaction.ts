/**
 * Daily Compaction Cron Job
 *
 * Once a day, archive the chat transcript and distill it down to a
 * carry-forward summary so each new day starts with a clean message buffer
 * but doesn't lose context (pains, focus areas, in-flight discussions).
 *
 * Without this, the prompt window (50 messages) eventually rolls over
 * mid-conversation — that's exactly the bug that produced the "goblet
 * squats are up next" contradiction.
 *
 * Schedule: 03:00 local time daily (well past any normal workout window).
 */

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { syncRepo } from "../storage/repo-sync.js";
import { writeAndCommit } from "../coach-v2/git.js";
import {
  clearMessages,
  formatTranscript,
  getAllMessages,
  type StoredMessage,
} from "../bot/message-history.js";
import { getToday, getTimezone } from "../utils/date.js";
import { runCronTask, type CronResult } from "./runner.js";

const SUMMARY_MODEL = "claude-haiku-4-5";
const SUMMARY_PATH = "state/conversation-summary.md";
const TRANSCRIPT_DIR = "transcripts";

export async function runDailyCompaction(): Promise<CronResult> {
  return runCronTask(
    "daily-compaction",
    async () => {
      const timezone = getTimezone();
      const today = getToday(timezone);

      const messages = getAllMessages();
      if (messages.length === 0) {
        return { success: true, message: "No messages to compact" };
      }

      const repoPath = await ensureRepoPath();
      const previousSummary = readPreviousSummary(repoPath);

      const transcript = formatTranscript(messages);
      const summary = await summarizeTranscript(transcript, previousSummary, today);

      const transcriptPath = `${TRANSCRIPT_DIR}/${today}.md`;
      const transcriptContent = `# Conversation transcript — ${today}\n\n${transcript}\n`;
      await writeAndCommit(
        repoPath,
        transcriptPath,
        transcriptContent,
        `Archive conversation transcript for ${today}`
      );

      const summaryContent = buildSummaryFile(summary, today, messages.length);
      await writeAndCommit(
        repoPath,
        SUMMARY_PATH,
        summaryContent,
        `Refresh conversation summary (${today})`
      );

      // Only clear local cache once both commits succeeded.
      clearMessages();

      return {
        success: true,
        message: `Compacted ${messages.length} messages → ${transcriptPath} + ${SUMMARY_PATH}`,
      };
    },
    {
      // Don't notify the user — this is a silent housekeeping job.
    }
  );
}

async function ensureRepoPath(): Promise<string> {
  const repoName = process.env.DATA_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repoName || !token) {
    throw new Error("DATA_REPO and GITHUB_TOKEN must be set");
  }
  return syncRepo({ repoUrl: `https://github.com/${repoName}.git`, token });
}

function readPreviousSummary(repoPath: string): string | null {
  const path = join(repoPath, SUMMARY_PATH);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
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

function buildSummaryFile(summary: string, today: string, msgCount: number): string {
  return `<!-- Auto-generated by daily-compaction. Last updated: ${today} (${msgCount} msgs compacted) -->

${summary}
`;
}

// Test seam — exposed so unit tests can stub the LLM call without a real key.
export const __testing = {
  summarizeTranscript,
  buildSummaryFile,
  formatTranscriptForTest: (msgs: StoredMessage[]): string => formatTranscript(msgs),
};
