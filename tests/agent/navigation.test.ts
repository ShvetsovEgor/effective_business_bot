import { expect, it } from 'vitest';
import { Repository } from '../../src/db/repository.js';
import { AgentNavigator } from '../../src/services/agent-navigator.js';
import type { Screen } from '../../src/bot/messages/types.js';
import { registrationRules } from '../../src/data/llc-registration.js';
import { taskList } from '../../src/services/agent/task-screens.js';
import { stages } from '../../src/graph/state.js';
import { initialState } from '../../src/graph/state.js';
import { Workflow } from '../../src/services/agent/workflow.js';
import { BusinessMemory } from '../../src/services/agent/memory.js';
const offline={run:async()=>({result:null,unavailable:true})};
const click=(s:Screen,action:string)=>{const b=s.buttons.find(b=>'action'in b&&b.action.endsWith('|'+action));if(!b||!('action'in b))throw new Error(`Missing ${action}`);return {type:'callback' as const,payload:b.action};};
it('active list excludes completed tasks, archive survives inactive rules and dates persist',()=>{
 const repo=new Repository(':memory:');try{
 repo.ensureUser('x');repo.syncTasks('x',registrationRules);repo.setStatus('x','reg-1','DONE');
 expect(taskList(repo,'x',0).buttons.some(b=>'action'in b&&b.action==='task:reg-1')).toBe(false);
 repo.db.prepare("UPDATE tasks SET active=0 WHERE user_id='x' AND id='reg-1'").run();
 expect(taskList(repo,'x',0,true).buttons.some(b=>'action'in b&&b.action==='task:reg-1')).toBe(true);
 expect(repo.tasks('x',true).find(t=>t.id==='reg-1')?.completion_date).toBeTruthy();
 }finally{repo.close();}
});
it('a question from any stage opens help without overwriting facts or stage',async()=>{
 const repo=new Repository(':memory:');const memory=new BusinessMemory(repo);memory.seed('max:1:1','1');
 const flow=new Workflow(memory,offline);try{
 for(const stage of stages){
   const s={...initialState('1','1'),currentStage:stage,pendingQuestion:'businessIdea' as const};
   const answered=await flow.apply(s,{id:stage,text:'Как выбрать ОКВЭД?'});
   expect(answered.currentStage).toBe(stage);expect(answered.helpScreen?.text).toContain('ОКВЭД');expect(memory.read(s.threadId).profile).toEqual({});
   const resumed=await flow.apply(answered,{id:stage+'back',action:'resume'});
   expect(resumed.currentStage).toBe(stage);expect(resumed.pendingQuestion).toBe('businessIdea');
 }
 }finally{repo.close();}
});
it('help inside a tax excursion returns to tax, menu resume returns to original route',async()=>{
 const repo=new Repository(':memory:');const nav=new AgentNavigator(repo,':memory:',offline);try{
 let s=await nav.handle('1',{type:'command',command:'menu'},'1');s=await nav.handle('1',click(s,'tax'),'2');
 expect((await nav.state('1'))?.currentStage).toBe('TAX_REGIME');
 s=await nav.handle('1',{type:'text',text:'Нужен шаблон Р11001'},'3');expect(s.text).toContain('Р11001');
 s=await nav.handle('1',click(s,'resume'),'4');expect((await nav.state('1'))?.currentStage).toBe('TAX_REGIME');
 s=await nav.handle('1',{type:'command',command:'menu'},'5');await nav.handle('1',click(s,'resume'),'6');
 expect((await nav.state('1'))?.currentStage).toBe('NICHE');
 }finally{nav.close();repo.close();}
});
