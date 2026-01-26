/**
 * PR Celebration Generator
 *
 * Creates exciting, contextual PR announcements with:
 * - Progress journey context
 * - Milestone detection (1/2/3/4 plate clubs, etc.)
 * - Personalized celebration messages
 */

import type { PRRecord, PRsData } from "../storage/types.js";
import { calculate1RM } from "./pr-calculator.js";

export interface PRCelebration {
  type: "weight" | "rep" | "estimated_1rm" | "milestone";
  exercise: string;
  current: { weight: number; reps: number; estimated1RM: number };
  previous?: { weight: number; reps: number; estimated1RM: number };
  message: string;
  journeyContext?: string;
  milestone?: MilestoneInfo;
  celebrationLevel: 1 | 2 | 3; // 1 = good, 2 = great, 3 = legendary
}

export interface MilestoneInfo {
  name: string;
  description: string;
  emoji: string;
}

// Standard plate milestones (in lbs)
const PLATE_MILESTONES: Record<string, number[]> = {
  bench_press: [135, 185, 225, 275, 315, 365, 405],
  squat: [135, 185, 225, 275, 315, 365, 405, 455, 495, 545],
  deadlift: [135, 225, 315, 405, 495, 585, 635],
  overhead_press: [95, 135, 185, 225],
};

const MILESTONE_NAMES: Record<number, string> = {
  95: "Green plate club",
  135: "One plate club",
  185: "One plate + 25s",
  225: "Two plate club",
  275: "Two plate + 25s",
  315: "Three plate club",
  365: "Three plate + 25s",
  405: "Four plate club",
  455: "Four plate + 25s",
  495: "Five plate club",
  545: "Five plate + 25s",
  585: "Six plate club",
  635: "Six plate + 25s",
};

const CELEBRATION_MESSAGES = {
  weight_pr: [
    "NEW WEIGHT PR! You just moved more iron than ever before!",
    "WEIGHT PR UNLOCKED! The gains train has no brakes!",
    "NEW WEIGHT PR! That bar has never felt this heavy... until now!",
    "WEIGHT PR! You're officially stronger than yesterday's you!",
  ],
  rep_pr: [
    "REP PR! More reps, more glory!",
    "REP PR! Your endurance is leveling up!",
    "REP PR! Grinding out gains one rep at a time!",
  ],
  estimated_1rm: [
    "New estimated 1RM! The math says you're stronger!",
    "Calculated strength gains! Your e1RM just went up!",
    "Strength is trending UP! New estimated max!",
  ],
  milestone: [
    "MILESTONE ACHIEVED! Welcome to the club!",
    "You've hit a legendary milestone!",
    "This is a moment to remember!",
  ],
};

/**
 * Generate a celebration message for a PR
 */
export function generatePRCelebration(
  exercise: string,
  weight: number,
  reps: number,
  currentPRs: PRsData,
  prHistory?: PRRecord[]
): PRCelebration | null {
  const normalizedName = normalizeExerciseName(exercise);
  const estimated1RM = calculate1RM(weight, reps);
  const existing = currentPRs[normalizedName];

  // Check if this is actually a PR
  if (existing) {
    const isWeightPR = weight > existing.current.weight;
    const isRepPR = weight === existing.current.weight && reps > existing.current.reps;
    const is1RMPR = estimated1RM > existing.current.estimated1RM && !isWeightPR;

    if (!isWeightPR && !isRepPR && !is1RMPR) {
      return null; // Not a PR
    }
  }

  const current = { weight, reps, estimated1RM };
  const previous = existing?.current;

  // Check for milestone
  const milestone = checkMilestone(normalizedName, weight, previous?.weight);

  // Determine celebration level
  let celebrationLevel: 1 | 2 | 3 = 1;
  if (milestone) {
    celebrationLevel = 3;
  } else if (!existing || weight > existing.current.weight) {
    celebrationLevel = 2;
  }

  // Determine PR type
  let type: PRCelebration["type"] = "estimated_1rm";
  let messagePool = CELEBRATION_MESSAGES.estimated_1rm;

  if (milestone) {
    type = "milestone";
    messagePool = CELEBRATION_MESSAGES.milestone;
  } else if (!existing || weight > existing.current.weight) {
    type = "weight";
    messagePool = CELEBRATION_MESSAGES.weight_pr;
  } else if (existing && weight === existing.current.weight && reps > existing.current.reps) {
    type = "rep";
    messagePool = CELEBRATION_MESSAGES.rep_pr;
  }

  // Pick a random message from the pool
  const baseMessage = messagePool[Math.floor(Math.random() * messagePool.length)];

  // Build the full celebration message
  const message = buildCelebrationMessage(baseMessage, exercise, current, previous, milestone);

  // Generate journey context if we have history
  const journeyContext = prHistory
    ? generateJourneyContext(exercise, prHistory, current)
    : undefined;

  return {
    type,
    exercise,
    current,
    previous,
    message,
    journeyContext,
    milestone: milestone || undefined,
    celebrationLevel,
  };
}

/**
 * Build a detailed celebration message
 */
function buildCelebrationMessage(
  baseMessage: string,
  exercise: string,
  current: { weight: number; reps: number; estimated1RM: number },
  previous?: { weight: number; reps: number; estimated1RM: number },
  milestone?: MilestoneInfo | null
): string {
  const lines: string[] = [];

  // Header with emoji based on significance
  if (milestone) {
    lines.push(`${milestone.emoji} ${baseMessage}`);
    lines.push(`${milestone.name.toUpperCase()}!`);
  } else {
    lines.push(`🎉 ${baseMessage}`);
  }

  lines.push("");
  lines.push(`${formatExerciseName(exercise)}: ${current.weight} x ${current.reps}`);

  if (previous) {
    const weightDiff = current.weight - previous.weight;
    const est1RMDiff = current.estimated1RM - previous.estimated1RM;

    if (weightDiff > 0) {
      lines.push(`Previous best: ${previous.weight} x ${previous.reps}`);
      lines.push(`+${weightDiff} lbs!`);
    } else if (current.reps > previous.reps) {
      lines.push(`Previous best at ${current.weight}: ${previous.reps} reps`);
      lines.push(`+${current.reps - previous.reps} reps!`);
    }

    if (est1RMDiff > 0) {
      lines.push(`Est. 1RM: ${current.estimated1RM} lbs (+${est1RMDiff})`);
    }
  } else {
    lines.push(`First recorded PR! Est. 1RM: ${current.estimated1RM} lbs`);
  }

  return lines.join("\n");
}

/**
 * Generate context about the athlete's journey with this lift
 */
function generateJourneyContext(
  exercise: string,
  history: PRRecord[],
  current: { weight: number; reps: number; estimated1RM: number }
): string {
  if (history.length < 2) {
    return "This is just the beginning of your journey!";
  }

  // Sort history by date
  const sorted = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const first = sorted[0];
  const totalGain = current.weight - first.weight;
  const est1RMGain = current.estimated1RM - first.estimated1RM;

  // Calculate time span
  const firstDate = new Date(first.date);
  const now = new Date();
  const monthsSpan = Math.round((now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

  const lines: string[] = [];
  lines.push(`📈 Your ${formatExerciseName(exercise)} journey:`);
  lines.push(`Started: ${first.weight} lbs → Now: ${current.weight} lbs`);

  if (totalGain > 0) {
    lines.push(`Total gain: +${totalGain} lbs over ${monthsSpan} months`);
    if (monthsSpan > 0) {
      const monthlyRate = (totalGain / monthsSpan).toFixed(1);
      lines.push(`That's ~${monthlyRate} lbs/month!`);
    }
  }

  if (est1RMGain > 0) {
    lines.push(`Est. 1RM improvement: +${est1RMGain} lbs`);
  }

  return lines.join("\n");
}

/**
 * Check if a weight hits a milestone
 */
function checkMilestone(
  exercise: string,
  newWeight: number,
  previousWeight?: number
): MilestoneInfo | null {
  const milestones = PLATE_MILESTONES[exercise];
  if (!milestones) return null;

  // Find milestones that were crossed
  for (const milestone of milestones) {
    const crossedMilestone =
      newWeight >= milestone && (!previousWeight || previousWeight < milestone);

    if (crossedMilestone) {
      return {
        name: MILESTONE_NAMES[milestone] || `${milestone} lb club`,
        description: `You've joined the ${milestone} lb club on ${formatExerciseName(exercise)}!`,
        emoji: getMilestoneEmoji(milestone),
      };
    }
  }

  return null;
}

/**
 * Get appropriate emoji for milestone significance
 */
function getMilestoneEmoji(weight: number): string {
  if (weight >= 405) return "🏆👑";
  if (weight >= 315) return "🏆🔥";
  if (weight >= 225) return "🏆";
  if (weight >= 135) return "💪";
  return "⭐";
}

/**
 * Format exercise name for display
 */
function formatExerciseName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize exercise name to canonical form
 */
function normalizeExerciseName(name: string): string {
  const lower = name.toLowerCase().trim();
  const aliases: Record<string, string> = {
    "bench press": "bench_press",
    bench: "bench_press",
    squat: "squat",
    squats: "squat",
    "back squat": "squat",
    deadlift: "deadlift",
    dl: "deadlift",
    "overhead press": "overhead_press",
    ohp: "overhead_press",
    press: "overhead_press",
  };
  return aliases[lower] || lower.replace(/[^a-z0-9]+/g, "_");
}

/**
 * Generate a weekly PR summary
 */
export function generateWeeklyPRSummary(
  prsThisWeek: Array<{ exercise: string; weight: number; reps: number; date: string }>
): string {
  if (prsThisWeek.length === 0) {
    return "No new PRs this week - keep grinding, they'll come!";
  }

  const lines: string[] = [];
  lines.push(`🎉 **${prsThisWeek.length} PR${prsThisWeek.length > 1 ? "s" : ""} This Week!**`);
  lines.push("");

  for (const pr of prsThisWeek) {
    const est1RM = calculate1RM(pr.weight, pr.reps);
    lines.push(`• ${formatExerciseName(pr.exercise)}: ${pr.weight} x ${pr.reps} (e1RM: ${est1RM})`);
  }

  // Add milestone check
  const milestones = prsThisWeek
    .map((pr) => checkMilestone(normalizeExerciseName(pr.exercise), pr.weight))
    .filter(Boolean);

  if (milestones.length > 0) {
    lines.push("");
    lines.push("🏆 **Milestones Hit:**");
    for (const m of milestones) {
      if (m) lines.push(`• ${m.name}`);
    }
  }

  return lines.join("\n");
}
