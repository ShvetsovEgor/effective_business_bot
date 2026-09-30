import type { Repository } from '../../db/repository.js';
import type { Screen } from '../../bot/messages/types.js';

export function taskList(repo:Repository,thread:string,page:number,archive=false):Screen {
  const tasks=repo.tasks(thread,archive).filter(t=>archive?t.status==='DONE':t.status==='TODO'||t.status==='IN_PROGRESS');
  const prefix=archive?'completed':'all';
  const index=Math.max(0,Math.min(page,Math.max(0,Math.ceil(tasks.length/5)-1)));
  return {text:`${archive?'Выполненные задачи':'Все активные задачи'} · ${tasks.length}\n${tasks.length?`Страница ${index+1}`:'Здесь пока пусто.'}`,
    buttons:[...tasks.slice(index*5,index*5+5).map(t=>({text:t.title,action:`task:${t.id}`})),
      ...(index>0?[{text:'Назад',action:`${prefix}:${index-1}`}]:[]),...((index+1)*5<tasks.length?[{text:'Далее',action:`${prefix}:${index+1}`}]:[]),
      {text:archive?'Активные задачи':'Выполненные задачи',action:archive?'all:0':'completed:0'},
      {text:'Вернуться к маршруту',action:'resume'},{text:'Меню',action:'menu'}]};
}
