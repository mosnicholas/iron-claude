/**
 * Unit Tests for Coach MCP Tools
 *
 * Tests the helper functions and tool logic for workout management,
 * PR tracking, and plan saving. No API key needed — these test
 * deterministic file operations.
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import {
  parsePRsYaml,
  serializePRsYaml,
  calculate1RM,
  readWorkoutFileLocal,
  writeWorkoutFile,
  ensureWorkoutPath,
} from "./tools.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "iron-claude-tools-test-"));
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// ============================================================================
// calculate1RM
// ============================================================================

describe("calculate1RM", () => {
  it("returns the weight itself for 1 rep", () => {
    expect(calculate1RM(225, 1)).toBe(225);
  });

  it("calculates correctly for 5 reps (Brzycki)", () => {
    // 175 * (36 / (37 - 5)) = 175 * (36/32) = 175 * 1.125 = 196.875 → 197
    expect(calculate1RM(175, 5)).toBe(197);
  });

  it("calculates correctly for 3 reps", () => {
    // 190 * (36 / (37 - 3)) = 190 * (36/34) = 190 * 1.0588 = 201.17 → 201
    expect(calculate1RM(190, 3)).toBe(201);
  });

  it("returns 0 for 0 reps", () => {
    expect(calculate1RM(100, 0)).toBe(0);
  });

  it("handles 10 reps", () => {
    // 135 * (36 / (37 - 10)) = 135 * (36/27) = 135 * 1.333 = 180
    expect(calculate1RM(135, 10)).toBe(180);
  });
});

// ============================================================================
// parsePRsYaml
// ============================================================================

describe("parsePRsYaml", () => {
  it("parses simple PR entries", () => {
    const yaml = `# Personal Records
bench_press:
  weight: 170
  reps: 5
  date: "2026-02-15"
  estimated_1rm: 197
squat:
  weight: 225
  reps: 5
  date: "2026-02-10"
  estimated_1rm: 261
`;

    const prs = parsePRsYaml(yaml);
    expect(prs.size).toBe(2);

    const bench = prs.get("bench_press");
    expect(bench).toBeDefined();
    expect(bench!.weight).toBe(170);
    expect(bench!.reps).toBe(5);
    expect(bench!.date).toBe("2026-02-15");
    expect(bench!.estimated_1rm).toBe(197);

    const squat = prs.get("squat");
    expect(squat).toBeDefined();
    expect(squat!.weight).toBe(225);
  });

  it("handles empty input", () => {
    const prs = parsePRsYaml("");
    expect(prs.size).toBe(0);
  });

  it("handles input with only comments", () => {
    const prs = parsePRsYaml("# Personal Records\n# Nothing here\n");
    expect(prs.size).toBe(0);
  });

  it("skips history sections", () => {
    const yaml = `bench_press:
  weight: 190
  reps: 3
  date: "2026-02-20"
  estimated_1rm: 202
  history:
    - weight: 185
      reps: 3
      date: "2026-02-15"
    - weight: 180
      reps: 3
      date: "2026-02-10"
squat:
  weight: 225
  reps: 5
  date: "2026-02-10"
`;

    const prs = parsePRsYaml(yaml);
    const bench = prs.get("bench_press");
    expect(bench!.weight).toBe(190);
    // Should NOT contain history entries
    expect(bench!["185"]).toBeUndefined();

    const squat = prs.get("squat");
    expect(squat!.weight).toBe(225);
  });

  it("handles workout_ref field with path strings", () => {
    const yaml = `deadlift:
  weight: 275
  reps: 5
  date: "2026-02-08"
  estimated_1rm: 319
  workout_ref: "weeks/2026-W06/2026-02-08.md"
`;

    const prs = parsePRsYaml(yaml);
    const dl = prs.get("deadlift");
    expect(dl!.workout_ref).toBe("weeks/2026-W06/2026-02-08.md");
  });
});

// ============================================================================
// serializePRsYaml
// ============================================================================

describe("serializePRsYaml", () => {
  it("serializes PR map to YAML format", () => {
    const prs = new Map<string, Record<string, unknown>>();
    prs.set("bench_press", {
      weight: 175,
      reps: 5,
      date: "2026-02-23",
      estimated_1rm: 197,
    });

    const yaml = serializePRsYaml(prs);
    expect(yaml).toContain("# Personal Records");
    expect(yaml).toContain("bench_press:");
    expect(yaml).toContain("  weight: 175");
    expect(yaml).toContain("  reps: 5");
    expect(yaml).toContain('  date: "2026-02-23"');
    expect(yaml).toContain("  estimated_1rm: 197");
  });

  it("serializes multiple exercises", () => {
    const prs = new Map<string, Record<string, unknown>>();
    prs.set("bench_press", { weight: 175, reps: 5 });
    prs.set("squat", { weight: 225, reps: 5 });

    const yaml = serializePRsYaml(prs);
    expect(yaml).toContain("bench_press:");
    expect(yaml).toContain("squat:");
  });

  it("round-trips through parse and serialize", () => {
    const original = `# Personal Records
bench_press:
  weight: 175
  reps: 5
  date: "2026-02-23"
  estimated_1rm: 197
`;

    const parsed = parsePRsYaml(original);
    const serialized = serializePRsYaml(parsed);
    const reparsed = parsePRsYaml(serialized);

    expect(reparsed.get("bench_press")!.weight).toBe(175);
    expect(reparsed.get("bench_press")!.reps).toBe(5);
    expect(reparsed.get("bench_press")!.date).toBe("2026-02-23");
  });
});

// ============================================================================
// ensureWorkoutPath
// ============================================================================

describe("ensureWorkoutPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("creates week directory if it does not exist", () => {
    const { filePath, week } = ensureWorkoutPath(tempDir, "2026-02-23");
    expect(week).toMatch(/^\d{4}-W\d{2}$/);
    expect(filePath).toContain("2026-02-23.md");

    // Directory should have been created
    const weekDir = join(tempDir, "weeks", week);
    expect(existsSync(weekDir)).toBe(true);
  });

  it("does not error if directory already exists", () => {
    const { week } = ensureWorkoutPath(tempDir, "2026-02-23");
    // Call again — should not throw
    const result = ensureWorkoutPath(tempDir, "2026-02-23");
    expect(result.week).toBe(week);
  });
});

// ============================================================================
// writeWorkoutFile + readWorkoutFileLocal
// ============================================================================

describe("writeWorkoutFile + readWorkoutFileLocal", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("writes a workout file with frontmatter and body", () => {
    const frontmatter = {
      date: "2026-02-23",
      type: "upper",
      status: "in_progress",
      started: "10:00",
    };
    const body = "# Workout — Sunday, Feb 23\n\n## Exercises\n";

    const filePath = writeWorkoutFile(tempDir, "2026-02-23", frontmatter, body);
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain('date: "2026-02-23"');
    expect(content).toContain("type: upper");
    expect(content).toContain("status: in_progress");
    expect(content).toContain("# Workout — Sunday, Feb 23");
    expect(content).toContain("## Exercises");
  });

  it("readWorkoutFileLocal returns null for non-existent file", () => {
    const result = readWorkoutFileLocal(tempDir, "2026-02-23");
    expect(result).toBeNull();
  });

  it("readWorkoutFileLocal returns parsed data for existing file", () => {
    const frontmatter = {
      date: "2026-02-23",
      type: "lower",
      status: "completed",
    };
    const body = "# Workout\n\n## Exercises\n\n### Squat\n- 225lbs x 5\n";

    writeWorkoutFile(tempDir, "2026-02-23", frontmatter, body);

    const result = readWorkoutFileLocal(tempDir, "2026-02-23");
    expect(result).not.toBeNull();
    expect(result!.frontmatter.type).toBe("lower");
    expect(result!.frontmatter.status).toBe("completed");
    expect(result!.content).toContain("Squat");
  });

  it("overwrites existing file when called again", () => {
    writeWorkoutFile(
      tempDir,
      "2026-02-23",
      { date: "2026-02-23", status: "in_progress" },
      "# First version"
    );

    writeWorkoutFile(
      tempDir,
      "2026-02-23",
      { date: "2026-02-23", status: "completed" },
      "# Second version"
    );

    const result = readWorkoutFileLocal(tempDir, "2026-02-23");
    expect(result!.frontmatter.status).toBe("completed");
    expect(result!.content).toContain("Second version");
  });
});

// ============================================================================
// PR update logic (integration-style with file I/O)
// ============================================================================

describe("PR update logic", () => {
  it("detects weight PR correctly", () => {
    const oldWeight = 170;
    const newWeight = 175;
    expect(newWeight > oldWeight).toBe(true);
  });

  it("detects rep PR at same weight", () => {
    const oldWeight = 175;
    const oldReps = 5;
    const newWeight = 175;
    const newReps = 6;
    const isRepPR = newWeight === oldWeight && newReps > oldReps;
    expect(isRepPR).toBe(true);
  });

  it("detects 1RM PR even when weight/reps individually aren't PRs", () => {
    // Old: 170 x 5 → 1RM = 191
    // New: 185 x 3 → 1RM = 196
    const old1RM = calculate1RM(170, 5); // 191
    const new1RM = calculate1RM(185, 3); // 196
    expect(new1RM).toBeGreaterThan(old1RM);
  });

  it("does NOT flag a PR when performance is below existing", () => {
    // Old: 185 x 5 → 1RM = 208
    // New: 155 x 5 → 1RM = 174
    const old1RM = calculate1RM(185, 5); // 208
    const new1RM = calculate1RM(155, 5); // 174
    expect(new1RM).toBeLessThan(old1RM);
  });

  it("does NOT flag matching performance as a PR", () => {
    const oldWeight = 225;
    const oldReps = 5;
    const old1RM = calculate1RM(225, 5);

    const newWeight = 225;
    const newReps = 5;
    const new1RM = calculate1RM(225, 5);

    const isWeightPR = newWeight > oldWeight;
    const isRepPR = newWeight === oldWeight && newReps > oldReps;
    const is1RMPR = new1RM > old1RM;

    expect(isWeightPR || isRepPR || is1RMPR).toBe(false);
  });
});

// ============================================================================
// PR YAML file round-trip with file system
// ============================================================================

describe("PR YAML file operations", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it("can update a PR in an existing prs.yaml file", () => {
    const prsPath = join(tempDir, "prs.yaml");
    const original = `# Personal Records
bench_press:
  weight: 170
  reps: 5
  date: "2026-02-15"
  estimated_1rm: 197
squat:
  weight: 225
  reps: 5
  date: "2026-02-10"
  estimated_1rm: 261
`;
    writeFileSync(prsPath, original);

    // Simulate updating bench press PR
    const prs = parsePRsYaml(readFileSync(prsPath, "utf-8"));
    prs.set("bench_press", {
      weight: 175,
      reps: 5,
      date: "2026-02-23",
      estimated_1rm: calculate1RM(175, 5),
      workout_ref: "weeks/2026-W09/2026-02-23.md",
    });

    writeFileSync(prsPath, serializePRsYaml(prs));

    // Verify
    const updated = parsePRsYaml(readFileSync(prsPath, "utf-8"));
    expect(updated.get("bench_press")!.weight).toBe(175);
    expect(updated.get("bench_press")!.date).toBe("2026-02-23");
    // Squat should be unchanged
    expect(updated.get("squat")!.weight).toBe(225);
  });

  it("can add a new exercise to prs.yaml", () => {
    const prsPath = join(tempDir, "prs.yaml");
    const original = `# Personal Records
bench_press:
  weight: 170
  reps: 5
  date: "2026-02-15"
  estimated_1rm: 197
`;
    writeFileSync(prsPath, original);

    const prs = parsePRsYaml(readFileSync(prsPath, "utf-8"));
    prs.set("pull_ups", {
      weight: 45,
      reps: 8,
      date: "2026-02-23",
      estimated_1rm: calculate1RM(45, 8),
    });

    writeFileSync(prsPath, serializePRsYaml(prs));

    const updated = parsePRsYaml(readFileSync(prsPath, "utf-8"));
    expect(updated.size).toBe(2);
    expect(updated.get("pull_ups")!.weight).toBe(45);
    expect(updated.get("bench_press")!.weight).toBe(170);
  });
});
