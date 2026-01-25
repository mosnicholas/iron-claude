/**
 * GitHub Repository Creation
 *
 * Creates and initializes the fitness-data repository.
 */

const GITHUB_API_BASE = 'https://api.github.com';

interface GitHubUser {
  login: string;
}

interface GitHubRepo {
  full_name: string;
}

/**
 * Verify GitHub token and get username
 */
export async function verifyGitHubToken(token: string): Promise<string> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('Invalid GitHub token or insufficient permissions');
  }

  const data = (await response.json()) as GitHubUser;
  return data.login;
}

/**
 * Create a new private repository
 */
async function createRepository(
  token: string,
  repoName: string
): Promise<string> {
  const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: repoName,
      description: 'Personal fitness data - managed by IronClaude',
      private: true,
      auto_init: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    if (error.includes('name already exists')) {
      throw new Error(`Repository "${repoName}" already exists`);
    }
    throw new Error(`Failed to create repository: ${error}`);
  }

  const data = (await response.json()) as GitHubRepo;
  return data.full_name;
}

/**
 * Create a file in the repository
 */
async function createFile(
  token: string,
  repo: string,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create ${path}: ${error}`);
  }
}

// --- Initial file contents ---

const INITIAL_PROFILE = `---
name: ""
timezone: "America/New_York"
telegram_chat_id: ""
primary_gym: ""
backup_gyms: []
created: "${new Date().toISOString().split('T')[0]}"
last_updated: "${new Date().toISOString().split('T')[0]}"
---

# Profile

*Run the onboarding conversation to fill this out.*

## Goals

### Primary
-

### Secondary
-

## Schedule

### Weekly Structure
- Target: sessions per week
- Preferred time:
- Preferred rest day:

### Constraints
-

## Medical & Limitations

### Current
*None*

### Historical
*None*

## Training Preferences

### Style
-

### Dislikes
-

### Session Length
- Ideal: 45 minutes
- Maximum: 60 minutes
- Minimum: 30 minutes

## Current Working Maxes

*Will be populated from workouts*

| Exercise | Weight | Reps | Date | Est 1RM |
|----------|--------|------|------|---------|
| | | | | |
`;

const INITIAL_LEARNINGS = `# Learnings

*Patterns and preferences discovered through conversation and observation.*

---

## Initial Setup

- Created: ${new Date().toISOString().split('T')[0]}

---

*Last updated: ${new Date().toISOString().split('T')[0]}*
`;

const INITIAL_PRS = `# Personal Records
# Auto-updated when new PRs are detected in workouts

# Example format:
# bench_press:
#   current:
#     weight: 185
#     reps: 3
#     date: "2025-01-15"
#     estimated_1rm: 196
#   history:
#     - weight: 185
#       reps: 3
#       date: "2025-01-15"
#       estimated_1rm: 196
`;

const README = `# Fitness Data

This repository contains your personal fitness data, managed by [IronClaude](https://github.com/yourusername/iron-claude).

## Structure

- \`profile.md\` - Your goals, preferences, and limitations
- \`learnings.md\` - Patterns discovered by your coach
- \`prs.yaml\` - Personal records with history
- \`workouts/\` - Individual workout logs
- \`plans/\` - Weekly training plans
- \`retrospectives/\` - Weekly analysis

## Privacy

This is a **private** repository. Your fitness data stays yours.

## Usage

Don't edit these files directly - interact with your coach via Telegram!
`;

/**
 * Create the fitness-data repository with initial structure
 */
export async function createGitHubRepo(
  token: string,
  repoName: string = 'fitness-data'
): Promise<string> {
  // Verify token first
  await verifyGitHubToken(token);

  // Create repository
  const fullName = await createRepository(token, repoName);

  // Brief wait for GitHub to process repo creation
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Create initial files
  await createFile(token, fullName, 'profile.md', INITIAL_PROFILE, 'Initialize profile');
  await createFile(token, fullName, 'learnings.md', INITIAL_LEARNINGS, 'Initialize learnings');
  await createFile(token, fullName, 'prs.yaml', INITIAL_PRS, 'Initialize PRs');

  // Create directories with .gitkeep
  await createFile(token, fullName, 'workouts/.gitkeep', '', 'Create workouts directory');
  await createFile(token, fullName, 'plans/.gitkeep', '', 'Create plans directory');
  await createFile(token, fullName, 'retrospectives/.gitkeep', '', 'Create retrospectives directory');
  await createFile(token, fullName, 'conversations/.gitkeep', '', 'Create conversations directory');

  // Update README
  await createFile(token, fullName, 'README.md', README, 'Update README');

  return fullName;
}
