import type { Task } from './types.js';
export const isPending = (t: Task) => t.status === 'TODO' || t.status === 'IN_PROGRESS';
export function prioritize(tasks: Task[], today: string) {
  const week = new Date(`${today}T00:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  const end = week.toISOString().slice(0, 10);
  const pending = tasks.filter(isPending).sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  return {
    now: pending.filter(t => (t.deadline !== null && t.deadline <= today) || t.status === 'IN_PROGRESS'),
    soon: pending.filter(t => t.deadline !== null && t.deadline > today && t.deadline <= end && t.status !== 'IN_PROGRESS'),
    next: pending[0], pending,
  };
}
