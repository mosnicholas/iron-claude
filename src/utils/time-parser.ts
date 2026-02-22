/**
 * Time Parser Utility
 *
 * Parses natural language time strings into 24-hour format.
 * Uses chrono-node for robust NLP date/time parsing.
 */

import * as chrono from "chrono-node";

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
 * - "in 2 hours" → (current hour + 2)
 */
export function parseTimeToHour(input: string): number | null {
  const parsed = chrono.parseDate(input);
  if (!parsed) return null;
  return parsed.getHours();
}
