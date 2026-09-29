import { expect, it } from 'vitest';
import { deadline, parseDate } from '../src/domain/deadlines/index.js';
import { transition } from '../src/domain/tax/transitions.js';
it('Уставный капитал — регистрация +4 календарных месяца', () => {
  expect(deadline({ type: 'REGISTRATION_MONTHS', months: 4 }, '2026-09-29')).toBe('2027-01-29');
  expect(deadline({ type: 'REGISTRATION_MONTHS', months: 4 }, '2026-10-31')).toBe('2027-02-28');
  expect(deadline({ type: 'REGISTRATION_MONTHS', months: 4 }, '2023-10-31')).toBe('2024-02-29');
});
it('Абсолютные даты и календарные дни без часовых сдвигов', () => {
  expect(deadline({ type: 'ABSOLUTE', date: '2026-12-31' })).toBe('2026-12-31');
  expect(deadline({ type: 'REGISTRATION_DAYS', days: 30 }, '2026-12-15')).toBe('2027-01-14');
  expect(deadline({ type: 'UNKNOWN' }, '2026-01-01')).toBeNull();
  expect(deadline({ type: 'REGISTRATION_DAYS', days: 30 })).toBeNull();
});
it('Не принимает несуществующие даты', () => {
  expect(parseDate('31.02.2026')).toBeNull();
  expect(parseDate('29.02.2024')).toBe('2024-02-29');
  expect(parseDate('2026-02-29')).toBeNull();
});
it('Переход использует дату налогового учёта, не угадывает отсутствующую', () => {
  expect(transition('usn-income')!.nominal).toBeNull();
  expect(transition('ausn-income', '2026-09-01')!.nominal).toBe('2026-10-01');
  expect(transition('osno')).toBeNull();
});
