import {
  getTanaSyncData,
  saveTanaSyncData,
  saveTanaTag,
  type TanaSyncData,
} from '../data/item-data';
import { LocalizableError } from '../errors';
import { type TanaClient } from '../tana/client';
import { buildReference } from '../tana/reference-builder';
import type { ResolvedSchema } from '../tana/schema';
import {
  toTanaPaste,
  type TanaField,
  type TanaLink,
  type TanaReferenceNode,
} from '../tana/tana-paste';
import { logger } from '../utils';

import { contentSignature, fieldSignature } from './content-signature';
import { syncAnnotations } from './sync-annotations';
import type { SyncJobParams } from './sync-job';

/**
 * Sync one regular item. Returns the display names of any fields that were left
 * unchanged because their Tana value node is referenced by other nodes (so the
 * caller can warn the user). Empty array = nothing skipped.
 */
export async function syncRegularItem(
  item: Zotero.Item,
  {
    client,
    schema,
    parentNodeId,
    entityParentNodeId,
    citationFormat,
    titleFormat,
  }: SyncJobParams,
): Promise<string[]> {
  const node = await buildReference({
    item,
    schema,
    citationFormat,
    titleFormat,
  });
  const stored = getTanaSyncData(item);

  // A previously-synced node that is no longer reachable in Tana is rebuilt from
  // scratch: a hard-purged node (404), a manually-trashed node, or an orphaned
  // "ghost" (readable by ID but detached from every tree when its trash was
  // emptied). readNode can't tell a usable node from a dead one — all but a hard
  // purge return 200 — so reachability is decided by search instead.
  const existing =
    stored && (await nodeReachable(client, schema, stored))
      ? stored
      : undefined;

  let nodeId: string;
  let signatures: Record<string, string>;
  let referencedFields: string[] = [];
  // Stamp the create time on create; preserve it across in-place updates so the
  // index-lag grace stays anchored to when the node was actually created.
  let createdAt: number | undefined;
  // Stamp the (re)name time on create and on any rename; preserve it otherwise.
  // The reachability grace keys off this so a rename's index lag isn't mistaken
  // for a deleted node (which rebuilt a duplicate). See nodeReachable.
  let titleSyncedAt: number | undefined;

  if (existing) {
    const result = await updateNode(
      client,
      schema,
      existing,
      node,
      entityParentNodeId,
    );
    ({ nodeId, signatures, referencedFields } = result);
    createdAt = existing.createdAt;
    const renamed = existing.title !== node.title;
    titleSyncedAt = renamed
      ? Date.now()
      : (existing.titleSyncedAt ?? existing.createdAt);
  } else {
    nodeId = await createNode(client, schema, node, parentNodeId);
    signatures = fieldSignatures(node);
    createdAt = Date.now();
    titleSyncedAt = createdAt;
  }

  const {
    annotations,
    containerId: annotationsContainerId,
    referencedAnnotations,
  } = await syncAnnotations(
    client,
    schema.annotationTags,
    item,
    nodeId,
    schema.annotationsFieldId,
    existing?.annotationsContainerId,
    existing?.annotations ?? {},
    schema.workspaceId,
  );

  // Tag the item first so its content signature is computed at steady state:
  // `saveTanaTag` adds the `tana` tag, which `getTags()` (and thus the signature)
  // includes. Snapshotting before it would differ from every later modify-path
  // computation, forcing one needless re-sync. (skipNotifier → no sync loop.)
  await saveTanaTag(item);
  await saveTanaSyncData(item, {
    nodeId,
    title: node.title,
    fields: signatures,
    // Network-free snapshot of the synced source content, recomputed with the
    // same helper the modify path uses so a no-op edit produces an equal value.
    contentSig: await contentSignature(item),
    createdAt,
    titleSyncedAt,
    annotationsContainerId,
    annotations,
  });

  // Field-level and annotation-level warn-and-skips share one warning channel.
  return [...referencedFields, ...referencedAnnotations];
}

/** Signatures for every writable field (the back-link is immutable, excluded). */
function fieldSignatures(node: TanaReferenceNode): Record<string, string> {
  const signatures: Record<string, string> = {};
  for (const field of node.fields) {
    if (field.type === 'item') continue;
    signatures[field.id] = fieldSignature(field);
  }
  return signatures;
}

/**
 * Whether a previously-synced reference node is still reachable in Tana.
 *
 * `readNode` returns 200 for a live node, a merely-trashed node, AND an orphaned
 * "ghost" (a node detached from every tree when its trash is emptied but not yet
 * garbage-collected), so it can't distinguish a usable node from a dead one — only
 * a hard purge 404s. A node that is reachable in the tree shows up in `search`;
 * trashed, orphaned, and purged nodes do not. So we search by the last-synced name
 * + #reference tag and confirm the stored node ID is among the hits. When it's
 * unreachable the caller discards the stale link and rebuilds, so the reference
 * reappears instead of being silently written into a dead node.
 *
 * Limitation (matches resolveEntityNodeId): substring search capped at 50 hits, so
 * a title sharing its text with 50+ other references could miss — vanishingly rare
 * for an author-date title, and the cost of a false "unreachable" is just a rebuild.
 */
/**
 * Tana's search index can lag a few seconds behind a freshly created OR renamed
 * node, so a reachability search miss right after either is "not yet indexed", not
 * "gone". Index lag is short and self-correcting; trashing is permanent — so a miss
 * within this window of the node's last (re)name is trusted (keep), and a later
 * miss is real (rebuild). Anchored to `titleSyncedAt` (the search term is the node
 * name, so its lag is what matters): a node not renamed in hours is past its window
 * and still rebuilds correctly, while a title-format change + quick re-sync no
 * longer search-misses into a duplicate.
 */
export const INDEX_LAG_GRACE_MS = 30_000;

async function nodeReachable(
  client: TanaClient,
  schema: ResolvedSchema,
  stored: TanaSyncData,
): Promise<boolean> {
  const results = await client.search(
    { and: [{ hasType: schema.tagId }, { textContains: stored.title }] },
    { limit: 50, workspaceIds: [schema.workspaceId] },
  );
  // `/nodes/search` returns trashed nodes too (with `inTrash: true`), so a node
  // the user trashed in Tana must NOT count as reachable — otherwise we'd update
  // it in place inside the trash instead of rebuilding it.
  if (results.some((node) => node.id === stored.nodeId && !node.inTrash))
    return true;

  // Search miss: a node we (re)named moments ago that the index hasn't caught up
  // to, or one genuinely trashed/orphaned/purged. Tell them apart by the age of the
  // last (re)name — no readNode (which can't distinguish a live node from a
  // trashed/orphaned one anyway). `titleSyncedAt` falls back to `createdAt` for
  // items synced before it existed.
  const anchor = stored.titleSyncedAt ?? stored.createdAt;
  return anchor !== undefined && Date.now() - anchor <= INDEX_LAG_GRACE_MS;
}

/** An options-typed field (single-value `options` or multi-value `optionList`). */
function isOptionField(field: TanaField): boolean {
  return field.type === 'options' || field.type === 'optionList';
}

/**
 * Write an options field's value(s). A value that matches a known option for this
 * field (predefined or previously auto-collected, from `schema.optionsByFieldId`)
 * is written BY ID via `setFieldOption`, reusing that option node. A value with no
 * matching option falls back to a string write, which auto-collects and dedupes a
 * fresh option by text. This split matters because a string write whose text
 * collides with a pre-existing template-defined option does NOT dedupe against it —
 * it mints a new detached value node every sync (live-verified; the duplication
 * bug this fixes). First value replaces, the rest append (multi-value fields).
 */
async function writeOptionsField(
  client: TanaClient,
  schema: ResolvedSchema,
  nodeId: string,
  field: TanaField,
): Promise<void> {
  if (field.type !== 'options' && field.type !== 'optionList') return;
  const values = field.type === 'optionList' ? field.values : [field.value];
  const options = schema.optionsByFieldId.get(field.id);
  for (const [index, value] of values.entries()) {
    const mode = index === 0 ? 'replace' : 'append';
    const optionId = options?.get(value);
    if (optionId) {
      await client.setFieldOption(nodeId, field.id, optionId, mode);
    } else {
      await client.setFieldContent(nodeId, field.id, value, mode);
    }
  }
}

async function createNode(
  client: TanaClient,
  schema: ResolvedSchema,
  node: TanaReferenceNode,
  parentNodeId: string,
): Promise<string> {
  // Options fields are written by id AFTER import (see writeOptionsField): a value
  // colliding with a pre-existing option won't dedupe through the paste either, so
  // emit everything else inline and resolve options against the schema afterward.
  const paste = toTanaPaste({
    ...node,
    fields: node.fields.filter((field) => !isOptionField(field)),
  });
  logger.debug('Importing new Tana node under', parentNodeId);
  const result = await client.import(parentNodeId, paste);

  // The tagged #reference node carries the visible name; field-value nodes come
  // back empty-named.
  const created =
    result.createdNodes.find(({ name }) => name === node.title) ??
    result.createdNodes.find(({ name }) => name);

  if (!created) {
    throw new LocalizableError(
      'Tana import did not return a created node ID',
      'zotana-error-import-no-node-id',
    );
  }

  for (const field of node.fields) {
    if (field.type === 'options' || field.type === 'optionList') {
      await writeOptionsField(client, schema, created.id, field);
    }
  }

  return created.id;
}

type UpdateResult = {
  nodeId: string;
  /** Reconciled field signatures to persist (skipped fields keep their old one). */
  signatures: Record<string, string>;
  /** Display names of fields left unchanged because their value node is referenced. */
  referencedFields: string[];
};

/**
 * Update an existing Tana node in place, writing only what changed since the last
 * sync. Each field's value is compared against the signature stored on the Zotero
 * item; unchanged fields are skipped entirely. This matters because Tana
 * implements a `setFieldContent` replace by trashing the previous value node — an
 * unconditional rewrite of every field buried ~20 nodes in the trash each sync.
 *
 * Before overwriting or clearing a field, we protect any value node that is BOTH
 * owned by this reference (so the write would trash it) AND referenced by another
 * Tana node (which would break that reference). Such a field is left untouched and
 * reported back so the user can resolve it in Tana; its old signature is kept so
 * the next sync retries. Scalar value nodes are always owned, so for them this is
 * just a reference check. Entity nodes (options from supertags → #Person/#Org) are
 * normally owned by the Library, not us, so re-pointing them is safe and skips the
 * check — UNLESS the user swapped the original into our field (Tana allows that),
 * in which case we own it and protect it too.
 *
 * Only fields that were set last sync but are now absent get cleared (set → empty
 * in Zotero). The `Item` back-link is immutable (the Zotero item key never
 * changes) and skipped.
 */
async function updateNode(
  client: TanaClient,
  schema: ResolvedSchema,
  existing: TanaSyncData,
  node: TanaReferenceNode,
  entityParentNodeId: string,
): Promise<UpdateResult> {
  const { nodeId } = existing;
  const previous = existing.fields;
  logger.debug('Updating Tana node', nodeId, 'in place');

  if (existing.title !== node.title) {
    await client.update(nodeId, { name: node.title });
  }

  const signatures: Record<string, string> = {};
  const referencedFields: string[] = [];
  const presentIds = new Set<string>();

  // Read Tana state once, only if we'll actually write or clear something: the
  // set of nodes this reference owns, and each field's current value node id(s).
  const touch = willWriteOrClear(schema, node, previous);
  const ownedIds = touch
    ? await ownedNodeIds(client, nodeId, schema.workspaceId)
    : new Set<string>();
  const valueNodeIds = touch
    ? parseFieldValueNodeIds((await client.readNode(nodeId, 2)).markdown)
    : {};

  // A field is protected if one of its current value nodes is owned by us AND
  // referenced elsewhere — overwriting/clearing it would trash a node others link to.
  const isProtected = async (fieldName: string): Promise<boolean> => {
    for (const id of valueNodeIds[fieldName] ?? []) {
      if (
        ownedIds.has(id) &&
        (await isReferenced(client, id, schema.workspaceId))
      )
        return true;
    }
    return false;
  };

  for (const field of node.fields) {
    if (field.type === 'item') continue; // immutable back-link
    presentIds.add(field.id);

    const signature = fieldSignature(field);
    if (previous[field.id] === signature) {
      signatures[field.id] = signature; // unchanged → no write
      continue;
    }

    if (await isProtected(field.name)) {
      referencedFields.push(field.name);
      // Keep the old signature so the next sync detects the change and retries.
      const prior = previous[field.id];
      if (prior !== undefined) signatures[field.id] = prior;
      continue;
    }

    if (field.type === 'links') {
      // Entity fields (Creators/Editors/Contributors/Publisher) are Options
      // fields holding #Person/#Organization nodes. Resolve each name to its
      // entity node id and write it by id via setFieldOption — which links the
      // existing node and auto-collects it (no duplicates). setFieldContent on an
      // options field would store the id as junk literal text.
      const ids: string[] = [];
      for (const link of field.links) {
        ids.push(
          await resolveEntityNodeId(client, schema, link, entityParentNodeId),
        );
      }
      for (const [index, id] of ids.entries()) {
        await client.setFieldOption(
          nodeId,
          field.id,
          id,
          index === 0 ? 'replace' : 'append',
        );
      }
    } else if (field.type === 'options' || field.type === 'optionList') {
      await writeOptionsField(client, schema, nodeId, field);
    } else {
      // plain/url/number/options set by string; date fields take the bare ISO
      // value (no [[date:]] wrapper) via the API.
      await client.setFieldContent(nodeId, field.id, field.value);
    }
    signatures[field.id] = signature;
  }

  // Clear enabled fields that were set last sync but are now absent. Same
  // protection: a clear also trashes the value node. Fields never set, disabled
  // fields, and the immutable back-link are skipped.
  const itemFieldId = schema.fields.item?.id;
  for (const field of Object.values(schema.fields)) {
    const { id, name } = field;
    const prior = previous[id];
    if (id === itemFieldId || presentIds.has(id) || prior === undefined) {
      continue;
    }

    if (await isProtected(name)) {
      referencedFields.push(name);
      signatures[id] = prior; // keep so the clear is retried
      continue;
    }
    await client.setFieldContent(nodeId, id, null);
  }

  return { nodeId, signatures, referencedFields };
}

/** Whether the update will write a changed field or clear a previously-set one. */
function willWriteOrClear(
  schema: ResolvedSchema,
  node: TanaReferenceNode,
  previous: Record<string, string>,
): boolean {
  const writes = node.fields.some(
    (field) =>
      field.type !== 'item' && previous[field.id] !== fieldSignature(field),
  );
  if (writes) return true;

  const presentIds = new Set(node.fields.map((field) => field.id));
  const itemFieldId = schema.fields.item?.id;
  return Object.values(schema.fields).some(
    ({ id }) =>
      id !== itemFieldId && previous[id] !== undefined && !presentIds.has(id),
  );
}

/**
 * The ids of every node this reference owns (its field values + annotations).
 *
 * `recursive` is omitted deliberately: the Local API validates it as a real
 * boolean and rejects the string `"true"` that a GET query string carries (400
 * "expected boolean, received string"), with no coercion. Its documented default
 * is already `true`, so omitting it gives the recursive set we want.
 */
async function ownedNodeIds(
  client: TanaClient,
  nodeId: string,
  workspaceId: string,
): Promise<Set<string>> {
  const owned = await client.search(
    { ownedBy: { nodeId } },
    { limit: 1000, workspaceIds: [workspaceId] },
  );
  return new Set(owned.map((node) => node.id));
}

/** Whether any LIVE node links to (references) the given node. */
export async function isReferenced(
  client: TanaClient,
  nodeId: string,
  workspaceId: string,
): Promise<boolean> {
  // `/nodes/search` includes trashed nodes; a trashed linker isn't a real
  // reference, so fetch a page and require at least one live one (don't `limit: 1`,
  // or a single trashed linker would falsely protect the field).
  const refs = await client.search(
    { linksTo: [nodeId] },
    { limit: 50, workspaceIds: [workspaceId] },
  );
  return refs.some((ref) => !ref.inTrash);
}

/**
 * Map field display name -> its current value node id(s), parsed from a depth-2
 * readNode markdown. Scalar fields carry an inline `<!-- node-id: id -->`; entity
 * fields render their references as `[name](tana:id)`, either inline (single
 * value) or as indented child bullets (multiple values).
 */
function parseFieldValueNodeIds(markdown: string): Record<string, string[]> {
  const ids: Record<string, string[]> = {};
  const add = (name: string, id: string) => {
    (ids[name] ??= []).push(id);
  };

  let currentField: string | null = null;
  let fieldIndent = 0;

  for (const line of markdown.split('\n')) {
    const header = /^(\s*)-\s*\*\*(.+?)\*\*:(.*)$/.exec(line);
    if (header) {
      const indent = header[1] ?? '';
      const name = header[2];
      const rest = header[3] ?? '';
      if (!name) continue;
      currentField = name;
      fieldIndent = indent.length;

      const inline =
        /<!-- node-id: ([A-Za-z0-9_-]+) -->/.exec(rest) ??
        /\(tana:([A-Za-z0-9_-]+)\)/.exec(rest);
      if (inline?.[1]) add(name, inline[1]);
      continue;
    }

    if (currentField) {
      const child = /^(\s*)-\s*\[.*?\]\(tana:([A-Za-z0-9_-]+)\)/.exec(line);
      if (child?.[2] && (child[1]?.length ?? 0) > fieldIndent) {
        add(currentField, child[2]);
      }
    }
  }

  return ids;
}

/**
 * Resolve a Person/Organization name to a Tana node ID, creating the entity node
 * if it does not already exist. Tana has no exact-name search operator, so we
 * substring-search by tag and match the name exactly client-side. New entities
 * are created under `entityParentNodeId` (the workspace Library), matching where
 * the create path's inline `[[Name #Person]]` references are filed.
 */
async function resolveEntityNodeId(
  client: TanaClient,
  schema: ResolvedSchema,
  link: TanaLink,
  entityParentNodeId: string,
): Promise<string> {
  const tagId = schema.entityTagIds[link.tag];

  const results = await client.search(
    { and: [{ hasType: tagId }, { textContains: link.name }] },
    { limit: 50, workspaceIds: [schema.workspaceId] },
  );
  const exact = results.find((n) => !n.inTrash && n.name === link.name);
  if (exact) return exact.id;

  const paste = `%%tana%%\n- ${link.name} #[[^${tagId}]]`;
  const result = await client.import(entityParentNodeId, paste);
  const created =
    result.createdNodes.find(({ name }) => name === link.name) ??
    result.createdNodes.find(({ name }) => name);

  if (!created) {
    throw new LocalizableError(
      `Failed to create Tana ${link.tag} node for "${link.name}"`,
      'zotana-error-import-no-node-id',
    );
  }

  return created.id;
}
