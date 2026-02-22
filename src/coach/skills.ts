/**
 * Dynamic Skills Loader
 *
 * Loads skills from skills/{name}/SKILL.md files on disk, following the
 * Claude Code convention: YAML frontmatter (name, description) + markdown body.
 *
 * Skills are discovered at startup and their descriptions are injected into the
 * system prompt. The agent decides when a skill is relevant and calls the
 * `load_skill` MCP tool to get the full instructions.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "../../skills");

interface SkillFile {
  name: string;
  description: string;
  content: string; // Full markdown body (prompt fragment)
}

/**
 * Parse a SKILL.md file with optional YAML frontmatter.
 */
function parseSkillFile(skillDir: string): SkillFile | null {
  const skillPath = join(SKILLS_DIR, skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;

  const raw = readFileSync(skillPath, "utf-8");

  // Parse YAML frontmatter
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    // No frontmatter — use directory name and first line as description
    return {
      name: skillDir,
      description: raw.split("\n")[0].replace(/^#\s*/, ""),
      content: raw,
    };
  }

  const frontmatter = match[1];
  const body = match[2].trim();

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch ? nameMatch[1].trim() : skillDir,
    description: descMatch ? descMatch[1].trim() : "",
    content: body,
  };
}

// Cache loaded skills — only scan disk once per process
let cachedSkills: SkillFile[] | null = null;

function loadAllSkills(): SkillFile[] {
  if (cachedSkills) return cachedSkills;

  if (!existsSync(SKILLS_DIR)) {
    cachedSkills = [];
    return cachedSkills;
  }

  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  cachedSkills = dirs.map((dir) => parseSkillFile(dir)).filter((s): s is SkillFile => s !== null);

  return cachedSkills;
}

/**
 * Build the available skills menu for the system prompt.
 * Lists skill names and descriptions so the agent knows what's available.
 */
export function getSkillsMenu(): string {
  const skills = loadAllSkills();
  if (skills.length === 0) return "";

  const items = skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");

  return `<available-skills>
These capabilities are available via the load_skill tool.
When the user's request matches a skill, load it for detailed instructions.

${items}
</available-skills>`;
}

/**
 * Load a skill's full content by name. Returns null if not found.
 */
export function loadSkillContent(name: string): string | null {
  const skills = loadAllSkills();
  const skill = skills.find((s) => s.name === name);
  return skill ? skill.content : null;
}

/**
 * Get all skill names (for error messages / validation).
 */
export function getSkillNames(): string[] {
  return loadAllSkills().map((s) => s.name);
}
