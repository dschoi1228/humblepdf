// Priority queue for page rendering (SPEC 6.2): visible pages first, then neighbours,
// then thumbnails; at most `concurrency` renders at once; queued or running jobs can be
// cancelled when their page leaves the view.

export const PRIORITY = { visible: 0, nearby: 1, thumbnail: 2 } as const;

type Job = {
  key: string;
  priority: number;
  run: (signal: AbortSignal) => Promise<void>;
  controller: AbortController;
  seq: number;
};

/** Counters read by tests and the M1 report. */
export type RenderStats = {
  started: number;
  completed: number;
  cancelled: number;
  failed: number;
  running: number;
  maxRunning: number;
};

export class RenderScheduler {
  private queue: Job[] = [];
  private running = new Map<string, Job>();
  private seq = 0;
  readonly stats: RenderStats = { started: 0, completed: 0, cancelled: 0, failed: 0, running: 0, maxRunning: 0 };

  constructor(private readonly concurrency = 2) {}

  /** Queues a job. A job with the same key that is queued or running is cancelled first. */
  schedule(key: string, priority: number, run: (signal: AbortSignal) => Promise<void>): void {
    this.cancel(key);
    this.queue.push({ key, priority, run, controller: new AbortController(), seq: this.seq++ });
    this.pump();
  }

  /** Changes the priority of a queued job (e.g. a page that became visible). */
  reprioritize(key: string, priority: number): void {
    const j = this.queue.find((q) => q.key === key);
    if (j) j.priority = priority;
  }

  cancel(key: string): void {
    const qi = this.queue.findIndex((q) => q.key === key);
    if (qi >= 0) {
      this.queue.splice(qi, 1);
      this.stats.cancelled++;
    }
    const r = this.running.get(key);
    if (r) {
      r.controller.abort();
      this.running.delete(key);
      this.stats.cancelled++;
      this.stats.running = this.running.size;
      this.pump();
    }
  }

  /** Cancels every job whose key starts with `prefix` and is not in `keep`. */
  cancelExcept(prefix: string, keep: Set<string>): void {
    const keys = [...this.queue.map((q) => q.key), ...this.running.keys()];
    for (const k of keys) if (k.startsWith(prefix) && !keep.has(k)) this.cancel(k);
  }

  has(key: string): boolean {
    return this.running.has(key) || this.queue.some((q) => q.key === key);
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queue.length) {
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      const job = this.queue.shift()!;
      this.running.set(job.key, job);
      this.stats.started++;
      this.stats.running = this.running.size;
      this.stats.maxRunning = Math.max(this.stats.maxRunning, this.running.size);
      job
        .run(job.controller.signal)
        .then(
          () => {
            if (!job.controller.signal.aborted) this.stats.completed++;
          },
          (e: unknown) => {
            if (!job.controller.signal.aborted && (e as Error)?.name !== "RenderAborted") {
              this.stats.failed++;
              console.error(e);
            }
          },
        )
        .finally(() => {
          if (this.running.get(job.key) === job) this.running.delete(job.key);
          this.stats.running = this.running.size;
          this.pump();
        });
    }
  }
}

/** The app-wide scheduler: pdf.js renders on the main thread, so keep concurrency low. */
export const scheduler = new RenderScheduler(2);
