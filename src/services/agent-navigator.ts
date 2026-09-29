import { randomUUID } from 'node:crypto';
import type { Repository } from '../db/repository.js';
import type { Event, Screen } from '../bot/messages/types.js';
import { YandexAgent, type Agent } from '../ai/agent.js';
import { initialState, StateSchema, type WorkflowState } from '../graph/state.js';
import { createBusinessGraph, Command } from '../graph/business-graph.js';
import { Workflow } from './agent/workflow.js';
import { BusinessMemory } from './agent/memory.js';

export class AgentNavigator {
  readonly memory:BusinessMemory;
  private readonly runtime:ReturnType<typeof createBusinessGraph>;
  constructor(readonly repo:Repository,checkpointPath:string,agent:Agent=new YandexAgent()) {
    this.memory=new BusinessMemory(repo);
    this.runtime=createBusinessGraph(new Workflow(this.memory,agent),checkpointPath);
  }
  close(){this.runtime.saver.db.close();}
  async state(user:string,chat=user):Promise<WorkflowState|null> {
    const snapshot=await this.runtime.graph.getState({configurable:{thread_id:`max:${chat}:${user}`}});
    return snapshot.values.data?StateSchema.parse(snapshot.values.data):null;
  }
  async handle(user:string,event:Event,eventId:string=randomUUID(),chat=user):Promise<Screen> {
    const thread=`max:${chat}:${user}`,config={configurable:{thread_id:thread}};
    this.memory.seed(thread,user);
    let snapshot=await this.runtime.graph.getState(config);
    if(snapshot.values.data&&snapshot.next.length&&!snapshot.tasks.some(t=>t.interrupts?.length)) {
      await this.runtime.graph.invoke(null,config);snapshot=await this.runtime.graph.getState(config);
    }
    let s=snapshot.values.data as WorkflowState|undefined;
    if(!s) {
      const initial=initialState(user,chat);
      if(this.memory.read(thread).profile.registrationStatus==='REGISTERED') initial.currentStage='POST_REGISTRATION';
      await this.runtime.graph.invoke({data:initial},config);
      s=(await this.runtime.graph.getState(config)).values.data as WorkflowState;
      if(event.type==='command'&&event.command==='start')return s.screen;
    }
    if(s.lastEventId===eventId||this.memory.operation(thread,eventId))return s.screen;
    let action:string|undefined;
    if(event.type==='callback') {
      if(!s.screen.buttons.some(b=>'action'in b&&b.action===event.payload))return s.screen;
      action=event.payload.slice(event.payload.indexOf('|')+1);
    } else if(event.type==='command') {
      if(event.command==='start')return s.screen;
      action=event.command==='reset'?'reset':'menu';
    }
    if(action==='reset-confirm'&&s.detail==='reset') {
      await this.runtime.saver.deleteThread(thread);this.memory.reset(thread);
      // Erase legacy facts as well, so a later restart cannot reimport deleted data.
      this.repo.reset(user);
      this.memory.save(thread,{});
      await this.runtime.graph.invoke({data:initialState(user,chat)},config);
    } else await this.runtime.graph.invoke(new Command({resume:{id:eventId,...(action?{action}:{}),...(event.type==='text'?{text:event.text.slice(0,4000)}:{})}}),config);
    return ((await this.runtime.graph.getState(config)).values.data as WorkflowState).screen;
  }
}
