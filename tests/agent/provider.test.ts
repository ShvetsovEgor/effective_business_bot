import { beforeEach, expect, it, vi } from 'vitest';
const {create}=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('../../src/ai/yandex-client.js',()=>({getYandexClient:()=>({responses:{create}}),modelUri:()=> 'gpt://test/model'}));
import { YandexAgent, type AgentInput } from '../../src/ai/agent.js';
import { directAnswer } from '../../src/services/agent/questions.js';
const input:AgentInput={threadId:'test',stage:'TAX_REGIME',profile:{},stageContext:{},userMessage:'Доход 8 млн',missingFields:['expectedAnnualRevenue']};
const response={output_text:JSON.stringify({profilePatch:{expectedAnnualRevenue:8000000},explanationKeys:[]}),usage:{input_tokens:10,output_tokens:10}};
beforeEach(()=>{create.mockReset();});
it('requests compact output without reasoning and enforces bounded network time',async()=>{
 create.mockResolvedValue(response);
 const r=await new YandexAgent(()=>undefined).run(input);
 expect(r.result?.profilePatch.expectedAnnualRevenue).toBe(8000000);
 expect(create.mock.calls[0]?.[0]).toMatchObject({reasoning:{effort:'none'},max_output_tokens:800,store:false});
 expect(create.mock.calls[0]?.[1]).toMatchObject({timeout:10000});expect(create.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
});
it('rejects extra model fields without retrying malformed answers',async()=>{
 create.mockResolvedValue({output_text:JSON.stringify({profilePatch:{magicTaxRate:1},explanationKeys:[]})});
 expect((await new YandexAgent(()=>undefined).run(input)).unavailable).toBe(true);expect(create).toHaveBeenCalledTimes(1);
});
it('transient errors have at most two attempts',async()=>{
 create.mockRejectedValue({status:503});
 expect((await new YandexAgent(()=>undefined).run(input)).unavailable).toBe(true);expect(create).toHaveBeenCalledTimes(2);
});
it('unambiguous typed fields never need model interpretation',()=>{
 expect(directAnswer('expectedAnnualRevenue','8 млн')).toEqual({expectedAnnualRevenue:8000000});
 expect(directAnswer('annualPayroll','150 тыс.')).toEqual({annualPayroll:150000});
 expect(directAnswer('legalForm','ООО')).toEqual({legalForm:'LLC'});
 expect(directAnswer('directorEmployed','да')).toEqual({directorEmployed:true});
 expect(directAnswer('contributions','не знаю')).toEqual({contributions:null});
 expect(()=>directAnswer('expectedAnnualRevenue','8 миллионов, расходы 5 миллионов')).toThrow();
});
