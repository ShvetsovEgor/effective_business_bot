import { z } from 'zod';
import { ProfileSchema, ProfileFieldSchema } from '../domain/business/profile.js';

export const stages = ['NICHE', 'MARKET_ANALYSIS', 'LEGAL_FORM', 'BUSINESS_PLAN', 'TAX_REGIME', 'REGISTRATION', 'POST_REGISTRATION', 'DASHBOARD', 'BANK_ACCOUNT'] as const;
export const StageSchema = z.enum(stages);
export type Stage = z.infer<typeof StageSchema>;
export const InputSchema = z.strictObject({ id: z.string(), text: z.string().max(4000).optional(), action: z.string().max(200).optional() });
export type GraphInput = z.infer<typeof InputSchema>;
export const MarketSchema = z.strictObject({
  customers: z.array(z.string().max(200)).max(3), competitors: z.array(z.string().max(200)).max(3),
  channels: z.array(z.string().max(200)).max(3), risks: z.array(z.string().max(200)).max(3),
  checks: z.array(z.string().max(200)).max(3),
});
export type MarketAnalysis = z.infer<typeof MarketSchema>;
const TaxResultSchema=z.strictObject({id:z.enum(['usn-income','usn-profit','ausn-income','ausn-profit','osno']),name:z.string(),eligibility:z.strictObject({available:z.boolean(),confirmed:z.boolean(),reasons:z.array(z.string())}),tax:z.number().finite(),contributions:z.number().finite().nullable(),total:z.number().finite(),complete:z.boolean(),formula:z.string(),warnings:z.array(z.string()),source_url:z.string().url()});
const ScreenSchema=z.strictObject({text:z.string(),buttons:z.array(z.union([z.strictObject({text:z.string(),action:z.string()}),z.strictObject({text:z.string(),url:z.string().url()})])),documentId:z.string().optional()});
export const StateSchema = z.strictObject({
  userId: z.string(), chatId: z.string(), threadId: z.string(), currentStage: StageSchema,
  completedStages: z.array(StageSchema), profileVersion: z.number().int(),
  pendingQuestion: ProfileFieldSchema.nullable(), pendingChange: ProfileSchema.nullable(),
  editing: z.boolean(), detail: z.string().nullable(), notice: z.string(),
  resumeStage: StageSchema.optional(), helpScreen: ScreenSchema.optional(),
  marketAnalysis: MarketSchema.nullable(),
  taxAnalysis: z.array(TaxResultSchema).nullable(),
  businessPlan: z.strictObject({ revenue: z.number(), expenses: z.number(), payroll: z.number(), taxes: z.number().nullable(), profit: z.number().nullable(), complete: z.boolean() }).nullable(),
  screen: ScreenSchema, event: InputSchema.nullable(), lastEventId: z.string().nullable(), lastUpdatedAt: z.string(),
});
export type WorkflowState = z.infer<typeof StateSchema>;
export function initialState(userId: string, chatId: string): WorkflowState {
  return { userId, chatId, threadId: `max:${chatId}:${userId}`, currentStage: 'NICHE',
    completedStages: [], profileVersion: 0, pendingQuestion: null, pendingChange: null,
    editing: false, detail: null, notice: '', marketAnalysis: null, taxAnalysis: null,
    businessPlan: null, screen: { text: '', buttons: [] }, event: null, lastEventId: null, lastUpdatedAt: new Date().toISOString() };
}
