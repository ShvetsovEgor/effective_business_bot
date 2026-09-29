import { Bot } from '@maxhub/max-bot-api';
import type { ClientOptions } from '@maxhub/max-bot-api';
import type { Repository } from '../db/repository.js';
import { Navigator } from '../services/navigator.js';
import { AgentNavigator } from '../services/agent-navigator.js';
import { registerHandlers } from './handlers/index.js';

// Transport startup is intentionally outside this factory: polling and webhook share handlers.
export function createBot(token: string, repository: Repository, clientOptions?: ClientOptions, navigator?: Navigator | AgentNavigator) {
  const bot = new Bot(token, { clientOptions });
  registerHandlers(bot, navigator ?? new Navigator(repository));
  return bot;
}
