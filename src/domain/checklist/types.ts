import type { DeadlineRule } from '../deadlines/index.js';

export type Status = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'NOT_APPLICABLE';
export interface Source { source_url: string; verified_at: string }
export interface TaskRule extends Source {
  id: string;
  title: string;
  description: string;
  why_it_matters: string;
  deadline_rule: DeadlineRule;
  group: 'registration' | 'after' | 'hr' | 'transition';
}
export interface Task extends TaskRule {
  status: Status;
  deadline: string | null;
  deadline_type: DeadlineRule['type'];
  official_source_url: string;
  completion_date: string | null;
}
export interface BusinessProfile {
  name: string;
  registration_date: string;
  region: string;
  tax_regime: string;
  employees: number;
  director: boolean;
  personal_data: boolean;
  cash_register: boolean;
  personnel_event: boolean;
}
