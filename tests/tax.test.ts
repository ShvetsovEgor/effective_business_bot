import { describe, expect, it } from 'vitest';
import { calculate, lowestComplete } from '../src/domain/tax/calculators.js';
import { eligibility } from '../src/domain/tax/eligibility.js';
import { taxRules, regionalOverrides } from '../src/data/tax-rules-2026.js';
import type { TaxInput } from '../src/domain/tax/types.js';
const input: TaxInput = { region: '77', income: 1_000_000, expenses: 500_000, payroll: 0,
  employees: 0, assets: 0, contributions: 0, simpleVat: true, confirmedUsn: true, confirmedAusn: true };
const ausn = taxRules.find(r => r.id === 'ausn-income')!;
describe('tax rules 2026', () => {
  it('АУСН недоступна при 6 сотрудниках', () => {
    expect(eligibility(ausn, { ...input, employees: 6 })).toMatchObject({ available: false, reasons: ['Работников больше 5.'] });
  });
  it('АУСН недоступна при доходе >60 млн, но граница включена', () => {
    expect(eligibility(ausn, { ...input, income: 60_000_001 }).available).toBe(false);
    expect(eligibility(ausn, { ...input, income: 60_000_000, employees: 5, assets: 150_000_000 }).available).toBe(true);
  });
  it('АУСН проверяет активы, регион и дату введения', () => {
    expect(eligibility(ausn, { ...input, assets: 150_000_001 }).available).toBe(false);
    expect(eligibility(ausn, { ...input, region: '52' }).available).toBe(false);
    expect(eligibility(ausn, { ...input, region: '89' }, '2026-03-31').available).toBe(false);
    expect(eligibility(ausn, { ...input, region: '89' }, '2026-04-01').available).toBe(true);
  });
  it('УСН доходы: 6% и ограничение вычета 50%', () => {
    expect(calculate(input)[0]!.tax).toBe(60_000);
    expect(calculate({ ...input, contributions: 40_000 })[0]).toMatchObject({ tax: 30_000, total: 70_000 });
    expect(calculate({ ...input, contributions: 10_000 })[0]!.tax).toBe(50_000);
  });
  it('УСН Д-Р: минимум 1%, включая убыток', () => {
    for (const expenses of [990_000, 2_000_000]) expect(calculate({ ...input, expenses })[1]!.tax).toBe(10_000);
  });
  it('АУСН Д-Р: минимум 3%, без ложной точности годовой оценки', () => {
    expect(calculate({ ...input, expenses: 990_000 })[3]).toMatchObject({ tax: 30_000, total: 32_959, complete: false });
  });
  it('УСН: численность, доход и основные средства', () => {
    const usn = taxRules[0]!;
    expect(eligibility(usn, { ...input, income: 490_500_000, assets: 218_000_000, employees: 130 }).available).toBe(true);
    for (const patch of [{ income: 490_500_001 }, { assets: 218_000_001 }, { employees: 131 }]) expect(eligibility(usn, { ...input, ...patch }).available).toBe(false);
  });
  it('нет победителя при НДС или неподтверждённых условиях', () => {
    const high = { ...input, income: 20_000_001 };
    expect(lowestComplete(calculate(high), high)).toEqual([]);
    const unknown = { ...input, confirmedAusn: false, confirmedUsn: false };
    expect(lowestComplete(calculate(unknown), unknown)).toEqual([]);
    expect(calculate({ ...input, contributions: null })[0]!.complete).toBe(false);
    const noContributions = { ...input, contributions: null };
    expect(lowestComplete(calculate(noContributions), noContributions)).toEqual([]);
    expect(lowestComplete(calculate(input), input)[0]!.id).toBe('usn-income');
    expect(calculate(input)[4]!.complete).toBe(false);
  });
  it('региональный override применяется и заменяет предупреждение', () => {
    regionalOverrides['77'] = { 'usn-income': { rate: 0.05, source_url: 'https://www.nalog.gov.ru/', verified_at: '2026-09-29' } };
    try {
      expect(calculate(input)[0]!.tax).toBe(50_000);
      expect(calculate(input)[0]!.warnings.some(w => w.includes('базовой'))).toBe(false);
    } finally { delete regionalOverrides['77']; }
  });
  it('ФОТ не вычитается повторно; взносы прибавляются к расходам один раз', () => {
    expect(calculate({ ...input, payroll: 200_000, contributions: 50_000 })[1]).toMatchObject({ tax: 67_500, total: 117_500 });
  });
  it('отклоняет нечисловые, отрицательные и противоречивые параметры', () => {
    for (const patch of [{ income: NaN }, { expenses: -1 }, { income: Infinity }, { employees: 1.1 }, { payroll: 600_000 }]) expect(() => calculate({ ...input, ...patch })).toThrow();
  });
});
