import { expect, it } from 'vitest';
import { acquireInstanceLock } from '../src/services/instance-lock.js';
it('Не допускает два процесса с одним токеном и освобождает блокировку', async () => {
  const key = `test-${process.pid}`;
  const release = await acquireInstanceLock(key);
  try { await expect(acquireInstanceLock(key)).rejects.toThrow('BOT_ALREADY_RUNNING'); }
  finally { await release(); }
  const again = await acquireInstanceLock(key);
  await again();
});
