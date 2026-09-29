import { Annotation, Command, interrupt, START, StateGraph } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { InputSchema, stages, type WorkflowState } from './state.js';
import type { Workflow } from '../services/agent/workflow.js';

const GraphState=Annotation.Root({data:Annotation<WorkflowState>({reducer:(_old,next)=>next})});
export function createBusinessGraph(workflow:Workflow,checkpointPath:string) {
  const saver=SqliteSaver.fromConnString(checkpointPath);
  saver.db.pragma('busy_timeout = 5000');
  const builder=new StateGraph(GraphState)
    .addNode('ROUTE',s=>({data:s.data}))
    .addNode('WAIT',s=>({data:{...s.data,event:InputSchema.parse(interrupt(s.data.screen))}}))
    .addNode('APPLY',async s=>({data:await workflow.apply(s.data,s.data.event!)}))
    .addNode('NICHE',async s=>({data:await workflow.render(s.data)}))
    .addNode('MARKET_ANALYSIS',async s=>({data:await workflow.render(s.data)}))
    .addNode('LEGAL_FORM',async s=>({data:await workflow.render(s.data)}))
    .addNode('TAX_REGIME',async s=>({data:await workflow.render(s.data)}))
    .addNode('BUSINESS_PLAN',async s=>({data:await workflow.render(s.data)}))
    .addNode('REGISTRATION',async s=>({data:await workflow.render(s.data)}))
    .addNode('BANK_ACCOUNT',async s=>({data:await workflow.render(s.data)}))
    .addNode('POST_REGISTRATION',async s=>({data:await workflow.render(s.data)}))
    .addNode('DASHBOARD',async s=>({data:await workflow.render(s.data)}));
  const routes=Object.fromEntries(stages.map(stage=>[stage,stage]));
  builder.addEdge(START,'ROUTE').addConditionalEdges('ROUTE',s=>s.data.currentStage,routes);
  for(const stage of stages) builder.addEdge(stage,'WAIT');
  builder.addEdge('WAIT','APPLY').addEdge('APPLY','ROUTE');
  return {graph:builder.compile({checkpointer:saver}),saver};
}
export { Command };
