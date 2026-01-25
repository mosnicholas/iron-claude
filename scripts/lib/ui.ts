/**
 * Shared UI Utilities
 *
 * Pretty terminal output for the unified setup wizard.
 */

import pc from "picocolors";
import { createSpinner, Spinner } from "nanospinner";
import boxen from "boxen";

export const ui = {
  /**
   * Main header with branding
   */
  header: (text: string): void => {
    console.log();
    console.log(pc.bold(pc.cyan(`  🏋️  ${text}`)));
    console.log(pc.dim("  " + "━".repeat(50)));
    console.log();
  },

  /**
   * Step indicator (e.g., "Step 1/5: Credentials")
   */
  step: (current: number, total: number, title: string): void => {
    console.log();
    console.log(pc.dim(`── Step ${current}/${total}: ${title} ` + "─".repeat(30)));
    console.log();
  },

  /**
   * Coach message in a bordered box
   */
  coach: (message: string): void => {
    console.log(
      boxen(message, {
        title: pc.cyan("Coach"),
        titleAlignment: "left",
        padding: 1,
        borderStyle: "round",
        borderColor: "cyan",
      })
    );
  },

  /**
   * Prefix for user input prompts
   */
  userPrompt: (): string => pc.green("You: "),

  /**
   * Success message with checkmark
   */
  success: (text: string): void => {
    console.log(pc.green(`  ✓ ${text}`));
  },

  /**
   * Error message with X
   */
  error: (text: string): void => {
    console.log(pc.red(`  ✗ ${text}`));
  },

  /**
   * Info/hint message (dimmed)
   */
  info: (text: string): void => {
    console.log(pc.dim(`  ${text}`));
  },

  /**
   * Warning message
   */
  warn: (text: string): void => {
    console.log(pc.yellow(`  ⚠ ${text}`));
  },

  /**
   * Create and start a spinner
   */
  spinner: (text: string): Spinner => {
    return createSpinner(text).start();
  },

  /**
   * Bold text helper
   */
  bold: (text: string): string => pc.bold(text),

  /**
   * Dim text helper
   */
  dim: (text: string): string => pc.dim(text),

  /**
   * Cyan text helper
   */
  cyan: (text: string): string => pc.cyan(text),

  /**
   * Print a horizontal divider
   */
  divider: (): void => {
    console.log();
    console.log(pc.dim("━".repeat(54)));
    console.log();
  },

  /**
   * Print blank line
   */
  blank: (): void => {
    console.log();
  },
};
