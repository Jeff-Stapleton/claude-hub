import chokidar, { type FSWatcher } from 'chokidar';
import { EventEmitter } from 'node:events';
import { CCConfigReader } from './reader.js';

export type CCWatchEvent =
  | { kind: 'projects' }
  | { kind: 'settings' }
  | { kind: 'skills' };

export interface CCWatcherEvents {
  change: (event: CCWatchEvent) => void;
}

/**
 * Thin chokidar wrapper that emits coarse `change` events for the three
 * categories the UI cares about. We intentionally don't surface per-file
 * paths — the UI just re-fetches the relevant slice via the reader.
 */
export class CCWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;

  constructor(private readonly reader: CCConfigReader) {
    super();
  }

  start(): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(
      [
        this.reader.projectsDir(),
        this.reader.skillsDir(),
        `${this.reader.root}/settings.json`,
        `${this.reader.root}/settings.local.json`,
      ],
      {
        ignoreInitial: true,
        depth: 2,
        // CC writes session files frequently; debounce stabilizes events.
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      },
    );

    this.watcher.on('all', (_event, path) => {
      if (path.includes('settings')) this.emit('change', { kind: 'settings' });
      else if (path.includes('skills')) this.emit('change', { kind: 'skills' });
      else this.emit('change', { kind: 'projects' });
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}

export interface CCWatcher {
  on<E extends keyof CCWatcherEvents>(event: E, listener: CCWatcherEvents[E]): this;
  off<E extends keyof CCWatcherEvents>(event: E, listener: CCWatcherEvents[E]): this;
  emit<E extends keyof CCWatcherEvents>(event: E, ...args: Parameters<CCWatcherEvents[E]>): boolean;
}
