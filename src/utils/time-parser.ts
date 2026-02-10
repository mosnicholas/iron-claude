/**
 * Time Parser Utility
 *
 * Parses natural language time strings into 24-hour format.
 * Used for gym time scheduling from user messages.
 */

/**
 * Parse a natural language time string into a 24-hour integer (0-23).
 * Returns null if the time cannot be parsed.
 *
 * Handles formats like:
 * - "3pm", "3 pm", "3PM" → 15
 * - "3:30pm", "3:30 pm" → 15
 * - "15:00", "15:30" → 15
 * - "noon" → 12
 * - "around 3pm" → 15
 * - "4ish" → 16
 * - "6" (bare number, assumes PM for typical gym hours)
 */
export function parseTimeToHour(input: string): number | null {
  const text = input.toLowerCase().trim();

  // Handle "noon" / "midday"
  if (/\bnoon\b|\bmidday\b/.test(text)) {
    return 12;
  }

  // Handle "midnight"
  if (/\bmidnight\b/.test(text)) {
    return 0;
  }

  // Try to extract a time pattern: H:MM am/pm, H am/pm, HH:MM, or bare number
  // Patterns ordered from most specific to least specific
  const patterns = [
    // 3:30pm, 3:30 pm, 3:30PM
    /(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/i,
    // 3pm, 3 pm, 3PM, 3 a.m.
    /(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i,
    // 15:00, 15:30 (24-hour format)
    /\b(\d{1,2}):(\d{2})\b/,
    // bare number (possibly preceded by "at", "around", etc.)
    /(?:at|around|~|like|about)?\s*(\d{1,2})(?:ish)?\b/,
  ];

  // Pattern 1: H:MM am/pm
  let match = text.match(patterns[0]);
  if (match) {
    const hour = parseInt(match[1], 10);
    const meridiem = match[3].replace(/\./g, "").toLowerCase();
    return convertTo24(hour, meridiem);
  }

  // Pattern 2: H am/pm
  match = text.match(patterns[1]);
  if (match) {
    const hour = parseInt(match[1], 10);
    const meridiem = match[2].replace(/\./g, "").toLowerCase();
    return convertTo24(hour, meridiem);
  }

  // Pattern 3: HH:MM (24-hour)
  match = text.match(patterns[2]);
  if (match) {
    const hour = parseInt(match[1], 10);
    if (hour >= 0 && hour <= 23) {
      return hour;
    }
    return null;
  }

  // Pattern 4: bare number
  match = text.match(patterns[3]);
  if (match) {
    const hour = parseInt(match[1], 10);
    if (hour >= 1 && hour <= 23) {
      // For gym context: assume PM for numbers 1-11 that are typical gym hours
      // Numbers 12+ are already 24-hour format
      if (hour >= 1 && hour <= 6) {
        // 1-6 almost certainly means PM for gym time
        return hour + 12;
      }
      // 7-11 is ambiguous (7am or 7pm?) - assume as-is since morning gym is common
      // 12-23 are already correct
      return hour;
    }
    return null;
  }

  return null;
}

/**
 * Convert 12-hour time to 24-hour
 */
function convertTo24(hour: number, meridiem: string): number | null {
  if (hour < 1 || hour > 12) return null;

  if (meridiem === "am") {
    return hour === 12 ? 0 : hour;
  }
  // pm
  return hour === 12 ? 12 : hour + 12;
}
