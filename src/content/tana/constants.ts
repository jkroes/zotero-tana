/**
 * The Zotero→Tana field catalog: the fixed set of fields Zotana knows how to
 * populate from a Zotero item, with the Tana data type to create each as.
 *
 * Field/tag IDs are NOT hardcoded anymore — they are workspace-specific and are
 * resolved (or created) at runtime from the user-configured tag + field NAMES
 * (see `tana/schema.ts`, `prefs/schema-config.ts`). This catalog is the source of
 * truth for the default name, ordering, and the immutable Tana data type of each
 * field; the user can rename or disable fields, but not change their type.
 */

export type FieldKey =
  | 'item'
  | 'creators'
  | 'editors'
  | 'contributors'
  | 'publisher'
  | 'container'
  | 'place'
  | 'date'
  | 'year'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'edition'
  | 'series'
  | 'number'
  | 'typeDetail'
  | 'itemType'
  | 'doi'
  | 'url'
  | 'abstract'
  | 'fullCitation'
  | 'inTextCitation'
  | 'collections'
  | 'tags'
  | 'extra'
  | 'citationKey'
  | 'dateAdded'
  | 'dateModified'
  | 'filePath'
  | 'shortTitle'
  | 'title';

/** Supertag a reference links to for people/orgs. Fixed (not user-renamable). */
export type EntityTag = 'Person' | 'Organization';

/**
 * Tana field data types accepted by `POST /tags/{tagId}/fields` (`dataType`).
 * Verified creatable via the Local REST API (2026-06-17):
 * - `instance` requires `sourceTagId`; `options` requires a non-empty seed list.
 */
export type TanaDataType =
  | 'plain'
  | 'number'
  | 'date'
  | 'url'
  | 'email'
  | 'checkbox'
  | 'user'
  | 'instance'
  | 'options';

export type CatalogEntry = {
  key: FieldKey;
  /** Default field name (shown in Tana); user-overridable in preferences. */
  defaultName: string;
  /** Tana data type used when creating the field. Not user-changeable. */
  dataType: TanaDataType;
  /** For `instance` fields: the entity tag whose nodes this field references. */
  sourceTag?: EntityTag;
  /** Whether the field can hold multiple values (e.g. several authors). */
  multiValue?: boolean;
  /**
   * Seed options for an `options`-typed field. The REST API rejects an empty
   * options array, so options fields need at least one. Item Type auto-collects
   * additional values as items sync, so the seed is a starting set, not a cap.
   */
  optionSeed?: string[];
  /**
   * Options field whose seed is throwaway: the entity fields hold #Person/#Org
   * node references (written by id via setFieldOption, auto-collecting a mixed
   * picker). The API can't create an empty options field, so bootstrap seeds it
   * with a placeholder and then trashes that option, leaving a clean field.
   */
  transientSeed?: boolean;
};

/**
 * Field catalog, ordered alphabetically by `defaultName`. This order is the
 * single source of truth: it drives the preferences table, the stored config
 * (see `prefs/schema-config.ts`), and the field-creation order in Tana (see
 * `tana/schema.ts`). The emitted Tana Paste order is independent — set by the
 * reference builder. Renaming a field in preferences does NOT reshuffle it; the
 * table sorts by `defaultName` so rows stay put while a name is being edited.
 */
export const CATALOG: CatalogEntry[] = [
  { key: 'abstract', defaultName: 'Abstract', dataType: 'plain' },
  { key: 'citationKey', defaultName: 'Citation Key', dataType: 'plain' },
  {
    key: 'collections',
    defaultName: 'Collections',
    dataType: 'options',
    multiValue: true,
    transientSeed: true,
  },
  {
    key: 'container',
    defaultName: 'Container',
    dataType: 'options',
    transientSeed: true,
  },
  {
    key: 'contributors',
    defaultName: 'Contributors',
    dataType: 'options',
    multiValue: true,
    transientSeed: true,
  },
  {
    key: 'creators',
    defaultName: 'Creators',
    dataType: 'options',
    multiValue: true,
    transientSeed: true,
  },
  { key: 'date', defaultName: 'Date', dataType: 'date' },
  { key: 'dateAdded', defaultName: 'Date Added', dataType: 'date' },
  { key: 'dateModified', defaultName: 'Date Modified', dataType: 'date' },
  { key: 'doi', defaultName: 'DOI', dataType: 'url' },
  { key: 'edition', defaultName: 'Edition', dataType: 'plain' },
  {
    key: 'editors',
    defaultName: 'Editors',
    dataType: 'options',
    multiValue: true,
    transientSeed: true,
  },
  { key: 'extra', defaultName: 'Extra', dataType: 'plain' },
  { key: 'filePath', defaultName: 'File Path', dataType: 'plain' },
  { key: 'fullCitation', defaultName: 'Full Citation', dataType: 'plain' },
  { key: 'inTextCitation', defaultName: 'In-Text Citation', dataType: 'plain' },
  { key: 'issue', defaultName: 'Issue', dataType: 'plain' },
  { key: 'item', defaultName: 'Item', dataType: 'url' },
  {
    key: 'itemType',
    defaultName: 'Item Type',
    dataType: 'options',
    optionSeed: ['Document'],
  },
  { key: 'number', defaultName: 'Number', dataType: 'plain' },
  { key: 'pages', defaultName: 'Pages', dataType: 'plain' },
  { key: 'place', defaultName: 'Place', dataType: 'plain' },
  {
    key: 'publisher',
    defaultName: 'Publisher',
    dataType: 'options',
    multiValue: true,
    transientSeed: true,
  },
  { key: 'series', defaultName: 'Series', dataType: 'plain' },
  { key: 'shortTitle', defaultName: 'Short Title', dataType: 'plain' },
  {
    key: 'tags',
    defaultName: 'Tags',
    dataType: 'options',
    multiValue: true,
    transientSeed: true,
  },
  { key: 'title', defaultName: 'Title', dataType: 'plain' },
  { key: 'typeDetail', defaultName: 'Type Detail', dataType: 'plain' },
  { key: 'url', defaultName: 'URL', dataType: 'url' },
  { key: 'volume', defaultName: 'Volume', dataType: 'plain' },
  { key: 'year', defaultName: 'Year', dataType: 'number' },
];

// `Object.fromEntries` widens to a string index signature, which TS won't narrow
// back to the literal-keyed Record; the assertion is safe because CATALOG covers
// every FieldKey.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const CATALOG_BY_KEY = Object.fromEntries(
  CATALOG.map((entry) => [entry.key, entry]),
) as Record<FieldKey, CatalogEntry>;

export const FIELD_KEYS: FieldKey[] = CATALOG.map((entry) => entry.key);

/**
 * The name a field is resolved/created under in Tana: the user's rename, or the
 * catalog default when the configured name is blank (the prefs placeholder).
 */
export function effectiveFieldName(key: FieldKey, name: string): string {
  return name.trim() || CATALOG_BY_KEY[key].defaultName;
}

/** The back-link field is immutable (the Zotero item key never changes). */
export const ITEM_FIELD_KEY: FieldKey = 'item';

/** Default name for the reference supertag (user-overridable in preferences). */
export const DEFAULT_TAG_NAME = 'zotero';

/** Fixed names for the auxiliary tags Zotana creates/links. Not user-renamable. */
export const ENTITY_TAG_NAMES: Record<EntityTag, string> = {
  Person: 'Person',
  Organization: 'Organization',
};

/** Bare tag (no fields) applied to highlight/underline annotation quote nodes. */
export const QUOTE_TAG_NAME = 'quote';

/** Tag applied to synced Zotero items so they can be filtered/found. */
export const TANA_TAG_NAME = 'tana';

/** Default Zotero Quick Copy style used when no citation format is configured. */
export const APA_STYLE = 'bibliography=http://www.zotero.org/styles/apa';
