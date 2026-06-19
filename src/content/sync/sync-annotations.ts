/**
 * Per-annotation upsert: reconcile an item's current Zotero annotations with the
 * quote/note nodes already under its #reference node in Tana.
 *
 * Each annotation is keyed by its stable Zotero key. On every sync we:
 *   - create a node for a key we've never synced (under the reference node),
 *   - update name/description in place when the text or comment changed,
 *   - trash the node for a key that has disappeared from Zotero,
 *   - leave unchanged annotations untouched (no API writes).
 *
 * Node names are set via `update` (a literal string) rather than baked into the
 * imported Tana Paste, because highlight text can contain Paste-significant
 * characters (`#`, `::`, `[[`). The Paste import only carries a placeholder name
 * plus the supertag; the real text is written afterwards.
 */

import type { StoredAnnotation } from '../data/item-data';
import { LocalizableError } from '../errors';
import { TanaApiError, type TanaClient } from '../tana/client';
import type { AnnotationKind } from '../tana/constants';
import type { ResolvedAnnotationTag } from '../tana/schema';
import { logger } from '../utils';

import { readItemAnnotations, type AnnotationNode } from './annotations';

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

  for (const annotation of current) {
    const previous = stored[annotation.key];
    const nodeId = previous
      ? await updateAnnotationNode(
          client,
          referenceNodeId,
          previous,
          annotation,
        )
      : await createAnnotationNode(client, referenceNodeId, annotation);

    result[annotation.key] = {
      nodeId,
      name: annotation.name,
      description: annotation.description,
    };
  }

  // Trash nodes for annotations removed from Zotero since the last sync.
  for (const [key, record] of Object.entries(stored)) {
    if (!result[key]) {
      logger.debug('Trashing Tana node for removed annotation', key);
      await client.trash(record.nodeId);
    }
  }

  return result;
}

async function createAnnotationNode(
  client: TanaClient,
  referenceNodeId: string,
  annotation: AnnotationNode,
): Promise<string> {
  // Carry the back-link in the paste (as a markdown link, so it imports as a
  // clickable URL node) under the tag's Annotation field. The link is stable per
  // annotation, so it's only ever written here — never on the update path.
  const paste = [
    '%%tana%%',
    `- ${PLACEHOLDER_NAME} #[[^${annotation.tagId}]]`,
    `  - [[^${annotation.annotationFieldId}]]:: [${annotation.link}](${annotation.link})`,
  ].join('\n');
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

  return created.id;
}

/** Update an existing annotation node in place, writing only what changed. */
async function updateAnnotationNode(
  client: TanaClient,
  referenceNodeId: string,
  previous: StoredAnnotation,
  annotation: AnnotationNode,
): Promise<string> {
  const fields: { name?: string; description?: string | null } = {};
  if (previous.name !== annotation.name) fields.name = annotation.name;
  if (previous.description !== annotation.description) {
    // A cleared comment must explicitly clear the description.
    fields.description = annotation.description || null;
  }

  if (fields.name === undefined && fields.description === undefined) {
    return previous.nodeId;
  }

  try {
    await client.update(previous.nodeId, fields);
    return previous.nodeId;
  } catch (error) {
    if (error instanceof TanaApiError && error.status === 404) {
      // The quote node was hard-deleted in Tana — recreate it (mirrors the
      // reference-node rebuild). A merely-trashed node returns 200, so this
      // only fires for a node purged from trash.
      logger.debug('Recreating hard-deleted annotation node', annotation.key);
      return createAnnotationNode(client, referenceNodeId, annotation);
    }
    throw error;
  }
}
