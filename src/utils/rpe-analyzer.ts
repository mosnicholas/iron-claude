/**
 * RPE Pattern Analyzer
 *
 * Tracks RPE trends to detect:
 * - Strength gains: Same RPE, higher weight = getting stronger
 * - Fatigue patterns: Same weight, higher RPE = need recovery
 * - Session difficulty scoring
 */

export interface RPEDataPoint {
  date: string;
  exercise: string;
  weight: number;
  reps: number;
  rpe: number;
  estimated1RM: number;
}

export interface RPETrend {
  exercise: string;
  dataPoints: RPEDataPoint[];
  insights: RPEInsight[];
}

export interface RPEInsight {
  type: "strength_gain" | "fatigue_warning" | "consistency" | "milestone";
  message: string;
  severity: "info" | "positive" | "warning";
  data?: Record<string, number | string>;
}

export interface SessionDifficulty {
  date: string;
  averageRPE: number;
  maxRPE: number;
  totalSets: number;
  difficultyScore: number; // 1-100
  category: "easy" | "moderate" | "hard" | "brutal";
}

// Note: 1RM calculation available in pr-calculator.ts if needed for RPE analysis

/**
 * Analyze RPE trends for a specific exercise
 *
 * Looks for patterns like:
 * - "Your @8 used to be 185, now it's 195 - you're stronger!"
 * - "RPE creeping up on same weights - consider deload"
 */
export function analyzeExerciseRPE(
  dataPoints: RPEDataPoint[],
  exerciseName: string
): RPETrend {
  const insights: RPEInsight[] = [];

  if (dataPoints.length < 2) {
    return { exercise: exerciseName, dataPoints, insights };
  }

  // Sort by date (oldest first)
  const sorted = [...dataPoints].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Group by RPE to detect strength gains at same RPE
  const byRPE = groupByRPE(sorted);

  // Check for strength gains at each RPE level
  for (const [rpe, points] of Object.entries(byRPE)) {
    if (points.length >= 2) {
      const oldest = points[0];
      const newest = points[points.length - 1];

      // Strength gain: same RPE, higher weight
      if (newest.weight > oldest.weight) {
        const improvement = newest.weight - oldest.weight;
        const percentGain = ((improvement / oldest.weight) * 100).toFixed(1);
        insights.push({
          type: "strength_gain",
          severity: "positive",
          message: `Your @${rpe} used to be ${oldest.weight} lbs, now it's ${newest.weight} lbs - you're ${percentGain}% stronger!`,
          data: {
            rpe: Number(rpe),
            oldWeight: oldest.weight,
            newWeight: newest.weight,
            improvement,
            percentGain: Number(percentGain),
          },
        });
      }
    }
  }

  // Group by weight to detect fatigue patterns
  const byWeight = groupByWeight(sorted);

  // Check for fatigue: same weight, increasing RPE over recent sessions
  for (const [weight, points] of Object.entries(byWeight)) {
    if (points.length >= 3) {
      const recent = points.slice(-3);
      const rpeValues = recent.map((p) => p.rpe);

      // Check if RPE is trending up
      if (isIncreasingTrend(rpeValues)) {
        const avgIncrease = (rpeValues[2] - rpeValues[0]) / 2;
        if (avgIncrease >= 0.5) {
          insights.push({
            type: "fatigue_warning",
            severity: "warning",
            message: `RPE creeping up at ${weight} lbs (${rpeValues[0]} → ${rpeValues[2]}) - consider a deload or extra recovery`,
            data: {
              weight: Number(weight),
              rpeStart: rpeValues[0],
              rpeEnd: rpeValues[2],
              sessions: 3,
            },
          });
        }
      }
    }
  }

  // Check for consistency (maintaining same RPE at same weight = good form)
  for (const [weight, points] of Object.entries(byWeight)) {
    if (points.length >= 4) {
      const rpeValues = points.slice(-4).map((p) => p.rpe);
      const avg = rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length;
      const variance = rpeValues.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / rpeValues.length;

      // Low variance = consistent
      if (variance < 0.3) {
        insights.push({
          type: "consistency",
          severity: "info",
          message: `Consistent RPE at ${weight} lbs over ${points.length} sessions - technique is dialed in`,
          data: {
            weight: Number(weight),
            averageRPE: Math.round(avg * 10) / 10,
            sessions: points.length,
          },
        });
      }
    }
  }

  return { exercise: exerciseName, dataPoints: sorted, insights };
}

/**
 * Calculate session difficulty score
 *
 * Combines average RPE, max RPE, and set count into a 1-100 score
 */
export function calculateSessionDifficulty(
  sets: Array<{ rpe?: number }>
): SessionDifficulty | null {
  const setsWithRPE = sets.filter((s) => s.rpe !== undefined && s.rpe > 0);

  if (setsWithRPE.length === 0) {
    return null;
  }

  const rpeValues = setsWithRPE.map((s) => s.rpe!);
  const averageRPE = rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length;
  const maxRPE = Math.max(...rpeValues);
  const totalSets = setsWithRPE.length;

  // Difficulty score formula:
  // - Base: average RPE * 10 (0-100)
  // - Bonus for high max RPE: +5 for each point above 8
  // - Volume factor: multiply by sqrt(sets/10) to account for session length
  let difficultyScore = averageRPE * 10;
  if (maxRPE > 8) {
    difficultyScore += (maxRPE - 8) * 5;
  }
  difficultyScore *= Math.sqrt(totalSets / 10);
  difficultyScore = Math.min(100, Math.max(1, Math.round(difficultyScore)));

  let category: SessionDifficulty["category"];
  if (difficultyScore < 40) {
    category = "easy";
  } else if (difficultyScore < 60) {
    category = "moderate";
  } else if (difficultyScore < 80) {
    category = "hard";
  } else {
    category = "brutal";
  }

  return {
    date: new Date().toISOString().split("T")[0],
    averageRPE: Math.round(averageRPE * 10) / 10,
    maxRPE,
    totalSets,
    difficultyScore,
    category,
  };
}

/**
 * Generate a summary of RPE patterns across all exercises
 */
export function generateRPESummary(trends: RPETrend[]): {
  strengthGains: RPEInsight[];
  fatigueWarnings: RPEInsight[];
  highlights: string[];
} {
  const strengthGains: RPEInsight[] = [];
  const fatigueWarnings: RPEInsight[] = [];
  const highlights: string[] = [];

  for (const trend of trends) {
    for (const insight of trend.insights) {
      if (insight.type === "strength_gain") {
        strengthGains.push({ ...insight, message: `${trend.exercise}: ${insight.message}` });
      } else if (insight.type === "fatigue_warning") {
        fatigueWarnings.push({ ...insight, message: `${trend.exercise}: ${insight.message}` });
      }
    }
  }

  // Generate highlight messages
  if (strengthGains.length > 0) {
    highlights.push(`${strengthGains.length} exercise(s) showing strength gains at same RPE`);
  }
  if (fatigueWarnings.length > 0) {
    highlights.push(`${fatigueWarnings.length} exercise(s) showing fatigue patterns - recovery may help`);
  }

  return { strengthGains, fatigueWarnings, highlights };
}

/**
 * Compare RPE between two time periods
 */
export function compareRPEPeriods(
  currentData: RPEDataPoint[],
  previousData: RPEDataPoint[]
): { exercise: string; change: string; interpretation: string }[] {
  const results: { exercise: string; change: string; interpretation: string }[] = [];

  // Group by exercise
  const currentByExercise = groupByExercise(currentData);
  const previousByExercise = groupByExercise(previousData);

  for (const [exercise, currentPoints] of Object.entries(currentByExercise)) {
    const prevPoints = previousByExercise[exercise];
    if (!prevPoints || prevPoints.length === 0) continue;

    const currentAvgRPE = average(currentPoints.map((p) => p.rpe));
    const prevAvgRPE = average(prevPoints.map((p) => p.rpe));
    const currentAvgWeight = average(currentPoints.map((p) => p.weight));
    const prevAvgWeight = average(prevPoints.map((p) => p.weight));

    const rpeDiff = currentAvgRPE - prevAvgRPE;
    const weightDiff = currentAvgWeight - prevAvgWeight;

    let interpretation = "";

    if (weightDiff > 0 && rpeDiff <= 0) {
      interpretation = "Getting stronger - more weight at same/lower effort";
    } else if (weightDiff > 0 && rpeDiff > 0.5) {
      interpretation = "Pushing harder - more weight but also more effort";
    } else if (weightDiff <= 0 && rpeDiff > 0.5) {
      interpretation = "Possible fatigue - same weight feeling harder";
    } else if (weightDiff < 0 && rpeDiff < 0) {
      interpretation = "Deload/recovery - lighter work";
    } else {
      interpretation = "Maintaining current level";
    }

    results.push({
      exercise,
      change: `Weight: ${weightDiff >= 0 ? "+" : ""}${weightDiff.toFixed(0)} lbs, RPE: ${rpeDiff >= 0 ? "+" : ""}${rpeDiff.toFixed(1)}`,
      interpretation,
    });
  }

  return results;
}

// Helper functions

function groupByRPE(dataPoints: RPEDataPoint[]): Record<string, RPEDataPoint[]> {
  const groups: Record<string, RPEDataPoint[]> = {};
  for (const point of dataPoints) {
    const key = point.rpe.toString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(point);
  }
  return groups;
}

function groupByWeight(dataPoints: RPEDataPoint[]): Record<string, RPEDataPoint[]> {
  const groups: Record<string, RPEDataPoint[]> = {};
  for (const point of dataPoints) {
    const key = point.weight.toString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(point);
  }
  return groups;
}

function groupByExercise(dataPoints: RPEDataPoint[]): Record<string, RPEDataPoint[]> {
  const groups: Record<string, RPEDataPoint[]> = {};
  for (const point of dataPoints) {
    if (!groups[point.exercise]) groups[point.exercise] = [];
    groups[point.exercise].push(point);
  }
  return groups;
}

function isIncreasingTrend(values: number[]): boolean {
  if (values.length < 2) return false;
  let increases = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) increases++;
  }
  return increases >= values.length - 1;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
