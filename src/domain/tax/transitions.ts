import { taxRules } from '../../data/tax-rules-2026.js';
import { deadline, parseDate } from '../deadlines/index.js';
import type { TaskRule } from '../checklist/types.js';
import type { TaxId } from './types.js';
export function transition(id: TaxId, taxRegistrationDate?: string) {
  const regime = taxRules.find(r => r.id === id);
  const rule = regime?.transitions[0];
  if (!regime || !rule) return null;
  const nominal = taxRegistrationDate && parseDate(taxRegistrationDate)
    ? deadline({ type: 'REGISTRATION_DAYS', days: rule.days }, taxRegistrationDate) : null;
  return { regime, rule, nominal,
    note: '30 календарных дней от даты постановки на налоговый учёт. Возможный перенос последнего дня требует проверки производственного календаря.',
  };
}
export function transitionTask(id: TaxId): TaskRule | null {
  const t = transition(id);
  return t ? { id: `transition-${id}`, group: 'transition', title: `Проверить переход на ${t.regime.name}`,
    description: `${t.rule.instructions} ${t.note}`,
    why_it_matters: 'Для новой организации. Срок зависит от даты постановки на учёт, а не только от даты регистрации ООО. Для действующей организации правило в MVP не настроено.',
    deadline_rule: { type: 'UNKNOWN' }, source_url: t.rule.source_url, verified_at: t.rule.verified_at,
  } : null;
}
