import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentResultSchema, ExtractionSchema, IdeaAnalysisSchema, type AgentResult } from './schemas.js';
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
    const market=input.stageContext!==null&&typeof input.stageContext==='object'&&'mode'in input.stageContext&&input.stageContext.mode==='qualitative_market';
    const wireSchema=market?IdeaAnalysisSchema:ExtractionSchema;
    const schema = z.toJSONSchema(wireSchema) as Record<string, unknown>;
    const signal=AbortSignal.timeout(18000);
    let jsonFallback = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.responses.create({
          model: modelUri(), instructions: AGENT_INSTRUCTIONS+'\nВерни только поля JSON-схемы. Не повторяй заполненные структурированные поля в profilePatch. Если BUSINESS_PROFILE содержит businessIdea, это сохранённое сырое описание, а не извлечённые факты: обязательно заполни отсутствующие region, legalForm, employeesCount и финансовые поля, явно указанные в описании. Саму businessIdea не переписывай. Для анализа идеи — по одному короткому пункту в каждой категории.',
          input: JSON.stringify({ CURRENT_STAGE: input.stage, BUSINESS_PROFILE: input.profile,
            STAGE_DATA: input.stageContext, LAST_USER_MESSAGE: input.userMessage.slice(0, 4000),
            MISSING_FIELDS: input.missingFields, DETERMINISTIC_RESULTS: input.deterministicResults,
            ...(jsonFallback ? { OUTPUT_JSON_SCHEMA: schema } : {}) }),
          text: { format: jsonFallback ? { type: 'json_object' } : { type: 'json_schema', name: 'business_agent', schema, strict: false } },
          reasoning:{effort:'none'}, temperature: 0.2, max_output_tokens: market?1200:800, store: false,
        },{signal,timeout:10000});
        const wire=wireSchema.parse(JSON.parse(response.output_text));
        const parsed = AgentResultSchema.safeParse({message:'',missingFields:[],stageComplete:false,warnings:[],marketAnalysis:null,explanationKeys:[],...wire});
        if (!parsed.success) { metric({ error: 'validation' }); return { result: null, unavailable: true }; }
        metric({ input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens });
        return { result: parsed.data, unavailable: false };
      } catch (error) {
        const status = (typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0) || 0;
        if (status === 400 && !jsonFallback) { jsonFallback = true; continue; }
        if (error instanceof SyntaxError||error instanceof z.ZodError) { metric({ error: 'validation' }); break; }
        if (!signal.aborted&&attempt < 1 && (status === 0 || status === 429 || status >= 500)) { await delay(300 * 2 ** attempt); continue; }
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
