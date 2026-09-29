import type { Screen } from './types.js';

/** One message, no overlapping edits. Drain the last edit before sending the final answer. */
export async function withProgress<T>(work:()=>Promise<T>,show:(screen:Screen)=>Promise<void>,timing={initial:700,interval:2000}):Promise<T> {
  let stopped=false,frame=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let pending:Promise<void>=Promise.resolve();
  const frames=['◐','◓','◑','◒'];
  const tick=()=>{
    if(stopped)return;
    pending=show({text:`${frames[frame++ % frames.length]} Готовлю ответ${'.'.repeat(frame%3+1)}`,buttons:[]})
      .catch(()=>undefined).then(()=>{if(!stopped)timer=setTimeout(tick,timing.interval);});
  };
  timer=setTimeout(tick,timing.initial);
  try{return await work();}
  finally{stopped=true;clearTimeout(timer);await pending;}
}
