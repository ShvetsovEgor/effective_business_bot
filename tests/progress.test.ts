import { afterEach, expect, it, vi } from 'vitest';
import { withProgress } from '../src/bot/messages/progress.js';
afterEach(()=>vi.useRealTimers());
it('fast replies do not flash a loading screen',async()=>{
 vi.useFakeTimers();const show=vi.fn().mockResolvedValue(undefined);
 expect(await withProgress(async()=>42,show)).toBe(42);
 await vi.advanceTimersByTimeAsync(5000);expect(show).not.toHaveBeenCalled();
});
it('animates one screen, drains in-flight edits and stops before final delivery',async()=>{
 vi.useFakeTimers();let finish!:()=>void,release!:()=>void;
 const show=vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 const work=withProgress(()=>new Promise<void>(resolve=>{finish=resolve;}),show);
 let complete=false;const observed=work.then(()=>{complete=true;});
 await vi.advanceTimersByTimeAsync(700);expect(show).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(2000);expect(show).toHaveBeenCalledTimes(2);
 expect(show.mock.calls[0]?.[0].text).not.toBe(show.mock.calls[1]?.[0].text);
 finish();await vi.advanceTimersByTimeAsync(1);expect(complete).toBe(false);
 release();await observed;await vi.advanceTimersByTimeAsync(5000);expect(show).toHaveBeenCalledTimes(2);
});
it('stops the animation on a failed request; display failure does not fail the answer',async()=>{
 vi.useFakeTimers();let fail!:(e:Error)=>void;
 const show=vi.fn().mockRejectedValue(new Error('network'));
 const work=withProgress(()=>new Promise<void>((_resolve,reject)=>{fail=reject;}),show);
 const check=expect(work).rejects.toThrow('provider');
 await vi.advanceTimersByTimeAsync(700);fail(new Error('provider'));await check;
 await vi.advanceTimersByTimeAsync(5000);expect(show).toHaveBeenCalledTimes(1);
});
