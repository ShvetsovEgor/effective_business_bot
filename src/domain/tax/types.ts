import type { Source } from '../checklist/types.js';
export type TaxId = 'usn-income' | 'usn-profit' | 'ausn-income' | 'ausn-profit' | 'osno';
export interface TransitionRule extends Source {
  from: 'new'; days: number; instructions: string;
}
export interface TaxRule extends Source {
  id: TaxId; name: string; year: number;
  eligibility: { maxIncome?: number; maxEmployees?: number; maxAssets?: number; regional: boolean };
  calculation: { rate: number; minimum: number; deductionLimit: number; injury: number };
  transitions: TransitionRule[]; official_sources: string[];
}
export interface TaxInput {
  region: string; income: number; expenses: number; payroll: number;
  employees: number; assets: number; contributions: number | null;
  simpleVat: boolean; confirmedUsn: boolean; confirmedAusn: boolean;
}
export interface Eligibility { available: boolean; confirmed: boolean; reasons: string[] }
export interface TaxResult {
  id: TaxId; name: string; eligibility: Eligibility;
  tax: number; contributions: number | null; total: number;
  complete: boolean; formula: string; warnings: string[]; source_url: string;
}
