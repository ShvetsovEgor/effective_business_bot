import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

// OS-owned listener disappears even after a crash. The token is never stored in a file.
export async function acquireInstanceLock(token: string): Promise<() => Promise<void>> {
  const server = createServer(socket => socket.destroy());
  const hash = createHash('sha256').update(token).digest();
  const address = process.platform === 'win32'
    ? { path: `\\\\.\\pipe\\max-navigator-${hash.toString('hex')}` }
    : { host: '127.0.0.1', port: 30000 + hash.readUInt16BE(0) % 20000 };
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error('BOT_ALREADY_RUNNING')));
    server.listen(address, resolve);
  });
  return () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
