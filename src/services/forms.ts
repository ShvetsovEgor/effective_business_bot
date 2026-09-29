import { parseDate, today } from '../domain/deadlines/index.js';
import { SOURCES } from '../data/sources.js';
export interface Question {
  key: string; text: string;
  type: 'text' | 'date' | 'region' | 'money' | 'integer' | 'choice';
  options?: [string, string][]; source?: string;
}
const yesNo: [string, string][] = [['Да', 'yes'], ['Нет', 'no']];
export const profileQuestions: Question[] = [
  { key: 'name', text: 'Как называется ООО? Введите название без кавычек (до 80 символов).', type: 'text' },
  { key: 'registration_date', text: 'Дата регистрации ООО? Формат: ДД.ММ.ГГГГ.', type: 'date' },
  { key: 'region', text: 'Регион регистрации? Введите двухзначный код субъекта РФ, например 77 для Москвы.', type: 'region' },
  { key: 'tax_regime', text: 'Какой налоговый режим применяется сейчас?', type: 'choice', options: [['УСН «Доходы»', 'usn-income'], ['УСН «Доходы − расходы»', 'usn-profit'], ['АУСН «Доходы»', 'ausn-income'], ['АУСН «Доходы − расходы»', 'ausn-profit'], ['ОСНО', 'osno'], ['Не знаю', 'unknown']] },
  { key: 'employees', text: 'Сколько сотрудников, включая оформленного директора? Введите целое число.', type: 'integer' },
  { key: 'director', text: 'Директор оформлен по трудовым отношениям?', type: 'choice', options: yesNo },
  { key: 'personal_data', text: 'Обрабатываете персональные данные клиентов или работников?', type: 'choice', options: yesNo },
  { key: 'cash_register', text: 'Планируете расчёты с физлицами, для которых может потребоваться ККТ?', type: 'choice', options: yesNo },
  { key: 'personnel_event', text: 'Есть кадровое событие, по которому нужно проверить ЕФС-1 (например, приём работника)?', type: 'choice', options: yesNo },
];
export const taxQuestions: Question[] = [
  { key: 'region', text: 'Регион ООО? Введите двухзначный код субъекта РФ (например, 77).', type: 'region' },
  { key: 'income', text: 'Ожидаемый доход за весь 2026 год, ₽?', type: 'money' },
  { key: 'expenses', text: 'Подтверждаемые расходы за год, ₽? Включите ФОТ, но не включайте страховые взносы: их укажем отдельно.', type: 'money' },
  { key: 'payroll', text: 'Годовой ФОТ до удержания НДФЛ, ₽? Он уже должен входить в указанную сумму расходов.', type: 'money' },
  { key: 'employees', text: 'Количество сотрудников, включая директора? Введите целое число.', type: 'integer' },
  { key: 'assets', text: 'Остаточная стоимость основных средств, ₽?', type: 'money' },
  { key: 'contributions', text: 'Страховые взносы за год на обычных режимах, ₽? Укажите рассчитанную сумму, уплаченную в пределах начисленной (включая травматизм и взносы за директора). По одному ФОТ её точно не определить.', type: 'money', options: [['Не знаю — предварительная оценка', 'unknown']], source: SOURCES.director },
  { key: 'simpleVat', text: 'Подтверждаете условия простой модели: доход 2025 года ≤ 20 млн ₽ (или новое ООО), нет импорта, обязанностей агента НДС, счетов-фактур с НДС, торгового сбора, имущественных и иных отдельных налогов?', type: 'choice', options: [['Да, подтверждаю', 'yes'], ['Нет / нужно уточнить', 'no']], source: SOURCES.limits },
  { key: 'confirmedUsn', text: 'Проверили остальные условия УСН по ФНС (вид деятельности, доли организаций, филиалы и другие ограничения)?', type: 'choice', options: [['Да, условия соблюдены', 'yes'], ['Нужно уточнить', 'no']], source: SOURCES.usn },
  { key: 'confirmedAusn', text: 'Проверили остальные условия АУСН по ФНС, включая уполномоченные банки, безналичную зарплату, состав участников и ограничения деятельности?', type: 'choice', options: [['Да, условия соблюдены', 'yes'], ['Нужно уточнить', 'no']], source: SOURCES.ausn },
];
export function parseAnswer(q: Question, raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (value.length > 100) throw new Error('Ответ слишком длинный.');
  if (q.options?.some(([, key]) => key === value)) {
    if (value === 'unknown' && q.key === 'contributions') return null;
    if (value === 'yes' || value === 'no') return value === 'yes';
    return value;
  }
  if (q.type === 'choice') throw new Error('Выберите ответ кнопкой.');
  if (q.type === 'date') {
    const date = parseDate(value);
    if (!date || date > today() || date < '1990-01-01') throw new Error('Укажите существующую дату не позднее сегодня, например 15.09.2026.');
    return date;
  }
  if (q.type === 'region') {
    const aliases: Record<string, string> = { 'москва': '77', 'московская область': '50', 'санкт-петербург': '78' };
    const code = aliases[value.toLowerCase()] ?? value.padStart(2, '0');
    const n = Number(code);
    if (!/^\d{2}$/.test(code) || !(n >= 1 && n <= 79 || [83, 86, 87, 89, 90, 91, 92, 93, 94, 95, 99].includes(n))) throw new Error('Введите код субъекта РФ: например 77, 50 или 78.');
    return code;
  }
  if (q.type === 'text') {
    if (!value || value.length > 80 || [...value].some(char => char.charCodeAt(0) < 32)) throw new Error('Введите название длиной от 1 до 80 символов в одну строку.');
    return value;
  }
  const clean = value.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error('Введите неотрицательное число без знака ₽, например 1200000.');
  const n = Number(clean);
  if (!Number.isFinite(n) || n > 1e12 || (q.type === 'integer' && (!Number.isInteger(n) || n > 100000))) throw new Error('Число вне допустимого диапазона.');
  return n;
}
