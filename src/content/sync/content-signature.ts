/**
 * Network-free change detection for the auto-sync (sync-on-modify) path.
 *
 * Zotero's `item.modify` notifier fires for *any* edit to an item, even edits to
 * fields that aren't synced to Tana. Syncing on every one of those is wasteful (a
 * network round-trip + a ProgressWindow) when the synced content didn't actually
 * change. `contentSignature` produces a stable string of an item's synced *source*
 * content; if it matches the signature stored at the last sync, the re-sync would
 * be a no-op and the modify path skips it. Manual menu syncs do not use this.
 *
 * It is computed entirely from the live Zotero item + the local schema config — no
 * Tana schema or network is needed, because change detection compares field VALUES
 * and `fieldSignature` does not depend on Tana attribute IDs.
 */

import { getSchemaConfig, type SchemaConfig } from '../prefs/schema-config';
import {
  ENTITY_TAG_NAMES,
  effectiveFieldName,
  type EntityTag,
  type FieldKey,
} from '../tana/constants';
import { buildReference } from '../tana/reference-builder';
import type { ResolvedField, ResolvedSchema } from '../tana/schema';
import type { TanaField, TanaReferenceNode } from '../tana/tana-paste';

import { getCitationFormat, getTitleFormat } from './sync-config';

/**
 * Catalog fields excluded from change detection. They either change on every edit
 * (`dateModified`) or are derived from synced source fields (`year` from `date`,
 * the citations from creators/title/date), so a real change always shows up in a
 * source field too. Excluding them means a cosmetic edit — or an edit to a field
 * that isn't synced — doesn't trigger an auto-sync. They are still written to Tana
 * on a real sync; they just never trigger one on their own.
 */
const NON_TRIGGERING_KEYS: ReadonlySet<string> = new Set<FieldKey>([
  'dateModified',
  'year',
  'fullCitation',
  'inTextCitation',
]);

/**
 * A stable string representation of a field's current value, used to detect
 * whether a re-sync needs to rewrite it. Scalar fields compare by their value;
 * link fields compare by their `tag:name` list (names, not resolved node IDs, so
 * an unchanged author list skips both resolution and the write).
 */
export function fieldSignature(field: TanaField): string {
  if (field.type === 'links') {
    return field.links.map((link) => `${link.tag}:${link.name}`).join(' ');
  }
  if (field.type === 'optionList') {
    return field.values.join('\n');
  }
  return field.value;
}

/**
 * A network-free signature of an item's synced source content. Two computations
 * that produce the same signature would write the same Tana fields (ignoring
 * derived/volatile fields), so a re-sync between them is a no-op.
 */
export async function contentSignature(item: Zotero.Item): Promise<string> {
  const config = getSchemaConfig();
  const node = await buildReference({
    item,
    schema: localSchema(config),
    citationFormat: getCitationFormat(),
    titleFormat: getTitleFormat(),
  });
  return serialize(node);
}

function serialize(node: TanaReferenceNode): string {
  const entries: string[] = [];
  for (const field of node.fields) {
    if (field.type === 'item') continue; // immutable back-link
    // `localSchema` sets each field's id to its catalog key.
    if (NON_TRIGGERING_KEYS.has(field.id)) continue;
    entries.push(`${field.id}=${fieldSignature(field)}`);
  }
  return entries.toSorted().join('\n');
}

/**
 * A `ResolvedSchema` stand-in built from the local config, with each enabled
 * field's `id` set to its catalog key (not a Tana attribute ID). `buildReference`
 * only reads `fields`, `tagName`, and `tagId`, so the entity/quote/workspace IDs
 * are unused placeholders — this lets us build the reference node without touching
 * Tana, and keys the resulting fields by catalog key for `NON_TRIGGERING_KEYS`.
 */
function localSchema(config: SchemaConfig): ResolvedSchema {
  const fields: Partial<Record<FieldKey, ResolvedField>> = {};
  for (const field of config.fields) {
    if (!field.enabled) continue;
    fields[field.key] = {
      id: field.key,
      name: effectiveFieldName(field.key, field.name),
    };
  }
  const entityTagIds: Record<EntityTag, string> = {
    Person: '',
    Organization: '',
  };
  const emptyAnnotationTag = {
    tagId: '',
    annotationFieldId: '',
    pageFieldId: '',
    orderFieldId: '',
  };
  return {
    workspaceId: '',
    tagId: '',
    tagName: config.tagName,
    entityTagIds,
    // Constant names (not config) keep the signature stable when a user renames
    // an entity tag — the signature tracks item content, not schema naming.
    entityTagNames: { ...ENTITY_TAG_NAMES },
    annotationTags: {
      highlight: emptyAnnotationTag,
      comment: emptyAnnotationTag,
      image: emptyAnnotationTag,
    },
    fields,
  };
}
