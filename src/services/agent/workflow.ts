import { randomUUID } from 'node:crypto';
import { explanations, type Agent } from '../../ai/agent.js';
import { AgentResultSchema } from '../../ai/schemas.js';
import { ProfileFieldSchema, validateProfile, type BusinessProfile } from '../../domain/business/profile.js';
import { calculate, lowestComplete, money } from '../../domain/tax/calculators.js';
import { transition, transitionTask } from '../../domain/tax/transitions.js';
import type { TaxId } from '../../domain/tax/types.js';
import { registrationRules } from '../../data/llc-registration.js';
import { SOURCES } from '../../data/sources.js';
import { type WorkflowState, type GraphInput } from '../../graph/state.js';
import { nextStage } from '../../graph/routing.js';
import { taskList } from './task-screens.js';
import { helpScreen, helpForId, isHelpRequest } from './help.js';
import { documentScreen, documentPath } from '../document-catalog.js';
import { documents } from '../../data/documents.js';
import type { Button, Screen } from '../../bot/messages/types.js';
import { BusinessMemory } from './memory.js';
import { directAnswer, labels, missing, questions } from './questions.js';
import { invalidate, syncObligations, taxInput } from './derived.js';

const button=(text:string,action:string):Button=>({text,action});
const next=(s:WorkflowState,p:BusinessProfile):WorkflowState=>({...s,currentStage:nextStage(s.currentStage,p),completedStages:[...new Set([...s.completedStages,s.currentStage])],detail:null,pendingQuestion:null});
const fallbackMarket={customers:['Опишите, кто заплатит за решение и в какой ситуации.'],competitors:['Найдите местные альтернативы, включая самостоятельное решение задачи.'],channels:['Проверьте один канал привлечения на небольшом бюджете.'],risks:['Спрос и стоимость привлечения пока не подтверждены.'],checks:['Поговорите с потенциальными клиентами до крупных затрат.']};

export class Workflow {
  constructor(readonly memory:BusinessMemory,private readonly agent:Agent) {}
  async apply(original:WorkflowState,event:GraphInput):Promise<WorkflowState> {
    const cached=this.memory.operation(original.threadId,event.id); if(cached) return cached;
    let s:WorkflowState={...original,event:null,lastEventId:event.id,notice:'',lastUpdatedAt:new Date().toISOString()};
    const current=this.memory.read(s.threadId).profile;
    let patch:BusinessProfile|undefined;
    const action=event.action;
    const wasHelp=!!s.helpScreen;s.helpScreen=undefined;
    if(event.text&&isHelpRequest(event.text)){
      s.helpScreen=helpScreen(event.text,current);this.memory.record(s,event.id);return s;
    }
    const reviewedMarket=action==='confirm-change'&&s.detail==='market-facts'?s.marketAnalysis:null;
    if(action==='menu') s.detail='menu';
    else if(action==='premises') s.detail='premises';
    else if(action==='reset') s.detail='reset';
    else if(action==='cancel'||action==='resume') {
      if(!wasHelp||action==='cancel'){
        if(s.resumeStage){s.currentStage=s.resumeStage;s.resumeStage=undefined;}
        s.detail=null;s.pendingChange=null;s.editing=false;
      }
    }
    else if(action==='profile') s.detail='profile';
    else if(action==='edit') {s.editing=true;s.detail='edit';}
    else if(action?.startsWith('edit-page:')) {s.editing=true;s.detail=action;}
    else if(action?.startsWith('edit-field:')) {s.editing=true;s.detail=action;s.pendingQuestion=ProfileFieldSchema.parse(action.slice(11));}
    else if(action==='registered') {patch={legalForm:'LLC',registrationStatus:'REGISTERED'};s.currentStage='POST_REGISTRATION';s.detail=null;}
    else if(action==='tax'||action==='tasks') {s.resumeStage??=s.currentStage;s.currentStage=action==='tax'?'TAX_REGIME':'DASHBOARD';s.detail=null;}
    else if(action?.startsWith('all:')||action?.startsWith('completed:')) s.detail=action;
    else if(action==='help') s.helpScreen={text:'Напишите вопрос обычным текстом. Например: «Как выбрать ОКВЭД?» или «Нужен шаблон решения». Ваш этап сохранён.',buttons:[button('Вернуться к маршруту','resume')]};
    else if(action?.startsWith('help:')) s.helpScreen=helpForId(action.slice(5),current);
    else if(action==='documents') s.helpScreen=documentScreen();
    else if(action?.startsWith('document:')) s.helpScreen=documentScreen(action.slice(9));
    else if(action?.startsWith('download:')) {
      const id=action.slice(9);s.helpScreen=documentScreen(id);
      if(documentPath(id))s.helpScreen={...s.helpScreen,documentId:id};
    }
    else if(action?.startsWith('tax-detail:')) s.detail=action;
    else if(action==='formulas') s.detail='formulas';
    else if(action==='transition') s.detail='transition';
    else if(action==='transition-add') {
      const t=current.taxRegime&&transitionTask(current.taxRegime);if(t)this.memory.repo.syncTasks(s.threadId,[t]);
      s.notice='Проверка перехода добавлена в задачи.';s.detail=null;
    }
    else if(action==='confirm-change'&&s.pendingChange) {patch=s.pendingChange;s.pendingChange=null;s.detail=null;s.editing=false;}
    else if(action?.startsWith('answer:')&&s.pendingQuestion) {
      const answer=directAnswer(s.pendingQuestion,action.slice(7));
      if(s.editing){s.pendingChange=answer;s.detail=null;}else patch=answer;
    }
    else if(action?.startsWith('status:')) {
      const [,status,id]=action.split(':');
      if(status==='TODO'||status==='IN_PROGRESS'||status==='NOT_APPLICABLE')this.memory.repo.setStatus(s.threadId,id!,status);
      if(id==='bank'&&status==='TODO')patch={bankAccountOpened:false};
      s.detail='all:0';
    }
    else if(action?.startsWith('choose:')) {
      const id=action.slice(7) as TaxId;const input=taxInput(current);const result=input&&calculate(input).find(r=>r.id===id);
      if(result?.eligibility.available) {
        patch={taxRegime:id};
        if(s.resumeStage){s.currentStage=s.resumeStage;s.resumeStage=undefined;s.detail=null;}
        else {s=next(s,current);s.detail='plan-review';}
      } else s.notice='Режим не проходит проверку. Измените параметры.';
    }
    else if(action==='plan-confirm')s.detail=null;
    else if(action==='continue'&&!missing(s.currentStage,current).length) {
      if(s.currentStage==='TAX_REGIME'&&current.legalForm!=='IP'&&!current.taxRegime) s.notice='Сначала выберите режим.';
      else if(s.currentStage==='REGISTRATION') s.notice='Сначала завершите шаги регистрации.';
      else s=next(s,current);
    }
    else if(action==='bank-opened') {patch={bankAccountOpened:true};s=next(s,current);}
    else if(action==='bank-later') {s.currentStage=current.registrationStatus==='REGISTERED'?'POST_REGISTRATION':'REGISTRATION';s.detail=null;}
    else if(action?.startsWith('task:')) s.detail=action;
    else if(action?.startsWith('done:')) {
      const id=action.slice(5);const task=this.memory.repo.tasks(s.threadId).find(t=>t.id===id);
      if(task) {
        // This confirms a user's manual action. No filing or banking API is called.
        if(id==='reg-9'&&s.detail!=='submit-confirm') s.detail='submit-confirm';
        else {this.memory.repo.setStatus(s.threadId,id,'DONE');s.detail=task.group==='registration'?null:'all:0';
          if(id==='bank')patch={bankAccountOpened:true};
          if(id==='reg-10') {patch={registrationStatus:'REGISTERED'};s.currentStage='POST_REGISTRATION';}}
      }
    }
    else if(event.text) {
      let direct:BusinessProfile|undefined;
      const question=s.pendingQuestion&&questions[s.pendingQuestion];
      const fastText=question?.type!=='text'||s.detail?.startsWith('edit-field:')
        ||(s.pendingQuestion==='businessIdea'&&Object.keys(current).length===0)
        ||(s.pendingQuestion==='businessName'&&event.text.trim().split(/\s+/).length===1);
      if(question&&fastText&&!wasHelp&&(!s.detail||s.detail.startsWith('edit-field:'))&&(!s.editing||s.detail?.startsWith('edit-field:'))) {
        try {direct=directAnswer(s.pendingQuestion!,event.text);} catch { /* Free text is handled by the model below. */ }
      }
      if(direct) {
        if(s.editing){s.pendingChange=direct;s.detail=null;}else patch=direct;
      } else {
      const reply=await this.agent.run({threadId:s.threadId,stage:s.currentStage,profile:current,stageContext:{question:s.pendingQuestion,editing:s.editing},userMessage:event.text,missingFields:missing(s.currentStage,current),deterministicResults:s.taxAnalysis});
      const parsed=AgentResultSchema.safeParse(reply.result);
      if(parsed.success&&Object.keys(parsed.data.profilePatch).length) {
        // Model proposes facts only. User confirmation is required before any write.
        try {validateProfile({...current,...parsed.data.profilePatch});s.pendingChange=parsed.data.profilePatch;s.detail=null;}
        catch {s.notice='Данные противоречат друг другу. Проверьте расходы, ФОТ, число сотрудников и дату.';}
      } else if(s.pendingQuestion&&!wasHelp&&(!s.detail||s.detail.startsWith('edit-field:'))&&(!s.editing||s.detail?.startsWith('edit-field:'))) {
        try {const answer=directAnswer(s.pendingQuestion,event.text);if(s.editing){s.pendingChange=answer;s.detail=null;}else patch=answer;}
        catch {s.notice=reply.unavailable?'Помощник временно недоступен. Ответьте на текущий вопрос числом, датой или кнопкой.':'Не удалось уверенно выделить данные. Уточните ответ на текущий вопрос.';}
      } else s.notice=parsed.success&&parsed.data.explanationKeys.length?parsed.data.explanationKeys.map(key=>explanations[key]).join('\n'):'Для этого вопроса у меня пока нет проверенного правила в базе. Можно изменить данные или продолжить маршрут кнопкой.';
      }
    }
    if(patch) {
      patch=Object.fromEntries(Object.entries(patch).filter(([key,value])=>JSON.stringify(current[key as keyof BusinessProfile])!==JSON.stringify(value))) as BusinessProfile;
      try {
        const valid=validateProfile({...current,...patch});
        // Existing values entered through buttons are confirmed by the button itself.
        s=invalidate(s,patch);
        if(reviewedMarket)s.marketAnalysis=reviewedMarket;
        s.profileVersion=this.memory.save(s.threadId,valid);
        if(patch.legalForm==='IP') {s.currentStage='TAX_REGIME';s.detail=null;}
        syncObligations(this.memory.repo,s.threadId,valid);
        const input=taxInput(valid);s.taxAnalysis=input?calculate(input):null;
        if(valid.taxRegime&&s.taxAnalysis&&!s.taxAnalysis.find(r=>r.id===valid.taxRegime)?.eligibility.available) {
          delete valid.taxRegime;s.profileVersion=this.memory.save(s.threadId,valid);s.currentStage='TAX_REGIME';s.notice='Выбранный режим больше не проходит проверку. Выберите заново.';
        }
      } catch {s.notice='Не удалось сохранить: проверьте согласованность данных.';}
    }
    this.memory.record(s,event.id);
    return s;
  }
  async render(original:WorkflowState):Promise<WorkflowState> {
    let s={...original};const p=this.memory.read(s.threadId).profile;
    // Resume old checkpoints without forcing the obsolete bank-account gate.
    if(!s.detail&&!s.helpScreen&&p.registrationStatus==='REGISTERED'&&(s.currentStage==='BANK_ACCOUNT'||s.currentStage==='DASHBOARD'&&missing('POST_REGISTRATION',p).length))s.currentStage='POST_REGISTRATION';
    const input=taxInput(p);s.taxAnalysis=input?calculate(input):null;
    if(input&&s.taxAnalysis&&JSON.stringify(this.memory.repo.calculation(s.threadId)?.input)!==JSON.stringify(input)) this.memory.repo.saveCalculation(s.threadId,input,s.taxAnalysis);
    const selected=s.taxAnalysis?.find(r=>r.id===p.taxRegime);
    s.businessPlan=p.expectedAnnualRevenue!==undefined&&p.expectedAnnualExpenses!==undefined?{revenue:p.expectedAnnualRevenue,expenses:p.expectedAnnualExpenses,payroll:p.annualPayroll??0,taxes:selected?.complete?selected.total:null,profit:selected?.complete?p.expectedAnnualRevenue-p.expectedAnnualExpenses-selected.total:null,complete:selected?.complete??false}:null;
    let screen:Screen={text:'',buttons:[]};
    const nav=button('Меню','menu');
    if(s.helpScreen)screen=s.helpScreen;
    else if(s.pendingChange) screen={text:`Сохранить эти данные?\n\n${labels(s.pendingChange)}`,buttons:[button('Подтвердить','confirm-change'),button('Отмена','cancel')]};
    else if(s.detail==='reset') screen={text:'Удалить профиль, задачи и весь прогресс? Это действие нельзя отменить.',buttons:[button('Удалить мои данные','reset-confirm'),button('Отмена','cancel')]};
    else if(s.detail==='menu') screen={text:'Что нужно сделать сейчас? Можно также написать вопрос обычным текстом.',buttons:[button('Продолжить маршрут','resume'),button('ООО уже зарегистрировано','registered'),button('Налоговый режим','tax'),button('Мои задачи','tasks'),button('Мой профиль','profile'),button('Документы','documents'),button('📍 Подобрать помещение','premises'),button('Задать вопрос','help')]};
    else if(s.detail==='premises') screen={text:'📍 БизнесСтарт — помещение для вашего бизнеса\n\nНаш сайт помогает выбрать место в аренду в вашем городе под ваш бизнес. Перейдите на БизнесСтарт, чтобы подобрать подходящее помещение.',buttons:[{text:'Перейти на БизнесСтарт',url:'https://бизнестарт.рф/'},button('Вернуться в главное меню','menu')]};
    else if(s.detail==='profile') screen={text:labels(p)||'Профиль пока пуст.',buttons:[button('Изменить данные','edit'),button('Продолжить','resume'),nav]};
    else if(s.editing&&s.detail?.startsWith('edit-field:')&&s.pendingQuestion) {
      const q=questions[s.pendingQuestion]!;
      screen={text:`Новое значение\n${q.text}`,buttons:[...(q.options??[]).map(([label,value])=>button(label,`answer:${value}`)),button('Отмена','cancel')]};
    }
    else if(s.editing) {
      const page=s.detail?.startsWith('edit-page:')?Number(s.detail.slice(10)):0;
      const fields=Object.entries(questions);const selected=fields.slice(page*5,page*5+5);
      screen={text:'Напишите, что изменить, или выберите поле. Например: «Теперь планирую 6 сотрудников». Изменения сохранятся после подтверждения.',buttons:[...selected.map(([key,q])=>button(q!.text.split('?')[0]!.slice(0,50),`edit-field:${key}`)),...(page>0?[button('Назад',`edit-page:${page-1}`)]:[]),...((page+1)*5<fields.length?[button('Далее',`edit-page:${page+1}`)]:[]),button('Отмена','cancel')]};
    }
    else if(s.detail==='formulas') screen={text:'Выберите режим: покажу формулу, ограничения и официальный источник.',buttons:[...(s.taxAnalysis??[]).map(r=>button(r.name,`tax-detail:${r.id}`)),button('Назад','resume'),nav]};
    else if(s.detail?.startsWith('tax-detail:')) {
      const r=s.taxAnalysis?.find(r=>r.id===s.detail?.slice(11));
      screen=r?{text:`${r.name}\n${r.formula}\n\n${r.eligibility.reasons.concat(r.warnings).join('\n')}`,buttons:[{text:'Официальный источник',url:r.source_url},button('Назад','resume')]}:{text:'Сначала заполните параметры.',buttons:[button('Назад','resume')]};
    }
    else if(s.detail==='transition') {
      const t=p.taxRegime&&transition(p.taxRegime,p.taxRegistrationDate);
      screen={text:t?`Как перейти на ${t.regime.name}\n\n${t.rule.instructions}\n${t.note}\n${t.nominal?`Календарный ориентир: ${t.nominal}. Окончательный срок нужно уточнить с учётом выходных и праздников.`:'Дедлайн: нужно уточнить дату постановки на налоговый учёт.'}\nДля действующих организаций переход пока не настроен.`:'Сначала выберите режим. Для ОСНО правило перехода в этой версии не настроено.',buttons:t?[button('Добавить в мои задачи','transition-add'),...(!p.taxRegistrationDate?[button('Указать дату учёта','edit-field:taxRegistrationDate')]:[]),{text:'Официальный источник',url:t.rule.source_url},button('Назад','resume')]:[button('Назад','resume')]};
    }
    else if(s.detail==='submit-confirm') screen={text:'Подтверждаете, что самостоятельно подали документы в ФНС? Бот не подаёт документы за вас.',buttons:[button('Да, документы поданы','done:reg-9'),button('Назад','resume')]};
    else if(s.detail?.startsWith('task:')) {
      const t=this.memory.repo.tasks(s.threadId,true).find(t=>t.id===s.detail?.slice(5));
      screen=t?{text:`${t.title}\n\n${t.description}\n\n${t.why_it_matters}\nСрок: ${t.deadline??'Нужно уточнить'}\nСтатус: ${t.status}`,buttons:[button(t.status==='DONE'?'Вернуть в задачи':'Выполнено',t.status==='DONE'?`status:TODO:${t.id}`:`done:${t.id}`),...(t.group!=='registration'?[button('В работе',`status:IN_PROGRESS:${t.id}`),button('Не применимо',`status:NOT_APPLICABLE:${t.id}`)]:[]),{text:'Официальный источник',url:t.source_url},button('Назад','resume')]}:{text:'Задача больше не применима.',buttons:[button('Назад','resume')]};
    }
    else if(s.detail?.startsWith('all:')||s.detail?.startsWith('completed:')) screen=taskList(this.memory.repo,s.threadId,Number(s.detail.split(':')[1]),s.detail.startsWith('completed:'));
    else if(s.detail==='plan-review') screen={text:`Проверьте итоговый план перед регистрацией\nДоход: ${money(p.expectedAnnualRevenue??0)} ₽\nРасходы, включая ФОТ: ${money(p.expectedAnnualExpenses??0)} ₽\n${s.businessPlan?.complete?`Налоги и взносы: ${money(s.businessPlan.taxes!)} ₽\nОстаток: ${money(s.businessPlan.profit!)} ₽`:'Полные налоги и прибыль: нужно уточнить.'}`,buttons:[button('Перейти к регистрации','plan-confirm'),button('Изменить параметры','edit'),nav]};
    else {
      const key=missing(s.currentStage,p)[0];s.pendingQuestion=key??null;
      if(key) {const q=questions[key]!;screen={text:q.text,buttons:[...(q.options??[]).map(([label,value])=>button(label,`answer:${value}`)),...(q.source?[{text:'Официальный источник',url:q.source}]:[]),nav]};}
      else if(s.currentStage==='NICHE') screen={text:`Идея: ${p.businessIdea}\n\nПерейдём к проверке спроса?`,buttons:[button('Да, продолжить','continue'),button('Изменить','edit'),nav]};
      else if(s.currentStage==='MARKET_ANALYSIS') {
        if(!s.marketAnalysis) {
          // One call analyzes the idea and extracts its other explicit facts. Initial input was saved instantly.
          const reply=await this.agent.run({threadId:s.threadId,stage:s.currentStage,profile:p,stageContext:{mode:'qualitative_market',extractFromIdea:true},userMessage:p.businessIdea??'',missingFields:ProfileFieldSchema.options.filter(key=>p[key]===undefined)});
          const m=reply.result?.marketAnalysis;
          // This guard rejects invented statistics/legal assertions; it never extracts profile facts.
          const qualitative=m&&Object.values(m).flat().every(text=>!/[\d%₽]|миллион|миллиард|налог|штраф|обязан|закон|срок подачи/i.test(text));
          s.marketAnalysis=qualitative?m:fallbackMarket;
          const parsed=AgentResultSchema.safeParse(reply.result);
          if(parsed.success){
            const additions=Object.fromEntries(Object.entries(parsed.data.profilePatch).filter(([key,value])=>key!=='businessIdea'&&p[key as keyof BusinessProfile]===undefined&&value!==undefined));
            if(Object.keys(additions).length){
              try{validateProfile({...p,...additions});s.pendingChange=additions;s.detail='market-facts';return this.render(s);}catch{/* Discard inconsistent inferred data. */}
            }
          }
        }
        screen={text:`Предварительный анализ идеи — гипотезы без веб-поиска.\n\nКлиенты: ${s.marketAnalysis.customers.slice(0,2).join(' ')}\nКонкуренты: ${s.marketAnalysis.competitors.slice(0,1).join(' ')}\nКаналы: ${s.marketAnalysis.channels.slice(0,1).join(' ')}\nРиски: ${s.marketAnalysis.risks.slice(0,1).join(' ')}\nПроверить: ${s.marketAnalysis.checks.slice(0,1).join(' ')}`,buttons:[button('Принять и продолжить','continue'),button('Уточнить идею','edit'),nav]};
      }
      else if(s.currentStage==='LEGAL_FORM') screen={text:`Сохранил форму: ${p.legalForm==='LLC'?'ООО':'ИП'}. Полный маршрут доступен для ООО.`,buttons:[button('Продолжить','continue'),button('Изменить','edit'),nav]};
      else if(s.currentStage==='TAX_REGIME') {
        if(p.legalForm==='IP') screen={text:'ИП сохранён. Налоговый расчёт и регистрационный маршрут ИП ещё не поддержаны. Можно продолжить работу с идеей и предварительным планом.',buttons:[button('Предварительный план','continue'),button('Изменить форму','edit'),nav]};
        else if(s.taxAnalysis&&input) {
          const best=lowestComplete(s.taxAnalysis,input);
          screen={text:`ООО · доход ${money(input.income)} ₽ · расходы ${money(input.expenses)} ₽ · сотрудников ${input.employees}\n\n${s.taxAnalysis.map(r=>`${r.name}: ${r.eligibility.available?`${money(r.total)} ₽${r.complete?'':' (предварительно)'}`:`недоступна — ${r.eligibility.reasons.join('; ')}`}`).join('\n')}\n\n${best.length?`Наименьшая полная расчётная нагрузка: ${best.map(r=>r.name).join(', ')}.`:'Победитель не определён: расчёт или условия применения неполные.'}\nБазовые ставки; региональные льготы не учтены. ОСНО — оценка без НДС; АУСН «расходы» требует помесячных данных. Это не бухгалтерская консультация.${input.income>20000000?' Необходимо учитывать НДС; расширенный расчёт вне точной модели MVP.':''}`,buttons:[...s.taxAnalysis.filter(r=>r.eligibility.available).map(r=>button(`Выбрать ${r.name}`,`choose:${r.id}`)),button('Как считается?','formulas'),button('Изменить параметры','edit'),nav]};
        }
      }
      else if(s.currentStage==='BUSINESS_PLAN') screen={text:s.businessPlan?`Предварительные финансы\nДоход: ${money(s.businessPlan.revenue)} ₽\nРасходы, включая ФОТ: ${money(s.businessPlan.expenses)} ₽\nФОТ: ${money(s.businessPlan.payroll)} ₽ (уже в расходах)\nОстаток до налогов и взносов: ${money(s.businessPlan.revenue-s.businessPlan.expenses)} ₽\nДалее проверим налоговый режим. Это оценки пользователя, не гарантия прибыли.`:'Для финансового плана нужны доходы и расходы.',buttons:[button(p.taxRegime?'К регистрации':'Подобрать налоги','continue'),button('Изменить данные','edit'),nav]};
      else if(s.currentStage==='REGISTRATION') {
        if(p.legalForm==='IP') screen={text:'Регистрация ИП пока не поддержана.',buttons:[nav,button('Изменить форму','edit')]};
        else if(p.registrationStatus==='REGISTERED') {s=next(s,p);return this.render(s);}
        else {
          this.memory.repo.syncTasks(s.threadId,registrationRules);
          const task=this.memory.repo.tasks(s.threadId).find(t=>t.group==='registration'&&t.status!=='DONE');
          screen=task?{text:`Шаг ${task.id.slice(4)} из 10\n${task.title}\n\n${task.description}`,buttons:[button('Выполнено',`done:${task.id}`),button('Подробнее',`task:${task.id}`),{text:'Официальный источник',url:task.source_url},nav]}:{text:'Регистрация отмечена выполненной. Укажите данные ООО.',buttons:[button('ООО зарегистрировано','registered')]};
        }
      }
      else if(s.currentStage==='BANK_ACCOUNT') screen={text:p.bankAccountOpened?'Счёт открыт. Остальные задачи доступны в рабочем списке.':'Открытие счёта — одна из параллельных задач. Оно не мешает перейти к остальным обязанностям.',buttons:[button(p.bankAccountOpened?'Продолжить':'Счёт открыт',p.bankAccountOpened?'continue':'bank-opened'),button('К остальным задачам','bank-later'),{text:'Официальный источник',url:SOURCES.registration},nav]};
      else if(s.currentStage==='POST_REGISTRATION') {syncObligations(this.memory.repo,s.threadId,p);s=next(s,p);return this.render(s);}
      else {
        syncObligations(this.memory.repo,s.threadId,p);
        const tasks=this.memory.repo.tasks(s.threadId);const todo=tasks.filter(t=>t.status!=='DONE'&&t.status!=='NOT_APPLICABLE').sort((a,b)=>(a.deadline??'9999').localeCompare(b.deadline??'9999'));
        screen={text:`${p.businessName?`${p.legalForm==='IP'?'ИП':'ООО'} «${p.businessName}»`:'Мои задачи'}\nПрогресс: ${tasks.filter(t=>t.status==='DONE').length} / ${tasks.length}\n\n${todo[0]?`🔴 Сейчас: ${todo[0].title}\nСрок: ${todo[0].deadline??'Нужно уточнить'}`:'Незавершённых задач нет.'}${todo[1]?`\n🟡 Далее: ${todo[1].title}`:''}`,buttons:[...(todo[0]?[button('Что делать сейчас?',`task:${todo[0].id}`)]:[]),button('Все задачи','all:0'),button('Мой профиль','profile'),button('Изменить данные','edit'),button('Налоговый режим','tax'),nav]};
      }
    }
    if(!s.helpScreen&&s.detail?.startsWith('task:')){
      const id=s.detail.slice(5),task=this.memory.repo.tasks(s.threadId,true).find(t=>t.id===id);
      if(task?.completion_date)screen.text+=`\nВыполнено: ${task.completion_date.slice(0,10)}`;
      if(!this.memory.repo.tasks(s.threadId).some(t=>t.id===id)){
        screen.text+='\nЗадача сохранена в архиве; сейчас правило не применяется.';
        screen.buttons=screen.buttons.filter(b=>!('action'in b)||!b.action.startsWith('status:')&&!b.action.startsWith('done:'));
      }
      screen.buttons.push(...documents.filter(d=>d.taskIds.includes(id)).map(d=>button(d.title,`document:${d.id}`)));
    }
    if(!s.detail&&s.currentStage==='REGISTRATION'){
      const id=this.memory.repo.tasks(s.threadId).find(t=>t.group==='registration'&&t.status!=='DONE')?.id;
      screen.buttons.push(...documents.filter(d=>d.taskIds.includes(id??'')).map(d=>button(d.title,`document:${d.id}`)));
    }
    if(s.currentStage==='DASHBOARD'&&!s.detail&&!s.helpScreen)screen.buttons.push(button('Выполненные задачи','completed:0'),button('Продолжить маршрут','resume'));
    if(!s.helpScreen)screen.buttons.push(button('Задать вопрос','help'));
    const nonce=randomUUID().slice(0,8);
    s.screen={...screen,text:`${s.notice?s.notice+'\n\n':''}${screen.text}`,buttons:screen.buttons.map(b=>'action'in b?{...b,action:`${nonce}|${b.action}`}:b)};
    return s;
  }
}
