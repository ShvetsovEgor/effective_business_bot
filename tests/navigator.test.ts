import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from '../src/db/repository.js';
import { Navigator } from '../src/services/navigator.js';
import type { Screen } from '../src/bot/messages/types.js';
import { afterRegistrationRules } from '../src/data/llc-after-registration.js';
import type { BusinessProfile } from '../src/domain/checklist/types.js';

let dir: string;
let repo: Repository;
let nav: Navigator;
const profile: BusinessProfile = { name: 'Пример', registration_date: '2026-01-31', region: '77', tax_regime: 'usn-income', employees: 0, director: false, personal_data: false, cash_register: false, personnel_event: false };
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'max-navigator-')); repo = new Repository(join(dir, 'test.sqlite')); nav = new Navigator(repo); });
afterEach(() => { repo.close(); rmSync(dir, { recursive: true, force: true }); });
function payload(screen: Screen, suffix: string) {
  const b = screen.buttons.find(b => 'action' in b && b.action.endsWith(`:${suffix}`));
  if (!b || !('action' in b)) throw new Error(`Button not found: ${suffix}`);
  return b.action;
}
const press = (screen: Screen, suffix: string, user = '1') => nav.handle(user, { type: 'callback', payload: payload(screen, suffix) });
const start = (user = '1') => nav.handle(user, { type: 'command', command: 'start' });

it('Состояние checklist и анкеты сохраняется после перезапуска', () => {
  let screen = press(start(), 'registration');
  screen = press(screen, 'status:reg-1:DONE');
  expect(screen.text).toContain('Шаг 2 из 10');
  const secondPayload = payload(screen, 'status:reg-2:DONE');
  repo.close(); repo = new Repository(join(dir, 'test.sqlite')); nav = new Navigator(repo);
  screen = nav.handle('1', { type: 'callback', payload: secondPayload });
  expect(screen.text).toContain('Шаг 3 из 10');
  expect(repo.tasks('1').filter(t => t.status === 'DONE')).toHaveLength(2);
  screen = press(start(), 'profile');
  nav.handle('1', { type: 'text', text: 'Тест' });
  repo.close(); repo = new Repository(join(dir, 'test.sqlite')); nav = new Navigator(repo);
  screen = nav.handle('1', { type: 'text', text: '01.09.2026' });
  expect(screen.text).toContain('Регион');
});
it('Повторный callback не завершает следующую задачу; чужая кнопка не меняет данные', () => {
  const screen = press(start(), 'registration');
  const done = payload(screen, 'status:reg-1:DONE');
  nav.handle('1', { type: 'callback', payload: done });
  nav.handle('1', { type: 'callback', payload: done });
  nav.handle('2', { type: 'callback', payload: done });
  expect(repo.tasks('1').filter(t => t.status === 'DONE')).toHaveLength(1);
  expect(repo.tasks('2')).toEqual([]);
});
it('Старая кнопка не инвалидирует текущую; повтор события возвращает актуальный экран', () => {
  const first = press(start(), 'registration');
  const event = { type: 'callback', payload: payload(first, 'status:reg-1:DONE') } as const;
  const second = nav.handle('1', event, 'done-first');
  expect(nav.handle('1', event)).toEqual(second);
  const third = press(second, 'status:reg-2:DONE');
  expect(nav.handle('1', event, 'done-first')).toEqual(third);
  expect(press(third, 'status:reg-3:DONE').text).toContain('Шаг 4 из 10');
});
it('Повторная доставка текстового сообщения не сдвигает анкету', () => {
  press(start(), 'profile');
  const event = { type: 'text', text: 'Тест' } as const;
  const screen = nav.handle('1', event, 'unique-message');
  expect(nav.handle('1', event, 'unique-message')).toEqual(screen);
  expect(repo.session('1').step).toBe(1);
});
it('Сброс требует подтверждения и удаляет только свои данные', () => {
  press(start(), 'registration'); press(start('2'), 'registration', '2');
  let reset = nav.handle('1', { type: 'command', command: 'reset' });
  expect(repo.tasks('1')).toHaveLength(10);
  press(reset, 'menu');
  expect(repo.tasks('1')).toHaveLength(10);
  reset = nav.handle('1', { type: 'command', command: 'reset' });
  press(reset, 'reset-confirm');
  expect(repo.tasks('1')).toHaveLength(0);
  expect(repo.tasks('2')).toHaveLength(10);
});
it('Полный путь регистрации завершается переходом к профилю', () => {
  let s = press(start(), 'registration');
  for (let n = 1; n <= 10; n++) s = press(s, `status:reg-${n}:DONE`);
  expect(s.text).toContain('Все шаги');
  expect(repo.tasks('1').filter(t => t.status === 'DONE')).toHaveLength(10);
});
it('Анкета создаёт условные задачи; ЕФС-1 только после подтверждения события', () => {
  expect(afterRegistrationRules({ ...profile, employees: 2 }).map(r => r.id)).not.toContain('efs');
  expect(afterRegistrationRules({ ...profile, employees: 2, personnel_event: true, personal_data: true, cash_register: true }).map(r => r.id)).toEqual(expect.arrayContaining(['efs', 'privacy', 'kkt', 'military', 'hr']));
  press(start(), 'profile');
  const answers = ['Тест', '31.01.2026', '77', 'usn-income', '1', 'yes', 'yes', 'yes', 'no'];
  let screen: Screen = { text: '', buttons: [] };
  for (const answer of answers) screen = nav.handle('1', { type: 'text', text: answer });
  expect(screen.text).toContain('ООО «Тест»');
  expect(repo.tasks('1').find(t => t.id === 'capital')!.deadline).toBe('2026-05-31');
  expect(repo.tasks('1').some(t => t.id === 'efs')).toBe(false);
  expect(repo.tasks('1').some(t => t.id === 'military')).toBe(true);
});
it('Обновление профиля не теряет выполненные задачи и скрывает неприменимые условия', () => {
  repo.ensureUser('1');
  repo.syncTasks('1', afterRegistrationRules({ ...profile, personal_data: true }), profile.registration_date, true);
  repo.setStatus('1', 'docs', 'DONE');
  repo.syncTasks('1', afterRegistrationRules(profile), profile.registration_date, true);
  expect(repo.tasks('1').find(t => t.id === 'docs')!.status).toBe('DONE');
  expect(repo.tasks('1').some(t => t.id === 'privacy')).toBe(false);
});
it('Налоговый сценарий, формулы, переход и добавление задачи', () => {
  let screen = press(press(start(), 'tax-intro'), 'tax-begin');
  for (const text of ['77', '1000000', '500000', '200000', '1', '0', '100000', 'yes', 'yes', 'yes']) screen = nav.handle('1', { type: 'text', text });
  expect(screen.text).toContain('УСН');
  expect(repo.calculation('1')!.result).toHaveLength(5);
  screen = press(screen, 'formulas');
  screen = press(screen, 'formula:usn-income');
  expect(screen.text).toContain('50%');
  expect(screen.buttons.some(b => 'url' in b && b.url.startsWith('https://www.nalog.gov.ru/'))).toBe(true);
  screen = press(screen, 'transition:usn-income');
  screen = press(screen, 'transition-new');
  screen = nav.handle('1', { type: 'text', text: '01.09.2026' });
  expect(screen.text).toContain('01.10.2026');
  press(screen, 'transition-add');
  expect(repo.tasks('1').find(t => t.id === 'transition-usn-income')!.deadline).toBeNull();
});
it('Ошибки ввода не продвигают анкету; назад позволяет исправить ответ', () => {
  press(start(), 'profile'); nav.handle('1', { type: 'text', text: 'Тест' });
  let screen = nav.handle('1', { type: 'text', text: '31.02.2026' });
  expect(repo.session('1').step).toBe(1);
  screen = press(screen, 'form-back');
  expect(screen.text).toContain('Как называется');
});
