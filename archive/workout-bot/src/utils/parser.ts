import type { ExerciseLog, ExerciseSet, UserProfile } from '../types/index.js';

export function parseExerciseLog(text: string): ExerciseLog | null {
  const trimmed = text.trim();

  // Pattern 1: Standard with weight - "OHP 115: 6, 5, 5 @8"
  const standardMatch = trimmed.match(
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*:\s*(.+?)(?:\s*@(\d+(?:\.\d+)?))?$/
  );
  if (standardMatch) {
    const [, name, weight, repsStr, rpe] = standardMatch;
    return {
      name: name.trim(),
      sets: parseReps(repsStr, parseFloat(weight), undefined, rpe ? parseFloat(rpe) : undefined),
    };
  }

  // Pattern 2: Bodyweight with added weight - "Dips +25: 8, 7, 6 @7"
  const addedWeightMatch = trimmed.match(
    /^(.+?)\s*\+(\d+(?:\.\d+)?)\s*:\s*(.+?)(?:\s*@(\d+(?:\.\d+)?))?$/
  );
  if (addedWeightMatch) {
    const [, name, addedWeight, repsStr, rpe] = addedWeightMatch;
    return {
      name: name.trim(),
      sets: parseReps(repsStr, undefined, parseFloat(addedWeight), rpe ? parseFloat(rpe) : undefined),
    };
  }

  // Pattern 3: Holds/Duration - "Hollow: 35s, 30s" or "Plank: 60s, 55s"
  const holdMatch = trimmed.match(/^(.+?)\s*:\s*([\d\s,s]+)$/i);
  if (holdMatch && holdMatch[2].includes('s')) {
    const [, name, durationsStr] = holdMatch;
    return {
      name: name.trim(),
      sets: parseDurations(durationsStr),
    };
  }

  // Pattern 4: Bodyweight only - "Pull-ups: 10, 8, 7 @8"
  const bodyweightMatch = trimmed.match(
    /^(.+?)\s*:\s*(.+?)(?:\s*@(\d+(?:\.\d+)?))?$/
  );
  if (bodyweightMatch) {
    const [, name, repsStr, rpe] = bodyweightMatch;
    // Check if it contains durations (has 's')
    if (!repsStr.includes('s')) {
      return {
        name: name.trim(),
        sets: parseReps(repsStr, undefined, undefined, rpe ? parseFloat(rpe) : undefined),
      };
    }
  }

  return null;
}

function parseReps(
  repsStr: string,
  weight?: number,
  addedWeight?: number,
  rpe?: number
): ExerciseSet[] {
  const reps = repsStr
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => parseInt(r, 10))
    .filter((r) => !isNaN(r));

  return reps.map((rep, index) => {
    const set: ExerciseSet = { reps: rep };
    if (weight !== undefined) set.weight = weight;
    if (addedWeight !== undefined) set.addedWeight = addedWeight;
    // RPE typically applies to the last set or all sets
    if (rpe !== undefined && index === reps.length - 1) set.rpe = rpe;
    return set;
  });
}

function parseDurations(durationsStr: string): ExerciseSet[] {
  const durations = durationsStr
    .split(',')
    .map((d) => d.trim().replace(/s/gi, ''))
    .filter((d) => d.length > 0)
    .map((d) => parseInt(d, 10))
    .filter((d) => !isNaN(d));

  return durations.map((duration) => ({
    reps: 1,
    duration,
  }));
}

export function isDoneSignal(text: string): boolean {
  const doneSignals = [
    'done',
    'finished',
    "that's it",
    'thats it',
    'wrapping up',
    'all done',
    'complete',
    'completed',
    'end workout',
    'session done',
    '/done',
  ];

  const lowerText = text.toLowerCase().trim();
  return doneSignals.some((signal) => lowerText.includes(signal));
}

export function isSkipSignal(text: string): boolean {
  const skipSignals = [
    'skip',
    'skipping',
    'rest day',
    "can't make it",
    'cant make it',
    'not today',
    '/skip',
  ];

  const lowerText = text.toLowerCase().trim();
  return skipSignals.some((signal) => lowerText.includes(signal));
}

export function parseClaudeMd(content: string): UserProfile {
  const profile: UserProfile = {
    name: '',
    location: '',
    gym: '',
    experience: '',
    goals: {
      primary: [],
      targets: [],
    },
    preferences: {
      sessionLength: '45-60 min',
      exerciseRotation: '2 weeks',
      skillFirst: true,
      trainingDays: 5,
    },
    currentStatus: {
      programWeek: 1,
      lastDeload: null,
      bodyweight: null,
    },
    injuries: [],
    coachingNotes: [],
  };

  // Parse name
  const nameMatch = content.match(/Name:\s*(.+)/i);
  if (nameMatch) profile.name = nameMatch[1].trim();

  // Parse location
  const locationMatch = content.match(/Location:\s*(.+)/i);
  if (locationMatch) profile.location = locationMatch[1].trim();

  // Parse gym
  const gymMatch = content.match(/Gym:\s*(.+)/i);
  if (gymMatch) profile.gym = gymMatch[1].trim();

  // Parse experience
  const experienceMatch = content.match(/Experience:\s*(.+)/i);
  if (experienceMatch) profile.experience = experienceMatch[1].trim();

  // Parse primary goals
  const primaryGoalsMatch = content.match(
    /### Primary\n([\s\S]*?)(?=###|## |$)/
  );
  if (primaryGoalsMatch) {
    profile.goals.primary = primaryGoalsMatch[1]
      .split('\n')
      .filter((line) => line.startsWith('-'))
      .map((line) => line.replace(/^-\s*/, '').trim());
  }

  // Parse session length
  const sessionMatch = content.match(/Session length:\s*(.+)/i);
  if (sessionMatch) profile.preferences.sessionLength = sessionMatch[1].trim();

  // Parse program week
  const weekMatch = content.match(/Program week:\s*(\d+)/i);
  if (weekMatch) profile.currentStatus.programWeek = parseInt(weekMatch[1], 10);

  // Parse injuries
  const injuriesMatch = content.match(
    /## Injuries & Limitations\n([\s\S]*?)(?=##|$)/
  );
  if (injuriesMatch) {
    const injuries = injuriesMatch[1]
      .split('\n')
      .filter((line) => line.startsWith('-'))
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => !line.toLowerCase().includes('none'));

    profile.injuries = injuries;
  }

  // Parse coaching notes
  const notesMatch = content.match(/## Notes for Claude\n([\s\S]*?)(?=##|$)/);
  if (notesMatch) {
    profile.coachingNotes = notesMatch[1]
      .split('\n')
      .filter((line) => line.startsWith('-'))
      .map((line) => line.replace(/^-\s*/, '').trim());
  }

  return profile;
}

export function extractNumberFromText(text: string): number | null {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

export function extractTimeFromText(text: string): string | null {
  // Match patterns like "7am", "7:30am", "14:00", "2pm", "2:30 pm"
  const timeMatch = text.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i);
  return timeMatch ? timeMatch[0] : null;
}
