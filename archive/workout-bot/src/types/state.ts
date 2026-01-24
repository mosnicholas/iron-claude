import type { DayPlan, ExerciseLog, WorkoutLog } from './workout.js';

export type ConversationPhase =
  | 'idle'
  | 'morning-checkin'
  | 'awaiting-gym-time'
  | 'pre-workout'
  | 'during-workout'
  | 'post-workout'
  | 'weekly-planning';

export interface UserState {
  phase: ConversationPhase;
  todayPlan: DayPlan | null;
  currentWorkoutLog: Partial<WorkoutLog>;
  scheduledWorkoutTime: string | null;
  lastMessageAt: string;
  messageBuffer: string[];
}

export interface ConversationContext {
  state: UserState;
  recentMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
}
