/**
 * AI Onboarding Conversation
 *
 * Interactive conversation with the coach to set up the user's profile.
 */

import * as readline from 'readline';
import { ui } from './ui.js';
import { createCoachAgent } from '../../src/coach/index.js';
import { buildOnboardingPrompt } from '../../src/coach/prompts.js';

/**
 * Run the onboarding conversation with the AI coach
 */
export async function runOnboardingConversation(): Promise<void> {
  ui.step(3, 5, 'Your Profile');

  const agent = createCoachAgent();
  const onboardingPrompt = buildOnboardingPrompt();

  // Start the onboarding conversation
  let response = await agent.runTask(
    `Start the onboarding conversation with a new client.

${onboardingPrompt}

Begin with a brief, friendly introduction and your first question.
Keep responses concise (2-3 sentences max) since this is a CLI interface.`,
    'Running onboarding via setup wizard'
  );

  ui.coach(response.message);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question(ui.userPrompt(), resolve);
    });

  // Track conversation for context
  const conversationHistory: { role: 'user' | 'coach'; content: string }[] = [
    { role: 'coach', content: response.message },
  ];

  // Conversation loop
  let turnCount = 0;
  const maxTurns = 30; // Safety limit

  while (turnCount < maxTurns) {
    turnCount++;
    const userInput = await ask();

    if (!userInput.trim()) {
      continue; // Skip empty input
    }

    if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
      ui.blank();
      ui.warn('Onboarding cancelled. You can run it again later via Telegram with /onboard');
      rl.close();
      return;
    }

    conversationHistory.push({ role: 'user', content: userInput });

    // Build conversation context
    const conversationContext = conversationHistory
      .map((m) => `${m.role === 'coach' ? 'Coach' : 'User'}: ${m.content}`)
      .join('\n\n');

    // Continue the conversation
    response = await agent.runTask(
      `Continue the onboarding conversation.

Previous conversation:
${conversationContext}

${onboardingPrompt}

The user just said: "${userInput}"

Continue the conversation naturally. Keep responses brief (2-3 sentences).
If you have enough information to create the profile, do so using write_file and let them know you're done.`,
      'Continuing onboarding'
    );

    ui.blank();
    ui.coach(response.message);

    conversationHistory.push({ role: 'coach', content: response.message });

    // Check if onboarding is complete
    const hasWrittenFile = response.toolsUsed.includes('write_file');
    const messageIndicatesComplete =
      response.message.toLowerCase().includes('all set') ||
      response.message.toLowerCase().includes('ready to go') ||
      response.message.toLowerCase().includes('profile is ready') ||
      response.message.toLowerCase().includes("you're all set") ||
      response.message.toLowerCase().includes('good to go');

    if (hasWrittenFile && messageIndicatesComplete) {
      rl.close();
      ui.blank();
      ui.success('Profile saved');

      // Save the conversation log
      try {
        const storage = agent.getStorage();
        const conversationMd = `# Onboarding Conversation

Started: ${new Date().toISOString()}

---

${conversationHistory.map((m) => `**${m.role === 'coach' ? 'Coach' : 'You'}:** ${m.content}`).join('\n\n')}
`;
        await storage.writeFile(
          'conversations/onboarding.md',
          conversationMd,
          'Save onboarding conversation'
        );
      } catch {
        // Ignore - conversation saving is not critical
      }

      return;
    }
  }

  // If we hit max turns
  rl.close();
  ui.warn('Onboarding reached maximum turns. You can continue via Telegram.');
}
