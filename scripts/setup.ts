#!/usr/bin/env tsx
/**
 * Setup Script
 *
 * Interactive setup that creates the fitness-data repository
 * and initializes the required structure.
 */

import * as readline from 'readline';

const GITHUB_API_BASE = 'https://api.github.com';

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    const q = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(q, answer => {
      rl.close();
      resolve(answer || defaultValue || '');
    });
  });
}

async function confirmPrompt(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/n)`, 'y');
  return answer.toLowerCase() === 'y';
}

async function createRepository(
  token: string,
  repoName: string,
  isPrivate: boolean
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
      description: 'Personal fitness data - managed by Fitness Coach',
      private: isPrivate,
      auto_init: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create repository: ${error}`);
  }

  const data = await response.json() as { full_name: string };
  return data.full_name;
}

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

This repository contains your personal fitness data, managed by [Fitness Coach](https://github.com/yourusername/fitness-coach).

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

async function main() {
  console.log('');
  console.log('🏋️ Fitness Coach Setup');
  console.log('======================');
  console.log('');
  console.log('This will create a private GitHub repository for your fitness data.');
  console.log('');

  // Get GitHub token
  console.log('First, you need a GitHub Personal Access Token.');
  console.log('Create one at: https://github.com/settings/tokens/new');
  console.log('Required scopes: repo (full control)');
  console.log('');

  const token = await prompt('GitHub Personal Access Token');
  if (!token) {
    console.error('Token is required');
    process.exit(1);
  }

  // Verify token
  console.log('Verifying token...');
  const userResponse = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!userResponse.ok) {
    console.error('Invalid token or insufficient permissions');
    process.exit(1);
  }

  const userData = await userResponse.json() as { login: string };
  console.log(`✓ Authenticated as ${userData.login}`);
  console.log('');

  // Get repo name
  const repoName = await prompt('Repository name', 'fitness-data');

  // Confirm private
  const isPrivate = await confirmPrompt('Make repository private?');

  console.log('');
  console.log('Creating repository...');

  try {
    const fullName = await createRepository(token, repoName, isPrivate);
    console.log(`✓ Created ${fullName}`);

    // Wait a moment for GitHub to process
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Initializing repository structure...');

    // Create initial files
    await createFile(token, fullName, 'profile.md', INITIAL_PROFILE, 'Initialize profile');
    console.log('  ✓ profile.md');

    await createFile(token, fullName, 'learnings.md', INITIAL_LEARNINGS, 'Initialize learnings');
    console.log('  ✓ learnings.md');

    await createFile(token, fullName, 'prs.yaml', INITIAL_PRS, 'Initialize PRs');
    console.log('  ✓ prs.yaml');

    // Create directories with .gitkeep
    await createFile(token, fullName, 'workouts/.gitkeep', '', 'Create workouts directory');
    console.log('  ✓ workouts/');

    await createFile(token, fullName, 'plans/.gitkeep', '', 'Create plans directory');
    console.log('  ✓ plans/');

    await createFile(token, fullName, 'retrospectives/.gitkeep', '', 'Create retrospectives directory');
    console.log('  ✓ retrospectives/');

    await createFile(token, fullName, 'conversations/.gitkeep', '', 'Create conversations directory');
    console.log('  ✓ conversations/');

    // Update README
    await createFile(token, fullName, 'README.md', README, 'Update README');
    console.log('  ✓ README.md');

    console.log('');
    console.log('✅ Setup complete!');
    console.log('');
    console.log('Next steps:');
    console.log('');
    console.log('1. Add these to your .env.local:');
    console.log(`   GITHUB_TOKEN=${token}`);
    console.log(`   DATA_REPO=${fullName}`);
    console.log('');
    console.log('2. Run onboarding to set up your profile:');
    console.log('   pnpm onboard');
    console.log('');
    console.log('3. Deploy to Vercel and set up webhook:');
    console.log('   vercel --prod');
    console.log('   pnpm set-webhook <your-vercel-url>/api/webhook');
    console.log('');
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
