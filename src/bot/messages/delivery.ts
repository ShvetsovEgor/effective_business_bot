import type { Context } from '@maxhub/max-bot-api';
import { setTimeout as delay } from 'node:timers/promises';
import type { Repository } from '../../db/repository.js';
import type { Screen } from './types.js';
import { keyboard } from '../keyboards/index.js';

export function createDelivery(repo: Repository) {
  const lastMutation = new Map<string, number>();
  const throttle = async (user: string) => {
    await delay(Math.max(0, 550 - (Date.now() - (lastMutation.get(user) ?? 0))));
    lastMutation.set(user, Date.now());
  };
  return async (ctx: Context, userId: number, screen: Screen, cleanHistory: boolean, belowUser = false) => {
    const user = String(userId);
    const state = repo.botScreen(user);
    const callbackMessage = ctx.callback && ctx.message?.sender?.is_bot ? ctx.message.body.mid : undefined;
    const previous = state.messageId ?? callbackMessage;
    const inputId = !ctx.callback ? ctx.message?.body.mid : undefined;
    const moveBelow = belowUser && inputId !== undefined && inputId !== state.inputMessageId;
    const extra = { text: screen.text, attachments: [keyboard(screen)], notify: false };
    let edited = false;
    if (previous && !moveBelow) {
      await throttle(user);
      try { edited = (await ctx.api.editMessage(previous, extra)).success; }
      catch { /* Deleted or inaccessible screen: send a replacement before cleanup. */ }
    }
    if (edited) state.messageId = previous;
    else {
      const sent = await ctx.api.sendMessageToUser(userId, screen.text, { attachments: extra.attachments });
      state.messageId = sent.body.mid;
      if (previous) state.pending.push(previous);
    }
    if (callbackMessage && callbackMessage !== state.messageId) state.pending.push(callbackMessage);
    if (belowUser && inputId) state.inputMessageId = inputId;
    // Only the bot's own messages in this private dialog; never delete user answers.
    if (cleanHistory && ctx.chatId && ctx.botInfo) {
      try {
        const history = await ctx.api.getMessages(ctx.chatId, { count: 100 });
        state.pending.push(...history.messages.filter(m => m.sender?.user_id === ctx.botInfo!.user_id).map(m => m.body.mid));
      } catch { /* History may be unavailable; the active screen still works. */ }
    }
    state.pending = [...new Set(state.pending)].filter(id => id !== state.messageId);
    repo.saveBotScreen(user, state);
    // Bounded cleanup keeps navigation responsive while respecting MAX's 2/sec limit.
    for (const id of state.pending.slice(0, 3)) {
      await throttle(user);
      try {
        if ((await ctx.api.deleteMessage(id)).success) state.pending = state.pending.filter(p => p !== id);
      } catch { /* Keep it queued for the next interaction. */ }
    }
    repo.saveBotScreen(user, state);
  };
}
