import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { HubPaths } from './paths.js';
import {
  type AgentProviderConfigs,
  STORE_SCHEMA_VERSION,
  type AppConfig,
  type Channel,
  type GitCredential,
  type OrchestratorState,
  type PipelineConfig,
  type Project,
  type StoreEntityKey,
  type StoreSnapshot,
  type Toolbox,
  type Trigger,
  type WorkItem,
} from './types.js';

const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: STORE_SCHEMA_VERSION,
  httpPort: 7878,
  orchestratorTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
  triggerTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
  defaultProvider: 'claude',
  projectsRoot: join(homedir(), 'claude-hub', 'projects'),
  providers: {
    claude: {
      type: 'claude',
      enabled: true,
      dangerouslySkipPermissions: true,
    },
    cursor: {
      type: 'cursor',
      enabled: true,
      model: 'gpt-5.5',
      force: false,
      trust: true,
      approveMcps: true,
    },
  },
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
    pipelines: [],
    workItems: [],
    toolbox: { skills: [], mcpServers: [] },
    gitCredentials: [],
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
  /**
   * Per-file write queue. Concurrent updates to the same key (e.g. two
   * pipeline work items advancing at once) are consistent in memory — the
   * updater runs synchronously against the latest snapshot — but their
   * temp-file renames race on Windows (EPERM). Chaining the writes keeps
   * rename-over-destination strictly sequential per file.
   */
  private writeQueues = new Map<string, Promise<void>>();

  constructor(paths?: HubPaths) {
    super();
    this.paths = paths ?? new HubPaths();
  }

  async load(): Promise<void> {
    await mkdir(this.paths.root, { recursive: true });
    await mkdir(this.paths.channelHistoryDir(), { recursive: true });
    await mkdir(this.paths.triggerHistoryDir(), { recursive: true });
    await mkdir(this.paths.workItemHistoryDir(), { recursive: true });
    await mkdir(this.paths.pipelineArchiveDir(), { recursive: true });

    const fresh = emptySnapshot();

    // Merge on top of defaults so additive fields (like a new timeout
    // option) are populated for configs written by earlier versions. Only
    // the schemaVersion gate is load-blocking; everything else is best-
    // effort forward-compatible.
    const persisted = await readJsonOrDefault<Partial<AppConfig>>(
      this.paths.file('config'),
      {},
    );
    fresh.config = mergeConfigDefaults(persisted);
    if (fresh.config.schemaVersion !== STORE_SCHEMA_VERSION) {
      throw new Error(
        `claude-hub store schema version mismatch: file=${fresh.config.schemaVersion}, ` +
          `expected=${STORE_SCHEMA_VERSION}. Refusing to load to avoid corruption.`,
      );
    }
    const rawProjects = await readJsonOrDefault<LegacyOrCurrentProject[]>(
      this.paths.file('projects'),
      [],
    );
    const { projects, migrated } = migrateLegacyProjects(rawProjects);
    fresh.projects = projects;
    if (migrated) {
      // Persist the v4 -> v5 shape once, up front, so a crash before the
      // first organic write can't leave the file behind the schema version.
      await writeJsonAtomic(this.paths.file('projects'), projects);
    }
    fresh.channels = await readJsonOrDefault(this.paths.file('channels'), fresh.channels);
    fresh.triggers = await readJsonOrDefault(this.paths.file('triggers'), fresh.triggers);
    fresh.orchestrator = await readJsonOrDefault(this.paths.file('orchestrator'), fresh.orchestrator);
    fresh.pipelines = await readJsonOrDefault(this.paths.file('pipelines'), fresh.pipelines);
    fresh.workItems = await readJsonOrDefault(this.paths.file('workItems'), fresh.workItems);
    fresh.toolbox = await readJsonOrDefault(this.paths.file('toolbox'), fresh.toolbox);
    fresh.gitCredentials = await readJsonOrDefault(
      this.paths.file('gitCredentials'),
      fresh.gitCredentials,
    );

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

  pipelines(): PipelineConfig[] {
    return this.get().pipelines;
  }

  workItems(): WorkItem[] {
    return this.get().workItems;
  }

  toolbox(): Toolbox {
    return this.get().toolbox;
  }

  gitCredentials(): GitCredential[] {
    return this.get().gitCredentials;
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
    const path = this.paths.file(key);
    // Write the snapshot value as of write time — if several updates queue
    // up, later writes carry the newest state and the final file matches
    // the final in-memory snapshot.
    const prev = this.writeQueues.get(path) ?? Promise.resolve();
    const write = prev.then(() => writeJsonAtomic(path, this.snapshot[key]));
    this.writeQueues.set(path, write.catch(() => undefined));
    await write;
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

let tmpSeq = 0;

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Sequence number keeps concurrent same-key updates (e.g. two project
  // pipelines advancing at once) from colliding on one temp file.
  const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Pre-v5 project shape: a bare working directory with an optional alias. */
interface LegacyProject {
  id: string;
  path: string;
  alias?: string;
  addedAt: string;
}

type LegacyOrCurrentProject = LegacyProject | Project;

/**
 * v4 -> v5: a project used to be a single working directory. It becomes a
 * project root with one implicit local repo pointing at that same path, so
 * nothing moves on disk and agent cwd is unchanged.
 */
function migrateLegacyProjects(raw: LegacyOrCurrentProject[]): {
  projects: Project[];
  migrated: boolean;
} {
  let migrated = false;
  const projects = raw.map((p): Project => {
    if ('repos' in p && Array.isArray(p.repos)) return p;
    migrated = true;
    const legacy = p as LegacyProject;
    const name = legacy.alias ?? basename(legacy.path);
    return {
      id: legacy.id,
      path: legacy.path,
      name,
      vision: '',
      repos: [
        {
          id: randomUUID(),
          name: basename(legacy.path),
          path: legacy.path,
          origin: 'local',
          status: 'ready',
          addedAt: legacy.addedAt,
        },
      ],
      addedAt: legacy.addedAt,
    };
  });
  return { projects, migrated };
}

function mergeConfigDefaults(persisted: Partial<AppConfig>): AppConfig {
  const rawProviders = (persisted.providers ?? {}) as Partial<AgentProviderConfigs>;
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...persisted,
    // v1 -> v2 -> v3 -> v4 are purely additive (new files default to [], new
    // optional fields back-filled here), so older stores coerce forward.
    // v4 -> v5 additionally reshapes projects, handled by
    // migrateLegacyProjects during load.
    schemaVersion:
      persisted.schemaVersion === undefined ||
      persisted.schemaVersion === 1 ||
      persisted.schemaVersion === 2 ||
      persisted.schemaVersion === 3 ||
      persisted.schemaVersion === 4
        ? STORE_SCHEMA_VERSION
        : persisted.schemaVersion,
    defaultProvider: persisted.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
    providers: {
      claude: {
        ...DEFAULT_CONFIG.providers.claude,
        ...(rawProviders.claude ?? {}),
      },
      cursor: {
        ...DEFAULT_CONFIG.providers.cursor,
        ...(rawProviders.cursor ?? {}),
      },
    },
  };

  if (!config.providers[config.defaultProvider]?.enabled) {
    config.defaultProvider = DEFAULT_CONFIG.defaultProvider;
  }

  return config;
}
