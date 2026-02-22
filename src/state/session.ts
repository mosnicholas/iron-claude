import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ============================================================================
// Session State Types
// ============================================================================

export interface WorkoutSessionState {
  date: string;
  type: string;
  exercisesCompleted: string[];
  currentExercise: string | null;
  plannedRemaining?: string[];
  notes?: string;
}

export type ConversationMode = "workout_active" | "chatting" | "planning" | "retrospective";

export interface SessionState {
  mode: ConversationMode;
  workout?: WorkoutSessionState;
  lastUpdated: string;
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_STATE_PATH = "state/session.json";
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

// ============================================================================
// Read
// ============================================================================

/**
 * Read session state from the locally-synced fitness-data repo.
 * Returns null if no session exists or if the session has expired.
 */
export function readSessionState(repoPath: string): SessionState | null {
  const filePath = join(repoPath, SESSION_STATE_PATH);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const state: SessionState = JSON.parse(content);

    if (isSessionExpired(state)) {
      return null;
    }

    return state;
  } catch {
    console.log(`[Session] Could not read session state from ${filePath}`);
    return null;
  }
}

/**
 * Check if a session has expired (>2 hours since last update).
 * Treats malformed dates as expired to prevent infinite sessions.
 */
export function isSessionExpired(state: SessionState): boolean {
  const lastUpdated = new Date(state.lastUpdated).getTime();
  if (isNaN(lastUpdated)) return true;
  return Date.now() - lastUpdated > SESSION_TIMEOUT_MS;
}

/**
 * Get the current conversation mode from session state.
 * Defaults to "chatting" if no session exists or session is expired.
 */
export function getMode(state: SessionState | null): ConversationMode {
  if (!state) return "chatting";
  return state.mode;
}

// ============================================================================
// Write
// ============================================================================

/**
 * Write session state to the fitness-data repo.
 * Creates the state/ directory if it doesn't exist.
 */
export function writeSessionState(repoPath: string, state: SessionState): void {
  const filePath = join(repoPath, SESSION_STATE_PATH);
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Clear session state (delete the file).
 */
export function clearSessionState(repoPath: string): void {
  const filePath = join(repoPath, SESSION_STATE_PATH);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

// ============================================================================
// Prompt Injection
// ============================================================================

/**
 * Format session state as a structured XML block for injection into the system prompt.
 */
export function formatSessionStateForPrompt(state: SessionState): string {
  return `<current-session-state>
${JSON.stringify(state, null, 2)}
</current-session-state>`;
}
