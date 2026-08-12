import { createHash } from 'node:crypto';

export interface TimingDependencies { now(): number; random(): number; sleep(milliseconds: number): Promise<void> }
export const defaultTiming: TimingDependencies = { now: Date.now, random: Math.random, sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) };

/** Constant bounded crypto work followed by a minimum 350ms floor and 0-49ms jitter. */
export async function equalizeAnonymousResponse(startedAt: number, timing: TimingDependencies) {
  let value = 'idoc-account-request';
  for (let index = 0; index < 128; index += 1) value = createHash('sha256').update(value).digest('hex');
  const remaining = 350 + Math.floor(timing.random() * 50) - (timing.now() - startedAt);
  if (remaining > 0) await timing.sleep(remaining);
}
