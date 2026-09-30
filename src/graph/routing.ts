import type { Stage } from './state.js';
import type { BusinessProfile } from '../domain/business/profile.js';

/** Main route ends in a workspace; opening a bank account is a parallel task. */
export function nextStage(stage:Stage,p:BusinessProfile):Stage {
  const route:Partial<Record<Stage,Stage>>={NICHE:'MARKET_ANALYSIS',MARKET_ANALYSIS:'LEGAL_FORM',LEGAL_FORM:'BUSINESS_PLAN',TAX_REGIME:'REGISTRATION',REGISTRATION:'POST_REGISTRATION',POST_REGISTRATION:'DASHBOARD',BANK_ACCOUNT:'DASHBOARD',DASHBOARD:'DASHBOARD'};
  if(stage==='BUSINESS_PLAN')return p.taxRegime?'REGISTRATION':'TAX_REGIME';
  return route[stage]??'DASHBOARD';
}
