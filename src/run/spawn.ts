import type { SpawnSyncReturns } from 'node:child_process';

/** How a spawned process ended, for an error message: `exited 1`, or `was killed by SIGKILL` when it did not exit on its own. */
export function exitText(r: Pick<SpawnSyncReturns<string>, 'status' | 'signal'>): string {
  return r.status === null ? `was killed by ${r.signal ?? 'a signal'}` : `exited ${r.status}`;
}
