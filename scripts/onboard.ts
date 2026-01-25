#!/usr/bin/env tsx
/**
 * Onboarding Script
 *
 * Runs the onboarding conversation to set up the user's profile.
 * Can be run locally or triggered via Telegram.
 */

import * as readline from 'readline';
import { createCoachAgent } from '../src/coach/index.js';
import { createGitHubStorage } from '../src/storage/github.js';
import { buildOnboardingPrompt } from '../src/coach/prompts.js';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('');
  console.log('🏋️ Fitness Coach Onboarding');
  console.log('===========================');
  console.log('');
  console.log("Let's set up your profile. This is a conversation - just answer naturally!");
  console.log('Type "quit" at any time to exit.');
  console.log('');

  const agent = createCoachAgent();
  const onboardingPrompt = buildOnboardingPrompt();

  // Start the onboarding conversation
  let response = await agent.runTask(
    `Start the onboarding conversation with a new client.

${onboardingPrompt}

Begin with your introduction and first question.`,
    'Running onboarding via CLI'
  );

  console.log('Coach:', response.message);
  console.log('');

  // Conversation loop
  const conversationHistory: { role: 'user' | 'coach'; content: string }[] = [
    { role: 'coach', content: response.message },
  ];

  while (true) {
    const userInput = await prompt('You: ');

    if (userInput.toLowerCase() === 'quit') {
      console.log('');
      console.log('Onboarding paused. Run again to continue.');
      break;
    }

    conversationHistory.push({ role: 'user', content: userInput });

    // Continue the conversation
    const conversationContext = conversationHistory
      .map(m => `${m.role === 'coach' ? 'Coach' : 'User'}: ${m.content}`)
      .join('\n\n');

    response = await agent.runTask(
      `Continue the onboarding conversation.

Previous conversation:
${conversationContext}

${onboardingPrompt}

The user just said: "${userInput}"

Continue the conversation naturally. If you have enough information to create the profile, do so and wrap up. Otherwise, ask the next appropriate question.`,
      'Continuing onboarding'
    );

    console.log('');
    console.log('Coach:', response.message);
    console.log('');

    conversationHistory.push({ role: 'coach', content: response.message });

    // Check if onboarding is complete (coach wrote the profile and indicates completion)
    const hasWrittenFile = response.toolsUsed.includes('Write') || response.toolsUsed.includes('Edit');
    const lowerMessage = response.message.toLowerCase();
    const indicatesComplete = lowerMessage.includes('all set') ||
      lowerMessage.includes('ready to go') ||
      lowerMessage.includes("you're all set") ||
      lowerMessage.includes('ready');

    if (hasWrittenFile && indicatesComplete) {
      console.log('');
      console.log('✅ Onboarding complete! Your profile has been created.');
      console.log('');
      console.log('Next steps:');
      console.log('1. Start chatting with your coach via Telegram');
      console.log("2. Or run 'pnpm dev' to test locally");
      console.log('');
      break;
    }
  }

  // Save the conversation
  const storage = createGitHubStorage();
  const conversationMd = `# Onboarding Conversation

Started: ${new Date().toISOString()}

---

${conversationHistory.map(m => `**${m.role === 'coach' ? 'Coach' : 'You'}:** ${m.content}`).join('\n\n')}
`;

  try {
    await storage.writeFile(
      'conversations/onboarding.md',
      conversationMd,
      'Save onboarding conversation'
    );
    console.log('Conversation saved to conversations/onboarding.md');
  } catch (error) {
    console.log('Note: Could not save conversation (repository may not be set up yet)');
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
