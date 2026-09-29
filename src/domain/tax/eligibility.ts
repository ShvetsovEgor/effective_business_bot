import { ausnRegions } from '../../data/tax-rules-2026.js';
import type { Eligibility, TaxInput, TaxRule } from './types.js';
export function eligibility(rule: TaxRule, input: TaxInput, on = '2026-09-29'): Eligibility {
  const r = rule.eligibility;
  const reasons: string[] = [];
  if (r.maxIncome !== undefined && input.income > r.maxIncome) reasons.push(`Доход превышает ${r.maxIncome.toLocaleString('ru-RU')} ₽.`);
  if (r.maxEmployees !== undefined && input.employees > r.maxEmployees) reasons.push(`Работников больше ${r.maxEmployees}.`);
  if (r.maxAssets !== undefined && input.assets > r.maxAssets) reasons.push(`Основные средства превышают ${r.maxAssets.toLocaleString('ru-RU')} ₽.`);
  const introduced = ausnRegions[input.region];
  if (r.regional && (!introduced || introduced > on)) reasons.push('Введение АУСН в регионе на выбранную дату не подтверждено конфигурацией. Проверьте таблицу ФНС.');
  const confirmed = rule.id === 'osno' || (r.regional ? input.confirmedAusn : input.confirmedUsn);
  return { available: reasons.length === 0, confirmed, reasons };
}
