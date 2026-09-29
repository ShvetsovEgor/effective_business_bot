import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('Завершённая задача видна из нового процесса Node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'max-process-'));
  const dbPath = join(dir, 'state.sqlite');
  const common = `import { Repository } from './src/db/repository.ts'; const r = new Repository(process.argv[1]);`;
  try {
    const write = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `${common} import { registrationRules } from './src/data/llc-registration.ts'; r.ensureUser('1'); r.syncTasks('1',registrationRules); r.setStatus('1','reg-1','DONE'); r.close();`, dbPath], { encoding: 'utf8' });
    expect(write.status, write.stderr).toBe(0);
    const read = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `${common} console.log(r.tasks('1').find(t => t.id === 'reg-1').status); r.close();`, dbPath], { encoding: 'utf8' });
    expect(read.status, read.stderr).toBe(0);
    expect(read.stdout.trim()).toBe('DONE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20000);
