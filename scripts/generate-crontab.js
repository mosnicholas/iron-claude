#!/usr/bin/env node
/**
 * Generate crontab with timezone-aware schedules
 *
 * Reads TIMEZONE from environment and generates crontab entries
 * that run at the correct UTC times for the user's local schedule.
 *
 * Default schedule (in user's local time):
 * - Check reminders: Every hour
 * - Daily reminder: 6:00 AM on weekdays
 * - Weekly retrospective: Sunday 7:30 PM
 * - Weekly plan: Sunday 8:00 PM
 */

// Inline implementation to avoid needing to build TypeScript
// Uses the same logic as src/utils/date.ts

const DEFAULT_TIMEZONE = "America/New_York";

function getTimezone() {
  return process.env.TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * Convert local time to UTC cron schedule
 * @param {number} localHour - Hour in local time (0-23)
 * @param {number} localMinute - Minute (0-59)
 * @param {string} timezone - IANA timezone string
 * @returns {{ utcHour: number, utcMinute: number, dayOffset: number }}
 */
function localToUtcSchedule(localHour, localMinute, timezone) {
  // Create a reference date (use a date without DST ambiguity)
  // We'll use the current date to get the correct offset
  const now = new Date();

  // Create a date string in the target timezone
  const localDateStr = now.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD format

  // Parse it back as if it were UTC, then adjust
  const [year, month, day] = localDateStr.split("-").map(Number);

  // Create a date object for the local time
  const localDate = new Date(Date.UTC(year, month - 1, day, localHour, localMinute));

  // Get the offset for this timezone at this date
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  });

  // Parse offset from formatted string (e.g., "GMT-5" or "GMT+2")
  const parts = formatter.formatToParts(localDate);
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  const offsetMatch = tzPart?.value?.match(/GMT([+-]?\d+)?(?::(\d+))?/);

  let offsetHours = 0;
  let offsetMinutes = 0;

  if (offsetMatch) {
    offsetHours = parseInt(offsetMatch[1] || "0", 10);
    offsetMinutes = parseInt(offsetMatch[2] || "0", 10);
    if (offsetHours < 0) offsetMinutes = -offsetMinutes;
  }

  // Convert local time to UTC
  // If timezone is GMT-5, local 8pm = UTC 8pm + 5 = UTC 1am (next day)
  let utcHour = localHour - offsetHours;
  let utcMinute = localMinute - offsetMinutes;
  let dayOffset = 0;

  // Handle minute overflow/underflow
  if (utcMinute < 0) {
    utcMinute += 60;
    utcHour -= 1;
  } else if (utcMinute >= 60) {
    utcMinute -= 60;
    utcHour += 1;
  }

  // Handle hour overflow/underflow
  if (utcHour < 0) {
    utcHour += 24;
    dayOffset = -1; // Previous day in UTC
  } else if (utcHour >= 24) {
    utcHour -= 24;
    dayOffset = 1; // Next day in UTC
  }

  return { utcHour, utcMinute, dayOffset };
}

/**
 * Convert day of week with offset
 * @param {string} daySpec - Cron day spec (e.g., "0" for Sunday, "1-5" for Mon-Fri)
 * @param {number} dayOffset - Day offset from timezone conversion
 * @returns {string} - Adjusted cron day spec
 */
function adjustDayOfWeek(daySpec, dayOffset) {
  if (dayOffset === 0) return daySpec;

  // Handle range (e.g., "1-5")
  if (daySpec.includes("-")) {
    const [start, end] = daySpec.split("-").map(Number);
    const newStart = ((start + dayOffset + 7) % 7).toString();
    const newEnd = ((end + dayOffset + 7) % 7).toString();
    return `${newStart}-${newEnd}`;
  }

  // Handle single day
  const day = parseInt(daySpec, 10);
  return ((day + dayOffset + 7) % 7).toString();
}

function generateCrontab() {
  const timezone = getTimezone();
  const cronSecret = "${CRON_SECRET}"; // Will be expanded by shell

  console.error(`Generating crontab for timezone: ${timezone}`);

  // Schedule definitions in local time
  const schedules = [
    {
      name: "Check reminders",
      localHour: null, // Every hour
      localMinute: 0,
      dayOfWeek: "*",
      endpoint: "check-reminders",
    },
    {
      name: "Daily reminder",
      localHour: 6,
      localMinute: 0,
      dayOfWeek: "1-5", // Mon-Fri
      endpoint: "daily-reminder",
    },
    {
      name: "Weekly retrospective",
      localHour: 19,
      localMinute: 30,
      dayOfWeek: "0", // Sunday
      endpoint: "weekly-retro",
    },
    {
      name: "Weekly plan",
      localHour: 20,
      localMinute: 0,
      dayOfWeek: "0", // Sunday
      endpoint: "weekly-plan",
    },
  ];

  const lines = [
    "# Fitness Coach Scheduled Tasks",
    `# Generated for timezone: ${timezone}`,
    `# Generated at: ${new Date().toISOString()}`,
    "",
  ];

  for (const schedule of schedules) {
    let cronExpr;

    if (schedule.localHour === null) {
      // Every hour - no timezone conversion needed
      cronExpr = `${schedule.localMinute} * * * *`;
      lines.push(`# ${schedule.name} - every hour`);
    } else {
      const { utcHour, utcMinute, dayOffset } = localToUtcSchedule(
        schedule.localHour,
        schedule.localMinute,
        timezone
      );

      const adjustedDay = adjustDayOfWeek(schedule.dayOfWeek, dayOffset);
      cronExpr = `${utcMinute} ${utcHour} * * ${adjustedDay}`;

      const localTime = `${schedule.localHour.toString().padStart(2, "0")}:${schedule.localMinute.toString().padStart(2, "0")}`;
      const utcTime = `${utcHour.toString().padStart(2, "0")}:${utcMinute.toString().padStart(2, "0")}`;
      lines.push(`# ${schedule.name} - ${localTime} ${timezone} (${utcTime} UTC)`);
    }

    lines.push(
      `${cronExpr} curl -s -H "Authorization: Bearer ${cronSecret}" http://localhost:8080/api/cron/${schedule.endpoint}`
    );
    lines.push("");
  }

  return lines.join("\n");
}

// Output the generated crontab
console.log(generateCrontab());
