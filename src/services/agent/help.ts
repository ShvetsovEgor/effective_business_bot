import { registrationRules } from '../../data/llc-registration.js';
import { afterRegistrationRules } from '../../data/llc-after-registration.js';
import { taxRules } from '../../data/tax-rules-2026.js';
import { SOURCES } from '../../data/sources.js';
import type { Screen } from '../../bot/messages/types.js';
import { documentScreen } from '../document-catalog.js';
import type { BusinessProfile } from '../../domain/business/profile.js';

const aliases:Record<string,string[]>={
 'reg-1':['учредител','участник'], 'reg-2':['назван'], 'reg-3':['адрес'], 'reg-4':['оквэд','оквед'], 'reg-5':['устав'], 'reg-6':['решени','протокол'], 'reg-8':['р11001','p11001','пакет документ'], 'reg-9':['подат','подач'], 'reg-10':['выписк','егрюл'],
 bank:['счет','банк'],capital:['капитал'],books:['бухгалтер','бухучет'],signature:['подпис','эцп','эдо'],cabinet:['кабинет фнс'],privacy:['персональн','роскомнадзор','ркн'],kkt:['касс','ккт'],efs:['ефс'],military:['воинск'],hr:['кадров','сотрудник'],
};
export function isHelpRequest(text:string):boolean {
 const t=text.trim().toLowerCase().replaceAll('ё','е').replace(/^(?:а |и |еще |пожалуйста,? )+/,'');
 return t.includes('?')|| /^(как |где |когда |почему |зачем |сколько |что такое |что нужно |расскажи|покажи|найди|объясни|подскажи|помоги|пришли|отправь|скача|подробнее|поясни|меня интересует|интересует |нужен |нужна |нужны |нужно найти |хочу узнать )/u.test(t)
   ||['документы','шаблоны','налоги','задачи','выполненные задачи','капитал','ккт','оквэд','оквед','устав','ефс-1','банк','расчетный счет','р11001','привет','здравствуйте'].includes(t);
}
export function helpScreen(text:string,p:BusinessProfile):Screen {
 const t=text.toLowerCase().replaceAll('ё','е');
 const back={text:'Вернуться к маршруту',action:'resume'};
 if(/шаблон|бланк|образец|скача|документ/.test(t))return documentScreen(/11001/.test(t)?'r11001':/устав/.test(t)?'charter':/протокол/.test(t)?'founders-minutes':/решени/.test(t)?'founder-decision':undefined);
 if(/выполненн|завершенн/.test(t))return {text:'Выполненные задачи сохранены в отдельном разделе.',buttons:[{text:'Выполненные задачи',action:'completed:0'},back]};
 if(/задач/.test(t))return {text:'Можно открыть активные задачи или историю выполненных.',buttons:[{text:'Активные задачи',action:'all:0'},{text:'Выполненные задачи',action:'completed:0'},back]};
 if(/налог|усн|аусн|осно|ндс/.test(t)){
   const regimes=taxRules.filter(r=>t.includes(r.id.startsWith('ausn')?'аусн':r.id.startsWith('usn')?'усн':'осно'));
   return {text:'Налоговые суммы считаются по вашим данным, а применимость — по правилам. Откройте калькулятор или официальный источник. Для вопроса вне этих правил нужен отдельный разбор.',buttons:[{text:'Открыть калькулятор',action:'tax'},...(regimes.length?regimes.slice(0,2).map(r=>({text:r.name,url:r.source_url})):[{text:'УСН — ФНС',url:SOURCES.usn},{text:'АУСН — ФНС',url:SOURCES.ausn}]),back]};
 }
 const all=[...registrationRules,...afterRegistrationRules({name:'',registration_date:'',region:p.region??'',tax_regime:p.taxRegime??'unknown',employees:1,director:true,personal_data:true,cash_register:true,personnel_event:true})];
 const matches=all.filter(rule=>aliases[rule.id]?.some(word=>t.includes(word)));
 if(matches.length===1){const r=matches[0]!;return {text:`${r.title}\n\n${r.description}\n${r.why_it_matters}\nЭто справка: наличие темы не означает, что обязанность применима к вашей компании.`,buttons:[{text:'Официальный источник',url:r.source_url},back]};}
 if(matches.length>1)return {text:'Нашёл несколько связанных тем. Уточните, какая нужна.',buttons:matches.slice(0,5).map(r=>({text:r.title,action:`help:${r.id}`})).concat([back])};
 return {text:'Для этого вопроса у меня пока нет проверенного ответа в базе. Можно уточнить тему: например, «Как внести уставный капитал?» или «Нужен шаблон решения». Текущий этап сохранён.',buttons:[{text:'Документы',action:'documents'},{text:'Активные задачи',action:'all:0'},back]};
}
export const helpForId=(id:string,p:BusinessProfile)=>helpScreen(`Расскажи ${aliases[id]?.[0]??id}`,p);
