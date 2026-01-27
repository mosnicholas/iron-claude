/**
 * Date and Week Utilities
 * Simplified to commonly used functions only.
 */

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

export function formatISOWeek(date: Date): string {
  return `${getISOWeekYear(date)}-W${getISOWeek(date).toString().padStart(2, "0")}`;
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateHuman(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function getDateInTimezone(date: Date, timezone: string): Date {
  return new Date(date.toLocaleString("en-US", { timeZone: timezone }));
}

export function parseISOWeek(weekString: string): { start: Date; end: Date } {
  const match = weekString.match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error(`Invalid ISO week: ${weekString}`);

  const [, yearStr, weekStr] = match;
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);

  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return { start, end };
}

export function getNextWeek(weekString: string): string {
  const { start } = parseISOWeek(weekString);
  start.setUTCDate(start.getUTCDate() + 7);
  return formatISOWeek(start);
}

export function getCurrentWeek(timezone?: string): string {
  const now = timezone ? getDateInTimezone(new Date(), timezone) : new Date();
  return formatISOWeek(now);
}

export function getToday(timezone?: string): string {
  const now = timezone ? getDateInTimezone(new Date(), timezone) : new Date();
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

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Get the configured timezone from environment
 */
export function getTimezone(): string {
  return process.env.TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * Get comprehensive date info using the configured timezone.
 * Pulls TIMEZONE from environment variable (defaults to America/New_York).
 */
export function getDateInfoTZAware(): DateInfo {
  const timezone = getTimezone();
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const dayOfWeek = get("weekday");
  const hour = get("hour");
  const minute = get("minute");

  // Calculate ISO week using timezone-aware date
  const tzDate = getDateInTimezone(now, timezone);
  const isoWeek = formatISOWeek(tzDate);

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    dayOfWeek,
    isoWeek,
    timezone,
  };
}
