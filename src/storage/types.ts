/**
 * Core data types for the Fitness Coach system
 * Simplified to only include types that are actually used.
 */

// ============================================================================
// Profile Types (Simplified)
// ============================================================================

export interface Profile {
  name: string;
  timezone: string;
  telegramChatId: string;
  primaryGym: string;
  goals: {
    primary: string[];
    secondary: string[];
  };
  schedule: {
    targetSessionsPerWeek: number;
    preferredRestDay: string;
  };
  medical: {
    current: { area: string; description: string }[];
  };
  preferences: {
    sessionLength: { ideal: number };
  };
}

// ============================================================================
// Personal Records Types
// ============================================================================

export interface PRRecord {
  weight: number;
  reps: number;
  date: string;
  estimated1RM: number;
  workoutRef?: string;
}

export interface ExercisePRs {
  current: PRRecord;
  history: PRRecord[];
}

export type PRsData = Record<string, ExercisePRs>;

// ============================================================================
// Workout Types
// ============================================================================

export interface WorkoutLog {
  date: string;
  type: string;
  started: string;
  finished?: string;
  durationMinutes?: number;
  location: string;
  energyLevel?: number;
  status: "in_progress" | "completed" | "abandoned";
  planReference: string;
  branch?: string;
  warmupCompleted?: boolean;
  cooldownCompleted?: boolean;
  prsHit: { exercise: string; achievement: string }[];
  exercises: LoggedExercise[];
}

export interface LoggedExercise {
  name: string;
  sets: LoggedSet[];
  notes?: string;
}

export interface LoggedSet {
  reps: number;
  weight: number | string;
  rpe?: number;
}

// ============================================================================
// Weekly Plan Types
// ============================================================================

export interface WeeklyPlan {
  week: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  status: "active" | "completed" | "archived";
  plannedSessions: number;
  theme?: string;
  days: DayPlan[];
}

export interface DayPlan {
  day: string;
  date: string;
  type: "workout" | "rest" | "optional";
  workoutType?: string;
  targetDuration?: number;
  warmup?: string[]; // Warm-up activities
  exercises?: PlannedExercise[];
  cooldown?: string[]; // Cool-down/stretching activities
  options?: string[];
}

export interface PlannedExercise {
  name: string;
  sets: number;
  reps: number | string;
  weight: number | string;
  restSeconds?: number; // Rest period between sets in seconds
  notes?: string;
}

// ============================================================================
// Exercise Parsing Types
// ============================================================================

export interface ParsedExercise {
  name: string;
  weight: number | string;
  sets: ParsedSet[];
  rpe?: number;
}

export interface ParsedSet {
  reps: number;
  weight?: number | string;
}

// ============================================================================
// Agent Context
// ============================================================================

export interface AgentContext {
  profile: Profile | null;
  learnings: string[];
  currentWeekPlan: WeeklyPlan | null;
  inProgressWorkout: WorkoutLog | null;
  recentWorkouts: WorkoutLog[];
  currentPRs: PRsData;
  todaysPlan: DayPlan | null;
}

// ============================================================================
// Estimated 1RM Tracking Types
// ============================================================================

/**
 * A single e1RM entry for an exercise in a session
 */
export interface E1RMEntry {
  e1rm: number;
  weight: number;
  reps: number;
  rpe?: number;
  rpeAdjusted: boolean;
}

/**
 * Session e1RM data for all exercises in a workout
 */
export interface SessionE1RMData {
  date: string;
  workoutRef: string;
  exercises: Record<string, E1RMEntry>;
}

/**
 * Exercise e1RM history over time
 */
export interface ExerciseE1RMHistory {
  exercise: string;
  sessions: Array<{
    date: string;
    e1rm: number;
    weight: number;
    reps: number;
    rpe?: number;
    workoutRef: string;
  }>;
  currentBest: {
    e1rm: number;
    date: string;
    weight: number;
    reps: number;
  };
}

/**
 * Full e1RM history data structure (stored in analytics/e1rm-history.yaml)
 */
export type E1RMHistoryData = Record<string, ExerciseE1RMHistory>;

// ============================================================================
// Telegram Types
// ============================================================================

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  voice?: TelegramVoice;
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

// ============================================================================
// GitHub Types
// ============================================================================

export interface GitHubFileContent {
  sha: string;
  content: string;
  encoding: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

export interface GitHubCommitResponse {
  commit: { sha: string };
  content: { sha: string };
}
