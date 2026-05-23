/**
 * Storage interface — the seam between the agent / coach / cron layer and
 * the underlying data store. Every implementation must scope by `userId`.
 *
 * Replaces the per-process repo clone + GitHubStorage class. There is one
 * concrete implementation today: `DbStorage` (src/storage/db.ts), backed by
 * Postgres via Drizzle.
 */

import type {
  Workout,
  WorkoutExercise,
  WorkoutSet,
  Pr,
  WeeklyPlan,
  WeeklyRetro,
  Message,
  ConversationSummary,
  Reminder,
  NewReminder,
  IntegrationToken,
  NewIntegrationToken,
  IntegrationMetric,
  Photo,
} from "../db/schema.js";

export type UserId = string; // uuid

export interface LoggedSetInput {
  reps: number;
  weight: number | string;
  rpe?: number;
}

export interface PrInput {
  exercise: string;
  weight: number;
  reps: number;
  date: string;
  estimated1Rm?: number;
  workoutId?: string;
}

export interface WorkoutSummary {
  id: string;
  date: string;
  isoWeek: string;
  type: string;
  status: string;
  durationMinutes: number | null;
  energyLevel: number | null;
  exerciseCount: number;
  setCount: number;
}

export interface WorkoutWithDetails extends Workout {
  exercises: (WorkoutExercise & { sets: WorkoutSet[] })[];
}

export interface MessageInput {
  role: "user" | "assistant";
  text: string;
  channel?: string;
  meta?: Record<string, unknown>;
  /**
   * Assistant-turn metadata. Only set when `role === "assistant"`. Used for
   * cost analytics, model-migration ROI, and debugging slow turns. Lives on
   * the same row as the assistant text so a JOIN-free query rolls up tokens
   * by user/day/model.
   */
  turnStats?: {
    turnId: string;
    handler: string;
    mode?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    turnMs: number;
    toolsUsed: string[];
  };
}

export interface Storage {
  // ── Profile ──────────────────────────────────────────────────────────────
  readProfile(userId: UserId): Promise<{ body: string; coachingPriorities: string | null } | null>;
  writeProfile(userId: UserId, body: string, coachingPriorities?: string | null): Promise<void>;

  // ── Learnings ────────────────────────────────────────────────────────────
  readLearnings(userId: UserId): Promise<string | null>;
  writeLearnings(userId: UserId, body: string): Promise<void>;
  appendLearning(userId: UserId, entry: string): Promise<void>;

  // ── PRs ──────────────────────────────────────────────────────────────────
  readPRs(userId: UserId): Promise<Pr[]>;
  upsertPR(userId: UserId, pr: PrInput): Promise<Pr>;

  // ── Plans + retros ───────────────────────────────────────────────────────
  readWeeklyPlan(userId: UserId, isoWeek: string): Promise<WeeklyPlan | null>;
  writeWeeklyPlan(userId: UserId, isoWeek: string, body: string): Promise<void>;
  readWeeklyRetro(userId: UserId, isoWeek: string): Promise<WeeklyRetro | null>;
  writeWeeklyRetro(userId: UserId, isoWeek: string, body: string): Promise<void>;

  // ── Workouts ─────────────────────────────────────────────────────────────
  getWorkout(userId: UserId, date: string): Promise<WorkoutWithDetails | null>;
  listWorkouts(
    userId: UserId,
    opts?: { isoWeek?: string; limit?: number }
  ): Promise<WorkoutSummary[]>;
  listWeekDates(
    userId: UserId,
    isoWeek: string
  ): Promise<{ date: string; type: string; status: string }[]>;
  getExerciseHistory(
    userId: UserId,
    exerciseName: string,
    limit?: number
  ): Promise<
    Array<{
      date: string;
      type: string;
      sets: { weight: number | string | null; reps: number; rpe: number | null }[];
      notes: string | null;
    }>
  >;

  startWorkout(
    userId: UserId,
    input: {
      date: string;
      isoWeek: string;
      type: string;
      location?: string;
      plannedDay?: string;
      backFilled: boolean;
      startedAt: string;
    }
  ): Promise<Workout>;

  appendExerciseSets(
    userId: UserId,
    workoutId: string,
    exerciseName: string,
    sets: LoggedSetInput[],
    notes?: string
  ): Promise<{ exerciseId: string; addedSetCount: number; noop: boolean }>;

  removeExercise(userId: UserId, workoutId: string, exerciseName: string): Promise<boolean>;

  editExercise(
    userId: UserId,
    workoutId: string,
    exerciseName: string,
    newSets: LoggedSetInput[],
    notes?: string
  ): Promise<boolean>;

  completeWorkout(
    userId: UserId,
    workoutId: string,
    input: {
      summary: string;
      energyLevel?: number;
      status: "completed" | "abandoned";
      finishedAt: string;
      durationMinutes: number;
      prs?: PrInput[];
    }
  ): Promise<Workout>;

  // ── Nutrition ────────────────────────────────────────────────────────────
  logMeal(
    userId: UserId,
    input: {
      date: string;
      isoWeek: string;
      label: string;
      loggedAt?: string;
      notes?: string;
      items: Array<{
        food: string;
        proteinG: number;
        kcal: number;
        carbsG?: number;
        fatG?: number;
      }>;
    }
  ): Promise<{ mealId: string }>;
  getDailyNutritionRollup(
    userId: UserId,
    date: string
  ): Promise<{
    protein_g: number;
    kcal: number;
    carbs_g: number | null;
    fat_g: number | null;
  } | null>;

  // ── Messages ─────────────────────────────────────────────────────────────
  addMessage(userId: UserId, msg: MessageInput): Promise<Message>;
  getRecentMessages(userId: UserId, count: number): Promise<Message[]>;
  getMessagesSince(userId: UserId, sinceMs: number): Promise<Message[]>;
  clearMessages(userId: UserId): Promise<void>;

  // ── Conversation summary ─────────────────────────────────────────────────
  readConversationSummary(userId: UserId): Promise<ConversationSummary | null>;
  writeConversationSummary(
    userId: UserId,
    body: string,
    asOfDate: string,
    messageCount: number
  ): Promise<void>;

  // ── Reminders ────────────────────────────────────────────────────────────
  getReminders(userId: UserId): Promise<Reminder[]>;
  getDueReminders(userId: UserId, triggerDate: string, triggerHour: number): Promise<Reminder[]>;
  addReminder(
    userId: UserId,
    r: Omit<NewReminder, "userId" | "id" | "createdAt">
  ): Promise<Reminder>;
  deleteReminder(userId: UserId, id: string): Promise<void>;
  deleteRemindersByContext(userId: UserId, context: string): Promise<number>;

  // ── Integration tokens ───────────────────────────────────────────────────
  getIntegrationToken(userId: UserId, provider: string): Promise<IntegrationToken | null>;
  upsertIntegrationToken(
    userId: UserId,
    provider: string,
    token: Omit<NewIntegrationToken, "userId" | "provider" | "id" | "updatedAt">
  ): Promise<IntegrationToken>;
  findUserByExternalIntegrationId(provider: string, externalUserId: string): Promise<UserId | null>;

  // ── Integration metrics ──────────────────────────────────────────────────
  upsertIntegrationMetric(
    userId: UserId,
    provider: string,
    date: string,
    kind: "sleep" | "recovery" | "workout",
    payload: Record<string, unknown>
  ): Promise<void>;
  getIntegrationMetrics(userId: UserId, date: string): Promise<IntegrationMetric[]>;

  // ── Photos ───────────────────────────────────────────────────────────────
  listPhotos(
    userId: UserId,
    opts?: { since?: string; until?: string; limit?: number }
  ): Promise<Photo[]>;
}
