/**
 * Skills System for IronClaude
 *
 * Skills are contextual capabilities that get activated based on what the user
 * is doing. They replace hardcoded slash commands with dynamic prompt fragments
 * and tool additions.
 *
 * Skills are activated via pattern matching on the user's message. If a pattern
 * matches, the skill's prompt fragment is injected into the system prompt and
 * its additional tools are made available for that query.
 */

export interface Skill {
  name: string;
  description: string;
  promptFragment: string;
  additionalTools?: string[];
  triggerPatterns: RegExp[];
}

const SKILLS: Record<string, Skill> = {
  "exercise-demo": {
    name: "exercise-demo",
    description: "Find exercise demonstrations and technique cues",
    promptFragment: `The user is asking about exercise form, technique, or wants a demonstration.
Search for quality instructional content from reputable sources (Jeff Nippard,
AthleanX, Renaissance Periodization, Squat University, etc).
Provide the video link and 2-3 key technique cues.`,
    additionalTools: ["WebSearch"],
    triggerPatterns: [
      /\b(show me|demo|demonstrate|how (?:do|to) (?:i |you )?do|form (?:for|on|check)|technique)\b/i,
      /\b(proper form|good form|correct form)\b/i,
    ],
  },

  "workout-complete": {
    name: "workout-complete",
    description: "Complete and summarize a workout",
    promptFragment: `The user is finishing their workout. Generate a completion summary:
1. Read the current workout file and state/session.json
2. List all exercises completed with sets/reps/weight
3. Note any PRs hit
4. Note any exercises skipped from the plan
5. Brief coaching note (what went well, what to watch)
6. Update the workout file status to "completed"
7. Clear state/session.json (set mode to "idle")
8. Save any relevant memories from the session`,
    triggerPatterns: [
      /\b(i'?m done|that'?s (?:it|my workout|all)|finished|wrapping up|calling it)\b/i,
      /\b(done (?:for today|working out|with (?:my )?workout))\b/i,
    ],
  },

  "exercise-lookup": {
    name: "exercise-lookup",
    description: "Look up exercise or equipment information",
    promptFragment: `The user is asking about an exercise, machine, or training concept.
Use WebSearch to find accurate information. Prefer reputable fitness sources.
If you can't find reliable info, say so rather than guessing.`,
    additionalTools: ["WebSearch"],
    triggerPatterns: [
      /\b(what (?:is|does|muscles)|how does|tell me about|explain|look up)\b.{0,30}\b(machine|exercise|equipment|muscle|movement)\b/i,
      /\b(CF\d+|model\s*#?\s*\d+)\b/i, // Machine model numbers
    ],
  },

  "progress-check": {
    name: "progress-check",
    description: "Analyze training progress and trends",
    promptFragment: `The user wants to check their training progress. Read historical workout data,
PRs (prs.yaml), and recent weeks to analyze:
- Weight progression on key lifts
- Volume trends
- PR history
- Any stalls or breakthroughs
Provide specific numbers and comparisons, not vague encouragement.`,
    triggerPatterns: [
      /\b(how'?s my|am i (?:improving|progressing|getting)|progress|trend|getting stronger)\b/i,
      /\b(show (?:me )?(?:my )?(?:PRs?|records|progress|stats))\b/i,
    ],
  },

  "plan-adjustment": {
    name: "plan-adjustment",
    description: "Modify the current week's training plan",
    promptFragment: `The user wants to adjust their training plan for this week.
Read the current plan, understand their request, and modify accordingly.
Update the plan file and explain what changed and why.
Respect their preferences from learnings.md.`,
    triggerPatterns: [
      /\b(swap|switch|replace|change|adjust|modify)\b.{0,20}\b(plan|workout|exercise|day)\b/i,
      /\b(can (?:we|i)|let'?s)\b.{0,20}\b(add|drop|skip|move|change)\b/i,
      /\b(more|less)\s+(volume|intensity|sets|reps|rest)\b/i,
    ],
  },
};

/**
 * Match a user message against all skill trigger patterns.
 * Returns all matching skills (a message can activate multiple skills).
 */
export function matchSkills(message: string): Skill[] {
  const matched: Skill[] = [];

  for (const skill of Object.values(SKILLS)) {
    for (const pattern of skill.triggerPatterns) {
      if (pattern.test(message)) {
        matched.push(skill);
        break; // One match per skill is enough
      }
    }
  }

  return matched;
}

/**
 * Get the combined prompt fragments from all matched skills.
 */
export function getSkillPromptFragments(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const fragments = skills.map((s) => `<skill name="${s.name}">\n${s.promptFragment}\n</skill>`);

  return `\n<active-skills>\n${fragments.join("\n\n")}\n</active-skills>`;
}

/**
 * Get the combined additional tools from all matched skills.
 */
export function getSkillAdditionalTools(skills: Skill[]): string[] {
  const tools = new Set<string>();
  for (const skill of skills) {
    if (skill.additionalTools) {
      for (const tool of skill.additionalTools) {
        tools.add(tool);
      }
    }
  }
  return [...tools];
}

/**
 * Build the available skills menu for the base system prompt.
 * This lets the agent know what capabilities exist even when they're not triggered.
 */
export function getSkillsMenu(): string {
  const items = Object.values(SKILLS)
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `<available-skills>
These capabilities activate automatically based on context. You don't need
slash commands — just respond naturally to what the user needs.

${items}
</available-skills>`;
}

export { SKILLS };
