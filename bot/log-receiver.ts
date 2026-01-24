/**
 * Log Receiver - Parse and save workout entries to markdown
 *
 * Handles incoming workout logs from Telegram and appends them to
 * the appropriate daily log file in weeks/YYYY-WXX/[day].md
 */

import { promises as fs } from 'fs';
import { dirname } from 'path';

export interface ParsedEntry {
  exercise: string;
  weight?: string; // e.g., "115", "+25" for bodyweight
  sets: string[]; // e.g., ["6", "5", "5"] or ["30s", "25s"]
  rpe?: number;
  display: string; // Human readable display
}

/**
 * Parse a workout entry from text
 *
 * Supported formats:
 * - "OHP 115: 6, 5, 5 @8" (barbell with RPE)
 * - "OHP 115: 6, 5, 5" (barbell without RPE)
 * - "Dips +25: 8, 7, 7 @7.5" (bodyweight with added weight)
 * - "Pull-ups: 10, 8, 7" (bodyweight)
 * - "Handstand: 30s, 25s, 30s" (isometric hold)
 * - "Wall HSPU: 3, 2, 2" (skill work)
 */
export function parseWorkoutEntry(text: string): ParsedEntry | null {
  const trimmed = text.trim();

  // Pattern: Exercise [Weight]: reps[, reps...] [@RPE]
  // Weight can be: number, +number (added weight), or omitted
  const pattern =
    /^([A-Za-z][A-Za-z\s\-]+?)(?:\s+(\+?\d+(?:\.\d+)?(?:\s*lbs?)?))?\s*:\s*(.+?)(?:\s*@\s*(\d+(?:\.\d+)?))?$/i;

  const match = trimmed.match(pattern);
  if (!match) {
    return null;
  }

  const [, exercise, weight, setsStr, rpeStr] = match;

  // Parse sets (comma or space separated)
  const sets = setsStr
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sets.length === 0) {
    return null;
  }

  // Build display string
  const weightDisplay = weight ? `${weight}: ` : '';
  const setsDisplay = sets.join(', ');
  const rpeDisplay = rpeStr ? ` @${rpeStr}` : '';
  const display = `${weightDisplay}${setsDisplay}${rpeDisplay}`;

  return {
    exercise: exercise.trim(),
    weight: weight?.trim(),
    sets,
    rpe: rpeStr ? parseFloat(rpeStr) : undefined,
    display,
  };
}

/**
 * Append a workout entry to a log file
 *
 * Creates the file if it doesn't exist with a basic header.
 * Appends the entry to the ## Strength or ## Skills section based on content.
 */
export async function handleLogMessage(
  logPath: string,
  rawText: string,
  parsed: ParsedEntry
): Promise<void> {
  // Ensure directory exists
  const dir = dirname(logPath);
  await fs.mkdir(dir, { recursive: true });

  // Check if file exists
  let content: string;
  try {
    content = await fs.readFile(logPath, 'utf-8');
  } catch {
    // Create new log file with header
    const dayName = logPath.split('/').pop()?.replace('.md', '') || 'workout';
    const today = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    content = `# ${capitalize(dayName)} (${today})

## Conditions
- Energy: /10
- Sleep: h

## Skills

## Strength

## Notes

`;
  }

  // Determine section (skills vs strength)
  const isSkill = isSkillExercise(parsed.exercise);
  const section = isSkill ? '## Skills' : '## Strength';
  const entry = `- ${parsed.exercise}${parsed.weight ? ' ' + parsed.weight : ''}: ${parsed.sets.join(', ')}${parsed.rpe ? ' @' + parsed.rpe : ''}`;

  // Find the section and append
  const sectionIndex = content.indexOf(section);
  if (sectionIndex === -1) {
    // Section doesn't exist, append at end
    content = content.trimEnd() + `\n\n${section}\n${entry}\n`;
  } else {
    // Find the next section or end of file
    const afterSection = content.slice(sectionIndex + section.length);
    const nextSectionMatch = afterSection.match(/\n##\s/);
    const insertPoint = nextSectionMatch
      ? sectionIndex + section.length + (nextSectionMatch.index ?? 0)
      : content.length;

    // Insert the entry before the next section
    const before = content.slice(0, insertPoint).trimEnd();
    const after = content.slice(insertPoint);
    content = `${before}\n${entry}${after}`;
  }

  await fs.writeFile(logPath, content, 'utf-8');
}

/**
 * Check if an exercise is a skill (calisthenics/isometric)
 */
function isSkillExercise(exercise: string): boolean {
  const skillKeywords = [
    'handstand',
    'hspu',
    'planche',
    'lever',
    'l-sit',
    'lsit',
    'hollow',
    'pike',
    'tuck',
    'straddle',
    'muscle-up',
    'muscle up',
    'ring',
    'wall',
    'freestanding',
  ];

  const lowerExercise = exercise.toLowerCase();
  return skillKeywords.some((keyword) => lowerExercise.includes(keyword));
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
