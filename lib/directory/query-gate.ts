import 'server-only';

/** Caps how many uncached directory queries one server instance runs at once, so a burst of searches
 * queues briefly (and then sheds load) instead of exhausting the small database connection pool or
 * piling up behind a slow scan. It is per instance, not global: each serverless instance enforces its
 * own cap, and the per-account rate limit still bounds any single member across all instances. */
export const DIRECTORY_MAX_CONCURRENT_QUERIES = 4;
export const DIRECTORY_MAX_QUEUED_QUERIES = 20;
export const DIRECTORY_QUEUE_WAIT_MS = 5_000;

export class DirectoryBusyError extends Error {
  constructor() {
    super('The member directory is busy. Please try again in a moment.');
    this.name = 'DirectoryBusyError';
  }
}

type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> };

export function createQueryGate(maxConcurrent: number, maxQueued: number, waitMs: number) {
  let running = 0;
  const queue: Waiter[] = [];

  function release() {
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.grant(); // the slot passes straight to the next waiter, so `running` is unchanged
    } else {
      running -= 1;
    }
  }

  async function acquire() {
    if (running < maxConcurrent) {
      running += 1;
      return;
    }
    if (queue.length >= maxQueued) throw new DirectoryBusyError();
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        timer: setTimeout(() => {
          queue.splice(queue.indexOf(waiter), 1);
          reject(new DirectoryBusyError());
        }, waitMs),
      };
      queue.push(waiter);
    });
  }

  return {
    /** Runs `operation` once a slot is free; rejects with DirectoryBusyError if the queue is full or the wait runs out. */
    async run<T>(operation: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await operation();
      } finally {
        release();
      }
    },
    snapshot: () => ({ queued: queue.length, running }),
  };
}

export const directoryQueryGate = createQueryGate(DIRECTORY_MAX_CONCURRENT_QUERIES, DIRECTORY_MAX_QUEUED_QUERIES, DIRECTORY_QUEUE_WAIT_MS);
