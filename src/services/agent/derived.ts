import type { BusinessProfile } from '../../domain/business/profile.js';
import type { TaxInput } from '../../domain/tax/types.js';
import type { WorkflowState } from '../../graph/state.js';
import { missing } from './questions.js';
import { afterRegistrationRules } from '../../data/llc-after-registration.js';
import type { Repository } from '../../db/repository.js';

export function taxInput(p:BusinessProfile): TaxInput|null {
  if(p.legalForm!=='LLC'||missing('TAX_REGIME',p).length) return null;
  return {region:p.region!,income:p.expectedAnnualRevenue!,expenses:p.expectedAnnualExpenses!,payroll:p.annualPayroll!,employees:p.employeesCount!,assets:p.fixedAssetsValue!,contributions:p.contributions!,simpleVat:p.simpleVat!,confirmedUsn:p.confirmedUsn!,confirmedAusn:p.confirmedAusn!};
}
export function invalidate(s:WorkflowState,patch:BusinessProfile): WorkflowState {
  const changed=Object.keys(patch);
  const tax=changed.some(k=>['region','legalForm','employeesCount','expectedAnnualRevenue','expectedAnnualExpenses','annualPayroll','fixedAssetsValue','contributions','simpleVat','confirmedUsn','confirmedAusn'].includes(k));
  const market=changed.some(k=>['businessIdea','businessDescription','region'].includes(k));
  return {...s,taxAnalysis:tax?null:s.taxAnalysis,businessPlan:tax||patch.taxRegime?null:s.businessPlan,
    marketAnalysis:market?null:s.marketAnalysis,completedStages:s.completedStages.filter(stage=>!(tax&&['TAX_REGIME','BUSINESS_PLAN'].includes(stage))&&!(market&&stage==='MARKET_ANALYSIS'))};
}
export function syncObligations(repo:Repository,thread:string,p:BusinessProfile) {
  if(p.legalForm!=='LLC') {repo.db.prepare('UPDATE tasks SET active=0 WHERE user_id=?').run(thread);return;}
  if(p.registrationStatus!=='REGISTERED'||missing('POST_REGISTRATION',p).some(key=>key!=='taxRegime')) return;
  const rules=afterRegistrationRules({name:p.businessName!,registration_date:p.registrationDate!,region:p.region!,tax_regime:p.taxRegime??'unknown',employees:p.employeesCount!,director:p.directorEmployed!,personal_data:p.processesPersonalData!,cash_register:p.needsCashRegister!,personnel_event:p.personnelEvent!});
  repo.syncTasks(thread,rules,p.registrationDate,true);
  if(p.bankAccountOpened&&repo.tasks(thread).find(t=>t.id==='bank')?.status!=='DONE') repo.setStatus(thread,'bank','DONE');
}
