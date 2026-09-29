import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from '../../src/db/repository.js';
import { AgentNavigator } from '../../src/services/agent-navigator.js';
import type { Agent } from '../../src/ai/agent.js';
import { AgentResultSchema } from '../../src/ai/schemas.js';
import type { Screen } from '../../src/bot/messages/types.js';
import { calculate } from '../../src/domain/tax/calculators.js';
import { taxInput } from '../../src/services/agent/derived.js';
const dirs:string[]=[];
const offline:Agent={run:async()=>({result:null,unavailable:true})};
function setup(agent=offline){const dir=mkdtempSync(join(tmpdir(),'max-agent-'));dirs.push(dir);const repo=new Repository(join(dir,'data.sqlite'));const navigator=new AgentNavigator(repo,join(dir,'check.sqlite'),agent);return {dir,repo,navigator};}
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function action(screen:Screen,value:string){const b=screen.buttons.find(b=>'action'in b&&b.action.endsWith('|'+value));if(!b||!('action'in b))throw new Error(`Missing action ${value}: ${screen.text}`);return {type:'callback' as const,payload:b.action};}
const full={legalForm:'LLC' as const,region:'16',expectedAnnualRevenue:7000000,expectedAnnualExpenses:4000000,annualPayroll:1000000,employeesCount:3,fixedAssetsValue:0,contributions:0,simpleVat:true,confirmedUsn:true,confirmedAusn:true};
it('known region is not asked; real SQLite checkpoints resume TAX_REGIME after restart',async()=>{
 const {dir,repo,navigator}=setup();navigator.memory.seed('max:1:1','1');navigator.memory.save('max:1:1',{legalForm:'LLC',region:'16'});
 let screen=await navigator.handle('1',{type:'command',command:'menu'},'1');screen=await navigator.handle('1',action(screen,'tax'),'2');expect(screen.text).toContain('доход');expect((await navigator.state('1'))?.pendingQuestion).toBe('expectedAnnualRevenue');navigator.close();repo.close();
 const reopened=new Repository(join(dir,'data.sqlite'));const restarted=new AgentNavigator(reopened,join(dir,'check.sqlite'),offline);
 try{expect((await restarted.state('1'))?.currentStage).toBe('TAX_REGIME');expect((await restarted.handle('1',{type:'command',command:'start'},'3')).text).toContain('доход');}finally{restarted.close();reopened.close();}
});
it('validated extraction is confirmed, saved, and invalidates/recomputes eligibility',async()=>{
 const fake:Agent={run:async()=>({unavailable:false,result:{message:'Налог якобы 1',profilePatch:{employeesCount:6},missingFields:[],stageComplete:true,warnings:[],marketAnalysis:null,explanationKeys:[]}})};
 const {repo,navigator}=setup(fake);try{
 navigator.memory.seed('max:1:1','1');navigator.memory.save('max:1:1',{...full,taxRegime:'ausn-income'});
 let screen=await navigator.handle('1',{type:'text',text:'Теперь 6 сотрудников'},'1');expect(navigator.memory.read('max:1:1').profile.employeesCount).toBe(3);
 screen=await navigator.handle('1',action(screen,'confirm-change'),'2');expect(navigator.memory.read('max:1:1').profile.employeesCount).toBe(6);
 const state=await navigator.state('1');expect(state?.taxAnalysis?.find(r=>r.id==='ausn-income')?.eligibility.available).toBe(false);expect(state?.taxAnalysis?.find(r=>r.id==='usn-income')?.tax).toBe(420000);expect(state?.currentStage).toBe('TAX_REGIME');expect(screen.text).not.toContain('Налог якобы');
 }finally{navigator.close();repo.close();}
});
it('unknown model keys are rejected and deterministic 420000 is immutable',()=>{
 expect(AgentResultSchema.safeParse({message:'',profilePatch:{magicTaxRate:0},missingFields:[],stageComplete:false,warnings:[],marketAnalysis:null,explanationKeys:[]}).success).toBe(false);
 expect(calculate(taxInput(full)!)[0]?.tax).toBe(420000);
});
it('AI unavailable: calculator and buttons work, duplicate task callback is harmless',async()=>{
 const {repo,navigator}=setup();try{
 navigator.memory.seed('max:1:1','1');navigator.memory.save('max:1:1',full);
 let screen=await navigator.handle('1',{type:'command',command:'menu'},'1');screen=await navigator.handle('1',action(screen,'tax'),'2');expect(screen.text).toContain('420');
 screen=await navigator.handle('1',action(screen,'choose:usn-income'),'3');screen=await navigator.handle('1',action(screen,'continue'),'4');
 const done=action(screen,'done:reg-1');screen=await navigator.handle('1',done,'5');expect(screen.text).toContain('Шаг 2');
 expect((await navigator.handle('1',done,'6')).text).toContain('Шаг 2');expect((await navigator.handle('1',done,'5')).text).toContain('Шаг 2');
 expect(repo.tasks('max:1:1').filter(t=>t.status==='DONE')).toHaveLength(1);expect(repo.tasks('max:1:1')).toHaveLength(10);
 }finally{navigator.close();repo.close();}
});
it('direct valid number 3 persists without the model, user threads stay isolated',async()=>{
 const {repo,navigator}=setup();try{
 navigator.memory.seed('max:1:1','1');navigator.memory.save('max:1:1',{...full,employeesCount:undefined});
 let screen=await navigator.handle('1',{type:'command',command:'menu'},'1');screen=await navigator.handle('1',action(screen,'tax'),'2');expect(screen.text).toContain('Количество сотрудников');
 await navigator.handle('1',{type:'text',text:'3'},'3');expect(navigator.memory.read('max:1:1').profile.employeesCount).toBe(3);expect(navigator.memory.read('max:2:1').profile).toEqual({});
 }finally{navigator.close();repo.close();}
});
it('model employeesCount=3 saves only after confirmation; model cannot change a stage',async()=>{
 const fake:Agent={run:async()=>({unavailable:false,result:{message:'Перейдите сразу в конец',profilePatch:{employeesCount:3},missingFields:[],stageComplete:true,warnings:[],marketAnalysis:null,explanationKeys:[]}})};
 const {repo,navigator}=setup(fake);try{
 navigator.memory.seed('max:1:1','1');navigator.memory.save('max:1:1',{employeesCount:0});
 let screen=await navigator.handle('1',{type:'text',text:'Три сотрудника'},'1');screen=await navigator.handle('1',action(screen,'confirm-change'),'2');
 expect(navigator.memory.read('max:1:1').profile.employeesCount).toBe(3);expect((await navigator.state('1'))?.currentStage).toBe('NICHE');expect(screen.text).not.toContain('Перейдите сразу');
 }finally{navigator.close();repo.close();}
});
it('saves initial idea instantly, extracts additional facts with a single later analysis call',async()=>{
 let calls=0;
 const fake:Agent={run:async()=>{calls++;return {unavailable:false,result:{message:'',profilePatch:{region:'16',employeesCount:3,legalForm:'LLC'},missingFields:[],stageComplete:false,warnings:[],marketAnalysis:null,explanationKeys:[]}};}};
 const {repo,navigator}=setup(fake);try{
 let screen=await navigator.handle('1',{type:'text',text:'Мастерская в Татарстане, ООО, три сотрудника'},'1');
 expect(calls).toBe(0);expect(navigator.memory.read('max:1:1').profile.businessIdea).toContain('Мастерская');
 screen=await navigator.handle('1',action(screen,'continue'),'2');expect(calls).toBe(1);expect(screen.text).toContain('Сохранить');
 screen=await navigator.handle('1',action(screen,'confirm-change'),'3');expect(calls).toBe(1);
 screen=await navigator.handle('1',action(screen,'continue'),'4');screen=await navigator.handle('1',action(screen,'continue'),'5');
 expect((await navigator.state('1'))?.pendingQuestion).toBe('expectedAnnualRevenue');expect(calls).toBe(1);
 await navigator.handle('1',{type:'text',text:'8000000'},'6');expect(calls).toBe(1);
 }finally{navigator.close();repo.close();}
});
it('complete LLC demo, confirmed filing, personal tasks, reset and preserved typed facts',async()=>{
 const {repo,navigator}=setup();let id=0;
 try{
 let screen=await navigator.handle('1',{type:'command',command:'start'},String(++id));
 const click=async(value:string)=>{screen=await navigator.handle('1',action(screen,value),String(++id));};
 const say=async(text:string)=>{screen=await navigator.handle('1',{type:'text',text},String(++id));};
 await say('Мастерская мебели');await click('continue');expect(screen.text).toContain('Предварительный анализ');await click('continue');await click('answer:LLC');await click('continue');
 for(const value of ['16','7000000','4000000','1000000','3','0','0'])await say(value);
 for(let n=0;n<3;n++)await click('answer:yes');
 await click('choose:usn-income');expect(screen.text).toContain('2');await click('continue');
 for(let n=1;n<=8;n++)await click(`done:reg-${n}`);
 await click('done:reg-9');expect(screen.text).toContain('самостоятельно подали');await click('done:reg-9');await click('done:reg-10');
 await click('answer:no');await click('bank-opened');await say('Мебель');await say('31.01.2026');
 // Region, employees and tax regime were already supplied: they must be skipped.
 expect((await navigator.state('1'))?.pendingQuestion).toBe('directorEmployed');
 await click('answer:yes');await click('answer:yes');await click('answer:no');await click('answer:no');
 expect((await navigator.state('1'))?.currentStage).toBe('DASHBOARD');
 const tasks=repo.tasks('max:1:1');expect(tasks.find(t=>t.id==='capital')?.deadline).toBe('2026-05-31');expect(tasks.some(t=>t.id==='efs')).toBe(false);expect(tasks.some(t=>t.id==='privacy')).toBe(true);expect(tasks.some(t=>t.id==='military')).toBe(true);
 await click('all:0');expect(screen.text).toContain('Все задачи');
 screen=await navigator.handle('1',{type:'command',command:'reset'},String(++id));await click('reset-confirm');expect(navigator.memory.read('max:1:1').profile).toEqual({});expect(repo.tasks('max:1:1')).toHaveLength(0);expect((await navigator.state('1'))?.currentStage).toBe('NICHE');
 }finally{navigator.close();repo.close();}
});
