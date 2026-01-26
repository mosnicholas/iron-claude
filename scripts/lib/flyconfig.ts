/**
 * Fly.io Configuration Generator
 *
 * Generates fly.toml from template with user-provided values.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { input, select } from "@inquirer/prompts";
import { ui } from "./ui.js";

const FLY_REGIONS = [
  { value: "ewr", name: "ewr - Newark, New Jersey (US East)" },
  { value: "lax", name: "lax - Los Angeles, California (US West)" },
  { value: "ord", name: "ord - Chicago, Illinois (US Central)" },
  { value: "sea", name: "sea - Seattle, Washington (US Northwest)" },
  { value: "lhr", name: "lhr - London, United Kingdom" },
  { value: "ams", name: "ams - Amsterdam, Netherlands" },
  { value: "fra", name: "fra - Frankfurt, Germany" },
  { value: "sin", name: "sin - Singapore" },
  { value: "nrt", name: "nrt - Tokyo, Japan" },
  { value: "syd", name: "syd - Sydney, Australia" },
];

export interface FlyConfig {
  appName: string;
  region: string;
}

/**
 * Check if fly.toml already exists
 */
export function flyTomlExists(): boolean {
  return existsSync("fly.toml");
}

/**
 * Collect Fly.io configuration from user
 */
export async function collectFlyConfig(): Promise<FlyConfig> {
  const appName = await input({
    message: "Fly.io app name (must be globally unique):",
    default: "my-fitness-coach",
    validate: (value) => {
      if (!value.match(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)) {
        return "App name must be lowercase, alphanumeric, and can contain hyphens";
      }
      if (value.length < 3) {
        return "App name must be at least 3 characters";
      }
      return true;
    },
  });

  const region = await select({
    message: "Select your nearest Fly.io region:",
    choices: FLY_REGIONS,
    default: "ewr",
  });

  return { appName, region };
}

/**
 * Generate fly.toml from template
 */
export function generateFlyToml(config: FlyConfig): void {
  const templatePath = "fly.toml.example";

  if (!existsSync(templatePath)) {
    throw new Error("fly.toml.example template not found");
  }

  let content = readFileSync(templatePath, "utf-8");

  // Replace placeholders
  content = content.replace(/^app = "my-fitness-coach"/m, `app = "${config.appName}"`);
  content = content.replace(/^primary_region = "ewr"/m, `primary_region = "${config.region}"`);

  writeFileSync("fly.toml", content);
  ui.success(`Generated fly.toml for app "${config.appName}" in region "${config.region}"`);
}
