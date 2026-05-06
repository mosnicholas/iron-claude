/**
 * Skill loading tool — lets the coach pull in a specialized playbook
 * (planning, retro, daily reminder) on demand.
 */

import { z } from "zod";
import { defineTool } from "../tool.js";
import { findSkill, readSkillBody, SKILLS } from "../skills/index.js";

export const loadSkill = defineTool({
  name: "load_skill",
  description:
    "Load a specialized playbook into context before entering a skilled mode. " +
    "Available skills: " +
    SKILLS.map((s) => s.name).join(", ") +
    ". Call this BEFORE doing the work — the returned content tells you exactly how to proceed.",
  schema: z.object({
    name: z
      .string()
      .describe("Name of the skill to load (e.g. 'plan-week', 'retro', 'daily-reminder')."),
  }),
  handler: async (input) => {
    const skill = findSkill(input.name);
    if (!skill) {
      const known = SKILLS.map((s) => s.name).join(", ");
      return `Unknown skill: ${input.name}. Known skills: ${known}`;
    }
    return readSkillBody(skill);
  },
});

export const SKILL_TOOLS = [loadSkill];
