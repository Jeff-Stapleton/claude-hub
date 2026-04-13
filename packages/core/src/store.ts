import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HubPaths } from './paths.js';
import {
  STORE_SCHEMA_VERSION,
  type AppConfig,
  type Channel,
  type OrchestratorState,
  type Project,
  type StoreEntityKey,
  type StoreSnapshot,
  type Trigger,
} from './types.js';

const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: STORE_SCHEMA_VERSION,
  httpPort: 7878,
  orchestratorTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
};

const DEFAULT_ORCHESTRATOR: OrchestratorState = {
  status: 'stopped',
  channelSessions: {},
};

/**
 * Per-entity defaults used when a JSON file is missing on first boot.
 *
 * Kept as a function returning a fresh object so consumers can't mutate the
 * defaults via the returned snapshot.
 */
function emptySnapshot(): StoreSnapshot {
  return {
    config: { ...DEFAULT_CONFIG },
    projects: [],
    channels: [],
    triggers: [],
    orchestrator: { ...DEFAULT_ORCHESTRATOR, channelSessions: {} },
  };
}

export interface StoreEvents {
  /** Fired after any successful save with the entity that changed. */
  change: (key: StoreEntityKey, snapshot: StoreSnapshot) => void;
}

/**
 * Flat-JSON, single-process state store. Reads happen from an in-memory
 * snapshot; writes go through `update()`, which serializes the affected
 * entity to disk atomically (write-temp + rename) and then emits `change`.
 *
 * Intentionally not safe for multi-process concurrent writes — claude-hub is
 * a single Node process and relies on that invariant.
 */
export class Store extends EventEmitter {
  readonly paths: HubPaths;
  private snapshot: StoreSnapshot = emptySnapshot();
  private loaded = false;

  constructor(paths?: HubPaths) {
    super();
    this.paths = paths ?? new HubPaths();
  }

  async load(): Promise<void> {
    await mkdir(this.paths.root, { recursive: true });
    await mkdir(this.paths.channelHistoryDir(), { recursive: true });
    await mkdir(this.paths.triggerHistoryDir(), { recursive: true });

    const fresh = emptySnapshot();

    // Merge on top of defaults so additive fields (like a new timeout
    // option) are populated for configs written by earlier versions. Only
    // the schemaVersion gate is load-blocking; everything else is best-
    // effort forward-compatible.
    const persisted = await readJsonOrDefault<Partial<AppConfig>>(
      this.paths.file('config'),
      {},
    );
    fresh.config = { ...fresh.config, ...persisted };
    if (fresh.config.schemaVersion !== STORE_SCHEMA_VERSION) {
      throw new Error(
        `claude-hub store schema version mismatch: file=${fresh.config.schemaVersion}, ` +
          `expected=${STORE_SCHEMA_VERSION}. Refusing to load to avoid corruption.`,
      );
    }
    fresh.projects = await readJsonOrDefault(this.paths.file('projects'), fresh.projects);
    fresh.channels = await readJsonOrDefault(this.paths.file('channels'), fresh.channels);
    fresh.triggers = await readJsonOrDefault(this.paths.file('triggers'), fresh.triggers);
    fresh.orchestrator = await readJsonOrDefault(this.paths.file('orchestrator'), fresh.orchestrator);

    this.snapshot = fresh;
    this.loaded = true;
  }

  get(): StoreSnapshot {
    this.ensureLoaded();
    return this.snapshot;
  }

  // -- typed accessors (read) -----------------------------------------------

  config(): AppConfig {
    return this.get().config;
  }

  projects(): Project[] {
    return this.get().projects;
  }

  channels(): Channel[] {
    return this.get().channels;
  }

  triggers(): Trigger[] {
    return this.get().triggers;
  }

  orchestrator(): OrchestratorState {
    return this.get().orchestrator;
  }

  // -- writes ---------------------------------------------------------------

  /**
   * Replaces a single entity, writes it atomically, and emits `change`.
   *
   * Pass either a new value or an updater function. Updater receives a
   * structuredClone of the current value, so mutating it freely is safe.
   */
  async update<K extends StoreEntityKey>(
    key: K,
    updater: StoreSnapshot[K] | ((current: StoreSnapshot[K]) => StoreSnapshot[K]),
  ): Promise<StoreSnapshot[K]> {
    this.ensureLoaded();
    const next =
      typeof updater === 'function'
        ? (updater as (c: StoreSnapshot[K]) => StoreSnapshot[K])(
            structuredClone(this.snapshot[key]),
          )
        : updater;
    this.snapshot = { ...this.snapshot, [key]: next };
    await writeJsonAtomic(this.paths.file(key), next);
    this.emit('change', key, this.snapshot);
    return next;
  }

  // -- internals ------------------------------------------------------------

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('Store.load() must be called before reading or writing.');
    }
  }
}

// Strongly-typed event emitter overrides for nicer call sites.
export interface Store {
  on<E extends keyof StoreEvents>(event: E, listener: StoreEvents[E]): this;
  off<E extends keyof StoreEvents>(event: E, listener: StoreEvents[E]): this;
  emit<E extends keyof StoreEvents>(event: E, ...args: Parameters<StoreEvents[E]>): boolean;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function readJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
