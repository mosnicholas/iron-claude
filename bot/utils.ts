/**
 * Date utilities for IronClaude bot
 */


const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type DayKey = (typeof DAY_KEYS)[number];
export type DayName = (typeof DAY_NAMES)[number];

/**
 * Get ISO week number string (e.g., "2026-W04")
 */
export function getWeekNumber(date: Date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );

  // Set to nearest Thursday (ISO week starts Monday, week 1 contains Jan 4)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));

  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Get day key (lowercase day name, e.g., "monday")
 */
export function getDayKey(date: Date = new Date()): DayKey {
  return DAY_KEYS[date.getDay()];
}

/**
 * Get day name (e.g., "Monday")
 */
export function getDayName(date: Date = new Date()): DayName {
  return DAY_NAMES[date.getDay()];
}

/**
 * Check if today is a weekend
 */
export function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Format a date as ISO string (YYYY-MM-DD)
 */
export function formatISODate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}
