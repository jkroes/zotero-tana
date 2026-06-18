/**
 * User-facing schema configuration: the Tana supertag name plus, per catalog
 * field, the field's name in Tana and whether it participates in sync.
 *
 * This is the SOURCE OF TRUTH for NAMES (not IDs). At sync time the names are
 * resolved to the live Tana attribute/tag IDs — or the tag and fields are
 * created — by `tana/schema.ts`. Persisted as a JSON string in the
 * `schemaConfig` preference.
 */

import { CATALOG, DEFAULT_TAG_NAME, type FieldKey } from '../tana/constants';
import { isObject } from '../utils';

import { ZotanaPref, getZotanaPref, setZotanaPref } from './zotana-pref';

export type FieldConfig = {
  key: FieldKey;
  /** Field name as it appears in Tana (used to resolve/create the field). */
  name: string;
  /** Whether the field is synced (and created during bootstrap). */
  enabled: boolean;
};

export type SchemaConfig = {
  /** Reference supertag name (used to resolve/create the tag). */
  tagName: string;
  /** One entry per catalog field, in catalog order. */
  fields: FieldConfig[];
};

/**
 * A fresh config: default tag name + every catalog field enabled, with no name
 * override (each field shows its catalog default as a placeholder).
 */
export function defaultSchemaConfig(): SchemaConfig {
  return {
    tagName: DEFAULT_TAG_NAME,
    fields: CATALOG.map((entry) => ({
      key: entry.key,
      name: '',
      enabled: true,
    })),
  };
}

/**
 * Reconcile a (possibly stale or partial) stored config against the current
 * catalog: keep the user's rename/enabled for known keys, fill in any fields the
 * catalog has gained, drop any keys the catalog no longer has, and always return
 * fields in catalog order. A blank name (or one matching the catalog default) is
 * stored as `''` and resolved to the default at sync time.
 */
export function mergeSchemaConfig(raw: unknown): SchemaConfig {
  const defaults = defaultSchemaConfig();
  if (!isObject(raw)) return defaults;

  const tagName =
    typeof raw.tagName === 'string' && raw.tagName.trim()
      ? raw.tagName.trim()
      : defaults.tagName;

  const stored: Map<string, unknown> = new Map();
  if (Array.isArray(raw.fields)) {
    for (const field of raw.fields) {
      if (isObject(field) && typeof field.key === 'string') {
        stored.set(field.key, field);
      }
    }
  }

  const fields = defaults.fields.map((fallback) => {
    const entry = stored.get(fallback.key);
    if (!isObject(entry)) return fallback;
    return {
      key: fallback.key,
      // Blank stays blank (renders as the grey placeholder, resolved to the
      // catalog default at sync time); real input is trimmed and kept verbatim.
      name: typeof entry.name === 'string' ? entry.name.trim() : '',
      enabled:
        typeof entry.enabled === 'boolean' ? entry.enabled : fallback.enabled,
    };
  });

  return { tagName, fields };
}

export function getSchemaConfig(): SchemaConfig {
  const json = getZotanaPref(ZotanaPref.schemaConfig);
  if (!json) return defaultSchemaConfig();
  try {
    return mergeSchemaConfig(JSON.parse(json));
  } catch {
    return defaultSchemaConfig();
  }
}

export function setSchemaConfig(config: SchemaConfig): void {
  setZotanaPref(ZotanaPref.schemaConfig, JSON.stringify(config));
}
