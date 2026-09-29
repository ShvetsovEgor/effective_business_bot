import type { TaxId, TaxRule } from '../domain/tax/types.js';
import { SOURCES, VERIFIED_AT } from './sources.js';

function taxRule(id: TaxId, name: string, rate: number, minimum: number): TaxRule {
  const ausn = id.startsWith('ausn');
  const osno = id === 'osno';
  const source_url = osno ? SOURCES.profit : ausn ? SOURCES.ausn : SOURCES.usn;
  return {
    id, name, year: 2026, source_url, verified_at: VERIFIED_AT,
    eligibility: osno ? { regional: false } : {
      maxIncome: ausn ? 60_000_000 : 490_500_000,
      maxEmployees: ausn ? 5 : 130, maxAssets: ausn ? 150_000_000 : 218_000_000, regional: ausn,
    },
    calculation: { rate, minimum, deductionLimit: 0.5, injury: ausn ? 2959 : 0 },
    transitions: osno ? [] : [{ from: 'new', days: 30, source_url, verified_at: VERIFIED_AT,
      instructions: ausn
        ? 'Проверьте все условия АУСН. Уведомите ФНС через личный кабинет или уполномоченный банк.'
        : 'Проверьте условия УСН и подайте уведомление в ФНС с выбранным объектом налогообложения.',
    }],
    official_sources: [source_url, SOURCES.limits, ...(ausn ? [SOURCES.injury] : [])],
  };
}
export const taxRules: TaxRule[] = [
  taxRule('usn-income', 'УСН «Доходы»', 0.06, 0),
  taxRule('usn-profit', 'УСН «Доходы − расходы»', 0.15, 0.01),
  taxRule('ausn-income', 'АУСН «Доходы»', 0.08, 0),
  taxRule('ausn-profit', 'АУСН «Доходы − расходы»', 0.20, 0.03),
  taxRule('osno', 'ОСНО — предварительная оценка', 0.25, 0),
];
export const regionalOverrides: Record<string, Partial<Record<TaxId, { rate: number; source_url: string; verified_at: string }>>> = {};
// FNS table snapshot. Missing codes mean unverified, not prohibited.
export const ausnRegions: Record<string, string> = Object.fromEntries([
  ...'01 06 07 08 09 11 14 15 19 20 21 23 26 27 28 30 32 33 35 36 38 41 42 43 44 45 47 48 49 51 54 55 56 57 60 64 68 69 71 72 73 74 78 79 86 91 92 99'.split(' ').map(c => [c, '2025-01-01']),
  ...'02 04 05 17 22 24 29 34 39 46 58 59 61 62 63 75 95'.split(' ').map(c => [c, '2026-01-01']),
  ...'10 12 31 66 83 90'.split(' ').map(c => [c, '2025-02-01']),
  ...'03 13 18'.split(' ').map(c => [c, '2025-04-01']),
  ...'16 40 50 77'.split(' ').map(c => [c, '2022-07-01']),
  ...'37 70 76 87'.split(' ').map(c => [c, '2026-02-01']),
  ['25', '2025-09-01'], ['53', '2025-11-01'], ['65', '2025-08-01'], ['67', '2025-10-01'],
  ['89', '2026-04-01'], ['93', '2025-03-01'], ['94', '2025-08-01'],
]);
export const regionSource = { source_url: SOURCES.ausn, verified_at: VERIFIED_AT };
export const vatModelLimit = 20_000_000;
