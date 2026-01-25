/**
 * Prompt Management
 *
 * Loads and templates prompt files for the coach agent.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');

/**
 * Load a prompt file
 */
export function loadPrompt(name: string): string {
  const path = join(PROMPTS_DIR, `${name}.md`);

  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${path}`);
  }

  return readFileSync(path, 'utf-8');
}

/**
 * Load a partial prompt
 */
export function loadPartial(name: string): string {
  const path = join(PROMPTS_DIR, 'partials', `${name}.md`);

  if (!existsSync(path)) {
    throw new Error(`Partial prompt not found: ${path}`);
  }

  return readFileSync(path, 'utf-8');
}

/**
 * Build the full system prompt with context
 */
export function buildSystemPrompt(contextSection: string): string {
  const systemPrompt = loadPrompt('system');

  // Load partials
  const exerciseParsing = loadPartial('exercise-parsing');
  const workoutManagement = loadPartial('workout-management');
  const prDetection = loadPartial('pr-detection');

  // Combine partials into context
  const partialsSection = `
## Reference Guides

<exercise-parsing>
${exerciseParsing}
</exercise-parsing>

<workout-management>
${workoutManagement}
</workout-management>

<pr-detection>
${prDetection}
</pr-detection>
`;

  // Replace the context placeholder
  const fullContext = `${contextSection}\n\n${partialsSection}`;
  return systemPrompt.replace('{{CONTEXT}}', fullContext);
}

/**
 * Build prompt for weekly planning
 */
export function buildWeeklyPlanningPrompt(): string {
  return loadPrompt('weekly-planning');
}

/**
 * Build prompt for retrospective
 */
export function buildRetrospectivePrompt(): string {
  return loadPrompt('retrospective');
}

/**
 * Build prompt for onboarding
 */
export function buildOnboardingPrompt(): string {
  return loadPrompt('onboarding');
}

/**
 * Persona configuration (could be loaded from config/persona.md)
 */
export const DEFAULT_PERSONA = {
  name: 'Coach',
  style: 'direct but warm',
  emojiUsage: 'sparingly and meaningfully',
  messageStyle: 'concise, mobile-first',
};
