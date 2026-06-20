import { TANA_TAG_NAME } from '../tana/constants';
import { isObject } from '../utils';

/**
 * Zotero-side storage of the Tana sync state for an item.
 *
 * A child link-attachment titled "Tana" (visible under the item, not hidden)
 * acts as the durable record so re-syncs can find and update the existing Tana
 * node. We store the Tana node ID (the upsert key), the last-synced title (used
 * to skip the rename call when unchanged), and the per-annotation node map.
 */

const TANA_SYNC_DATA_ID = 'tana-sync-data';
const TANA_LINK_TITLE = 'Tana';

/** Last-synced state of one annotation's Tana node (the per-annotation upsert). */
export type StoredAnnotation = {
  nodeId: string;
  /** Last-synced node name + description, to detect in-place changes. */
  name: string;
  description: string;
  /**
   * Epoch ms when this annotation's Tana node was created. Drives the same
   * index-lag grace the reference node uses (`createdAt` on `TanaSyncData`): a
   * reachability search miss within a short grace of creation is treated as the
   * search index not having caught up yet (keep), not as a deleted node
   * (recreate). Set on create, preserved across in-place updates; absent for
   * annotations synced before this existed (backfilled on the next sync).
   */
  createdAt?: number;
  /**
   * Last-written 1-based reading-order rank, to detect when an annotation's
   * position shifted (an insert/delete moves the ones after it) and rewrite its
   * `Order` field. Absent for annotations synced before this existed.
   */
  order?: number;
};

export type TanaSyncData = {
  nodeId: string;
  title: string;
  /**
   * Field attribute ID -> last-synced value signature. Lets a re-sync write only
   * the fields whose value actually changed, instead of replacing every field
   * each time (each `setFieldContent` replace trashes the prior value node, so an
   * unconditional rewrite buried a pile of nodes in the Tana trash every sync).
   */
  fields: Record<string, string>;
  /**
   * Network-free signature of the item's synced source content at the last sync
   * (see `sync/content-signature.ts`). The sync-on-modify path compares the
   * current signature against this to skip syncs that would be a no-op (edits to
   * non-synced or volatile fields). Absent for items synced before this existed.
   */
  contentSig?: string;
  /**
   * Epoch ms when this Tana node was created. Lets the reachability check tell a
   * freshly-created node that Tana's search index hasn't caught up to yet (keep)
   * from one that's genuinely gone (rebuild) — a search miss within a short grace
   * of creation is treated as index lag. Set only on create, preserved across
   * in-place updates; absent for items synced before this existed.
   */
  createdAt?: number;
  /** Zotero annotation key -> its Tana node state. */
  annotations: Record<string, StoredAnnotation>;
};

/**
 * Best-effort clickable Tana link for the attachment URL. The durable data lives
 * in the attachment note (below); this URL is convenience only.
 *
 * `tana:<nodeId>` is Tana's own deep-link scheme (the form its Local API emits in
 * read-node markdown, verified 2026-06-17); it opens the node in the desktop app.
 */
function tanaNodeURL(nodeId: string): string {
  return `tana:${encodeURIComponent(nodeId)}`;
}

function readSyncData(attachment: Zotero.Item): TanaSyncData | undefined {
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(attachment.getNote(), 'text/html');
  const json = doc.getElementById(TANA_SYNC_DATA_ID)?.innerHTML;
  if (!json) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  if (!isObject(parsed) || typeof parsed.nodeId !== 'string') return undefined;

  return {
    nodeId: parsed.nodeId,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    fields: parseFields(parsed.fields),
    contentSig:
      typeof parsed.contentSig === 'string' ? parsed.contentSig : undefined,
    createdAt:
      typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    annotations: parseAnnotations(parsed.annotations),
  };
}

/** Parse the persisted field-signature map, dropping any non-string entries. */
function parseFields(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, signature] of Object.entries(value)) {
    if (typeof signature === 'string') result[key] = signature;
  }
  return result;
}

/** Parse the persisted annotation map, dropping any malformed entries. */
function parseAnnotations(value: unknown): Record<string, StoredAnnotation> {
  if (!isObject(value)) return {};

  const result: Record<string, StoredAnnotation> = {};
  for (const [key, record] of Object.entries(value)) {
    if (
      isObject(record) &&
      typeof record.nodeId === 'string' &&
      typeof record.name === 'string' &&
      typeof record.description === 'string'
    ) {
      result[key] = {
        nodeId: record.nodeId,
        name: record.name,
        description: record.description,
        createdAt:
          typeof record.createdAt === 'number' ? record.createdAt : undefined,
        order: typeof record.order === 'number' ? record.order : undefined,
      };
    }
  }
  return result;
}

function getAllTanaLinkAttachments(item: Zotero.Item): Zotero.Item[] {
  const attachmentIDs = item
    .getAttachments(false)
    .slice()
    // Sort to get largest ID first
    .toSorted((a, b) => b - a);

  return Zotero.Items.get(attachmentIDs).filter(
    (attachment) => readSyncData(attachment) !== undefined,
  );
}

export function getTanaLinkAttachment(
  item: Zotero.Item,
): Zotero.Item | undefined {
  return getAllTanaLinkAttachments(item)[0];
}

export function getTanaSyncData(item: Zotero.Item): TanaSyncData | undefined {
  const attachment = getTanaLinkAttachment(item);
  return attachment && readSyncData(attachment);
}

function buildAttachmentNote(data: TanaSyncData): string {
  const note = `
<h2 style="background-color: #ff666680;">Do not modify or delete!</h2>
<p>This link attachment lets Zotana update the Tana node for this item.</p>
<p>Last synced: ${new Date().toLocaleString()}</p>
`;
  return `${note}<pre id="${TANA_SYNC_DATA_ID}">${JSON.stringify(data)}</pre>`;
}

export async function saveTanaSyncData(
  item: Zotero.Item,
  data: TanaSyncData,
): Promise<void> {
  const attachments = getAllTanaLinkAttachments(item);

  if (attachments.length > 1) {
    const attachmentIDs = attachments.slice(1).map(({ id }) => id);
    await Zotero.Items.erase(attachmentIDs);
  }

  let attachment = attachments[0];
  const url = tanaNodeURL(data.nodeId);

  if (attachment) {
    attachment.setField('url', url);
  } else {
    attachment = await Zotero.Attachments.linkFromURL({
      parentItemID: item.id,
      title: TANA_LINK_TITLE,
      url,
      saveOptions: { skipNotifier: true },
    });
  }

  attachment.setNote(buildAttachmentNote(data));
  // skipNotifier so persisting our own sync data doesn't emit a notification that
  // re-enters the sync path (matches the create branch above and saveTanaTag).
  await attachment.saveTx({ skipNotifier: true });
}

export async function saveTanaTag(item: Zotero.Item): Promise<void> {
  item.addTag(TANA_TAG_NAME);
  await item.saveTx({ skipNotifier: true });
}
