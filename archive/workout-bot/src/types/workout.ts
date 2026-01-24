export interface ExerciseSet {
  reps: number;
  weight?: number;
  addedWeight?: number;
  duration?: number;
  rpe?: number;
}

export interface ExerciseLog {
  name: string;
  sets: ExerciseSet[];
  notes?: string;
  isSuperset?: boolean;
}

export interface WorkoutLog {
  date: string;
  dayType: WorkoutDayType;
  energy: number;
  sleepHours: number;
  skills: ExerciseLog[];
  strength: ExerciseLog[];
  notes: string[];
}

export type WorkoutDayType =
  | 'upper-push'
  | 'lower'
  | 'conditioning'
  | 'upper-pull'
  | 'full-body'
  | 'rest';

export interface PlannedExercise {
  name: string;
  targetSets: number;
  targetReps: string;
  targetWeight: number | 'BW' | 'TBD';
  notes?: string;
}

export interface DayPlan {
  dayType: WorkoutDayType;
  skills: PlannedExercise[];
  strength: PlannedExercise[];
}

export interface WeekPlan {
  weekNumber: string;
  startDate: string;
  endDate: string;
  lastWeekSummary?: WeekSummary;
  focus: string[];
  days: Record<string, DayPlan>;
  deloadStatus: DeloadRecommendation;
}

export interface WeekSummary {
  totalSets: number;
  mainLiftProgress: Record<string, number>;
  skillWins: string[];
  fatigueSignals: string[];
}

export interface DeloadRecommendation {
  weeksInBlock: number;
  needsDeload: boolean;
  reason?: string;
  action?: string;
}

export interface UserProfile {
  name: string;
  location: string;
  gym: string;
  experience: string;
  goals: {
    primary: string[];
    targets: GoalTarget[];
  };
  preferences: {
    sessionLength: string;
    exerciseRotation: string;
    skillFirst: boolean;
    trainingDays: number;
  };
  currentStatus: {
    programWeek: number;
    lastDeload: string | null;
    bodyweight: number | null;
  };
  injuries: string[];
  coachingNotes: string[];
}

export interface GoalTarget {
  description: string;
  targetDate?: string;
  completed: boolean;
}

// Behavioral pattern analysis types for adaptive coaching
export interface ExerciseAdherence {
  mainLifts: number; // % completion (0-100)
  accessories: number; // % completion (0-100)
  conditioning: number; // % completion (0-100)
  skills: number; // % completion (0-100)
}

export interface ProgressionRate {
  exercise: string;
  lbsPerWeek: number;
  weeksTracked: number;
}

export interface BehavioralPattern {
  // Training frequency
  actualDaysPerWeek: number; // vs stated preference
  statedDaysPerWeek: number;
  frequencyDelta: number; // actual - stated

  // Volume adherence
  avgSetsCompleted: number;
  avgSetsPlanned: number;
  setCompletionRate: number; // % of planned sets completed

  // Intensity
  avgRPE: number;
  rpeRange: { min: number; max: number };

  // Exercise adherence by category
  exerciseAdherence: ExerciseAdherence;

  // Progression tracking
  progressionRates: ProgressionRate[];

  // Consistency patterns
  consistency: {
    bestDays: string[]; // e.g., "monday", "thursday"
    worstDays: string[]; // days often skipped
    weeksAnalyzed: number;
  };

  // Summary insights
  insights: string[];
}
