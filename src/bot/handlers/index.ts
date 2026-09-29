import type { Bot, Context } from '@maxhub/max-bot-api';
import type { Repository } from '../../db/repository.js';
import type { Event, Screen } from '../messages/types.js';
import { createDelivery } from '../messages/delivery.js';

export function registerHandlers(bot: Bot, navigator: { repo: Repository; handle(user:string,event:Event,eventId?:string,chat?:string):Screen|Promise<Screen> }) {
  const queues = new Map<string, Promise<void>>();
  const deliver = createDelivery(navigator.repo);
  const dispatch = async (ctx: Context, event: Event, eventId?: string) => {
    const sender = ctx.callback?.user ?? ctx.message?.sender ?? ctx.user;
    if (!sender || sender.is_bot) return;
    // Never expose a personal profile or financial input in group conversations.
    if (ctx.message && ctx.message.recipient.chat_type !== 'dialog') return;
    const user = String(sender.user_id);
    const previous = queues.get(user) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (ctx.callback) await ctx.answerOnCallback({}).catch(() => undefined);
      const chat = String(ctx.message?.recipient.chat_id ?? ctx.chatId ?? sender.user_id);
      const screen = await navigator.handle(user, event, eventId, chat);
      await deliver(ctx, sender.user_id, screen, event.type === 'command' && ['start', 'menu'].includes(event.command));
    });
    queues.set(user, current);
    try { await current; }
    finally { if (queues.get(user) === current) queues.delete(user); }
  };
  for (const command of ['start', 'menu', 'reset']) {
    bot.command(command, ctx => dispatch(ctx, { type: 'command', command }, ctx.messageId ? `message:${ctx.messageId}` : undefined));
  }
  bot.on('bot_started', ctx => dispatch(ctx, { type: 'command', command: 'start' }, `start:${ctx.update.timestamp}`));
  bot.on('message_callback', ctx => dispatch(ctx, { type: 'callback', payload: ctx.callback.payload ?? '' }, `callback:${ctx.callback.callback_id}`));
  bot.on('message_created', ctx => {
    const text = ctx.message.body.text?.trim() ?? '';
    if (text.startsWith('/')) return dispatch(ctx, { type: 'command', command: text.slice(1).split(/[\s@]/)[0] ?? '' }, `message:${ctx.message.body.mid}`);
    return dispatch(ctx, { type: 'text', text }, `message:${ctx.message.body.mid}`);
  });
  bot.catch(async (_error, ctx) => {
    console.error('Не удалось обработать обновление MAX. Данные и токен не выводятся.');
    const sender = ctx.callback?.user ?? ctx.message?.sender ?? ctx.user;
    if (sender && !sender.is_bot) await ctx.api.sendMessageToUser(sender.user_id, 'Не удалось отправить ответ. Попробуйте /menu; сохранённый прогресс останется.').catch(() => undefined);
  });
}
