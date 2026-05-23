/**
 * DbStorage unit tests — run against an in-memory Postgres (pg-mem) with the
 * real Drizzle migration applied.
 *
 * Goal: every method on DbStorage is exercised, and user-scoping is verified
 * end to end (user A's writes never appear under user B).
 */

import { createMemDb, seedUser, getMemDb } from "../../tests/helpers/pgmem.js";
import { getStorage, DbStorage } from "./db.js";

describe("DbStorage", () => {
  let storage: DbStorage;
  let alice: string;
  let bob: string;

  beforeAll(() => {
    createMemDb();
  });

  afterAll(() => {
    getMemDb().close();
  });

  beforeEach(async () => {
    getMemDb().reset();
    storage = getStorage();
    alice = await seedUser({ displayName: "Alice" });
    bob = await seedUser({ displayName: "Bob" });
  });

  // ── Profile ────────────────────────────────────────────────────────────────
  describe("profile", () => {
    it("returns null for missing profile", async () => {
      expect(await storage.readProfile(alice)).toBeNull();
    });

    it("writes and reads a profile", async () => {
      await storage.writeProfile(alice, "# Alice's profile", "Form first");
      const p = await storage.readProfile(alice);
      expect(p?.body).toBe("# Alice's profile");
      expect(p?.coachingPriorities).toBe("Form first");
    });

    it("writeProfile upserts (no duplicate rows)", async () => {
      await storage.writeProfile(alice, "v1");
      await storage.writeProfile(alice, "v2");
      const p = await storage.readProfile(alice);
      expect(p?.body).toBe("v2");
    });

    it("scopes profiles by userId", async () => {
      await storage.writeProfile(alice, "alice's");
      await storage.writeProfile(bob, "bob's");
      expect((await storage.readProfile(alice))?.body).toBe("alice's");
      expect((await storage.readProfile(bob))?.body).toBe("bob's");
    });
  });

  // ── Learnings ──────────────────────────────────────────────────────────────
  describe("learnings", () => {
    it("returns null when none exist", async () => {
      expect(await storage.readLearnings(alice)).toBeNull();
    });

    it("writes and reads learnings", async () => {
      await storage.writeLearnings(alice, "raw body");
      expect(await storage.readLearnings(alice)).toBe("raw body");
    });

    it("upserts (no duplicates)", async () => {
      await storage.writeLearnings(alice, "v1");
      await storage.writeLearnings(alice, "v2");
      expect(await storage.readLearnings(alice)).toBe("v2");
    });

    it("appendLearning concatenates entries", async () => {
      await storage.appendLearning(alice, "- first");
      await storage.appendLearning(alice, "- second");
      const body = await storage.readLearnings(alice);
      expect(body).toContain("- first");
      expect(body).toContain("- second");
    });

    it("scopes learnings by userId", async () => {
      await storage.appendLearning(alice, "alice-only");
      expect(await storage.readLearnings(bob)).toBeNull();
    });
  });

  // ── PRs ────────────────────────────────────────────────────────────────────
  describe("PRs", () => {
    it("upsertPR inserts a current PR", async () => {
      const pr = await storage.upsertPR(alice, {
        exercise: "Bench",
        weight: 170,
        reps: 5,
        date: "2026-02-15",
        estimated1Rm: 197,
      });
      expect(pr.isCurrent).toBe(true);
      expect(pr.weight).toBe(170);
    });

    it("upsertPR marks prior current row as historical", async () => {
      await storage.upsertPR(alice, {
        exercise: "Bench",
        weight: 170,
        reps: 5,
        date: "2026-02-15",
      });
      await storage.upsertPR(alice, {
        exercise: "Bench",
        weight: 175,
        reps: 5,
        date: "2026-03-01",
      });
      const rows = await storage.readPRs(alice);
      const bench = rows.filter((r) => r.exercise === "Bench");
      expect(bench).toHaveLength(2);
      const current = bench.filter((r) => r.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0].weight).toBe(175);
    });

    it("returns all PRs across exercises", async () => {
      await storage.upsertPR(alice, {
        exercise: "Bench",
        weight: 170,
        reps: 5,
        date: "2026-02-15",
      });
      await storage.upsertPR(alice, {
        exercise: "Squat",
        weight: 225,
        reps: 5,
        date: "2026-02-10",
      });
      const rows = await storage.readPRs(alice);
      expect(rows).toHaveLength(2);
    });

    it("scopes PRs by userId", async () => {
      await storage.upsertPR(alice, {
        exercise: "Bench",
        weight: 170,
        reps: 5,
        date: "2026-02-15",
      });
      expect(await storage.readPRs(bob)).toEqual([]);
    });
  });

  // ── Plans + retros ─────────────────────────────────────────────────────────
  describe("plans + retros", () => {
    it("writes and reads weekly plan", async () => {
      await storage.writeWeeklyPlan(alice, "2026-W21", "# Plan");
      const p = await storage.readWeeklyPlan(alice, "2026-W21");
      expect(p?.body).toBe("# Plan");
    });

    it("upserts plan by (user, isoWeek)", async () => {
      await storage.writeWeeklyPlan(alice, "2026-W21", "v1");
      await storage.writeWeeklyPlan(alice, "2026-W21", "v2");
      const p = await storage.readWeeklyPlan(alice, "2026-W21");
      expect(p?.body).toBe("v2");
    });

    it("writes and reads retros", async () => {
      await storage.writeWeeklyRetro(alice, "2026-W21", "# Retro");
      const r = await storage.readWeeklyRetro(alice, "2026-W21");
      expect(r?.body).toBe("# Retro");
    });

    it("scopes plans by userId", async () => {
      await storage.writeWeeklyPlan(alice, "2026-W21", "alice");
      expect(await storage.readWeeklyPlan(bob, "2026-W21")).toBeNull();
    });
  });

  // ── Workouts ───────────────────────────────────────────────────────────────
  describe("workouts", () => {
    const startInput = {
      date: "2026-05-20",
      isoWeek: "2026-W21",
      type: "upper",
      backFilled: false,
      startedAt: "10:00",
    };

    it("startWorkout creates a new workout", async () => {
      const w = await storage.startWorkout(alice, startInput);
      expect(w.status).toBe("in_progress");
      expect(w.type).toBe("upper");
    });

    it("startWorkout is idempotent on same date", async () => {
      const a = await storage.startWorkout(alice, startInput);
      const b = await storage.startWorkout(alice, startInput);
      expect(a.id).toBe(b.id);
    });

    it("appendExerciseSets creates exercise on first call, appends on second", async () => {
      const w = await storage.startWorkout(alice, startInput);
      const r1 = await storage.appendExerciseSets(alice, w.id, "Bench Press", [
        { reps: 5, weight: 175, rpe: 7 },
      ]);
      expect(r1.noop).toBe(false);
      expect(r1.addedSetCount).toBe(1);

      const r2 = await storage.appendExerciseSets(alice, w.id, "Bench Press", [
        { reps: 5, weight: 175, rpe: 7 },
      ]);
      // Same trailing set → noop
      expect(r2.noop).toBe(true);
      expect(r2.exerciseId).toBe(r1.exerciseId);

      const r3 = await storage.appendExerciseSets(alice, w.id, "Bench Press", [
        { reps: 5, weight: 180, rpe: 8 },
      ]);
      expect(r3.noop).toBe(false);
      expect(r3.addedSetCount).toBe(1);
    });

    it("appendExerciseSets is case-insensitive on exercise name", async () => {
      const w = await storage.startWorkout(alice, startInput);
      const r1 = await storage.appendExerciseSets(alice, w.id, "Bench Press", [
        { reps: 5, weight: 175 },
      ]);
      const r2 = await storage.appendExerciseSets(alice, w.id, "BENCH press", [
        { reps: 5, weight: 180 },
      ]);
      expect(r2.exerciseId).toBe(r1.exerciseId);
    });

    it("appendExerciseSets rejects appending to completed workout", async () => {
      const w = await storage.startWorkout(alice, startInput);
      await storage.appendExerciseSets(alice, w.id, "Bench", [
        { reps: 5, weight: 175 },
      ]);
      await storage.completeWorkout(alice, w.id, {
        summary: "done",
        energyLevel: 8,
        status: "completed",
        finishedAt: "11:00",
        durationMinutes: 60,
      });
      await expect(
        storage.appendExerciseSets(alice, w.id, "OHP", [
          { reps: 5, weight: 105 },
        ])
      ).rejects.toThrow(/completed/);
    });

    it("removeExercise deletes the exercise + sets", async () => {
      const w = await storage.startWorkout(alice, startInput);
      await storage.appendExerciseSets(alice, w.id, "Bench", [
        { reps: 5, weight: 175 },
      ]);
      const removed = await storage.removeExercise(alice, w.id, "Bench");
      expect(removed).toBe(true);
      const got = await storage.getWorkout(alice, startInput.date);
      expect(got?.exercises).toHaveLength(0);
    });

    it("removeExercise returns false when exercise is missing", async () => {
      const w = await storage.startWorkout(alice, startInput);
      expect(await storage.removeExercise(alice, w.id, "Nope")).toBe(false);
    });

    it("editExercise replaces sets", async () => {
      const w = await storage.startWorkout(alice, startInput);
      await storage.appendExerciseSets(alice, w.id, "Bench", [
        { reps: 5, weight: 175 },
        { reps: 5, weight: 175 },
      ]);
      const edited = await storage.editExercise(alice, w.id, "Bench", [
        { reps: 3, weight: 200 },
      ]);
      expect(edited).toBe(true);
      const got = await storage.getWorkout(alice, startInput.date);
      expect(got?.exercises[0].sets).toHaveLength(1);
      expect(got?.exercises[0].sets[0].reps).toBe(3);
      expect(got?.exercises[0].sets[0].weight).toBe(200);
    });

    it("completeWorkout updates status + inserts PRs", async () => {
      const w = await storage.startWorkout(alice, startInput);
      await storage.appendExerciseSets(alice, w.id, "Bench", [
        { reps: 5, weight: 200 },
      ]);
      await storage.completeWorkout(alice, w.id, {
        summary: "PR day",
        energyLevel: 9,
        status: "completed",
        finishedAt: "11:00",
        durationMinutes: 60,
        prs: [
          {
            exercise: "Bench",
            weight: 200,
            reps: 5,
            date: startInput.date,
            estimated1Rm: 231,
          },
        ],
      });
      const got = await storage.getWorkout(alice, startInput.date);
      expect(got?.status).toBe("completed");
      expect(got?.summary).toBe("PR day");
      const prs = await storage.readPRs(alice);
      expect(prs.filter((p) => p.isCurrent && p.exercise === "Bench")).toHaveLength(1);
    });

    it("getWorkout returns hierarchical structure ordered by idx", async () => {
      const w = await storage.startWorkout(alice, startInput);
      await storage.appendExerciseSets(alice, w.id, "Bench", [
        { reps: 5, weight: 175 },
        { reps: 5, weight: 180 },
      ]);
      await storage.appendExerciseSets(alice, w.id, "OHP", [
        { reps: 5, weight: 105 },
      ]);
      const got = await storage.getWorkout(alice, startInput.date);
      expect(got).not.toBeNull();
      expect(got!.exercises.map((e) => e.name)).toEqual(["Bench", "OHP"]);
      expect(got!.exercises[0].sets.map((s) => s.weight)).toEqual([175, 180]);
    });

    it("listWorkouts filters by iso week", async () => {
      await storage.startWorkout(alice, startInput);
      await storage.startWorkout(alice, {
        ...startInput,
        date: "2026-05-15",
        isoWeek: "2026-W20",
      });
      const rows = await storage.listWorkouts(alice, { isoWeek: "2026-W21" });
      expect(rows).toHaveLength(1);
    });

    it("listWeekDates returns week's workouts", async () => {
      await storage.startWorkout(alice, startInput);
      const days = await storage.listWeekDates(alice, "2026-W21");
      expect(days).toHaveLength(1);
      expect(days[0].type).toBe("upper");
    });

    it("getExerciseHistory finds matching exercises (case-insensitive)", async () => {
      const w = await storage.startWorkout(alice, startInput);
      await storage.appendExerciseSets(alice, w.id, "Bench Press", [
        { reps: 5, weight: 175 },
      ]);
      const hits = await storage.getExerciseHistory(alice, "bench", 10);
      expect(hits).toHaveLength(1);
      expect(hits[0].sets).toHaveLength(1);
    });

    it("scopes workouts by userId", async () => {
      await storage.startWorkout(alice, startInput);
      expect(await storage.getWorkout(bob, startInput.date)).toBeNull();
      // listWorkouts uses correlated subqueries that pg-mem treats slightly
      // differently than Postgres — we verify scoping via the listWeekDates
      // method (which uses a plain SELECT) instead.
      expect(await storage.listWeekDates(bob, "2026-W21")).toEqual([]);
    });
  });

  // ── Messages ───────────────────────────────────────────────────────────────
  describe("messages", () => {
    it("addMessage and getRecentMessages", async () => {
      await storage.addMessage(alice, { role: "user", text: "hi" });
      await storage.addMessage(alice, { role: "assistant", text: "hello" });
      const recent = await storage.getRecentMessages(alice, 10);
      expect(recent).toHaveLength(2);
      expect(recent[0].role).toBe("user");
      expect(recent[1].role).toBe("assistant");
    });

    it("getRecentMessages returns N most-recent in chronological order", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.addMessage(alice, { role: "user", text: `m${i}` });
      }
      const recent = await storage.getRecentMessages(alice, 3);
      expect(recent.map((m) => m.text)).toEqual(["m2", "m3", "m4"]);
    });

    it("clearMessages wipes the user's messages", async () => {
      await storage.addMessage(alice, { role: "user", text: "hi" });
      await storage.clearMessages(alice);
      expect(await storage.getRecentMessages(alice, 10)).toHaveLength(0);
    });

    it("scopes messages by userId", async () => {
      await storage.addMessage(alice, { role: "user", text: "alice-only" });
      expect(await storage.getRecentMessages(bob, 10)).toHaveLength(0);
    });
  });

  // ── Reminders ──────────────────────────────────────────────────────────────
  describe("reminders", () => {
    it("addReminder + getReminders", async () => {
      await storage.addReminder(alice, {
        triggerDate: "2026-05-21",
        triggerHour: 9,
        message: "drink water",
        context: null,
      });
      const all = await storage.getReminders(alice);
      expect(all).toHaveLength(1);
    });

    it("getDueReminders filters by (date, hour)", async () => {
      await storage.addReminder(alice, {
        triggerDate: "2026-05-21",
        triggerHour: 9,
        message: "ok",
        context: null,
      });
      await storage.addReminder(alice, {
        triggerDate: "2026-05-21",
        triggerHour: 10,
        message: "miss",
        context: null,
      });
      const due = await storage.getDueReminders(alice, "2026-05-21", 9);
      expect(due).toHaveLength(1);
      expect(due[0].message).toBe("ok");
    });

    it("deleteReminder removes a specific row", async () => {
      const r = await storage.addReminder(alice, {
        triggerDate: "2026-05-21",
        triggerHour: 9,
        message: "x",
        context: null,
      });
      await storage.deleteReminder(alice, r.id);
      expect(await storage.getReminders(alice)).toHaveLength(0);
    });

    it("deleteRemindersByContext returns the deleted count", async () => {
      await storage.addReminder(alice, {
        triggerDate: "2026-05-21",
        triggerHour: 9,
        message: "x",
        context: "workout-timeout-check",
      });
      await storage.addReminder(alice, {
        triggerDate: "2026-05-22",
        triggerHour: 9,
        message: "y",
        context: "workout-timeout-check",
      });
      const n = await storage.deleteRemindersByContext(
        alice,
        "workout-timeout-check"
      );
      expect(n).toBe(2);
    });

    it("scopes reminders by userId", async () => {
      await storage.addReminder(alice, {
        triggerDate: "2026-05-21",
        triggerHour: 9,
        message: "x",
        context: null,
      });
      expect(await storage.getReminders(bob)).toHaveLength(0);
    });
  });

  // ── Integration tokens ─────────────────────────────────────────────────────
  describe("integration tokens", () => {
    it("upsert + get", async () => {
      await storage.upsertIntegrationToken(alice, "whoop", {
        accessTokenEnc: "ct1",
        refreshTokenEnc: "rt1",
        expiresAt: new Date("2026-12-01"),
        externalUserId: "whoop-1",
        scopes: "read",
      });
      const t = await storage.getIntegrationToken(alice, "whoop");
      expect(t?.accessTokenEnc).toBe("ct1");
      expect(t?.externalUserId).toBe("whoop-1");
    });

    it("upsert overwrites existing token", async () => {
      await storage.upsertIntegrationToken(alice, "whoop", {
        accessTokenEnc: "ct1",
      });
      await storage.upsertIntegrationToken(alice, "whoop", {
        accessTokenEnc: "ct2",
      });
      const t = await storage.getIntegrationToken(alice, "whoop");
      expect(t?.accessTokenEnc).toBe("ct2");
    });

    it("findUserByExternalIntegrationId", async () => {
      await storage.upsertIntegrationToken(alice, "whoop", {
        accessTokenEnc: "ct1",
        externalUserId: "whoop-1",
      });
      const id = await storage.findUserByExternalIntegrationId(
        "whoop",
        "whoop-1"
      );
      expect(id).toBe(alice);
    });

    it("findUserByExternalIntegrationId returns null when missing", async () => {
      expect(
        await storage.findUserByExternalIntegrationId("whoop", "missing")
      ).toBeNull();
    });
  });

  // ── Integration metrics ────────────────────────────────────────────────────
  describe("integration metrics", () => {
    it("upsertIntegrationMetric stores payload", async () => {
      await storage.upsertIntegrationMetric(
        alice,
        "whoop",
        "2026-05-20",
        "sleep",
        { sleep_hours: 7.5 }
      );
      const rows = await storage.getIntegrationMetrics(alice, "2026-05-20");
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("sleep");
    });

    it("upsert overwrites for (user, provider, date, kind)", async () => {
      await storage.upsertIntegrationMetric(
        alice,
        "whoop",
        "2026-05-20",
        "sleep",
        { sleep_hours: 7.5 }
      );
      await storage.upsertIntegrationMetric(
        alice,
        "whoop",
        "2026-05-20",
        "sleep",
        { sleep_hours: 8.0 }
      );
      const rows = await storage.getIntegrationMetrics(alice, "2026-05-20");
      expect(rows).toHaveLength(1);
      expect((rows[0].payload as { sleep_hours: number }).sleep_hours).toBe(
        8.0
      );
    });

    it("mirrors recovery payload into workouts.recoverySnapshot", async () => {
      await storage.startWorkout(alice, {
        date: "2026-05-20",
        isoWeek: "2026-W21",
        type: "upper",
        backFilled: false,
        startedAt: "10:00",
      });
      await storage.upsertIntegrationMetric(
        alice,
        "whoop",
        "2026-05-20",
        "recovery",
        { recovery_score: 78 }
      );
      const w = await storage.getWorkout(alice, "2026-05-20");
      const snap = w?.recoverySnapshot as Record<string, unknown> | null;
      expect(snap).not.toBeNull();
      expect((snap?.recovery as { recovery_score: number }).recovery_score).toBe(78);
    });
  });

  // ── Cross-user scoping (final guard) ───────────────────────────────────────
  describe("user scoping", () => {
    it("user B never sees user A's data", async () => {
      await storage.writeProfile(alice, "alice");
      await storage.writeLearnings(alice, "alice-l");
      await storage.upsertPR(alice, {
        exercise: "Bench",
        weight: 200,
        reps: 5,
        date: "2026-02-15",
      });
      await storage.writeWeeklyPlan(alice, "2026-W21", "alice-plan");
      await storage.addMessage(alice, { role: "user", text: "alice-msg" });

      expect(await storage.readProfile(bob)).toBeNull();
      expect(await storage.readLearnings(bob)).toBeNull();
      expect(await storage.readPRs(bob)).toEqual([]);
      expect(await storage.readWeeklyPlan(bob, "2026-W21")).toBeNull();
      expect(await storage.getRecentMessages(bob, 10)).toEqual([]);
    });
  });
});
