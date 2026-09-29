import type { BusinessProfile, TaskRule } from '../domain/checklist/types.js';
import { SOURCES, VERIFIED_AT } from './sources.js';
import { taxRules } from './tax-rules-2026.js';

function rule(id: string, title: string, description: string, source_url: string, group: TaskRule['group'] = 'after'): TaskRule {
  return { id, title, description, source_url, group, verified_at: VERIFIED_AT,
    why_it_matters: 'Проверьте применимость по официальному источнику и сохраните подтверждение выполнения.',
    deadline_rule: { type: 'UNKNOWN' } };
}
export function afterRegistrationRules(p: BusinessProfile): TaskRule[] {
  const rules = [
    rule('docs', 'Сохранить регистрационные документы', 'Сохраните выписку, устав и документы о постановке на учёт.', SOURCES.registration),
    rule('bank', 'Открыть расчётный счёт', 'Выберите банк. Если счёт уже открыт, нажмите «Выполнено».', SOURCES.registration),
    { ...rule('capital', 'Внести уставный капитал', 'Проверьте срок в решении или договоре: он может быть раньше. Здесь указан предельный срок — 4 месяца после регистрации.', SOURCES.registration), deadline_rule: { type: 'REGISTRATION_MONTHS', months: 4 } as const },
    rule('tax', 'Проверить выбранный налоговый режим', `Указано: ${taxRules.find(r => r.id === p.tax_regime)?.name ?? 'не определён'}. Проверьте подтверждение применения и возможность перехода.`, p.tax_regime.startsWith('ausn') ? SOURCES.ausn : SOURCES.usn),
    rule('books', 'Организовать бухгалтерию', 'Выберите способ ведения учёта и ответственного за отчётность.', SOURCES.bookkeeping),
    rule('signature', 'Настроить электронную подпись и ЭДО при необходимости', 'Определите, какие документы и отчёты будете отправлять электронно.', SOURCES.signature),
    rule('cabinet', 'Создать личный кабинет юридического лица ФНС', 'Настройте доступ и проверьте сведения об организации.', SOURCES.cabinet),
    rule('director-contributions', 'Проверить взносы за руководителя', 'С 2026 года действует минимальная база для взносов за руководителя коммерческой организации. Проверьте применимость, исключения и свой режим.', SOURCES.director),
  ];
  if (p.personnel_event) rules.push(rule('efs', 'Проверить и подать ЕФС-1 по кадровому событию', 'Для приёма сведения обычно подаются не позднее следующего рабочего дня после оформляющего документа. Нужны вид и дата события; без них срок — «Нужно уточнить».', SOURCES.efs, 'hr'));
  if (p.personal_data) rules.push(rule('privacy', 'Проверить обязанности по персональным данным', 'Определите цели, основания, меры защиты и необходимые документы. Необходимость уведомления Роскомнадзора определяется статьёй 22 закона 152-ФЗ с учётом исключений.', SOURCES.privacy));
  if (p.cash_register) rules.push(rule('kkt', 'Проверить необходимость ККТ', 'Уточните виды расчётов, способ оплаты и исключения по 54-ФЗ до начала расчётов. Ответ «да» в анкете ещё не устанавливает обязанность.', SOURCES.kkt));
  if (p.employees > 0 || p.director) {
    rules.push(rule('hr', 'Организовать кадровый учёт', 'Проверьте оформление трудовых отношений, оплату труда, кадровые документы и отчётность.', SOURCES.efs, 'hr'));
    rules.push(rule('military', 'Проверить обязанности по воинскому учёту', 'Уточните наличие военнообязанных работников, документы и применимые обязанности организации.', SOURCES.military, 'hr'));
  }
  return rules;
}
