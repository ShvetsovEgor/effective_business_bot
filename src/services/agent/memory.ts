import type { Repository } from '../../db/repository.js';
import { ProfileSchema, validateProfile, type BusinessProfile } from '../../domain/business/profile.js';
import type { WorkflowState } from '../../graph/state.js';

/** Canonical facts live here; checkpoints contain workflow position, not another profile. */
export class BusinessMemory {
  constructor(readonly repo: Repository) {
    repo.db.exec(`CREATE TABLE IF NOT EXISTS agent_profiles(thread_id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_operations(thread_id TEXT NOT NULL,event_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(thread_id,event_id));`);
  }
  read(thread: string): { profile: BusinessProfile; version: number } {
    const row = this.repo.db.prepare('SELECT data,version FROM agent_profiles WHERE thread_id=?').get(thread) as {data:string;version:number}|undefined;
    return row ? {profile:validateProfile(JSON.parse(row.data)),version:row.version} : {profile:{},version:0};
  }
  save(thread: string, profile: BusinessProfile) {
    const valid = validateProfile(profile);
    const previous=this.read(thread);
    if(previous.version&&JSON.stringify(previous.profile)===JSON.stringify(valid))return previous.version;
    this.repo.db.prepare('INSERT INTO agent_profiles VALUES (?,?,1) ON CONFLICT(thread_id) DO UPDATE SET data=excluded.data,version=version+1').run(thread,JSON.stringify(valid));
    return this.read(thread).version;
  }
  operation(thread: string, event: string): WorkflowState|null {
    const row = this.repo.db.prepare('SELECT data FROM agent_operations WHERE thread_id=? AND event_id=?').get(thread,event) as {data:string}|undefined;
    return row ? JSON.parse(row.data) as WorkflowState : null;
  }
  record(s: WorkflowState, event: string) {
    this.repo.db.prepare('INSERT OR REPLACE INTO agent_operations VALUES (?,?,?)').run(s.threadId,event,JSON.stringify(s));
  }
  reset(thread: string) {
    this.repo.db.prepare('DELETE FROM agent_profiles WHERE thread_id=?').run(thread);
    this.repo.db.prepare('DELETE FROM agent_operations WHERE thread_id=?').run(thread);
    this.repo.reset(thread);
  }
  seed(thread: string, user: string) {
    this.repo.ensureUser(thread);
    if (this.read(thread).version) return;
    const old = this.repo.profile(user), calc = this.repo.calculation(user);
    let profile: BusinessProfile = {};
    if (old) profile = { businessName:old.name,legalForm:'LLC',registrationStatus:'REGISTERED',registrationDate:old.registration_date,
      region:old.region,employeesCount:old.employees,directorEmployed:old.director,processesPersonalData:old.personal_data,
      needsCashRegister:old.cash_register,personnelEvent:old.personnel_event,
      ...(ProfileSchema.shape.taxRegime.safeParse(old.tax_regime).success ? {taxRegime:ProfileSchema.shape.taxRegime.parse(old.tax_regime)} : {}) };
    if (calc) profile = {region:calc.input.region, expectedAnnualRevenue:calc.input.income,expectedAnnualExpenses:calc.input.expenses,
      annualPayroll:calc.input.payroll,employeesCount:calc.input.employees,fixedAssetsValue:calc.input.assets,
      contributions:calc.input.contributions,simpleVat:calc.input.simpleVat,confirmedUsn:calc.input.confirmedUsn,confirmedAusn:calc.input.confirmedAusn,...profile};
    this.save(thread,profile);
    for (const task of this.repo.tasks(user)) {
      this.repo.syncTasks(thread,[task],profile.registrationDate);
      this.repo.setStatus(thread,task.id,task.status);
      this.repo.db.prepare('UPDATE tasks SET completion_date=? WHERE user_id=? AND id=?').run(task.completion_date,thread,task.id);
    }
  }
}
