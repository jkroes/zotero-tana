/**
 * Read a Zotero item's PDF/EPUB annotations and normalize each to the Tana node
 * it should become. Pure of any Tana I/O — `sync-annotations.ts` consumes these.
 *
 * Mapping (decided with the user):
 *   - highlight / underline -> #highlight node; name = selected text, the comment
 *     becomes the node's *description*.
 *   - note / text           -> #comment node; name = the typed content.
 *   - image                 -> #image placeholder node ("Image annotation");
 *                              comment, if any, becomes the description.
 *   - ink                   -> skipped (no text content).
 *
 * Every node also carries an `Annotation` URL field with a `zotero://open-pdf`
 * deep link back to the annotation in its PDF, and a `Page` field with the
 * annotation's Zotero page label.
 *
 * `annotationText` is only populated for highlight/underline; every other type
 * carries its content in `annotationComment` (mirrors Zotero's own display-title
 * logic in data/item.js).
 */

import type { AnnotationKind } from '../tana/constants';
import type { ResolvedAnnotationTag } from '../tana/schema';

export type AnnotationNode = {
  /** Stable Zotero annotation key — the per-annotation upsert key. */
  key: string;
  /** Node name: the quote text, note content, or image placeholder. */
  name: string;
  /** Node description (the annotation comment); empty string when none. */
  description: string;
  /** Annotation supertag to apply (highlight/comment/image). */
  tagId: string;
  /** The tag's `Annotation` URL field id. */
  annotationFieldId: string;
  /** The tag's `Page` field id. */
  pageFieldId: string;
  /** Zotero page label for the annotation; empty string when none. */
  page: string;
  /** The tag's `Order` (reading-order rank) field id. */
  orderFieldId: string;
  /** `zotero://open-pdf/...?annotation=KEY` deep link to the annotation. */
  link: string;
};

/**
 * `zotero://open-pdf` deep link to an annotation, derived from its PDF
 * attachment. Mirrors the group-vs-library handling in reference-builder's
 * `zoteroLink` (Zotero.Libraries is absent from the bundled type defs).
 */
function annotationLink(
  attachment: Zotero.Item,
  annotationKey: string,
): string {
  const uri = Zotero.URI.getItemURI(attachment);
  const groupMatch = uri.match(/\/groups\/(\d+)\/items\//);
  const base = groupMatch
    ? `zotero://open-pdf/groups/${groupMatch[1]}/items/${attachment.key}`
    : `zotero://open-pdf/library/items/${attachment.key}`;
  return `${base}?annotation=${annotationKey}`;
}

/**
 * Strip any inline HTML from a Zotero annotation field and collapse whitespace.
 * Tana node names/descriptions are single-line, and PDF text extraction litters
 * highlights with newlines, so runs of whitespace collapse to single spaces.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Normalize a single Zotero annotation item, or return null to skip it. */
export function buildAnnotationNode(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  annotationTags: Record<AnnotationKind, ResolvedAnnotationTag>,
): AnnotationNode | null {
  const key = annotation.key;
  const comment = htmlToPlainText(annotation.annotationComment);
  const page = annotation.annotationPageLabel || '';

  const make = (
    kind: AnnotationKind,
    name: string,
    description: string,
  ): AnnotationNode => ({
    key,
    name,
    description,
    tagId: annotationTags[kind].tagId,
    annotationFieldId: annotationTags[kind].annotationFieldId,
    pageFieldId: annotationTags[kind].pageFieldId,
    page,
    orderFieldId: annotationTags[kind].orderFieldId,
    link: annotationLink(attachment, key),
  });

  switch (annotation.annotationType) {
    case 'highlight':
    case 'underline': {
      const text = htmlToPlainText(annotation.annotationText);
      if (!text) return null;
      return make('highlight', text, comment);
    }
    case 'note':
    case 'text': {
      if (!comment) return null;
      return make('comment', comment, '');
    }
    case 'image': {
      // Page lives in the Page field now, not the node name.
      return make('image', 'Image annotation', comment);
    }
    default:
      // 'ink' (and any future type) has no text content — skip.
      return null;
  }
}

/**
 * Read and normalize all of an item's annotations across its file attachments,
 * in reading order (`annotationSortIndex`). Skipped/empty annotations are
 * dropped, so the result is exactly the set of nodes that should exist in Tana.
 */
export function readItemAnnotations(
  item: Zotero.Item,
  annotationTags: Record<AnnotationKind, ResolvedAnnotationTag>,
): AnnotationNode[] {
  const attachments = Zotero.Items.get(item.getAttachments(false));

  // Keep each annotation paired with its attachment — the back-link needs the
  // attachment's key/library.
  const pairs: { annotation: Zotero.Item; attachment: Zotero.Item }[] = [];
  for (const attachment of attachments) {
    if (attachment.isFileAttachment()) {
      for (const annotation of attachment.getAnnotations(false)) {
        pairs.push({ annotation, attachment });
      }
    }
  }

  pairs.sort((a, b) =>
    a.annotation.annotationSortIndex.localeCompare(
      b.annotation.annotationSortIndex,
    ),
  );

  return pairs
    .map(({ annotation, attachment }) =>
      buildAnnotationNode(annotation, attachment, annotationTags),
    )
    .filter((node): node is AnnotationNode => node !== null);
}
