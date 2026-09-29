import { z } from 'zod';
import { ProfileFieldSchema, ProfileSchema } from '../domain/business/profile.js';
import { MarketSchema } from '../graph/state.js';
export const AgentResultSchema = z.strictObject({
  message: z.string().max(800), profilePatch: ProfileSchema,
  missingFields: z.array(ProfileFieldSchema).max(30), stageComplete: z.boolean(),
  warnings: z.array(z.string().max(200)).max(5),
  marketAnalysis: MarketSchema.nullable(),
  explanationKeys: z.array(z.enum(['expenses_include_payroll', 'regional_rates', 'incomplete_calculation', 'source_required', 'preliminary_plan'])).max(5),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
