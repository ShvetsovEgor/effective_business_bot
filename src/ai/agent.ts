import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentResultSchema, type AgentResult } from './schemas.js';
import { AGENT_INSTRUCTIONS } from './prompts.js';
import { getYandexClient, modelUri } from './yandex-client.js';
import type { BusinessProfile, ProfileField } from '../domain/business/profile.js';
import type { Stage } from '../graph/state.js';

export interface AgentInput { threadId: string; stage: Stage; profile: BusinessProfile; stageContext: unknown;
  userMessage: string; missingFields: ProfileField[]; deterministicResults?: unknown }
export interface AgentReply { result: AgentResult | null; unavailable: boolean }
export interface Agent { run(input: AgentInput): Promise<AgentReply> }
export interface Metrics { thread_id: string; stage: Stage; duration_ms: number; input_tokens?: number; output_tokens?: number; error?: 'unavailable' | 'validation' | 'provider' }
export const logMetric = (metric: Metrics) => console.log(JSON.stringify(metric));

export class YandexAgent implements Agent {
  constructor(private readonly log: (m: Metrics) => void = logMetric) {}
  async run(input: AgentInput): Promise<AgentReply> {
    const started = Date.now();
    const metric = (extra: Partial<Metrics>) => this.log({ thread_id: input.threadId, stage: input.stage, duration_ms: Date.now() - started, ...extra });
    const client = getYandexClient();
    if (!client) { metric({ error: 'unavailable' }); return { result: null, unavailable: true }; }
    const schema = z.toJSONSchema(AgentResultSchema) as Record<string, unknown>;
    let jsonFallback = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.responses.create({
          model: modelUri(), instructions: AGENT_INSTRUCTIONS,
          input: JSON.stringify({ CURRENT_STAGE: input.stage, BUSINESS_PROFILE: input.profile,
            STAGE_DATA: input.stageContext, LAST_USER_MESSAGE: input.userMessage.slice(0, 4000),
            MISSING_FIELDS: input.missingFields, DETERMINISTIC_RESULTS: input.deterministicResults,
            ...(jsonFallback ? { OUTPUT_JSON_SCHEMA: schema } : {}) }),
          text: { format: jsonFallback ? { type: 'json_object' } : { type: 'json_schema', name: 'business_agent', schema, strict: false } },
          temperature: 0.2, max_output_tokens: 2000, store: false,
        });
        const parsed = AgentResultSchema.safeParse(JSON.parse(response.output_text));
        if (!parsed.success) { metric({ error: 'validation' }); return { result: null, unavailable: true }; }
        metric({ input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens });
        return { result: parsed.data, unavailable: false };
      } catch (error) {
        const status = (typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0) || 0;
        if (status === 400 && !jsonFallback) { jsonFallback = true; continue; }
        if (error instanceof SyntaxError) { metric({ error: 'validation' }); break; }
        if (attempt < 2 && (status === 0 || status === 429 || status >= 500)) { await delay(300 * 2 ** attempt); continue; }
        metric({ error: 'provider' }); break;
      }
    }
    return { result: null, unavailable: true };
  }
}

// For sensitive stages the model selects reviewed explanations; its prose never replaces facts.
export const explanations: Record<AgentResult['explanationKeys'][number], string> = {
  expenses_include_payroll: 'ФОТ уже входит в расходы и повторно не вычитается.',
  regional_rates: 'Расчёт по базовым ставкам; региональные льготы не учтены.',
  incomplete_calculation: 'Неполные оценки нельзя считать точным сравнением режимов.',
  source_required: 'Для этого вопроса у меня пока нет проверенного правила в базе.',
  preliminary_plan: 'Это предварительный план по вашим оценкам, не гарантия прибыли.',
};
