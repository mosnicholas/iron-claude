import { getEnv } from '../config/env.js';
import { TelegramService } from './telegram.service.js';
import { ClaudeService } from './claude.service.js';
import { GitHubService } from './github.service.js';
import { StateService } from './state.service.js';

export interface ServiceContainer {
  telegram: TelegramService;
  claude: ClaudeService;
  github: GitHubService;
  state: StateService;
  chatId: number;
}

let cachedServices: ServiceContainer | null = null;
let stateService: StateService | null = null;

export function createServices(): ServiceContainer {
  const env = getEnv();

  // Reuse state service across requests to maintain conversation state
  if (!stateService) {
    stateService = new StateService();
  }

  // Cache other services for reuse
  if (!cachedServices) {
    cachedServices = {
      telegram: new TelegramService(env.TELEGRAM_BOT_TOKEN),
      claude: new ClaudeService(env.ANTHROPIC_API_KEY),
      github: new GitHubService(
        env.GITHUB_TOKEN,
        env.GITHUB_OWNER,
        env.GITHUB_REPO
      ),
      state: stateService,
      chatId: env.TELEGRAM_CHAT_ID,
    };
  } else {
    // Update state reference in case it was recreated
    cachedServices.state = stateService;
  }

  return cachedServices;
}

export function resetServices(): void {
  cachedServices = null;
  stateService = null;
}

export { TelegramService } from './telegram.service.js';
export { ClaudeService } from './claude.service.js';
export { GitHubService } from './github.service.js';
export { StateService } from './state.service.js';
