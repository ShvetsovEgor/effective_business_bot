import { expect, it, vi } from 'vitest';
import { Context } from '@maxhub/max-bot-api';
import type { Message, Update } from '@maxhub/max-bot-api/types';
import { Repository } from '../src/db/repository.js';
import { createBot } from '../src/bot/create-bot.js';

const sender = { user_id: 42, first_name: 'Test', name: 'Test', username: null, is_bot: false, last_activity_time: 0 };
const message: Message = { sender, recipient: { chat_id: 42, user_id: 42, chat_type: 'dialog', post_id: null }, timestamp: 1, body: { mid: 'm1', seq: 1, text: '/start' } };
it('Официальный SDK: /start, inline callback, ack, сохранение; группы игнорируются', async () => {
  const repo = new Repository(':memory:');
  const bot = createBot('test-placeholder', repo);
  const send = vi.spyOn(bot.api, 'sendMessageToUser').mockResolvedValue(message);
  const ack = vi.spyOn(bot.api, 'answerOnCallback').mockResolvedValue({ success: true });
  const dispatch = (update: Update) => bot.middleware()(new Context(update, bot.api), async () => undefined);
  try {
    await dispatch({ update_type: 'message_created', timestamp: 1, message });
    expect(send).toHaveBeenCalledTimes(1);
    const attachment = send.mock.calls[0]![2]!.attachments![0];
    if (attachment?.type !== 'inline_keyboard') throw new Error('Missing MAX keyboard');
    const button = attachment.payload.buttons[0]![0]!;
    if (button.type !== 'callback') throw new Error('Missing callback');
    await dispatch({ update_type: 'message_callback', timestamp: 2, callback: { timestamp: 2, callback_id: 'c1', user: sender, payload: button.payload }, message });
    expect(ack).toHaveBeenCalledWith('c1', {});
    expect(send.mock.calls[1]![1]).toContain('Шаг 1 из 10');
    expect(repo.tasks('42')).toHaveLength(10);
    await dispatch({ update_type: 'message_created', timestamp: 3, message: { ...message, body: { ...message.body, mid: 'group' }, recipient: { ...message.recipient, chat_type: 'chat' } } });
    expect(send).toHaveBeenCalledTimes(2);
  } finally { repo.close(); }
});
