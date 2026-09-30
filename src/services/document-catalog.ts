import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { documents } from '../data/documents.js';
import type { Screen } from '../bot/messages/types.js';

export function documentPath(id:string,root=process.env.DOCUMENTS_PATH??'./data/templates'):string|null {
  const doc=documents.find(d=>d.id===id);if(!doc)return null;
  const candidate=resolve(root,doc.fileName);if(!existsSync(candidate))return null;
  const base=realpathSync(root),path=realpathSync(candidate),inside=relative(base,path);
  if(inside.startsWith('..')||isAbsolute(inside))return null;
  const stat=statSync(path);return stat.isFile()&&stat.size>0&&stat.size<=20*1024*1024?path:null;
}
export function documentScreen(id?:string):Screen {
  const doc=documents.find(d=>d.id===id);
  if(!doc)return {text:'Документы для регистрации ООО. Выберите документ: покажу официальный сервис и отправлю файл, если проверенный шаблон загружен.',buttons:[...documents.map(d=>({text:d.title,action:`document:${d.id}`})),{text:'Вернуться к маршруту',action:'resume'}]};
  return {text:`${doc.title}\n\n${doc.description}\n${documentPath(doc.id)?'Шаблон доступен для скачивания.':'Файл шаблона ещё не загружен. Пока доступен официальный источник.'}`,buttons:[...(documentPath(doc.id)?[{text:'Получить файл',action:`download:${doc.id}`}]:[]),{text:'Официальный источник',url:doc.source_url},{text:'Все документы',action:'documents'},{text:'Вернуться к маршруту',action:'resume'}]};
}
