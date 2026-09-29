import { z } from 'zod';
import { parseDate, today } from '../deadlines/index.js';

const amount = z.number().finite().min(0).max(1e12);
const text = z.string().trim().min(1).max(2000);
export const ProfileSchema = z.strictObject({
  businessName: z.string().trim().min(1).max(80).optional(),
  businessIdea: text.optional(), businessDescription: text.optional(),
  region: z.string().regex(/^\d{2}$/).optional(),
  legalForm: z.enum(['IP', 'LLC', 'UNKNOWN']).optional(),
  registrationStatus: z.enum(['IDEA', 'PREPARING', 'REGISTERED']).optional(),
  registrationDate: z.string().optional(), taxRegistrationDate: z.string().optional(),
  foundersCount: z.number().int().min(1).max(50).optional(),
  employeesCount: z.number().int().min(0).max(100000).optional(),
  expectedAnnualRevenue: amount.optional(), expectedAnnualExpenses: amount.optional(),
  annualPayroll: amount.optional(), fixedAssetsValue: amount.optional(),
  contributions: amount.nullable().optional(),
  simpleVat: z.boolean().optional(), confirmedUsn: z.boolean().optional(), confirmedAusn: z.boolean().optional(),
  taxRegime: z.enum(['usn-income', 'usn-profit', 'ausn-income', 'ausn-profit', 'osno']).optional(),
  hasWebsite: z.boolean().optional(), processesPersonalData: z.boolean().optional(),
  acceptsPaymentsFromIndividuals: z.boolean().optional(), needsCashRegister: z.boolean().optional(),
  directorEmployed: z.boolean().optional(), personnelEvent: z.boolean().optional(),
  bankAccountOpened: z.boolean().optional(),
  okvedMain: z.string().max(20).optional(), okvedAdditional: z.array(z.string().max(20)).max(30).optional(),
});
export type BusinessProfile = z.infer<typeof ProfileSchema>;
export type ProfileField = keyof BusinessProfile;
export const ProfileFieldSchema = z.enum(Object.keys(ProfileSchema.shape) as [ProfileField, ...ProfileField[]]);
export function validateProfile(value: unknown): BusinessProfile {
  const p = ProfileSchema.parse(value);
  for(const date of [p.registrationDate,p.taxRegistrationDate]) if(date&&(parseDate(date)!==date||date>today()||date<'1990-01-01'))throw new Error('INVALID_REGISTRATION_DATE');
  if(p.region){const n=Number(p.region);if(!(n>=1&&n<=79||[83,86,87,89,90,91,92,93,94,95,99].includes(n)))throw new Error('INVALID_REGION');}
  if (p.annualPayroll !== undefined && p.expectedAnnualExpenses !== undefined && p.annualPayroll > p.expectedAnnualExpenses) throw new Error('PAYROLL_EXCEEDS_EXPENSES');
  if (p.directorEmployed && p.employeesCount === 0) throw new Error('DIRECTOR_IS_EMPLOYEE');
  return p;
}
export const hasField = (p: BusinessProfile, key: ProfileField) => p[key] !== undefined && p[key] !== 'UNKNOWN';
