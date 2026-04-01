import { config } from './config.js';

type Release = () => void;

export class Semaphore {
  private available: number;
  private readonly queue: Array<(release: Release) => void> = [];
  private readonly max: number;
  // Reject when pending queue exceeds this multiple of max concurrency.
  private readonly maxQueueDepth: number;

  constructor(max: number, maxQueueMultiplier = 4) {
    this.max = max;
    this.available = max;
    this.maxQueueDepth = max * maxQueueMultiplier;
  }

  get activeCount(): number {
    return this.max - this.available;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  acquire(): Promise<Release> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve(() => this.release());
    }

    if (this.queue.length >= this.maxQueueDepth) {
      return Promise.reject(new Error('QUEUE_FULL'));
    }

    return new Promise<Release>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next(() => this.release());
    } else {
      this.available++;
    }
  }
}

// Singleton semaphore, configured from the loaded config.
// Created lazily so config is already frozen when this is first imported.
let _semaphore: Semaphore | undefined;

export function getSemaphore(): Semaphore {
  if (!_semaphore) {
    _semaphore = new Semaphore(config.maxConcurrency);
  }
  return _semaphore;
}
