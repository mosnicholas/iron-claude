import Anthropic from '@anthropic-ai/sdk';
import type {
  ClaudeMessage,
  ClaudeChatOptions,
  UserProfile,
  WorkoutLog,
  WeekPlan,
  DayPlan,
} from '../types/index.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1024;

export class ClaudeService {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(
    systemPrompt: string,
    messages: ClaudeMessage[],
    options: ClaudeChatOptions = {}
  ): Promise<string> {
    const { maxTokens = DEFAULT_MAX_TOKENS, model = DEFAULT_MODEL } = options;

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return textBlock.text;
  }

  async generateWorkoutPlan(
    profile: UserProfile,
    recentLogs: WorkoutLog[],
    currentPlan: WeekPlan | null,
    exerciseVariations: string
  ): Promise<string> {
    const systemPrompt = this.buildPlanningSystemPrompt();
    const userMessage = this.buildPlanningUserMessage(
      profile,
      recentLogs,
      currentPlan,
      exerciseVariations
    );

    return this.chat(systemPrompt, [{ role: 'user', content: userMessage }], {
      maxTokens: 4096,
    });
  }

  async analyzeWorkout(
    log: WorkoutLog,
    plan: DayPlan,
    profile: UserProfile
  ): Promise<string> {
    const systemPrompt = this.buildAnalysisSystemPrompt();
    const userMessage = this.buildAnalysisUserMessage(log, plan, profile);

    return this.chat(systemPrompt, [{ role: 'user', content: userMessage }], {
      maxTokens: 512,
    });
  }

  private buildPlanningSystemPrompt(): string {
    return `You are an expert strength and calisthenics coach creating a weekly training plan.

Your role:
- Make all programming decisions. Be prescriptive and confident.
- Base recommendations on the data provided.
- Focus on progressive overload for strength and skill development.

Output format:
- Generate a complete week plan in markdown format
- Include specific weights, sets, and rep ranges
- Note any deload recommendations`;
  }

  private buildPlanningUserMessage(
    profile: UserProfile,
    recentLogs: WorkoutLog[],
    currentPlan: WeekPlan | null,
    exerciseVariations: string
  ): string {
    return `
## User Profile
Name: ${profile.name}
Experience: ${profile.experience}
Goals: ${profile.goals.primary.join(', ')}
Session length: ${profile.preferences.sessionLength}
Training days: ${profile.preferences.trainingDays}
Current program week: ${profile.currentStatus.programWeek}

## Recent Workout Logs
${recentLogs.length > 0 ? JSON.stringify(recentLogs, null, 2) : 'No recent logs available'}

## Current Week Plan
${currentPlan ? JSON.stringify(currentPlan, null, 2) : 'No current plan'}

## Exercise Variations Reference
${exerciseVariations}

Generate next week's training plan with specific exercises, weights, sets, and rep ranges.
`;
  }

  private buildAnalysisSystemPrompt(): string {
    return `You are a workout coach providing brief post-workout feedback.

Rules:
- Keep response to 3-4 lines max
- Be direct and prescriptive
- Note any PRs briefly
- Give one specific recommendation for next session
- No emojis unless it's a PR`;
  }

  private buildAnalysisUserMessage(
    log: WorkoutLog,
    plan: DayPlan,
    profile: UserProfile
  ): string {
    return `
## Completed Workout
${JSON.stringify(log, null, 2)}

## Planned Workout
${JSON.stringify(plan, null, 2)}

## User Context
Name: ${profile.name}
Goals: ${profile.goals.primary.join(', ')}

Provide brief post-workout feedback.
`;
  }
}
