import { regionalOverrides, taxRules, vatModelLimit } from '../../data/tax-rules-2026.js';
import { eligibility } from './eligibility.js';
import type { TaxInput, TaxResult } from './types.js';
export const money = (n: number): string => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calculate(input: TaxInput): TaxResult[] {
  for (const n of [input.income, input.expenses, input.payroll, input.employees, input.assets, input.contributions ?? 0]) {
    if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new Error('Некорректные финансовые параметры');
  }
  if (!Number.isInteger(input.employees) || input.expenses < input.payroll) throw new Error('Проверьте сотрудников и расходы: ФОТ должен входить в расходы');
  return taxRules.map(rule => {
    const ausn = rule.id.startsWith('ausn');
    const profit = rule.id.endsWith('profit') || rule.id === 'osno';
    const override = regionalOverrides[input.region]?.[rule.id];
    const rate = override?.rate ?? rule.calculation.rate;
    const contributions = ausn ? rule.calculation.injury : input.contributions;
    const paid = contributions ?? 0;
    const base = profit ? Math.max(0, input.income - input.expenses - paid) : input.income;
    const raw = base * rate;
    const minimum = input.income * rule.calculation.minimum;
    const deduction = rule.id === 'usn-income' ? Math.min(paid, raw * rule.calculation.deductionLimit) : 0;
    const tax = round(Math.max(raw - deduction, minimum));
    const warnings: string[] = [];
    if (!ausn && rule.id !== 'osno' && !override) warnings.push('Расчет выполнен по базовой ставке. Региональные льготы не учтены.');
    if (contributions === null) warnings.push('Взносы неизвестны: показан налог до их учёта, полной нагрузки нет.');
    if (input.income > vatModelLimit && !ausn) warnings.push('В вашем сценарии необходимо учитывать НДС. Расширенный расчет НДС пока находится за пределами точной модели MVP.');
    if (!input.simpleVat) warnings.push('Не подтверждено отсутствие НДС и других неучтённых налогов.');
    if (ausn) warnings.push('Учтено 2 959 ₽ травматизма за полный год. Обычные взносы на АУСН имеют специальный порядок.');
    if (rule.id === 'ausn-profit') warnings.push('Годовая оценка: АУСН считается помесячно. Без помесячных данных минимум 3% нельзя точно суммировать за год.');
    if (rule.id === 'osno') warnings.push('Только предварительный налог на прибыль 25%. НДС, различия налоговой базы и другие налоги не рассчитаны.');
    const access = eligibility(rule, input);
    if (!access.confirmed) warnings.push('Нечисловые условия режима не подтверждены. Доступность нужно уточнить.');
    let formula = profit
      ? `max(max(0, ${money(input.income)} − ${money(input.expenses)} − ${money(paid)}) × ${rate * 100}%; ${money(input.income)} × ${rule.calculation.minimum * 100}%)`
      : `${money(input.income)} × ${rate * 100}%${rule.id === 'usn-income' ? ` − min(${money(paid)}; ${money(raw)} × 50%)` : ''}`;
    formula += ` = ${money(tax)} ₽; + взносы ${contributions === null ? 'неизвестны' : `${money(paid)} ₽`}`;
    return { id: rule.id, name: rule.name, eligibility: access, tax, contributions,
      total: round(tax + paid), formula, warnings, source_url: override?.source_url ?? rule.source_url,
      complete: access.available && access.confirmed && contributions !== null && input.simpleVat
        && input.income <= vatModelLimit && rule.id !== 'osno' && rule.id !== 'ausn-profit',
    };
  });
}
export function lowestComplete(results: TaxResult[], input: TaxInput): TaxResult[] {
  if (input.income > vatModelLimit) return [];
  // Never make a regime look best merely because a comparable alternative lacks inputs.
  // OSNO and annual AUSN profit are explicitly outside the exact comparison.
  const candidates = results.filter(r => r.id !== 'osno' && r.id !== 'ausn-profit' && r.eligibility.available);
  if (candidates.some(r => !r.complete) || candidates.length < 2) return [];
  const complete = candidates;
  const min = Math.min(...complete.map(r => r.total));
  return complete.filter(r => r.total === min);
}
