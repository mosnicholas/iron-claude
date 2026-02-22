import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Session State Types
// ============================================================================

export interface ExerciseSet {
  weight: number;
  reps: number;
  rpe?: number;
}

export interface CompletedExercise {
  name: string;
  sets: ExerciseSet[];
}

export interface WorkoutSessionState {
  date: string;
  type: string;
  startedAt: string;
  exercisesCompleted: CompletedExercise[];
  exercisesSkipped: string[];
  currentExercise: string | null;
  currentSetNumber: number;
  plannedExercises: string[];
}

export type ConversationMode = "workout_active" | "chatting" | "planning" | "retrospective";

export interface SessionState {
  mode: ConversationMode;
  workout?: WorkoutSessionState;
  lastUpdated: string;
  messageCount: number;
}

// ============================================================================
// Session State Reader (from local filesystem after repo sync)
// ============================================================================

const SESSION_STATE_PATH = "state/session.json";
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

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
 */
export function isSessionExpired(state: SessionState): boolean {
  const lastUpdated = new Date(state.lastUpdated).getTime();
  const now = Date.now();
  return now - lastUpdated > SESSION_TIMEOUT_MS;
}

/**
 * Get the current conversation mode from session state.
 * Defaults to "chatting" if no session exists or session is expired.
 */
export function getMode(state: SessionState | null): ConversationMode {
  if (!state) return "chatting";
  return state.mode;
}

/**
 * Format session state as a structured XML block for injection into the system prompt.
 */
export function formatSessionStateForPrompt(state: SessionState): string {
  return `<current-session-state>
${JSON.stringify(state, null, 2)}
</current-session-state>`;
}
