#!/usr/bin/env tsx
/**
 * Standalone Integration Setup
 *
 * Run setup for a specific fitness device integration.
 *
 * Usage:
 *   npm run setup:integration         # Interactive selection
 *   npm run setup:integration whoop   # Direct to Whoop setup
 *   npm run setup:whoop               # Shorthand for Whoop
 */

import { select } from "@inquirer/prompts";
import pc from "picocolors";
import { setupWhoop, isWhoopConfigured } from "../src/integrations/whoop/setup.js";
import { INTEGRATION_METADATA } from "../src/integrations/registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Integration Setup Registry
// ─────────────────────────────────────────────────────────────────────────────

interface IntegrationSetup {
  name: string;
  slug: string;
  available: boolean;
  isConfigured: () => boolean;
  setup: () => Promise<{ success: boolean }>;
}

const INTEGRATIONS: IntegrationSetup[] = [
  {
    name: "Whoop",
    slug: "whoop",
    available: true,
    isConfigured: isWhoopConfigured,
    setup: setupWhoop,
  },
  // Future integrations:
  // {
  //   name: "Garmin",
  //   slug: "garmin",
  //   available: false,
  //   isConfigured: () => false,
  //   setup: async () => ({ success: false }),
  // },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const deviceArg = process.argv[2];

  // If device specified as argument, run that setup directly
  if (deviceArg) {
    const integration = INTEGRATIONS.find((i) => i.slug === deviceArg.toLowerCase());

    if (!integration) {
      console.error(pc.red(`Unknown integration: ${deviceArg}`));
      console.log();
      console.log("Available integrations:");
      for (const meta of INTEGRATION_METADATA) {
        const status = meta.available ? pc.green("available") : pc.dim("coming soon");
        console.log(`  - ${meta.slug}: ${meta.name} (${status})`);
      }
      process.exit(1);
    }

    if (!integration.available) {
      console.error(pc.yellow(`${integration.name} integration is coming soon!`));
      process.exit(1);
    }

    const result = await integration.setup();
    process.exit(result.success ? 0 : 1);
  }

  // Interactive selection
  console.log();
  console.log(pc.bold(pc.cyan("  Fitness Device Integration Setup")));
  console.log(pc.dim("  " + "━".repeat(40)));
  console.log();

  // Show current status
  console.log(pc.dim("  Current integration status:"));
  for (const integration of INTEGRATIONS) {
    if (integration.available) {
      const configured = integration.isConfigured();
      const status = configured ? pc.green("configured") : pc.dim("not configured");
      console.log(`    ${integration.name}: ${status}`);
    }
  }
  console.log();

  // Build choices
  const choices = INTEGRATIONS.map((integration) => {
    const configured = integration.isConfigured();
    const statusHint = configured ? " (reconfigure)" : "";

    return {
      value: integration.slug,
      name: `${integration.name}${statusHint}`,
      disabled: !integration.available ? "Coming soon" : false,
    };
  });

  // Add cancel option
  choices.push({
    value: "cancel",
    name: pc.dim("Cancel"),
    disabled: false,
  });

  const selected = await select({
    message: "Which integration do you want to set up?",
    choices,
  });

  if (selected === "cancel") {
    console.log(pc.dim("  Setup cancelled."));
    process.exit(0);
  }

  const integration = INTEGRATIONS.find((i) => i.slug === selected);
  if (!integration) {
    console.error(pc.red("Integration not found"));
    process.exit(1);
  }

  const result = await integration.setup();
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Setup error:", error);
  process.exit(1);
});
