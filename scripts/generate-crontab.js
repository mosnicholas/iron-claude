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

import { getTimezoneOffset } from "date-fns-tz";

const DEFAULT_TIMEZONE = "America/New_York";

function getTimezone() {
  return process.env.TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * Convert local time to UTC cron schedule using date-fns-tz
 * @param {number} localHour - Hour in local time (0-23)
 * @param {number} localMinute - Minute (0-59)
 * @param {string} timezone - IANA timezone string
 * @returns {{ utcHour: number, utcMinute: number, dayOffset: number }}
 */
function localToUtcSchedule(localHour, localMinute, timezone) {
  // Get timezone offset in minutes (negative for west of UTC)
  // Use current date to get the correct offset (handles DST)
  const offsetMs = getTimezoneOffset(timezone, new Date());
  const offsetMinutes = offsetMs / (60 * 1000);

  // Convert local time to UTC by subtracting the offset
  // offset is positive for timezones ahead of UTC (e.g., +540 for Asia/Tokyo)
  // offset is negative for timezones behind UTC (e.g., -300 for America/New_York)
  let totalMinutes = localHour * 60 + localMinute - offsetMinutes;
  let dayOffset = 0;

  // Handle day wraparound
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60;
    dayOffset = -1;
  } else if (totalMinutes >= 24 * 60) {
    totalMinutes -= 24 * 60;
    dayOffset = 1;
  }

  const utcHour = Math.floor(totalMinutes / 60);
  const utcMinute = totalMinutes % 60;

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
      lines.push(
        `# ${schedule.name} - ${localTime} ${timezone} (${utcTime} UTC)`
      );
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
