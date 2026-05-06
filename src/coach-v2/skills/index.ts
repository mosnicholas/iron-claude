/**
 * Skills catalog.
 *
 * Skills are model-loaded playbooks the coach pulls in when entering a
 * specialized mode (weekly planning, retrospective, daily reminder).
 * Each skill is a markdown file in this directory; the model fetches its
 * body via the `load_skill` tool.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface Skill {
  name: string;
  description: string;
  file: string;
}

export const SKILLS: Skill[] = [
  {
    name: "plan-week",
    description:
      "Generate the weekly training plan. Load when the athlete asks to plan their week, " +
      "when state/planning-pending.md is present, or when prompted by the Sunday cron to generate a plan.",
    file: "plan-week.md",
  },
  {
    name: "retro",
    description:
      "Write the weekly retrospective. Load when asked to generate a retro for a completed week.",
    file: "retro.md",
  },
  {
    name: "daily-reminder",
    description:
      "Compose the morning workout reminder. Load when prompted to generate today's reminder. " +
      "Read-only flow — do not log or modify workouts.",
    file: "daily-reminder.md",
  },
];

export function findSkill(name: string): Skill | undefined {
  return SKILLS.find((s) => s.name === name);
}

export function readSkillBody(skill: Skill): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, skill.file), "utf-8");
}

export function skillsCatalogForPrompt(): string {
  return SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
