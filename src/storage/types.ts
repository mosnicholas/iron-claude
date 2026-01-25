/**
 * Core data types for the Fitness Coach system
 */

// ============================================================================
// Profile Types
// ============================================================================

export interface Profile {
  name: string;
  timezone: string;
  telegramChatId: string;
  primaryGym: string;
  backupGyms: string[];
  created: string;
  lastUpdated: string;
  goals: ProfileGoals;
  schedule: ProfileSchedule;
  medical: MedicalInfo;
  preferences: TrainingPreferences;
  workingMaxes: WorkingMax[];
}

export interface ProfileGoals {
  primary: string[];
  secondary: string[];
}

export interface ProfileSchedule {
  targetSessionsPerWeek: number;
  preferredTime: string;
  constraints: ScheduleConstraint[];
  preferredRestDay: string;
}

export interface ScheduleConstraint {
  day: string;
  constraint: string;
}

export interface MedicalInfo {
  current: Limitation[];
  historical: Limitation[];
  movementNotes: Record<string, string>;
}

export interface Limitation {
  area: string;
  description: string;
  avoidMovements?: string[];
  alternatives?: string[];
}

export interface TrainingPreferences {
  style: string[];
  dislikes: string[];
  sessionLength: {
    ideal: number;
    maximum: number;
    minimum: number;
  };
  supersets: boolean;
}

export interface WorkingMax {
  exercise: string;
  weight: number;
  reps: number;
  date: string;
  estimated1RM: number;
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
  addedWeight?: number; // For weighted bodyweight exercises
  bodyweightNote?: string;
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
  mergedAt?: string;
  prsHit: PRHit[];
  exercises: LoggedExercise[];
  summary?: WorkoutSummary;
}

export interface PRHit {
  exercise: string;
  achievement: string;
}

export interface LoggedExercise {
  name: string;
  planned?: PlannedExercise;
  sets: LoggedSet[];
  notes?: string;
}

export interface LoggedSet {
  setNumber: number;
  weight: number | string; // string for "BW" or "+45"
  reps: number;
  time?: string;
  rpe?: number;
  notes?: string;
}

export interface WorkoutSummary {
  planAdherence: {
    completed: string[];
    skipped: string[];
    added: string[];
    modified: string[];
  };
  observations: string[];
}

// ============================================================================
// Weekly Plan Types
// ============================================================================

export interface WeeklyPlan {
  week: string; // "2025-W04"
  startDate: string;
  endDate: string;
  generatedAt: string;
  status: 'active' | 'completed' | 'archived';
  plannedSessions: number;
  theme?: string;
  gymScheduleFetched?: string;
  overview?: string;
  days: DayPlan[];
  weekNotes?: string[];
}

export interface DayPlan {
  day: string; // "Monday, Jan 20"
  date: string;
  type: 'workout' | 'rest' | 'optional';
  workoutType?: string; // "Push", "Pull", "Legs", etc.
  location?: string;
  targetDuration?: number;
  exercises?: PlannedExercise[];
  options?: string[]; // For optional/rest days
  notes?: string;
}

export interface PlannedExercise {
  name: string;
  sets: number;
  reps: number | string; // string for ranges like "5-8" or time like "30s"
  weight: number | string; // string for "BW" or "+45"
  notes?: string;
}

// ============================================================================
// Weekly Retrospective Types
// ============================================================================

export interface WeeklyRetrospective {
  week: string;
  generatedAt: string;
  plannedSessions: number;
  completedSessions: number;
  adherenceRate: number;
  adherence: DayAdherence[];
  wins: string[];
  areasForImprovement: string[];
  volumeAnalysis: VolumeAnalysis;
  patternsObserved: string[];
  recommendationsForNextWeek: string[];
}

export interface DayAdherence {
  day: string;
  planned: string;
  actual: string;
  status: 'complete' | 'partial' | 'skipped' | 'rest';
}

export interface VolumeAnalysis {
  categories: VolumeCategory[];
  totalSets: number;
  previousWeekTotal?: number;
  change?: string;
}

export interface VolumeCategory {
  name: string; // "Push", "Pull", "Legs"
  sets: number;
  previousWeek?: number;
  change?: string;
}

// ============================================================================
// Gym Profile Types
// ============================================================================

export interface GymProfile {
  name: string;
  type: 'full-service' | 'basic' | 'hotel' | 'home';
  address?: string;
  hours?: {
    weekday: string;
    weekend: string;
  };
  scheduleUrl?: string;
  equipment: GymEquipment;
  cardio?: string[];
  classes?: GymClasses;
  crowdPatterns?: CrowdPattern[];
  notes?: string[];
}

export interface GymEquipment {
  freeWeights: {
    dumbbells?: string;
    barbells?: string;
    ezCurlBars?: boolean;
    trapBars?: boolean;
  };
  racksAndBenches: {
    squatRacks?: number;
    powerRacks?: number;
    flatBenches?: number;
    inclineBenches?: number;
    declineBench?: number;
    adjustableBenches?: number;
  };
  machines?: string[];
  specialty?: string[];
}

export interface GymClasses {
  relevant: string[];
  scheduleNotes?: string[];
}

export interface CrowdPattern {
  time: string;
  level: 'Light' | 'Moderate' | 'Busy' | 'Very Busy';
}

// ============================================================================
// Learning Types
// ============================================================================

export interface Learning {
  category: string;
  content: string;
  dateAdded?: string;
}

// ============================================================================
// Conversation Types
// ============================================================================

export interface ConversationMessage {
  role: 'user' | 'coach';
  content: string;
  timestamp: string;
}

export interface OnboardingConversation {
  startedAt: string;
  completedAt?: string;
  messages: ConversationMessage[];
}

// ============================================================================
// Exercise Parsing Types
// ============================================================================

export interface ParsedExercise {
  name: string;
  weight: number | string;
  sets: ParsedSet[];
  rpe?: number;
  notes?: string;
}

export interface ParsedSet {
  reps: number;
  weight?: number | string;
}

// ============================================================================
// Agent Types
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

export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
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
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: TelegramVoice;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

// ============================================================================
// GitHub Types
// ============================================================================

export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  content: string;
  encoding: string;
}

export interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
  };
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
  };
}
