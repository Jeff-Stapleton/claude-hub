import {
  VAULT_KEY_PATTERN,
  type MachineTemplate,
  type Store,
  type Toolbox,
  type VaultEntry,
} from '@claude-hub/core';

/**
 * Vault entries as the UI sees them: values stripped to a set/unset flag
 * (write-only secrets — no reveal endpoint, ever), plus which toolbox tools
 * and machine templates require the key. `requiredBy` is derived here,
 * never stored, so deleting a tool can't leave stale back-references.
 */
export interface RedactedVaultEntry {
  key: string;
  valueSet: boolean;
  requiredBy: { skills: string[]; mcpServers: string[]; machineTemplates: string[] };
  createdAt: string;
  updatedAt: string;
}

export function redactVault(
  vault: VaultEntry[],
  toolbox: Toolbox,
  machineTemplates: MachineTemplate[] = [],
): RedactedVaultEntry[] {
  return vault.map((entry) => ({
    key: entry.key,
    valueSet: entry.value !== null && entry.value !== '',
    requiredBy: {
      skills: toolbox.skills
        .filter((s) => s.requiredEnv?.includes(entry.key))
        .map((s) => s.name),
      mcpServers: toolbox.mcpServers
        .filter((m) => m.requiredEnv?.includes(entry.key))
        .map((m) => m.name),
      machineTemplates: machineTemplates
        .filter((t) => t.requiredEnv?.includes(entry.key))
        .map((t) => t.name),
    },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

/**
 * Auto-creates missing vault keys with a null (unset) value — the hook that
 * lights the vault's warning lamp when a tool declares a key nobody has
 * configured yet. Strictly additive: existing entries (set or unset) are
 * never touched, so tool re-saves and bundled reseeds can't clobber values.
 */
export async function ensureVaultKeys(store: Store, keys: string[]): Promise<void> {
  const existing = new Set(store.vault().map((e) => e.key));
  const missing = [...new Set(keys)].filter((k) => !existing.has(k));
  if (missing.length === 0) return;
  const now = new Date().toISOString();
  await store.update('vault', (current) => [
    ...current,
    ...missing.map((key) => ({ key, value: null, createdAt: now, updatedAt: now })),
  ]);
}

/** Validates a requiredEnv payload field; error-string style like parseTags. */
export function parseRequiredEnv(raw: unknown): string[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((k) => typeof k !== 'string')) {
    return 'requiredEnv must be an array of strings';
  }
  const cleaned = (raw as string[]).map((k) => k.trim()).filter((k) => k.length > 0);
  for (const key of cleaned) {
    if (!VAULT_KEY_PATTERN.test(key)) {
      return `requiredEnv key "${key}" must be SCREAMING_SNAKE_CASE (letters, digits, underscores; starts with a letter)`;
    }
  }
  return [...new Set(cleaned)];
}
