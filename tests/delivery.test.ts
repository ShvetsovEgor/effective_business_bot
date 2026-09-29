import { expect, it, vi } from 'vitest';
import { Context } from '@maxhub/max-bot-api';
import type { Message } from '@maxhub/max-bot-api/types';
import { Repository } from '../src/db/repository.js';
import { createBot } from '../src/bot/create-bot.js';
import { createDelivery } from '../src/bot/messages/delivery.js';

it('После перезапуска редактирует прежний экран; при отказе создаёт новый и удаляет старый', async () => {
  const repo = new Repository(':memory:');
  const bot = createBot('test-placeholder', repo);
  const user = { user_id: 1, name: 'Test', first_name: 'Test', username: null, is_bot: false, last_activity_time: 0 };
  const msg: Message = { sender: user, recipient: { chat_id: 1, user_id: 1, chat_type: 'dialog', post_id: null }, timestamp: 1, body: { mid: 'user-answer', seq: 1, text: 'answer' } };
  const ctx = new Context({ update_type: 'message_created', timestamp: 1, message: msg }, bot.api);
  const edit = vi.spyOn(bot.api, 'editMessage').mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, message: 'Message no longer exists' });
  const send = vi.spyOn(bot.api, 'sendMessageToUser').mockResolvedValue({ ...msg, body: { ...msg.body, mid: 'new-screen' } });
  const remove = vi.spyOn(bot.api, 'deleteMessage').mockResolvedValue({ success: true });
  const screen = { text: 'Current', buttons: [{ text: 'Menu', action: 'nonce:menu' }] };
  repo.saveBotScreen('1', { messageId: 'old-screen', pending: [] });
  try {
    await createDelivery(repo)(ctx, 1, screen, false);
    expect(edit).toHaveBeenCalledWith('old-screen', expect.objectContaining({ text: 'Current' }));
    expect(send).not.toHaveBeenCalled();
    await createDelivery(repo)(ctx, 1, screen, false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('old-screen');
    expect(remove).not.toHaveBeenCalledWith('user-answer');
    expect(repo.botScreen('1')).toEqual({ messageId: 'new-screen', pending: [] });
  } finally { repo.close(); }
});
