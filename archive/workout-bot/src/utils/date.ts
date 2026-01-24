const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type DayName = (typeof DAY_NAMES)[number];
export type DayKey = (typeof DAY_KEYS)[number];

export function getWeekNumber(date: Date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );

  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));

  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getNextWeekNumber(date: Date = new Date()): string {
  const nextWeek = new Date(date);
  nextWeek.setDate(nextWeek.getDate() + 7);
  return getWeekNumber(nextWeek);
}

export function getDayKey(date: Date = new Date()): DayKey {
  return DAY_KEYS[date.getDay()];
}

export function getDayName(date: Date = new Date()): DayName {
  return DAY_NAMES[date.getDay()];
}

export function formatDateForFilename(date: Date = new Date()): string {
  const dayKey = getDayKey(date);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${dayKey}-${month}-${day}`;
}

export function formatISODate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

export function isWeekday(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

export function isSunday(date: Date = new Date()): boolean {
  return date.getDay() === 0;
}

export function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  // Parse formats like "7am", "7:30am", "14:00", "2pm", "2:30 pm"
  const cleanStr = timeStr.toLowerCase().replace(/\s+/g, '');

  // 24-hour format: "14:00" or "14:30"
  const time24Match = cleanStr.match(/^(\d{1,2}):(\d{2})$/);
  if (time24Match) {
    return {
      hours: parseInt(time24Match[1], 10),
      minutes: parseInt(time24Match[2], 10),
    };
  }

  // 12-hour format: "7am", "7:30am", "2pm", "2:30pm"
  const time12Match = cleanStr.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (time12Match) {
    let hours = parseInt(time12Match[1], 10);
    const minutes = time12Match[2] ? parseInt(time12Match[2], 10) : 0;
    const isPM = time12Match[3] === 'pm';

    if (isPM && hours !== 12) {
      hours += 12;
    } else if (!isPM && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  return null;
}

export function getDateAtTime(
  hours: number,
  minutes: number,
  baseDate: Date = new Date()
): Date {
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function getWeekStartDate(weekNumber: string): Date {
  const [year, week] = weekNumber.split('-W').map(Number);

  // January 4th is always in week 1
  const jan4 = new Date(year, 0, 4);

  // Get Monday of week 1
  const dayOfWeek = jan4.getDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - dayOfWeek + 1);

  // Add weeks
  const targetDate = new Date(mondayWeek1);
  targetDate.setDate(mondayWeek1.getDate() + (week - 1) * 7);

  return targetDate;
}

export function getWeekEndDate(weekNumber: string): Date {
  const start = getWeekStartDate(weekNumber);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}
