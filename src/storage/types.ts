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
  status: 'in_progress' | 'completed' | 'abandoned';
  planReference: string;
  branch?: string;
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
  status: 'active' | 'completed' | 'archived';
  plannedSessions: number;
  theme?: string;
  days: DayPlan[];
}

export interface DayPlan {
  day: string;
  date: string;
  type: 'workout' | 'rest' | 'optional';
  workoutType?: string;
  targetDuration?: number;
  exercises?: PlannedExercise[];
  options?: string[];
}

export interface PlannedExercise {
  name: string;
  sets: number;
  reps: number | string;
  weight: number | string;
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
