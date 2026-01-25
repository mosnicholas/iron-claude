/**
 * AI Onboarding Conversation
 *
 * Interactive conversation with the coach to set up the user's profile.
 * Uses Claude Agent SDK for local file system access.
 */

import * as readline from 'readline';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ui } from './ui.js';
import { loadPrompt } from '../../src/coach/prompts.js';
import { syncRepo, pushChanges } from '../../src/storage/repo-sync.js';
import { extractTextFromMessage, extractToolsFromMessage } from '../../src/utils/sdk-helpers.js';

async function runQuery(
  prompt: string,
  systemPrompt: string,
  cwd: string
): Promise<{ text: string; toolsUsed: string[] }> {
  const toolsUsed: string[] = [];
  let responseText = '';

  const q = query({
    prompt,
    options: {
      systemPrompt,
      cwd,
      maxTurns: 10,
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'acceptEdits',
    },
  });

  for await (const message of q) {
    if (message.type === 'assistant') {
      responseText = extractTextFromMessage(message);
      toolsUsed.push(...extractToolsFromMessage(message));
    }
  }

  return { text: responseText, toolsUsed };
}

export async function runOnboardingConversation(): Promise<void> {
  ui.step(3, 5, 'Your Profile');

  const repoName = process.env.DATA_REPO!;
  const token = process.env.GITHUB_TOKEN!;

  const syncSpinner = ui.spinner('Syncing data repository...');
  const repoPath = await syncRepo({
    repoUrl: `https://github.com/${repoName}.git`,
    token,
  });
  syncSpinner.success({ text: 'Repository synced' });

  const onboardingPrompt = loadPrompt('onboarding');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question(ui.userPrompt(), resolve));

  const systemPrompt = `You are a friendly fitness coach conducting an onboarding conversation.
Your goal is to learn about the user and create their profile.

${onboardingPrompt}

You have direct file access to the fitness-data repository.
- Read profile.md to see current state
- Write to profile.md when you have enough information

Keep responses concise (2-3 sentences max) since this is a CLI interface.
When done, write the profile and let them know you're all set.`;

  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const initialResponse = await runQuery(
    'Start the onboarding conversation. Greet the user warmly and ask their name.',
    systemPrompt,
    repoPath
  );

  ui.coach(initialResponse.text);
  conversationHistory.push({ role: 'assistant', content: initialResponse.text });

  let isComplete = false;
  let turnCount = 0;

  while (!isComplete && turnCount < 30) {
    turnCount++;
    const userInput = await ask();

    if (!userInput.trim()) continue;
    if (['quit', 'exit'].includes(userInput.toLowerCase())) {
      ui.blank();
      ui.warn('Onboarding cancelled.');
      rl.close();
      return;
    }

    conversationHistory.push({ role: 'user', content: userInput });

    const contextPrompt = conversationHistory
      .map((m) => `${m.role === 'assistant' ? 'Coach' : 'User'}: ${m.content}`)
      .join('\n\n');

    const response = await runQuery(
      `Continue the onboarding. Previous:\n${contextPrompt}\n\nUser said: "${userInput}"`,
      systemPrompt,
      repoPath
    );

    ui.blank();
    ui.coach(response.text);
    conversationHistory.push({ role: 'assistant', content: response.text });

    const hasWrittenFile = response.toolsUsed.includes('Write') || response.toolsUsed.includes('Edit');
    const lowerMessage = response.text.toLowerCase();
    isComplete = hasWrittenFile && (
      lowerMessage.includes('all set') ||
      lowerMessage.includes('ready to go') ||
      lowerMessage.includes("you're all set")
    );
  }

  rl.close();

  const pushSpinner = ui.spinner('Saving profile...');
  await pushChanges('Complete onboarding profile');
  pushSpinner.success({ text: 'Profile saved to GitHub' });
}
