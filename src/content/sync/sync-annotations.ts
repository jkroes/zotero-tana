/**
 * Per-annotation upsert: reconcile an item's current Zotero annotations with the
 * quote/note nodes already under its #reference node in Tana.
 *
 * Each annotation is keyed by its stable Zotero key. On every sync we:
 *   - create a node for a key we've never synced (under the reference node),
 *   - recreate the node for a key whose Tana node is no longer reachable (the
 *     user trashed/deleted it — see the reachability check below),
 *   - update name/description in place when the text or comment changed,
 *   - trash the node for a key that has disappeared from Zotero,
 *   - leave unchanged, still-reachable annotations untouched (no API writes).
 *
 * Node names are set via `update` (a literal string) rather than baked into the
 * imported Tana Paste, because highlight text can contain Paste-significant
 * characters (`#`, `::`, `[[`). The Paste import only carries a placeholder name
 * plus the supertag; the real text is written afterwards.
 */

import type { StoredAnnotation } from '../data/item-data';
import { LocalizableError } from '../errors';
import { TanaApiError, type TanaClient } from '../tana/client';
import { ANNOTATION_TAG_KEYS, type AnnotationKind } from '../tana/constants';
import type { ResolvedAnnotationTag } from '../tana/schema';
import { logger } from '../utils';

import { readItemAnnotations, type AnnotationNode } from './annotations';
import { INDEX_LAG_GRACE_MS } from './sync-regular-item';

/** Parse-safe placeholder name used only between import and the literal rename. */
const PLACEHOLDER_NAME = 'Zotana annotation';

export async function syncAnnotations(
  client: TanaClient,
  annotationTags: Record<AnnotationKind, ResolvedAnnotationTag>,
  item: Zotero.Item,
  referenceNodeId: string,
  stored: Record<string, StoredAnnotation>,
): Promise<Record<string, StoredAnnotation>> {
  const current = readItemAnnotations(item, annotationTags);
  const result: Record<string, StoredAnnotation> = {};

  // Which previously-synced annotation nodes are still alive in Tana? Only worth
  // asking when we have stored nodes to check (a freshly rebuilt reference node
  // passes `stored = {}`, so every annotation is created fresh below). Tana
  // returns 200 when updating a *trashed* node, so a blind update would silently
  // write into a deleted node; this search tells reachable from gone instead
  // (mirrors the reference node's `nodeReachable`).
  const liveNodeIds =
    Object.keys(stored).length > 0
      ? await liveAnnotationNodeIds(client, annotationTags, referenceNodeId)
      : new Set<string>();

  // `current` is in reading order, so each annotation's index is its rank. The
  // rank is written to the Order field and rewritten whenever it shifts.
  for (const [index, annotation] of current.entries()) {
    const order = index + 1;
    const previous = stored[annotation.key];
    const reachable =
      previous !== undefined && isReachable(previous, liveNodeIds);

    result[annotation.key] = reachable
      ? await updateAnnotationNode(
          client,
          referenceNodeId,
          previous,
          annotation,
          order,
        )
      : await createAnnotationNode(client, referenceNodeId, annotation, order);
  }

  // Trash nodes for annotations removed from Zotero since the last sync. Only
  // trash one we know is still alive — a node the user already deleted is gone
  // (and re-trashing a trashed node 400s).
  for (const [key, record] of Object.entries(stored)) {
    if (!result[key] && liveNodeIds.has(record.nodeId)) {
      logger.debug('Trashing Tana node for removed annotation', key);
      await client.trash(record.nodeId);
    }
  }

  return result;
}

/**
 * The set of live (non-trashed) annotation node IDs owned by the reference node.
 *
 * Scoped to the annotation supertags (not a bare `ownedBy`) for two reasons: it
 * returns *only* annotation nodes — excluding each reference's field-value nodes
 * and each annotation's own `Annotation` URL value node — and the search `limit`
 * caps at 1000 with no paging, so narrowing the result keeps the ceiling at
 * ~1000 annotations per item rather than ~500. (An item with more annotations
 * than that would search-miss the overflow and recreate duplicates — rare, and
 * the same class of cap as entity resolution's 50-hit limit.)
 *
 * `ownedBy.recursive` is omitted: the Local API 400s on the string `"true"` a GET
 * query carries, and its default is already `true` (see `ownedNodeIds`).
 */
async function liveAnnotationNodeIds(
  client: TanaClient,
  annotationTags: Record<AnnotationKind, ResolvedAnnotationTag>,
  referenceNodeId: string,
): Promise<Set<string>> {
  // Dedupe in case the user merged annotation tags into one in Tana.
  const tagIds = [
    ...new Set(ANNOTATION_TAG_KEYS.map((kind) => annotationTags[kind].tagId)),
  ];
  const nodes = await client.search(
    {
      and: [
        { ownedBy: { nodeId: referenceNodeId } },
        { or: tagIds.map((id) => ({ hasType: id })) },
      ],
    },
    { limit: 1000 },
  );
  return new Set(nodes.map((node) => node.id));
}

/**
 * Whether a stored annotation node is still usable. Reachable if the search found
 * it live; otherwise trusted only within the index-lag grace of its creation —
 * Tana's search index lags a few seconds behind a freshly created node, so a miss
 * right after a create is "not yet indexed", not "deleted" (same reasoning as the
 * reference node's `nodeReachable`). A node with no `createdAt` (synced before this
 * existed) and a search miss is treated as gone, which is correct: a long-indexed
 * node that the scoped search still misses really is trashed/deleted.
 */
function isReachable(
  previous: StoredAnnotation,
  liveNodeIds: Set<string>,
): boolean {
  if (liveNodeIds.has(previous.nodeId)) return true;
  return (
    previous.createdAt !== undefined &&
    Date.now() - previous.createdAt <= INDEX_LAG_GRACE_MS
  );
}

async function createAnnotationNode(
  client: TanaClient,
  referenceNodeId: string,
  annotation: AnnotationNode,
  order: number,
): Promise<StoredAnnotation> {
  // Carry the back-link in the paste under the tag's Annotation field, as plain
  // text (like every URL field — the user converts URLs to nodes in Tana). The
  // page label goes in the Page field. Both are stable per annotation, so
  // they're only ever written here.
  const lines = [
    '%%tana%%',
    `- ${PLACEHOLDER_NAME} #[[^${annotation.tagId}]]`,
    `  - [[^${annotation.annotationFieldId}]]:: ${annotation.link}`,
  ];
  if (annotation.page) {
    lines.push(`  - [[^${annotation.pageFieldId}]]:: ${annotation.page}`);
  }
  const paste = lines.join('\n');
  const { createdNodes } = await client.import(referenceNodeId, paste);

  // The annotation node is the placeholder-named one (the field-value node the
  // paste also creates carries the URL as its name, so don't match the first name).
  const created =
    createdNodes.find(({ name }) => name === PLACEHOLDER_NAME) ??
    createdNodes[0];
  if (!created) {
    throw new LocalizableError(
      `Tana import did not return a node ID for annotation ${annotation.key}`,
      'zotana-error-import-no-node-id',
    );
  }

  // Set the literal text + comment; placeholder name is replaced here.
  await client.update(created.id, {
    name: annotation.name,
    ...(annotation.description ? { description: annotation.description } : {}),
  });
  // The reading-order rank goes in its own (mutable) Order field.
  await client.setFieldContent(
    created.id,
    annotation.orderFieldId,
    String(order),
  );

  return toStored(created.id, annotation, undefined, order);
}

/** Update a still-reachable annotation node in place, writing only what changed. */
async function updateAnnotationNode(
  client: TanaClient,
  referenceNodeId: string,
  previous: StoredAnnotation,
  annotation: AnnotationNode,
  order: number,
): Promise<StoredAnnotation> {
  const fields: { name?: string; description?: string | null } = {};
  if (previous.name !== annotation.name) fields.name = annotation.name;
  if (previous.description !== annotation.description) {
    // A cleared comment must explicitly clear the description.
    fields.description = annotation.description || null;
  }
  const nameOrDescChanged =
    fields.name !== undefined || fields.description !== undefined;
  // Rewrite Order whenever the rank shifted (an insert/delete moves the ones
  // after it). A missing stored order (pre-Order annotation) counts as changed.
  const orderChanged = previous.order !== order;

  if (!nameOrDescChanged && !orderChanged) {
    // Unchanged and still reachable — keep the node, backfilling createdAt for an
    // annotation synced before it was tracked.
    return toStored(previous.nodeId, annotation, previous.createdAt, order);
  }

  try {
    if (nameOrDescChanged) await client.update(previous.nodeId, fields);
    if (orderChanged) {
      await client.setFieldContent(
        previous.nodeId,
        annotation.orderFieldId,
        String(order),
      );
    }
    return toStored(previous.nodeId, annotation, previous.createdAt, order);
  } catch (error) {
    if (error instanceof TanaApiError && error.status === 404) {
      // Backstop: the reachability search said live but the node was purged
      // between then and this write (or its `createdAt` grace let a missing node
      // through). Recreate it, stamping a fresh createdAt.
      logger.debug('Recreating hard-deleted annotation node', annotation.key);
      return createAnnotationNode(client, referenceNodeId, annotation, order);
    }
    throw error;
  }
}

/**
 * Build the stored record for an annotation. `createdAt` is preserved when given
 * (in-place update of an existing node) and stamped fresh otherwise (create, or
 * backfill for a pre-tracking annotation). `order` is the rank just written.
 */
function toStored(
  nodeId: string,
  annotation: AnnotationNode,
  createdAt: number | undefined,
  order: number,
): StoredAnnotation {
  return {
    nodeId,
    name: annotation.name,
    description: annotation.description,
    createdAt: createdAt ?? Date.now(),
    order,
  };
}
