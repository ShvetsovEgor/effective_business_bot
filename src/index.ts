import { config } from 'dotenv';
import { Repository } from './db/repository.js';
import { createBot } from './bot/create-bot.js';
import { acquireInstanceLock } from './services/instance-lock.js';
import { AgentNavigator } from './services/agent-navigator.js';

config({ quiet: true });
const token = process.env.MAX_BOT_TOKEN?.trim();
if (!token) {
  console.error('Укажите MAX_BOT_TOKEN в локальном .env или переменной окружения.');
  process.exitCode = 1;
} else {
  const repo = new Repository(process.env.DATABASE_PATH ?? './data/bot.sqlite');
  const navigator = new AgentNavigator(repo, process.env.CHECKPOINT_PATH ?? './data/checkpoints.sqlite');
  const bot = createBot(token, repo, undefined, navigator);
  let stopping = false;
  let release: (() => Promise<void>) | undefined;
  const stop = () => { stopping = true; bot.stopPolling(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    release = await acquireInstanceLock(token);
    // SDK start() removes webhook subscriptions; prevent silently disabling an existing deployment.
    const subscriptions = await bot.api.getSubscriptions();
    if (subscriptions.length) throw new Error('WEBHOOK_ACTIVE');
    await bot.api.setMyCommands([
      { name: 'start', description: 'Начать' },
      { name: 'menu', description: 'Главное меню' },
      { name: 'reset', description: 'Удалить мои данные с подтверждением' },
    ]);
    console.log('Навигатор ООО запущен: Long Polling.');
    await bot.start();
  } catch (error) {
    if (!stopping) {
      console.error(error instanceof Error && error.message === 'BOT_ALREADY_RUNNING'
        ? 'Бот уже запущен в другом процессе (или занят локальный адрес блокировки). Второй экземпляр остановлен.'
        : error instanceof Error && error.message === 'WEBHOOK_ACTIVE'
        ? 'У бота есть webhook-подписка. Отключите её перед запуском Long Polling.'
        : 'Запуск не удался. Проверьте MAX_BOT_TOKEN, сеть и доступ к базе. Секреты не выводятся.');
      process.exitCode = 1;
    }
  } finally {
    bot.stopPolling();
    navigator.close();
    repo.close();
    await release?.();
  }
}
