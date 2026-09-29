import { Keyboard } from '@maxhub/max-bot-api';
import type { Screen } from '../messages/types.js';
export function keyboard(screen: Screen) {
  return Keyboard.inlineKeyboard(screen.buttons.map(button => [
    'url' in button ? Keyboard.button.link(button.text, button.url) : Keyboard.button.callback(button.text, button.action),
  ]));
}
