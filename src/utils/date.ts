/**
 * Date and Week Utilities
 * Uses date-fns and date-fns-tz for reliable date handling.
 */

import {
  format,
  getISOWeek,
  getISOWeekYear,
  addWeeks,
  startOfISOWeek,
  endOfISOWeek,
  eachDayOfInterval,
  parse,
} from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Get the configured timezone from environment
 */
export function getTimezone(): string {
  return process.env.TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * Format a date as ISO week string (e.g., "2026-W05")
 */
export function formatISOWeek(date: Date): string {
  const year = getISOWeekYear(date);
  const week = getISOWeek(date);
  return `${year}-W${week.toString().padStart(2, "0")}`;
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Format a date in human-readable form (e.g., "Friday, Jan 24")
 */
export function formatDateHuman(date: Date): string {
  return format(date, "EEEE, MMM d");
}

/**
 * Parse an ISO week string (e.g., "2026-W05") into start and end dates.
 * Start is Monday, end is Sunday.
 */
export function parseISOWeek(weekString: string): { start: Date; end: Date } {
  const match = weekString.match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error(`Invalid ISO week: ${weekString}`);

  // Parse using date-fns - "R" is ISO week-numbering year, "I" is ISO week
  // We parse to get any date in that week, then find the start/end
  const dateInWeek = parse(weekString, "RRRR-'W'II", new Date());
  const start = startOfISOWeek(dateInWeek);
  const end = endOfISOWeek(dateInWeek);

  return { start, end };
}

/**
 * Get the next week's ISO string
 */
export function getNextWeek(weekString: string): string {
  const { start } = parseISOWeek(weekString);
  const nextWeekStart = addWeeks(start, 1);
  return formatISOWeek(nextWeekStart);
}

/**
 * Get the current ISO week string for a timezone
 */
export function getCurrentWeek(timezone?: string): string {
  const tz = timezone || getTimezone();
  const now = toZonedTime(new Date(), tz);
  return formatISOWeek(now);
}

/**
 * Get today's date as YYYY-MM-DD for a timezone
 */
export function getToday(timezone?: string): string {
  const tz = timezone || getTimezone();
  const now = toZonedTime(new Date(), tz);
  return formatDate(now);
}

/**
 * Comprehensive date info for a specific timezone
 * Used for system prompts and logging
 */
export interface DateInfo {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  dayOfWeek: string; // e.g., "Tuesday"
  isoWeek: string; // e.g., "2026-W05"
  timezone: string; // The timezone used
}

/**
 * Get comprehensive date info using the configured timezone.
 * Pulls TIMEZONE from environment variable (defaults to America/New_York).
 */
export function getDateInfoTZAware(): DateInfo {
  const timezone = getTimezone();
  const now = new Date();

  // Format all values in the target timezone
  const date = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const time = formatInTimeZone(now, timezone, "HH:mm");
  const dayOfWeek = formatInTimeZone(now, timezone, "EEEE");

  // Calculate ISO week using timezone-aware date
  const zonedNow = toZonedTime(now, timezone);
  const isoWeek = formatISOWeek(zonedNow);

  return {
    date,
    time,
    dayOfWeek,
    isoWeek,
    timezone,
  };
}

/**
 * Information about a single day in a week
 */
export interface WeekDayInfo {
  dayName: string; // e.g., "Monday"
  date: string; // YYYY-MM-DD
  dateHuman: string; // e.g., "Jan 27"
}

/**
 * Get all days of a specific ISO week with their names and dates.
 * Returns Monday through Sunday.
 */
export function getWeekDays(weekString: string): WeekDayInfo[] {
  const { start, end } = parseISOWeek(weekString);

  return eachDayOfInterval({ start, end }).map((day) => ({
    dayName: format(day, "EEEE"),
    date: format(day, "yyyy-MM-dd"),
    dateHuman: format(day, "MMM d"),
  }));
}
