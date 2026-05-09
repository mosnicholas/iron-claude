/**
 * Unit tests for write tools — no API calls, just deterministic file writes.
 *
 * These prove the reliability invariants: every write commits, paths are
 * computed deterministically, and replays don't corrupt files.
 */

import { execSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseFrontmatter } from "../../integrations/storage.js";
import { getCurrentWeek, getToday } from "../../utils/date.js";
import {
  startWorkout,
  logExercise,
  completeWorkout,
  removeExercise,
  editExercise,
  savePlan,
  amendPlan,
  saveLearning,
} from "./writes.js";
import type { ToolContext } from "../tool.js";

function setupRepo(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "ironclaude-v2-writes-"));
  execSync("git init", { cwd: path, stdio: "pipe" });
  execSync('git config user.email "test@iron-claude.dev"', { cwd: path, stdio: "pipe" });
  execSync('git config user.name "test"', { cwd: path, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: path, stdio: "pipe" });
  // Empty repo needs an initial commit so writeAndCommit can use rev-parse HEAD.
  writeFileSync(join(path, "README.md"), "# test\n");
  execSync("git add -A && git commit -m init", { cwd: path, stdio: "pipe" });
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

function makeCtx(repoPath: string): ToolContext {
  return {
    repoPath,
    timezone: process.env.TIMEZONE || "America/New_York",
    turnId: "test-turn",
    handler: "coach",
  };
}

// Stub the GitHub-backed reminder calls — they need real env, which we don't
// have in unit tests. The startWorkout/completeWorkout tools wrap these in
// try/catch, so we let them fail silently.
beforeAll(() => {
  process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || "test-token-not-real";
  process.env.DATA_REPO = process.env.DATA_REPO || "test-owner/test-repo";
});

describe("writes / start_workout", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => {
    repo = setupRepo();
  });
  afterEach(() => repo.cleanup());

  it("creates today's workout file with status=in_progress", async () => {
    const result = await startWorkout.handler({ type: "upper" }, makeCtx(repo.path));
    expect(result).toContain("Started workout");

    const week = getCurrentWeek();
    const date = getToday();
    const path = join(repo.path, "weeks", week, `${date}.md`);
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.status).toBe("in_progress");
    expect(frontmatter.type).toBe("upper");
    expect(frontmatter.date).toBe(date);
  });

  it("is idempotent — second call is a no-op", async () => {
    await startWorkout.handler({ type: "upper" }, makeCtx(repo.path));
    const second = await startWorkout.handler({ type: "lower" }, makeCtx(repo.path));
    expect(second).toContain("already exists");

    const path = join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`);
    const { frontmatter } = parseFrontmatter(readFileSync(path, "utf-8"));
    // The original "upper" type is preserved.
    expect(frontmatter.type).toBe("upper");
  });
});

describe("writes / log_exercise", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => {
    repo = setupRepo();
  });
  afterEach(() => repo.cleanup());

  it("auto-creates a workout file if none exists, then writes the exercise", async () => {
    const ctx = makeCtx(repo.path);
    const result = await logExercise.handler(
      { exercise: "Bench Press", sets: [{ reps: 5, weight: 175, rpe: 7 }] },
      ctx
    );
    expect(result).toContain("Logged Bench Press");

    const path = join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`);
    const raw = readFileSync(path, "utf-8");
    expect(raw).toContain("### Bench Press");
    expect(raw).toContain("175 x 5");
    expect(raw).toContain("RPE 7");
  });

  it("appends additional sets to the same exercise without duplicating the header", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler({ exercise: "Bench Press", sets: [{ reps: 5, weight: 175 }] }, ctx);
    await logExercise.handler({ exercise: "Bench Press", sets: [{ reps: 5, weight: 175 }] }, ctx);

    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    const headerCount = (raw.match(/^### Bench Press/gm) || []).length;
    expect(headerCount).toBe(1);
    const setLineCount = (raw.match(/175 x 5/g) || []).length;
    expect(setLineCount).toBe(2);
  });

  it("creates separate sections for different exercises", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler({ exercise: "Bench Press", sets: [{ reps: 5, weight: 175 }] }, ctx);
    await logExercise.handler({ exercise: "OHP", sets: [{ reps: 6, weight: 95 }] }, ctx);

    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    expect(raw).toContain("### Bench Press");
    expect(raw).toContain("### OHP");
    expect(raw).toContain("175 x 5");
    expect(raw).toContain("95 x 6");
  });

  it("commits each exercise — there are 1 commit per log_exercise", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler({ exercise: "Bench Press", sets: [{ reps: 5, weight: 175 }] }, ctx);
    await logExercise.handler({ exercise: "OHP", sets: [{ reps: 6, weight: 95 }] }, ctx);

    const log = execSync("git log --oneline", { cwd: repo.path, encoding: "utf-8" });
    // init + start + log Bench + log OHP = at least 4 lines.
    expect(log.split("\n").filter((l) => l.trim()).length).toBeGreaterThanOrEqual(4);
    expect(log).toContain("Log Bench Press");
    expect(log).toContain("Log OHP");
  });

  it("refuses to log additional sets after complete_workout", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler({ exercise: "Bench Press", sets: [{ reps: 5, weight: 175 }] }, ctx);
    await completeWorkout.handler(
      {
        summary: "Done",
        energy_level: 7,
      },
      ctx
    );
    const result = await logExercise.handler(
      { exercise: "OHP", sets: [{ reps: 5, weight: 95 }] },
      ctx
    );
    expect(result).toContain("already marked complete");
  });
});

describe("writes / complete_workout", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => {
    repo = setupRepo();
  });
  afterEach(() => repo.cleanup());

  it("transitions status to completed and adds summary", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler({ exercise: "Bench", sets: [{ reps: 5, weight: 175 }] }, ctx);
    const result = await completeWorkout.handler(
      {
        summary: "Solid session, bench felt strong.",
        energy_level: 8,
      },
      ctx
    );
    expect(result).toContain("Completed workout");

    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.status).toBe("completed");
    expect(frontmatter.energy_level).toBe(8);
    expect(raw).toContain("## Summary");
    expect(raw).toContain("Solid session");
  });
});

describe("writes / retroactive (date override)", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => {
    repo = setupRepo();
  });
  afterEach(() => repo.cleanup());

  // Pick a date that's safely in the past relative to "today" no matter when
  // the test runs — "1970-01-07" is a Wednesday in ISO week 1970-W02.
  const PAST_DATE = "1970-01-07";
  const PAST_WEEK = "1970-W02";

  it("start_workout with `date` writes into that date's week folder, marks back_filled", async () => {
    const ctx = makeCtx(repo.path);
    const result = await startWorkout.handler({ type: "upper", date: PAST_DATE }, ctx);
    expect(result).toContain("Started workout");
    expect(result).toContain("back-filled");

    const path = join(repo.path, "weeks", PAST_WEEK, `${PAST_DATE}.md`);
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.date).toBe(PAST_DATE);
    expect(frontmatter.back_filled).toBe(true);
    expect(frontmatter.status).toBe("in_progress");
    // Heading uses the date's day-of-week (Wednesday for 1970-01-07), not today's.
    expect(raw).toContain("Wednesday, 1970-01-07");
  });

  it("log_exercise with `date` auto-creates the past-day file and writes the exercise", async () => {
    const ctx = makeCtx(repo.path);
    const result = await logExercise.handler(
      {
        exercise: "Pull-up",
        sets: [{ reps: 7, weight: "BW+25" }],
        date: PAST_DATE,
      },
      ctx
    );
    expect(result).toContain("Logged Pull-up");

    // Today's file should NOT have been created.
    const todayPath = join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`);
    expect(existsSync(todayPath)).toBe(false);

    // The past-date file should exist with the exercise.
    const pastPath = join(repo.path, "weeks", PAST_WEEK, `${PAST_DATE}.md`);
    expect(existsSync(pastPath)).toBe(true);
    const raw = readFileSync(pastPath, "utf-8");
    expect(raw).toContain("### Pull-up");
    expect(raw).toContain("BW+25 x 7");
  });

  it("complete_workout with `date` closes the past file with duration=0 and back_filled=true", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper", date: PAST_DATE }, ctx);
    await logExercise.handler(
      { exercise: "Bench", sets: [{ reps: 5, weight: 175 }], date: PAST_DATE },
      ctx
    );
    const result = await completeWorkout.handler(
      { summary: "Back-filled session.", energy_level: 7, date: PAST_DATE },
      ctx
    );
    expect(result).toContain("Completed workout");

    const raw = readFileSync(join(repo.path, "weeks", PAST_WEEK, `${PAST_DATE}.md`), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.status).toBe("completed");
    expect(frontmatter.duration_minutes).toBe(0);
    expect(frontmatter.back_filled).toBe(true);
    expect(frontmatter.energy_level).toBe(7);
    expect(raw).toContain("## Summary");
    expect(raw).toContain("Back-filled session.");
  });

  it("rejects invalid date strings", async () => {
    const ctx = makeCtx(repo.path);
    await expect(
      startWorkout.handler({ type: "upper", date: "not-a-date" }, ctx)
    ).rejects.toThrow();
  });
});

describe("writes / complete_workout abandoned status", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => (repo = setupRepo()));
  afterEach(() => repo.cleanup());

  it("sets status=abandoned when status='abandoned' is passed", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "lower" }, ctx);
    await completeWorkout.handler(
      {
        status: "abandoned",
        summary: "Felt sick after warm-up, cut it short.",
        energy_level: 3,
      },
      ctx
    );
    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.status).toBe("abandoned");
    expect(frontmatter.energy_level).toBe(3);
    expect(raw).toContain("## Summary");
  });

  it("defaults status to 'completed' when omitted", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await completeWorkout.handler(
      {
        summary: "Solid session.",
        energy_level: 8,
      },
      ctx
    );
    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.status).toBe("completed");
  });
});

describe("writes / remove_exercise + edit_exercise", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => (repo = setupRepo()));
  afterEach(() => repo.cleanup());

  it("remove_exercise deletes a single exercise section, leaving others intact", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler({ exercise: "Bench Press", sets: [{ reps: 5, weight: 175 }] }, ctx);
    await logExercise.handler({ exercise: "Overhead Press", sets: [{ reps: 8, weight: 95 }] }, ctx);
    await removeExercise.handler({ exercise: "Bench Press" }, ctx);
    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    expect(raw).not.toMatch(/^### Bench Press$/m);
    expect(raw).toMatch(/^### Overhead Press$/m);
    expect(raw).toContain("95 x 8");
  });

  it("remove_exercise reports when the section doesn't exist", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    const result = await removeExercise.handler({ exercise: "Squat" }, ctx);
    expect(result).toMatch(/No "Squat" section/);
  });

  it("edit_exercise replaces the set list of an existing section", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    await logExercise.handler(
      {
        exercise: "Bench Press",
        sets: [
          { reps: 5, weight: 175 },
          { reps: 5, weight: 175 },
          { reps: 4, weight: 175 },
        ],
      },
      ctx
    );
    await editExercise.handler(
      {
        exercise: "Bench Press",
        sets: [
          { reps: 5, weight: 180 },
          { reps: 5, weight: 180 },
        ],
        notes: "fixed: was logged at wrong weight",
      },
      ctx
    );
    const raw = readFileSync(
      join(repo.path, "weeks", getCurrentWeek(), `${getToday()}.md`),
      "utf-8"
    );
    expect(raw).toContain("180 x 5");
    expect(raw).not.toContain("175 x 5");
    expect(raw).not.toContain("175 x 4");
    expect(raw).toContain("fixed: was logged at wrong weight");
  });

  it("edit_exercise errors when the section doesn't exist", async () => {
    const ctx = makeCtx(repo.path);
    await startWorkout.handler({ type: "upper" }, ctx);
    const result = await editExercise.handler(
      { exercise: "Squat", sets: [{ reps: 5, weight: 225 }] },
      ctx
    );
    expect(result).toMatch(/No "Squat" section/);
  });
});

describe("writes / save_plan + amend_plan", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => (repo = setupRepo()));
  afterEach(() => repo.cleanup());

  it("save_plan writes the file; amend_plan adds amendment", async () => {
    const ctx = makeCtx(repo.path);
    const week = "2026-W18";
    await savePlan.handler(
      {
        week,
        content: "---\nweek: 2026-W18\n---\n# Plan\n\nMonday: bench\n",
      },
      ctx
    );
    expect(existsSync(join(repo.path, "weeks", week, "plan.md"))).toBe(true);

    await amendPlan.handler({ week, amendment: "Friday Push moved to Saturday" }, ctx);
    const raw = readFileSync(join(repo.path, "weeks", week, "plan.md"), "utf-8");
    expect(raw).toContain("## Amendments");
    expect(raw).toContain("Friday Push moved to Saturday");
  });
});

describe("writes / save_learning", () => {
  let repo: ReturnType<typeof setupRepo>;
  beforeEach(() => (repo = setupRepo()));
  afterEach(() => repo.cleanup());

  it("appends to learnings.md under the right section header", async () => {
    const ctx = makeCtx(repo.path);
    await saveLearning.handler({ category: "preference", content: "Hates leg press" }, ctx);
    await saveLearning.handler({ category: "preference", content: "Loves RDLs" }, ctx);
    const raw = readFileSync(join(repo.path, "learnings.md"), "utf-8");
    expect(raw).toContain("## Preferences");
    expect(raw).toContain("Hates leg press");
    expect(raw).toContain("Loves RDLs");
  });
});
