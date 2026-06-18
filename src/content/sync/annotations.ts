/**
 * Read a Zotero item's PDF/EPUB annotations and normalize each to the Tana node
 * it should become. Pure of any Tana I/O — `sync-annotations.ts` consumes these.
 *
 * Mapping (decided with the user):
 *   - highlight / underline -> #quote node; name = selected text, the comment
 *     becomes the node's *description*.
 *   - note / text           -> plain (untagged) node; name = the typed content.
 *   - image                 -> plain placeholder node ("Image annotation (p. N)");
 *                              comment, if any, becomes the description.
 *   - ink                   -> skipped (no text content).
 *
 * `annotationText` is only populated for highlight/underline; every other type
 * carries its content in `annotationComment` (mirrors Zotero's own display-title
 * logic in data/item.js).
 */

export type AnnotationNode = {
  /** Stable Zotero annotation key — the per-annotation upsert key. */
  key: string;
  /** Node name: the quote text, note content, or image placeholder. */
  name: string;
  /** Node description (the annotation comment); empty string when none. */
  description: string;
  /** Supertag to apply (the resolved quote tag id), or null for a plain node. */
  tagId: string | null;
};

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
  quoteTagId: string,
): AnnotationNode | null {
  const key = annotation.key;
  const comment = htmlToPlainText(annotation.annotationComment);

  switch (annotation.annotationType) {
    case 'highlight':
    case 'underline': {
      const text = htmlToPlainText(annotation.annotationText);
      if (!text) return null;
      return { key, name: text, description: comment, tagId: quoteTagId };
    }
    case 'note':
    case 'text': {
      if (!comment) return null;
      return { key, name: comment, description: '', tagId: null };
    }
    case 'image': {
      const page = annotation.annotationPageLabel;
      const name = page ? `Image annotation (p. ${page})` : 'Image annotation';
      return { key, name, description: comment, tagId: null };
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
  quoteTagId: string,
): AnnotationNode[] {
  const attachments = Zotero.Items.get(item.getAttachments(false));

  const annotations: Zotero.Item[] = [];
  for (const attachment of attachments) {
    if (attachment.isFileAttachment()) {
      annotations.push(...attachment.getAnnotations(false));
    }
  }

  annotations.sort((a, b) =>
    a.annotationSortIndex.localeCompare(b.annotationSortIndex),
  );

  return annotations
    .map((annotation) => buildAnnotationNode(annotation, quoteTagId))
    .filter((node): node is AnnotationNode => node !== null);
}
