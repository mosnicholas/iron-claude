/**
 * Date and Week Utilities
 *
 * All date operations for the fitness coach system.
 * Uses ISO week numbers (week starts on Monday).
 */

/**
 * Get the ISO week number for a date
 */
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Get the ISO week year (may differ from calendar year at year boundaries)
 */
export function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

/**
 * Format a date as an ISO week string (e.g., "2025-W04")
 */
export function formatISOWeek(date: Date): string {
  const year = getISOWeekYear(date);
  const week = getISOWeek(date);
  return `${year}-W${week.toString().padStart(2, '0')}`;
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format a date as a human-readable string (e.g., "Monday, Jan 20")
 */
export function formatDateHuman(date: Date): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = dayNames[date.getDay()];
  const monthName = monthNames[date.getMonth()];
  const dayOfMonth = date.getDate();

  return `${dayName}, ${monthName} ${dayOfMonth}`;
}

/**
 * Get the day of the week (lowercase)
 */
export function getDayKey(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
}

/**
 * Get the day of the week (title case)
 */
export function getDayName(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

/**
 * Check if a date is a weekend
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is today
 */
export function isToday(date: Date, timezone?: string): boolean {
  const today = timezone ? getDateInTimezone(new Date(), timezone) : new Date();
  return formatDate(date) === formatDate(today);
}

/**
 * Get the start of the ISO week (Monday)
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the ISO week (Sunday)
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Get a date in a specific timezone
 */
export function getDateInTimezone(date: Date, timezone: string): Date {
  const str = date.toLocaleString('en-US', { timeZone: timezone });
  return new Date(str);
}

/**
 * Get the current time in a specific timezone as HH:MM
 */
export function getCurrentTime(timezone: string): string {
  const date = new Date();
  return date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Parse an ISO week string (e.g., "2025-W04") into start and end dates
 */
export function parseISOWeek(weekString: string): { start: Date; end: Date } {
  const match = weekString.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO week format: ${weekString}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // January 4th is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;

  // Find the Monday of week 1
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);

  // Add (week - 1) weeks to get to the target week
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return { start, end };
}

/**
 * Get an array of dates for a week
 */
export function getWeekDates(weekString: string): Date[] {
  const { start } = parseISOWeek(weekString);
  const dates: Date[] = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    dates.push(date);
  }

  return dates;
}

/**
 * Get the previous week's ISO string
 */
export function getPreviousWeek(weekString: string): string {
  const { start } = parseISOWeek(weekString);
  start.setUTCDate(start.getUTCDate() - 7);
  return formatISOWeek(start);
}

/**
 * Get the next week's ISO string
 */
export function getNextWeek(weekString: string): string {
  const { start } = parseISOWeek(weekString);
  start.setUTCDate(start.getUTCDate() + 7);
  return formatISOWeek(start);
}

/**
 * Get the number of days between two dates
 */
export function daysBetween(date1: Date, date2: Date): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Check if a date string is valid
 */
export function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Get the current week string
 */
export function getCurrentWeek(timezone?: string): string {
  const now = timezone ? getDateInTimezone(new Date(), timezone) : new Date();
  return formatISOWeek(now);
}

/**
 * Get today's date string
 */
export function getToday(timezone?: string): string {
  const now = timezone ? getDateInTimezone(new Date(), timezone) : new Date();
  return formatDate(now);
}
