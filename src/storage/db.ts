/**
 * Postgres implementation of the Storage interface.
 *
 * All multi-step mutations (start_workout, complete_workout, edit_exercise…)
 * run inside a single Drizzle transaction so a crash mid-tool can't leave
 * the DB half-updated. Concurrency on the same user is handled by the inbox
 * worker's advisory lock — Storage doesn't lock on its own.
 */

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  conversationSummaries,
  integrationMetrics,
  integrationTokens,
  learnings,
  messages,
  prs,
  profiles,
  reminders,
  weeklyPlans,
  weeklyRetros,
  workoutExercises,
  workoutSets,
  workouts,
  type Workout,
  type Pr,
  type WeeklyPlan,
  type WeeklyRetro,
  type Message,
  type ConversationSummary,
  type Reminder,
  type NewReminder,
  type IntegrationToken,
  type NewIntegrationToken,
  type IntegrationMetric,
} from "../db/schema.js";
import type {
  LoggedSetInput,
  MessageInput,
  PrInput,
  Storage,
  UserId,
  WorkoutSummary,
  WorkoutWithDetails,
} from "./storage.js";

const MAX_RECENT_MESSAGES = 200;

export class DbStorage implements Storage {
  private get db() {
    return getDb();
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async readProfile(userId: UserId) {
    const rows = await this.db
      .select({ body: profiles.body, coachingPriorities: profiles.coachingPriorities })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async writeProfile(userId: UserId, body: string, coachingPriorities?: string | null) {
    await this.db
      .insert(profiles)
      .values({ userId, body, coachingPriorities: coachingPriorities ?? null })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { body, coachingPriorities: coachingPriorities ?? null, updatedAt: new Date() },
      });
  }

  // ── Learnings ────────────────────────────────────────────────────────────

  async readLearnings(userId: UserId) {
    const rows = await this.db
      .select({ body: learnings.body })
      .from(learnings)
      .where(eq(learnings.userId, userId))
      .limit(1);
    return rows[0]?.body ?? null;
  }

  async writeLearnings(userId: UserId, body: string) {
    await this.db
      .insert(learnings)
      .values({ userId, body })
      .onConflictDoUpdate({
        target: learnings.userId,
        set: { body, updatedAt: new Date() },
      });
  }

  async appendLearning(userId: UserId, entry: string) {
    const existing = await this.readLearnings(userId);
    const next = existing ? `${existing.trimEnd()}\n\n${entry.trim()}\n` : `${entry.trim()}\n`;
    await this.writeLearnings(userId, next);
  }

  // ── PRs ──────────────────────────────────────────────────────────────────

  async readPRs(userId: UserId): Promise<Pr[]> {
    return this.db
      .select()
      .from(prs)
      .where(eq(prs.userId, userId))
      .orderBy(asc(prs.exercise), desc(prs.date));
  }

  async upsertPR(userId: UserId, pr: PrInput): Promise<Pr> {
    return this.db.transaction(async (tx) => {
      // Mark prior current PR for this exercise as historical.
      await tx
        .update(prs)
        .set({ isCurrent: false })
        .where(and(eq(prs.userId, userId), eq(prs.exercise, pr.exercise), eq(prs.isCurrent, true)));

      const [row] = await tx
        .insert(prs)
        .values({
          userId,
          exercise: pr.exercise,
          weight: pr.weight,
          reps: pr.reps,
          date: pr.date,
          estimated1Rm: pr.estimated1Rm ?? null,
          workoutId: pr.workoutId ?? null,
          isCurrent: true,
        })
        .returning();
      return row;
    });
  }

  // ── Plans + retros ───────────────────────────────────────────────────────

  async readWeeklyPlan(userId: UserId, isoWeek: string): Promise<WeeklyPlan | null> {
    const rows = await this.db
      .select()
      .from(weeklyPlans)
      .where(and(eq(weeklyPlans.userId, userId), eq(weeklyPlans.isoWeek, isoWeek)))
      .limit(1);
    return rows[0] ?? null;
  }

  async writeWeeklyPlan(userId: UserId, isoWeek: string, body: string) {
    await this.db
      .insert(weeklyPlans)
      .values({ userId, isoWeek, body })
      .onConflictDoUpdate({
        target: [weeklyPlans.userId, weeklyPlans.isoWeek],
        set: { body, updatedAt: new Date() },
      });
  }

  async readWeeklyRetro(userId: UserId, isoWeek: string): Promise<WeeklyRetro | null> {
    const rows = await this.db
      .select()
      .from(weeklyRetros)
      .where(and(eq(weeklyRetros.userId, userId), eq(weeklyRetros.isoWeek, isoWeek)))
      .limit(1);
    return rows[0] ?? null;
  }

  async writeWeeklyRetro(userId: UserId, isoWeek: string, body: string) {
    await this.db
      .insert(weeklyRetros)
      .values({ userId, isoWeek, body })
      .onConflictDoUpdate({
        target: [weeklyRetros.userId, weeklyRetros.isoWeek],
        set: { body, generatedAt: new Date() },
      });
  }

  // ── Workouts ─────────────────────────────────────────────────────────────

  async getWorkout(userId: UserId, date: string): Promise<WorkoutWithDetails | null> {
    const [workout] = await this.db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.date, date)))
      .limit(1);
    if (!workout) return null;

    const exercises = await this.db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workout.id))
      .orderBy(asc(workoutExercises.idx));

    const setsByExercise: Record<string, (typeof workoutSets.$inferSelect)[]> = {};
    if (exercises.length > 0) {
      const exIds = exercises.map((e) => e.id);
      const allSets = await this.db
        .select()
        .from(workoutSets)
        .where(sql`${workoutSets.exerciseId} = ANY(${exIds})`)
        .orderBy(asc(workoutSets.exerciseId), asc(workoutSets.idx));
      for (const s of allSets) {
        (setsByExercise[s.exerciseId] ??= []).push(s);
      }
    }

    return {
      ...workout,
      exercises: exercises.map((ex) => ({ ...ex, sets: setsByExercise[ex.id] ?? [] })),
    };
  }

  async listWorkouts(
    userId: UserId,
    opts: { isoWeek?: string; limit?: number } = {}
  ): Promise<WorkoutSummary[]> {
    const conditions = [eq(workouts.userId, userId)];
    if (opts.isoWeek) conditions.push(eq(workouts.isoWeek, opts.isoWeek));

    const rows = await this.db
      .select({
        id: workouts.id,
        date: workouts.date,
        isoWeek: workouts.isoWeek,
        type: workouts.type,
        status: workouts.status,
        durationMinutes: workouts.durationMinutes,
        energyLevel: workouts.energyLevel,
        exerciseCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${workoutExercises} WHERE ${workoutExercises.workoutId} = ${workouts.id}
        )`,
        setCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${workoutSets}
          WHERE ${workoutSets.exerciseId} IN (
            SELECT id FROM ${workoutExercises} WHERE ${workoutExercises.workoutId} = ${workouts.id}
          )
        )`,
      })
      .from(workouts)
      .where(and(...conditions))
      .orderBy(desc(workouts.date))
      .limit(opts.limit ?? 50);

    return rows.map((r) => ({ ...r, date: String(r.date) }));
  }

  async getExerciseHistory(
    userId: UserId,
    exerciseName: string,
    limit = 10
  ): Promise<
    Array<{
      date: string;
      type: string;
      sets: { weight: number | string | null; reps: number; rpe: number | null }[];
      notes: string | null;
    }>
  > {
    // One query: join workouts → workout_exercises → workout_sets, scoped to
    // this user and a case-insensitive substring match on exercise name.
    const rows = await this.db
      .select({
        date: workouts.date,
        type: workouts.type,
        exerciseId: workoutExercises.id,
        exerciseName: workoutExercises.name,
        notes: workoutExercises.notes,
        setIdx: workoutSets.idx,
        reps: workoutSets.reps,
        weight: workoutSets.weight,
        weightText: workoutSets.weightText,
        rpe: workoutSets.rpe,
      })
      .from(workouts)
      .innerJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
      .leftJoin(workoutSets, eq(workoutSets.exerciseId, workoutExercises.id))
      .where(
        and(
          eq(workouts.userId, userId),
          sql`lower(${workoutExercises.name}) LIKE lower(${"%" + exerciseName + "%"})`
        )
      )
      .orderBy(desc(workouts.date), asc(workoutExercises.idx), asc(workoutSets.idx));

    // Group by exerciseId, preserving order. Cap result count at `limit`
    // distinct exercise instances (each workout date can contain multiple
    // matches if the lift appears more than once).
    const byExercise = new Map<
      string,
      {
        date: string;
        type: string;
        sets: { weight: number | string | null; reps: number; rpe: number | null }[];
        notes: string | null;
      }
    >();
    for (const r of rows) {
      let bucket = byExercise.get(r.exerciseId);
      if (!bucket) {
        bucket = { date: String(r.date), type: r.type, sets: [], notes: r.notes };
        byExercise.set(r.exerciseId, bucket);
      }
      if (r.setIdx !== null && r.reps !== null) {
        const weight = r.weight !== null ? r.weight : r.weightText;
        bucket.sets.push({ weight, reps: r.reps, rpe: r.rpe });
      }
    }
    return Array.from(byExercise.values()).slice(0, limit);
  }

  async listWeekDates(userId: UserId, isoWeek: string) {
    const rows = await this.db
      .select({ date: workouts.date, type: workouts.type, status: workouts.status })
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.isoWeek, isoWeek)))
      .orderBy(asc(workouts.date));
    return rows.map((r) => ({ date: String(r.date), type: r.type, status: r.status }));
  }

  async startWorkout(
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
  ): Promise<Workout> {
    const existing = await this.db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.date, input.date)))
      .limit(1);
    if (existing[0]) return existing[0];

    const [row] = await this.db
      .insert(workouts)
      .values({
        userId,
        date: input.date,
        isoWeek: input.isoWeek,
        type: input.type,
        status: "in_progress",
        location: input.location,
        plannedDay: input.plannedDay,
        backFilled: input.backFilled,
        startedAt: input.startedAt,
      })
      .returning();
    return row;
  }

  async appendExerciseSets(
    userId: UserId,
    workoutId: string,
    exerciseName: string,
    sets: LoggedSetInput[],
    notes?: string
  ) {
    return this.db.transaction(async (tx) => {
      // Verify workout belongs to user and isn't completed.
      const [w] = await tx
        .select({ status: workouts.status })
        .from(workouts)
        .where(and(eq(workouts.userId, userId), eq(workouts.id, workoutId)))
        .limit(1);
      if (!w) throw new Error(`workout ${workoutId} not found for user`);
      if (w.status === "completed") {
        throw new Error("workout already completed");
      }

      // Find or create the exercise row (case-insensitive match on name).
      const [existing] = await tx
        .select()
        .from(workoutExercises)
        .where(
          and(
            eq(workoutExercises.workoutId, workoutId),
            sql`lower(${workoutExercises.name}) = lower(${exerciseName})`
          )
        )
        .limit(1);

      let exerciseId: string;
      let startIdx: number;
      if (existing) {
        exerciseId = existing.id;
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(workoutSets)
          .where(eq(workoutSets.exerciseId, exerciseId));
        startIdx = count;
        if (notes) {
          await tx
            .update(workoutExercises)
            .set({ notes })
            .where(eq(workoutExercises.id, exerciseId));
        }
      } else {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(workoutExercises)
          .where(eq(workoutExercises.workoutId, workoutId));
        const [created] = await tx
          .insert(workoutExercises)
          .values({ workoutId, idx: count, name: exerciseName, notes: notes ?? null })
          .returning();
        exerciseId = created.id;
        startIdx = 0;
      }

      // Idempotency: if the user is re-logging the exact same trailing run of
      // sets (same weights, reps, RPE in order), skip.
      const recent = await tx
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.exerciseId, exerciseId))
        .orderBy(asc(workoutSets.idx));
      const trail = recent.slice(-sets.length);
      const trailMatches =
        trail.length === sets.length &&
        trail.every((existingSet, i) => {
          const incoming = sets[i];
          const incomingWeight = typeof incoming.weight === "number" ? incoming.weight : null;
          const incomingText = typeof incoming.weight === "string" ? incoming.weight : null;
          return (
            existingSet.reps === incoming.reps &&
            existingSet.weight === incomingWeight &&
            existingSet.weightText === incomingText &&
            (existingSet.rpe ?? null) === (incoming.rpe ?? null)
          );
        });
      if (trailMatches && sets.length > 0) {
        return { exerciseId, addedSetCount: 0, noop: true };
      }

      const newRows = sets.map((s, i) => ({
        exerciseId,
        idx: startIdx + i,
        reps: s.reps,
        weight: typeof s.weight === "number" ? s.weight : null,
        weightText: typeof s.weight === "string" ? s.weight : null,
        rpe: s.rpe ?? null,
      }));
      if (newRows.length > 0) {
        await tx.insert(workoutSets).values(newRows);
      }

      await tx
        .update(workouts)
        .set({ updatedAt: new Date() })
        .where(eq(workouts.id, workoutId));

      return { exerciseId, addedSetCount: newRows.length, noop: false };
    });
  }

  async removeExercise(userId: UserId, workoutId: string, exerciseName: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [w] = await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.userId, userId), eq(workouts.id, workoutId)))
        .limit(1);
      if (!w) return false;

      const [ex] = await tx
        .select({ id: workoutExercises.id })
        .from(workoutExercises)
        .where(
          and(
            eq(workoutExercises.workoutId, workoutId),
            sql`lower(${workoutExercises.name}) = lower(${exerciseName})`
          )
        )
        .limit(1);
      if (!ex) return false;

      await tx.delete(workoutExercises).where(eq(workoutExercises.id, ex.id));
      return true;
    });
  }

  async editExercise(
    userId: UserId,
    workoutId: string,
    exerciseName: string,
    newSets: LoggedSetInput[],
    notes?: string
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [w] = await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.userId, userId), eq(workouts.id, workoutId)))
        .limit(1);
      if (!w) return false;

      const [ex] = await tx
        .select({ id: workoutExercises.id })
        .from(workoutExercises)
        .where(
          and(
            eq(workoutExercises.workoutId, workoutId),
            sql`lower(${workoutExercises.name}) = lower(${exerciseName})`
          )
        )
        .limit(1);
      if (!ex) return false;

      await tx.delete(workoutSets).where(eq(workoutSets.exerciseId, ex.id));
      if (newSets.length > 0) {
        await tx.insert(workoutSets).values(
          newSets.map((s, i) => ({
            exerciseId: ex.id,
            idx: i,
            reps: s.reps,
            weight: typeof s.weight === "number" ? s.weight : null,
            weightText: typeof s.weight === "string" ? s.weight : null,
            rpe: s.rpe ?? null,
          }))
        );
      }
      if (notes !== undefined) {
        await tx
          .update(workoutExercises)
          .set({ notes: notes || null })
          .where(eq(workoutExercises.id, ex.id));
      }
      return true;
    });
  }

  async completeWorkout(
    userId: UserId,
    workoutId: string,
    input: {
      summary: string;
      energyLevel: number;
      status: "completed" | "abandoned";
      finishedAt: string;
      durationMinutes: number;
      prs?: PrInput[];
    }
  ): Promise<Workout> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(workouts)
        .set({
          status: input.status,
          finishedAt: input.finishedAt,
          durationMinutes: input.durationMinutes,
          energyLevel: input.energyLevel,
          summary: input.summary,
          updatedAt: new Date(),
        })
        .where(and(eq(workouts.userId, userId), eq(workouts.id, workoutId)))
        .returning();
      if (!updated) throw new Error(`workout ${workoutId} not found`);

      for (const pr of input.prs ?? []) {
        await tx
          .update(prs)
          .set({ isCurrent: false })
          .where(
            and(eq(prs.userId, userId), eq(prs.exercise, pr.exercise), eq(prs.isCurrent, true))
          );
        await tx.insert(prs).values({
          userId,
          exercise: pr.exercise,
          weight: pr.weight,
          reps: pr.reps,
          date: pr.date,
          estimated1Rm: pr.estimated1Rm ?? null,
          workoutId,
          isCurrent: true,
        });
      }

      return updated;
    });
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  async addMessage(userId: UserId, msg: MessageInput): Promise<Message> {
    const [row] = await this.db
      .insert(messages)
      .values({
        userId,
        channel: msg.channel ?? "telegram",
        role: msg.role,
        text: msg.text,
        meta: msg.meta ?? null,
      })
      .returning();
    return row;
  }

  async getRecentMessages(userId: UserId, count: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.ts))
      .limit(Math.min(count, MAX_RECENT_MESSAGES));
    return rows.reverse();
  }

  async getMessagesSince(userId: UserId, sinceMs: number): Promise<Message[]> {
    const cutoff = new Date(sinceMs);
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId), gte(messages.ts, cutoff)))
      .orderBy(asc(messages.ts));
    return rows;
  }

  async clearMessages(userId: UserId): Promise<void> {
    await this.db.delete(messages).where(eq(messages.userId, userId));
  }

  // ── Conversation summary ─────────────────────────────────────────────────

  async readConversationSummary(userId: UserId): Promise<ConversationSummary | null> {
    const rows = await this.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async writeConversationSummary(userId: UserId, body: string, asOfDate: string, messageCount: number) {
    await this.db
      .insert(conversationSummaries)
      .values({ userId, body, asOfDate, messageCount })
      .onConflictDoUpdate({
        target: conversationSummaries.userId,
        set: { body, asOfDate, messageCount, updatedAt: new Date() },
      });
  }

  // ── Reminders ────────────────────────────────────────────────────────────

  async getReminders(userId: UserId): Promise<Reminder[]> {
    return this.db.select().from(reminders).where(eq(reminders.userId, userId));
  }

  async getDueReminders(userId: UserId, triggerDate: string, triggerHour: number) {
    return this.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.triggerDate, triggerDate),
          eq(reminders.triggerHour, triggerHour)
        )
      );
  }

  async addReminder(
    userId: UserId,
    r: Omit<NewReminder, "userId" | "id" | "createdAt">
  ): Promise<Reminder> {
    const [row] = await this.db.insert(reminders).values({ ...r, userId }).returning();
    return row;
  }

  async deleteReminder(userId: UserId, id: string) {
    await this.db.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.id, id)));
  }

  async deleteRemindersByContext(userId: UserId, context: string): Promise<number> {
    const deleted = await this.db
      .delete(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.context, context)))
      .returning({ id: reminders.id });
    return deleted.length;
  }

  // ── Integration tokens ───────────────────────────────────────────────────

  async getIntegrationToken(userId: UserId, provider: string): Promise<IntegrationToken | null> {
    const rows = await this.db
      .select()
      .from(integrationTokens)
      .where(and(eq(integrationTokens.userId, userId), eq(integrationTokens.provider, provider)))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertIntegrationToken(
    userId: UserId,
    provider: string,
    token: Omit<NewIntegrationToken, "userId" | "provider" | "id" | "updatedAt">
  ): Promise<IntegrationToken> {
    const [row] = await this.db
      .insert(integrationTokens)
      .values({ ...token, userId, provider })
      .onConflictDoUpdate({
        target: [integrationTokens.userId, integrationTokens.provider],
        set: {
          accessTokenEnc: token.accessTokenEnc,
          refreshTokenEnc: token.refreshTokenEnc ?? null,
          expiresAt: token.expiresAt ?? null,
          externalUserId: token.externalUserId ?? null,
          scopes: token.scopes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async findUserByExternalIntegrationId(provider: string, externalUserId: string): Promise<UserId | null> {
    const [row] = await this.db
      .select({ userId: integrationTokens.userId })
      .from(integrationTokens)
      .where(
        and(eq(integrationTokens.provider, provider), eq(integrationTokens.externalUserId, externalUserId))
      )
      .limit(1);
    return row?.userId ?? null;
  }

  // ── Integration metrics ──────────────────────────────────────────────────

  async upsertIntegrationMetric(
    userId: UserId,
    provider: string,
    date: string,
    kind: "sleep" | "recovery" | "workout",
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.db
      .insert(integrationMetrics)
      .values({ userId, provider, date, kind, payload })
      .onConflictDoUpdate({
        target: [
          integrationMetrics.userId,
          integrationMetrics.provider,
          integrationMetrics.date,
          integrationMetrics.kind,
        ],
        set: { payload },
      });

    // Mirror key metrics into the workouts.recoverySnapshot column so the
    // coach can see them in context without a join.
    if (kind === "recovery" || kind === "sleep") {
      const [workout] = await this.db
        .select({ id: workouts.id, snapshot: workouts.recoverySnapshot })
        .from(workouts)
        .where(and(eq(workouts.userId, userId), eq(workouts.date, date)))
        .limit(1);
      if (workout) {
        const merged = { ...(workout.snapshot as Record<string, unknown> | null), [kind]: payload };
        await this.db
          .update(workouts)
          .set({ recoverySnapshot: merged })
          .where(eq(workouts.id, workout.id));
      }
    }
  }

  async getIntegrationMetrics(userId: UserId, date: string): Promise<IntegrationMetric[]> {
    return this.db
      .select()
      .from(integrationMetrics)
      .where(and(eq(integrationMetrics.userId, userId), eq(integrationMetrics.date, date)));
  }
}

let cached: DbStorage | null = null;

export function getStorage(): DbStorage {
  if (!cached) cached = new DbStorage();
  return cached;
}
