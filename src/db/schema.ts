/**
 * Database schema — single source of truth for IronClaude state.
 *
 * Every table (except `users`, `channel_identities`, `auth_otps`, and
 * `inbox_events`) carries `user_id` for multi-tenancy. Queries MUST scope by
 * `user_id` in the Storage layer; we deliberately don't use Postgres RLS yet.
 *
 * Replaces:
 *   - GitHubStorage (src/storage/github.ts)
 *   - repo-sync /tmp/fitness-data clone (src/storage/repo-sync.ts)
 *   - /tmp/iron-claude-message-history.json (src/bot/message-history.ts)
 *   - state/*.json files in fitness-data
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  bigint,
  timestamp,
  date,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
  index,
  real,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * Foreign key to Supabase's auth.users(id). Owns the canonical phone/email
     * + OTP state; we don't manage credentials ourselves. Nullable so we can
     * still auto-create a user from a Telegram-first signup before they bind
     * a real phone via OTP.
     */
    supabaseUserId: uuid("supabase_user_id"),
    phoneE164: varchar("phone_e164", { length: 32 }).notNull(),
    displayName: text("display_name"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("America/New_York"),
    active: boolean("active").notNull().default(true),
    // Subscription tier — see src/auth/tiers.ts. Default new users to a 30-day
    // trial. Stripe webhook toggles regular/athlete; admin script can grant
    // comped (and set tierOverriddenByAdmin so Stripe webhooks won't undo it).
    tier: varchar("tier", { length: 16 }).notNull().default("trial"),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }).notNull().defaultNow(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
    /**
     * Largest `event.created` (unix seconds) we've already processed for this
     * customer. The Stripe webhook skips any event whose `created` is <= this
     * value, so out-of-order deliveries (e.g. a delayed `deleted` arriving
     * after a re-`created`) can't downgrade a paying user. Updated atomically
     * with the tier write in applyTierFromStripe().
     */
    stripeLastEventEpoch: integer("stripe_last_event_epoch").notNull().default(0),
    tierOverriddenByAdmin: boolean("tier_overridden_by_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex("users_phone_idx").on(t.phoneE164),
    supabaseIdx: uniqueIndex("users_supabase_idx").on(t.supabaseUserId),
  })
);

/**
 * Bind external channel identities (Telegram chat_id, WhatsApp number, etc.)
 * to a user. A user can have multiple rows (one per channel they use).
 */
export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 16 }).notNull(), // telegram | whatsapp | sms | web
    externalId: varchar("external_id", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chanExtIdx: uniqueIndex("channel_identities_chan_ext_idx").on(t.channel, t.externalId),
    userIdx: index("channel_identities_user_idx").on(t.userId),
  })
);

// Auth lives in Supabase's auth.* schema; we don't define our own tables for
// OTPs or sessions. `users.supabase_user_id` joins to auth.users(id).

// ─────────────────────────────────────────────────────────────────────────────
// Coaching content
// ─────────────────────────────────────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  coachingPriorities: text("coaching_priorities"),
  goals: jsonb("goals"),
  equipment: text("equipment"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const learnings = pgTable("learnings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Workouts + PRs
// ─────────────────────────────────────────────────────────────────────────────

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    isoWeek: varchar("iso_week", { length: 8 }).notNull(), // 2026-W05
    type: text("type").notNull(),
    status: varchar("status", { length: 16 }).notNull(), // in_progress | completed | abandoned
    location: text("location"),
    plannedDay: text("planned_day"),
    backFilled: boolean("back_filled").notNull().default(false),
    startedAt: varchar("started_at", { length: 8 }), // HH:MM local
    finishedAt: varchar("finished_at", { length: 8 }),
    durationMinutes: integer("duration_minutes"),
    energyLevel: integer("energy_level"),
    summary: text("summary"),
    recoverySnapshot: jsonb("recovery_snapshot"), // {recovery_score, sleep_hours, hrv, etc.}
    warmupCompleted: boolean("warmup_completed"),
    cooldownCompleted: boolean("cooldown_completed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDateIdx: uniqueIndex("workouts_user_date_idx").on(t.userId, t.date),
    userWeekIdx: index("workouts_user_week_idx").on(t.userId, t.isoWeek),
  })
);

export const workoutExercises = pgTable(
  "workout_exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
  },
  (t) => ({
    workoutIdx: index("workout_exercises_workout_idx").on(t.workoutId),
    workoutOrderIdx: uniqueIndex("workout_exercises_workout_idx_unique").on(t.workoutId, t.idx),
  })
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    reps: integer("reps").notNull(),
    weight: real("weight"), // null when weight is bodyweight expression
    weightText: text("weight_text"), // raw weight as logged (e.g., "BW+25")
    rpe: real("rpe"),
  },
  (t) => ({
    exerciseIdx: index("workout_sets_exercise_idx").on(t.exerciseId),
    exerciseOrderIdx: uniqueIndex("workout_sets_exercise_idx_unique").on(t.exerciseId, t.idx),
  })
);

export const prs = pgTable(
  "prs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exercise: text("exercise").notNull(),
    weight: real("weight").notNull(),
    reps: integer("reps").notNull(),
    date: date("date").notNull(),
    estimated1Rm: real("estimated_1rm"),
    isCurrent: boolean("is_current").notNull().default(true),
    workoutId: uuid("workout_id").references(() => workouts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userExerciseIdx: index("prs_user_exercise_idx").on(t.userId, t.exercise),
    userCurrentIdx: index("prs_user_current_idx").on(t.userId, t.exercise, t.isCurrent),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Plans + retros
// ─────────────────────────────────────────────────────────────────────────────

export const weeklyPlans = pgTable(
  "weekly_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isoWeek: varchar("iso_week", { length: 8 }).notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWeekIdx: uniqueIndex("weekly_plans_user_week_idx").on(t.userId, t.isoWeek),
  })
);

export const weeklyRetros = pgTable(
  "weekly_retros",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isoWeek: varchar("iso_week", { length: 8 }).notNull(),
    body: text("body").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWeekIdx: uniqueIndex("weekly_retros_user_week_idx").on(t.userId, t.isoWeek),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Conversation history
// ─────────────────────────────────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 16 }).notNull().default("telegram"),
    role: varchar("role", { length: 16 }).notNull(), // user | assistant
    text: text("text").notNull(),
    meta: jsonb("meta"), // { hasImage: true, voiceFileId: "..." }
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTsIdx: index("messages_user_ts_idx").on(t.userId, t.ts),
  })
);

export const conversationSummaries = pgTable("conversation_summaries", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  asOfDate: date("as_of_date").notNull(),
  messageCount: integer("message_count"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Reminders
// ─────────────────────────────────────────────────────────────────────────────

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggerDate: date("trigger_date").notNull(),
    triggerHour: integer("trigger_hour").notNull(),
    message: text("message").notNull(),
    context: text("context"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dueIdx: index("reminders_due_idx").on(t.triggerDate, t.triggerHour),
    userIdx: index("reminders_user_idx").on(t.userId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Device integrations
// ─────────────────────────────────────────────────────────────────────────────

export const integrationTokens = pgTable(
  "integration_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    externalUserId: varchar("external_user_id", { length: 128 }),
    scopes: text("scopes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProviderIdx: uniqueIndex("integration_tokens_user_provider_idx").on(t.userId, t.provider),
    externalIdx: index("integration_tokens_external_idx").on(t.provider, t.externalUserId),
  })
);

export const integrationMetrics = pgTable(
  "integration_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    date: date("date").notNull(),
    kind: varchar("kind", { length: 16 }).notNull(), // sleep | recovery | workout
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("integration_metrics_uniq").on(t.userId, t.provider, t.date, t.kind),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Inbox (idempotent webhook queue)
// ─────────────────────────────────────────────────────────────────────────────

export const inboxEvents = pgTable(
  "inbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: varchar("channel", { length: 16 }).notNull(),
    externalUpdateId: varchar("external_update_id", { length: 128 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("inbox_events_uniq").on(t.channel, t.externalUpdateId),
    pendingIdx: index("inbox_events_pending_idx").on(t.status, t.nextAttemptAt),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook idempotency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record of every Stripe event we've successfully begun processing. Used to
 * dedupe Stripe's at-least-once webhook deliveries: the handler does an
 * INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id and short-circuits if
 * no row comes back. See src/handlers/stripe.ts.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // Stripe's event.id ("evt_...")
    type: varchar("type", { length: 64 }).notNull(),
    createdEpoch: integer("created_epoch").notNull(), // event.created (unix seconds)
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index("stripe_events_type_idx").on(t.type),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Progress photos
// ─────────────────────────────────────────────────────────────────────────────

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(), // e.g. "<userId>/<photoId>.jpg"
    bucket: varchar("bucket", { length: 64 }).notNull().default("progress-photos"),
    contentType: varchar("content_type", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    caption: text("caption"),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    sourceChannel: varchar("source_channel", { length: 16 }).notNull().default("telegram"),
    sourceMessageId: varchar("source_message_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTimeIdx: index("photos_user_taken_idx").on(t.userId, t.takenAt),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Observability
// ─────────────────────────────────────────────────────────────────────────────

export const toolCallLog = pgTable(
  "tool_call_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    turnId: varchar("turn_id", { length: 32 }).notNull(),
    handler: varchar("handler", { length: 32 }),
    tool: varchar("tool", { length: 64 }).notNull(),
    args: jsonb("args"),
    ok: boolean("ok").notNull(),
    ms: integer("ms"),
    resultPreview: text("result_preview"),
    error: text("error"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTsIdx: index("tool_call_log_user_ts_idx").on(t.userId, t.ts),
    turnIdx: index("tool_call_log_turn_idx").on(t.turnId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Type exports — used by Storage layer and tools
// ─────────────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChannelIdentity = typeof channelIdentities.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;
export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type NewWorkoutSet = typeof workoutSets.$inferInsert;
export type Pr = typeof prs.$inferSelect;
export type NewPr = typeof prs.$inferInsert;
export type WeeklyPlan = typeof weeklyPlans.$inferSelect;
export type WeeklyRetro = typeof weeklyRetros.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ConversationSummary = typeof conversationSummaries.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
export type IntegrationToken = typeof integrationTokens.$inferSelect;
export type NewIntegrationToken = typeof integrationTokens.$inferInsert;
export type IntegrationMetric = typeof integrationMetrics.$inferSelect;
export type InboxEvent = typeof inboxEvents.$inferSelect;
export type NewInboxEvent = typeof inboxEvents.$inferInsert;
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type NewStripeEvent = typeof stripeEvents.$inferInsert;
export type ToolCallLogEntry = typeof toolCallLog.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
