export type DeadlineRule =
  | { type: 'ABSOLUTE'; date: string }
  | { type: 'REGISTRATION_DAYS'; days: number }
  | { type: 'REGISTRATION_MONTHS'; months: number }
  | { type: 'UNKNOWN' };

export function parseDate(value: string): string | null {
  const normalized = value.trim().replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, '$3-$2-$1');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized
    ? normalized : null;
}

export function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
}

export function deadline(rule: DeadlineRule, registrationDate?: string): string | null {
  if (rule.type === 'UNKNOWN') return null;
  if (rule.type === 'ABSOLUTE') return parseDate(rule.date);
  if (!registrationDate || !parseDate(registrationDate)) return null;
  const date = new Date(`${registrationDate}T00:00:00Z`);
  if (rule.type === 'REGISTRATION_DAYS') date.setUTCDate(date.getUTCDate() + rule.days);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + rule.months);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  }
  return date.toISOString().slice(0, 10);
}

export function formatDate(value: string | null): string {
  return value ? value.split('-').reverse().join('.') : 'Нужно уточнить';
}
