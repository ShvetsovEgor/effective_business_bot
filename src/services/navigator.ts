import { randomBytes } from 'node:crypto';
import type { Repository, Session } from '../db/repository.js';
import type { Button, Event, Screen } from '../bot/messages/types.js';
import { registrationRules } from '../data/llc-registration.js';
import { afterRegistrationRules } from '../data/llc-after-registration.js';
import { taxRules } from '../data/tax-rules-2026.js';
import { isPending, prioritize } from '../domain/checklist/service.js';
import type { BusinessProfile, Status } from '../domain/checklist/types.js';
import { formatDate, today } from '../domain/deadlines/index.js';
import { calculate, lowestComplete, money } from '../domain/tax/calculators.js';
import type { TaxId, TaxInput } from '../domain/tax/types.js';
import { transition, transitionTask } from '../domain/tax/transitions.js';
import { parseAnswer, profileQuestions, taxQuestions, type Question } from './forms.js';

const action = (text: string, value: string): Button => ({ text, action: value });
const source = (url: string): Button => ({ text: '🔗 Официальный источник', url });
const menuButton = () => action('Главное меню', 'menu');
const statuses: Record<Status, string> = { TODO: 'Не начато', IN_PROGRESS: 'В работе', DONE: 'Выполнено', NOT_APPLICABLE: 'Не применимо' };

export class Navigator {
  constructor(readonly repo: Repository) {}

  handle(user: string, event: Event, eventId?: string): Screen {
    return this.repo.transaction(() => {
      this.repo.ensureUser(user);
      if (eventId) {
        const existing = this.repo.event(user, eventId);
        if (existing) return existing;
      }
      let session = this.repo.session(user);
      let screen: Screen;
      if (event.type === 'command') {
        if (event.command === 'reset') {
          session = { nonce: '', actions: [] };
          screen = { text: 'Удалить ваш профиль, задачи и историю расчётов? Это действие нельзя отменить.', buttons: [action('Да, удалить мои данные', 'reset-confirm'), menuButton()] };
        } else if (event.command === 'start' || event.command === 'menu') {
          screen = this.menu();
          // Preserve a saved form until the user explicitly starts another scenario.
          if (session.form) screen.buttons.unshift(action('Продолжить анкету', 'resume'));
        } else screen = { text: 'Доступны команды /start, /menu и /reset.', buttons: [menuButton()] };
      } else if (event.type === 'callback') {
        const colon = event.payload.indexOf(':');
        const nonce = event.payload.slice(0, colon);
        const value = event.payload.slice(colon + 1);
        if (colon < 0 || nonce !== session.nonce || !session.actions.includes(value)) {
          screen = session.form ? this.question(session, 'Эта кнопка устарела. Продолжим с текущего вопроса.')
            : { text: 'Эта кнопка уже обработана или устарела. Откройте актуальный экран.', buttons: [action('📋 Мои задачи', 'tasks'), menuButton()] };
        } else ({ screen, session } = this.callback(user, value, session));
      } else if (session.form) ({ screen, session } = this.answer(user, event.text, session));
      else screen = { text: 'Выберите действие в меню.', buttons: [menuButton()] };
      const nonce = randomBytes(6).toString('hex');
      session.nonce = nonce;
      session.actions = screen.buttons.flatMap(b => 'action' in b ? [b.action] : []);
      this.repo.saveSession(user, session);
      const response = { ...screen, buttons: screen.buttons.map(b => 'action' in b ? { ...b, action: `${nonce}:${b.action}` } : b) };
      if (eventId) this.repo.saveEvent(user, eventId, response);
      return response;
    });
  }

  private menu(): Screen {
    return { text: 'Привет! Я помогу открыть ООО и не пропустить обязательные действия после регистрации.\n\nВыберите, что вам нужно:', buttons: [
      action('🏢 Хочу открыть ООО', 'registration'), action('✅ ООО уже зарегистрировано', 'profile'),
      action('💰 Подобрать налоговый режим', 'tax-intro'), action('📋 Мои задачи', 'tasks'),
    ] };
  }

  private callback(user: string, value: string, session: Session): { screen: Screen; session: Session } {
    const result = (screen: Screen) => ({ screen, session });
    if (value === 'menu') {
      const screen = this.menu();
      if (session.form) screen.buttons.unshift(action('Продолжить анкету', 'resume'));
      return result(screen);
    }
    if (value === 'reset-confirm') { this.repo.reset(user); session = { nonce: '', actions: [] }; return result(this.menu()); }
    if (value === 'resume') return result(this.question(session));
    if (value === 'registration') {
      session.form = undefined;
      this.repo.syncTasks(user, registrationRules);
      return result(this.nextRegistration(user));
    }
    if (value === 'profile' || value === 'tax-begin') {
      session = { nonce: '', actions: [], form: value === 'profile' ? 'profile' : 'tax', step: 0, draft: {} };
      return result(this.question(session));
    }
    if (value === 'tax-intro') {
      session.form = undefined;
      return result({ text: 'Рассчитываем ООО за 2026 год. НПД и ПСН для ООО не подходят.\n\nЭто проверяемая модель, а не юридическая или бухгалтерская консультация. Расходы должны включать ФОТ. Взносы укажем отдельно.', buttons: [action('Да, рассчитываем ООО', 'tax-begin'), menuButton()] });
    }
    if (value === 'form-back' && session.form) {
      session.step = Math.max(0, (session.step ?? 0) - 1);
      return result(this.question(session));
    }
    if (value.startsWith('answer:') && session.form) return this.answer(user, value.slice(7), session);
    if (value === 'tasks') { session.form = undefined; return result(this.dashboard(user)); }
    if (value === 'now') {
      const next = prioritize(this.repo.tasks(user), today()).next;
      return result(next ? this.task(user, next.id) : this.dashboard(user));
    }
    if (value.startsWith('list:')) return result(this.taskList(user, Number(value.slice(5))));
    if (value.startsWith('task:')) return result(this.task(user, value.slice(5)));
    if (value.startsWith('detail:')) return result(this.task(user, value.slice(7), true));
    if (value.startsWith('status:')) {
      const [, taskId, status] = value.split(':');
      const task = this.repo.tasks(user).find(t => t.id === taskId);
      if (!task || !status || !Object.hasOwn(statuses, status)) return result(this.dashboard(user));
      this.repo.setStatus(user, task.id, status as Status);
      if (status === 'DONE' && task.group === 'registration') return result(this.nextRegistration(user));
      return result(this.task(user, task.id));
    }
    if (value === 'tax-results') return result(this.taxSummary(user));
    if (value === 'formulas') return result({ text: 'Выберите расчёт, чтобы увидеть формулу и ограничения.', buttons: [...taxRules.map(r => action(r.name, `formula:${r.id}`)), action('Назад к сравнению', 'tax-results')] });
    if (value.startsWith('formula:')) return result(this.taxDetails(user, value.slice(8)));
    if (value === 'transitions') return result({ text: 'На какой режим хотите перейти?', buttons: [
      ...taxRules.filter(r => r.id !== 'osno').map(r => action(r.name, `transition:${r.id}`)),
      action('ОСНО / другие переходы', 'transition:osno'), menuButton(),
    ] });
    if (value.startsWith('transition:')) {
      const id = value.slice(11) as TaxId;
      if (!transition(id)) return result({ text: 'Правило этого перехода ещё не добавлено в MVP. Срок нужно уточнить по ФНС.', buttons: [source(taxRules.find(r => r.id === id)?.source_url ?? taxRules[0]!.source_url), menuButton()] });
      session.transitionId = id;
      session.taxDate = undefined;
      return result({ text: 'Это новая организация, которая выбирает режим с даты постановки на учёт?', buttons: [action('Да, новая организация', 'transition-new'), action('Нет, меняем действующий режим', 'transition-existing'), menuButton()] });
    }
    if (value === 'transition-existing') return result({ text: 'Для действующей организации переход зависит от текущего режима и условий. Это правило ещё не настроено в MVP. Срок: нужно уточнить.', buttons: [source(transition(session.transitionId as TaxId)!.rule.source_url), menuButton()] });
    if (value === 'transition-new') {
      session.form = 'transition'; session.step = 0;
      return result(this.question(session));
    }
    if (value === 'transition-add') {
      const rule = transitionTask(session.transitionId as TaxId);
      if (rule) {
        const t = transition(session.transitionId as TaxId, session.taxDate)!;
        if (t.nominal) rule.description += ` Ориентир +30 дней: ${formatDate(t.nominal)}. Юридический срок с учётом переноса нужно уточнить.`;
        this.repo.syncTasks(user, [rule]);
        return result(this.task(user, rule.id));
      }
    }
    return result(this.menu());
  }

  private questions(session: Session): Question[] {
    if (session.form === 'profile') return profileQuestions;
    if (session.form === 'tax') return taxQuestions;
    return [{ key: 'taxDate', text: 'Какая дата постановки на налоговый учёт указана в документах? Формат ДД.ММ.ГГГГ. Не подменяйте её датой регистрации без проверки.', type: 'date', options: [['Дата неизвестна', 'unknown']] }];
  }
  private question(session: Session, error?: string): Screen {
    const questions = this.questions(session);
    const q = questions[session.step ?? 0]!;
    return { text: `${error ? `${error}\n\n` : ''}Вопрос ${(session.step ?? 0) + 1} из ${questions.length}\n${q.text}`, buttons: [
      ...(q.options ?? []).map(([label, key]) => action(label, `answer:${key}`)),
      ...(q.source ? [source(q.source)] : []),
      ...((session.step ?? 0) > 0 ? [action('⬅️ Назад', 'form-back')] : []), menuButton(),
    ] };
  }
  private answer(user: string, raw: string, session: Session): { screen: Screen; session: Session } {
    const q = this.questions(session)[session.step ?? 0]!;
    let parsed: string | number | boolean | null;
    try {
      parsed = parseAnswer(q, raw);
      if (q.key === 'payroll' && Number(parsed) > Number(session.draft?.expenses)) throw new Error('ФОТ не может быть больше расходов, которые его включают. Исправьте ФОТ или вернитесь к расходам.');
      if (q.key === 'director' && parsed === true && session.draft?.employees === 0) throw new Error('Оформленный директор входит в число сотрудников. Нажмите «Назад» и исправьте количество.');
    } catch (e) { return { screen: this.question(session, e instanceof Error ? e.message : 'Проверьте ответ.'), session }; }
    if (session.form === 'transition') {
      session.taxDate = parsed === 'unknown' ? undefined : String(parsed);
      session.form = undefined;
      return { screen: this.transitionScreen(session), session };
    }
    session.draft = { ...session.draft, [q.key]: parsed };
    // An answer to an earlier question invalidates all dependent later answers.
    for (const later of this.questions(session).slice((session.step ?? 0) + 1)) delete session.draft[later.key];
    session.step = (session.step ?? 0) + 1;
    if (session.step < this.questions(session).length) return { screen: this.question(session), session };
    if (session.form === 'profile') {
      const profile = session.draft as unknown as BusinessProfile;
      this.repo.saveProfile(user, profile);
      this.repo.syncTasks(user, afterRegistrationRules(profile), profile.registration_date, true);
      session.form = undefined; session.draft = undefined;
      return { screen: this.dashboard(user), session };
    }
    const input = session.draft as unknown as TaxInput;
    this.repo.saveCalculation(user, input, calculate(input));
    session.form = undefined; session.draft = undefined;
    return { screen: this.taxSummary(user), session };
  }

  private dashboard(user: string): Screen {
    const profile = this.repo.profile(user);
    const tasks = this.repo.tasks(user);
    if (!tasks.length) return { text: 'Пока нет задач. Выберите сценарий, чтобы создать персональный список.', buttons: [action('🏢 Хочу открыть ООО', 'registration'), action('✅ ООО уже зарегистрировано', 'profile'), menuButton()] };
    const p = prioritize(tasks, today());
    const done = tasks.filter(t => t.status === 'DONE').length;
    const na = tasks.filter(t => t.status === 'NOT_APPLICABLE').length;
    const now = p.now[0] ?? p.next;
    return { text: `${profile ? `ООО «${profile.name}»` : 'Ваше будущее ООО'}\n\nПрогресс: ${done} / ${tasks.length - na}\n\n🔴 Сейчас\n${now ? `${now.title}\nСрок: ${formatDate(now.deadline)}` : 'Все применимые задачи выполнены'}\n\n🟡 Скоро\n${p.soon.filter(t => t.id !== now?.id).slice(0, 2).map(t => `${t.title} — ${formatDate(t.deadline)}`).join('\n') || 'Ближайших известных сроков нет'}\n\n✅ Выполнено: ${done}${na ? ` · Не применимо: ${na}` : ''}`, buttons: [action('Что делать сейчас?', 'now'), action('Все задачи', 'list:0'), action('Изменить профиль', 'profile'), menuButton()] };
  }
  private nextRegistration(user: string): Screen {
    const next = this.repo.tasks(user).find(t => t.group === 'registration' && isPending(t));
    return next ? this.task(user, next.id) : { text: 'Все шаги регистрации отмечены. Если ООО уже зарегистрировано, создадим список следующих действий.', buttons: [action('✅ ООО уже зарегистрировано', 'profile'), action('Все задачи', 'list:0'), menuButton()] };
  }
  private task(user: string, id: string, details = false): Screen {
    const tasks = this.repo.tasks(user);
    const task = tasks.find(t => t.id === id);
    if (!task) return this.dashboard(user);
    const regIndex = registrationRules.findIndex(r => r.id === id);
    return { text: `${regIndex >= 0 ? `Шаг ${regIndex + 1} из 10\n` : task.group === 'hr' ? 'Кадровые обязанности\n' : ''}${task.title}\n\n${task.description}\n\nСтатус: ${statuses[task.status]}\nСрок: ${formatDate(task.deadline)}${task.completion_date ? `\nВыполнено: ${formatDate(task.completion_date.slice(0, 10))}` : ''}${details ? `\n\n${task.why_it_matters}\nПравило проверено: ${formatDate(task.verified_at)}` : ''}`, buttons: [
      ...(task.status !== 'DONE' ? [action('✅ Выполнено', `status:${id}:DONE`)] : [action('Вернуть в задачи', `status:${id}:TODO`)]),
      ...(!details ? [action('ℹ️ Подробнее', `detail:${id}`)] : []), source(task.official_source_url),
      ...(id === 'reg-7' || id === 'tax' ? [action('Сравнить налоговые режимы', 'tax-intro'), action('Как перейти?', 'transitions')] : []),
      ...(details && task.group !== 'registration' ? [action('В работе', `status:${id}:IN_PROGRESS`), action('Не применимо', `status:${id}:NOT_APPLICABLE`)] : []),
      action('⬅️ Назад', regIndex > 0 ? `task:reg-${regIndex}` : 'tasks'), menuButton(),
    ] };
  }
  private taskList(user: string, page: number): Screen {
    const tasks = this.repo.tasks(user);
    const max = Math.max(0, Math.ceil(tasks.length / 5) - 1);
    const p = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, max));
    const items = tasks.slice(p * 5, p * 5 + 5);
    return { text: `Все задачи · ${p + 1} / ${max + 1}\n\n${items.map(t => `${statuses[t.status]} · ${t.title}`).join('\n') || 'Список пуст'}`, buttons: [
      ...items.map(t => action(t.title, `task:${t.id}`)),
      ...(p > 0 ? [action('⬅️ Предыдущие', `list:${p - 1}`)] : []),
      ...(p < max ? [action('Следующие ➡️', `list:${p + 1}`)] : []), action('Мои задачи', 'tasks'),
    ] };
  }
  private taxSummary(user: string): Screen {
    const calc = this.repo.calculation(user);
    if (!calc) return { text: 'Сначала введём параметры ООО.', buttons: [action('Рассчитать', 'tax-intro'), menuButton()] };
    const { input, result } = calc;
    const winners = lowestComplete(result, input);
    const rows = result.map(r => `${r.name}\n${!r.eligibility.available ? `Недоступна по проверенным условиям: ${r.eligibility.reasons.join(' ')}` : `${money(r.total)} ₽${r.complete ? ' — в рамках модели' : ' — неполная оценка'}\nДоступна: ${r.eligibility.confirmed ? 'да, по вашим подтверждениям' : 'нужно уточнить условия'}`}`);
    const conclusion = winners.length >= 1
      ? `Наименьшая расчетная налоговая нагрузка среди полностью рассчитанных доступных вариантов: ${winners.map(r => r.name).join(', ')}. Неполные оценки не участвуют; это не рекомендация режима.`
      : 'Полного сравнения пока нет — победитель не определяется. Посмотрите формулы и недостающие данные.';
    return { text: `ООО · модель 2026\nДоход: ${money(input.income)} ₽\nРасходы (с ФОТ, без взносов): ${money(input.expenses)} ₽\nФОТ: ${money(input.payroll)} ₽ · Сотрудники: ${input.employees}\nРегион: ${input.region}\n\n${rows.join('\n\n')}\n\n${input.income > 20_000_000 ? 'В вашем сценарии необходимо учитывать НДС. Расширенный расчет НДС пока находится за пределами точной модели MVP.\n\n' : ''}${conclusion}\n\nБазовые ставки; региональные льготы не учтены. Расчёт не является юридической или бухгалтерской консультацией.`, buttons: [action('Как считается?', 'formulas'), action('Как перейти?', 'transitions'), action('Изменить параметры', 'tax-begin'), menuButton()] };
  }
  private taxDetails(user: string, id: string): Screen {
    const r = this.repo.calculation(user)?.result.find(r => r.id === id);
    if (!r) return this.taxSummary(user);
    return { text: `${r.name}\n\n${r.formula}\n\nНалог: ${money(r.tax)} ₽\n${r.contributions === null ? 'Полная нагрузка неизвестна' : `Налог + взносы: ${money(r.total)} ₽`}\n\n${r.warnings.join('\n\n')}\n\n${r.eligibility.reasons.join('\n')}`, buttons: [source(r.source_url), action('Как перейти?', `transition:${r.id}`), action('Назад к сравнению', 'tax-results')] };
  }
  private transitionScreen(session: Session): Screen {
    const t = transition(session.transitionId as TaxId, session.taxDate)!;
    const expired = t.nominal && t.nominal < today();
    return { text: `Как перейти на ${t.regime.name}\n\nКогда:\n${t.note}\n\nЧто сделать:\n${t.rule.instructions}\n\nБлижайший юридический дедлайн: Нужно уточнить${t.nominal ? `\nОриентир +30 дней: ${formatDate(t.nominal)}${expired ? '\nОриентир уже прошёл. Не считайте переход доступным: уточните срок и другой порядок в ФНС.' : ''}` : '\nУточните дату постановки на учёт.'}`, buttons: [action('Добавить в мои задачи', 'transition-add'), source(t.rule.source_url), menuButton()] };
  }
}
