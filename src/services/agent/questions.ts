import { profileQuestions, taxQuestions, parseAnswer, type Question } from '../forms.js';
import { hasField, ProfileSchema, type BusinessProfile, type ProfileField } from '../../domain/business/profile.js';
import type { Stage } from '../../graph/state.js';

const mapping: Record<string,ProfileField> = {name:'businessName',registration_date:'registrationDate',tax_regime:'taxRegime',employees:'employeesCount',director:'directorEmployed',personal_data:'processesPersonalData',cash_register:'needsCashRegister',personnel_event:'personnelEvent',income:'expectedAnnualRevenue',expenses:'expectedAnnualExpenses',payroll:'annualPayroll',assets:'fixedAssetsValue'};
export const questions = Object.fromEntries([...profileQuestions,...taxQuestions].map(q=>[mapping[q.key]??q.key,{...q,key:mapping[q.key]??q.key}])) as Partial<Record<ProfileField,Question>>;
questions.businessIdea={key:'businessIdea',type:'text',text:'Какой бизнес хотите открыть? Опишите идею и клиента в одном сообщении.'};
questions.legalForm={key:'legalForm',type:'choice',text:'Какую форму выбираете? Полный маршрут этой версии рассчитан на ООО.',options:[['ООО','LLC'],['ИП','IP']]};
questions.bankAccountOpened={key:'bankAccountOpened',type:'choice',text:'Расчётный счёт уже открыт?',options:[['Да','yes'],['Нет','no']]};
questions.taxRegistrationDate={key:'taxRegistrationDate',type:'date',text:'Дата постановки на налоговый учёт? Сверьте документ ФНС и введите ДД.ММ.ГГГГ.'};
const tax: ProfileField[]=['region','expectedAnnualRevenue','expectedAnnualExpenses','annualPayroll','employeesCount','fixedAssetsValue','contributions','simpleVat','confirmedUsn','confirmedAusn'];
export function required(stage: Stage, p: BusinessProfile): ProfileField[] {
  if(stage==='NICHE') return ['businessIdea'];
  if(stage==='LEGAL_FORM') return ['legalForm'];
  if(stage==='TAX_REGIME') return p.legalForm==='IP'?[]:['legalForm',...tax];
  if(stage==='BUSINESS_PLAN'&&p.legalForm==='IP') return ['expectedAnnualRevenue','expectedAnnualExpenses','annualPayroll'];
  if(stage==='REGISTRATION') return p.registrationStatus==='REGISTERED'?['registrationDate']:[];
  if(stage==='BANK_ACCOUNT') return ['bankAccountOpened'];
  if(stage==='POST_REGISTRATION') return ['businessName','registrationDate','region','taxRegime','employeesCount','directorEmployed','processesPersonalData','needsCashRegister','personnelEvent'];
  return [];
}
export const missing = (stage:Stage,p:BusinessProfile) => required(stage,p).filter(k=>!hasField(p,k));
export function directAnswer(key: ProfileField, raw: string): BusinessProfile {
  if(key==='businessIdea') return ProfileSchema.parse({businessIdea:raw});
  const q=questions[key]; if(!q) throw new Error('UNKNOWN_QUESTION');
  const input=key==='region' && ['татарстан','республика татарстан'].includes(raw.toLowerCase()) ? '16' : raw;
  return ProfileSchema.parse({[key]:parseAnswer(q,input)});
}
export const labels = (p:BusinessProfile) => Object.entries(p).map(([k,v])=>`${({businessIdea:'Идея',businessName:'Название',region:'Регион',legalForm:'Форма',registrationStatus:'Статус регистрации',employeesCount:'Сотрудники',expectedAnnualRevenue:'Доход за год',expectedAnnualExpenses:'Расходы за год',annualPayroll:'ФОТ за год',fixedAssetsValue:'Основные средства',taxRegime:'Режим',registrationDate:'Дата регистрации',contributions:'Взносы'} as Record<string,string>)[k]??questions[k as ProfileField]?.text.split('?')[0]??k}: ${v===true?'да':v===false?'нет':v===null?'неизвестно':v}`).join('\n');
