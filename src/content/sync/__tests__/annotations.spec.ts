import { beforeEach, describe, expect, it } from 'vite-plus/test';

import { createZoteroItemMock, zoteroMock } from '../../../../test/utils';
import { buildAnnotationNode, readItemAnnotations } from '../annotations';

const annotationTags = {
  highlight: { tagId: 'highlight-tag', annotationFieldId: 'hl-field' },
  comment: { tagId: 'comment-tag', annotationFieldId: 'cm-field' },
  image: { tagId: 'image-tag', annotationFieldId: 'im-field' },
};

// A PDF attachment the annotations belong to; its key drives the back-link.
const attachment = createZoteroItemMock();

const openPdfLink = (annotationKey: string) =>
  `zotero://open-pdf/library/items/${attachment.key}?annotation=${annotationKey}`;

function annotation(props: Partial<Zotero.Item>): Zotero.Item {
  return createZoteroItemMock(props);
}

beforeEach(() => {
  // A user-library URI (no /groups/) → the library branch of the back-link.
  zoteroMock.URI.getItemURI.mockReturnValue(
    'http://zotero.org/users/local/ZswAJ4Qe/items/ATTACHKEY',
  );
});

describe('buildAnnotationNode', () => {
  it('maps a highlight to a #highlight node, comment as description', () => {
    const a = annotation({
      annotationType: 'highlight',
      annotationText: 'The selected text',
      annotationComment: 'my note',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)).toEqual({
      key: a.key,
      name: 'The selected text',
      description: 'my note',
      tagId: 'highlight-tag',
      annotationFieldId: 'hl-field',
      link: openPdfLink(a.key),
    });
  });

  it('maps an underline to a #highlight node too', () => {
    const a = annotation({
      annotationType: 'underline',
      annotationText: 'underlined',
      annotationComment: '',
    });
    const node = buildAnnotationNode(a, attachment, annotationTags);
    expect(node?.tagId).toBe('highlight-tag');
    expect(node?.description).toBe('');
  });

  it('strips HTML and collapses whitespace in the text', () => {
    const a = annotation({
      annotationType: 'highlight',
      annotationText: '<b>Hello</b>\n   world',
      annotationComment: '',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)?.name).toBe(
      'Hello world',
    );
  });

  it('skips a highlight with no text', () => {
    const a = annotation({
      annotationType: 'highlight',
      annotationText: '',
      annotationComment: 'orphan comment',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)).toBeNull();
  });

  it('maps a note annotation to a #comment node named by its comment', () => {
    const a = annotation({
      annotationType: 'note',
      annotationText: '',
      annotationComment: 'a standalone note',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)).toEqual({
      key: a.key,
      name: 'a standalone note',
      description: '',
      tagId: 'comment-tag',
      annotationFieldId: 'cm-field',
      link: openPdfLink(a.key),
    });
  });

  it('skips a note annotation with no comment', () => {
    const a = annotation({
      annotationType: 'note',
      annotationText: '',
      annotationComment: '',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)).toBeNull();
  });

  it('maps an image annotation to a #image placeholder with the page label', () => {
    const a = annotation({
      annotationType: 'image',
      annotationText: '',
      annotationComment: 'figure 2',
      annotationPageLabel: '12',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)).toEqual({
      key: a.key,
      name: 'Image annotation (p. 12)',
      description: 'figure 2',
      tagId: 'image-tag',
      annotationFieldId: 'im-field',
      link: openPdfLink(a.key),
    });
  });

  it('maps an image annotation without a page label', () => {
    const a = annotation({
      annotationType: 'image',
      annotationText: '',
      annotationComment: '',
      annotationPageLabel: '',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)?.name).toBe(
      'Image annotation',
    );
  });

  it('builds a group-library back-link from a /groups/ URI', () => {
    zoteroMock.URI.getItemURI.mockReturnValue(
      'http://zotero.org/groups/123456/items/ATTACHKEY',
    );
    const a = annotation({
      annotationType: 'highlight',
      annotationText: 'grouped',
      annotationComment: '',
    });
    expect(buildAnnotationNode(a, attachment, annotationTags)?.link).toBe(
      `zotero://open-pdf/groups/123456/items/${attachment.key}?annotation=${a.key}`,
    );
  });

  it('skips ink annotations', () => {
    const a = annotation({ annotationType: 'ink' });
    expect(buildAnnotationNode(a, attachment, annotationTags)).toBeNull();
  });
});

describe('readItemAnnotations', () => {
  it('reads file-attachment annotations in sort order, skipping non-file attachments and ink', () => {
    const second = annotation({
      annotationType: 'highlight',
      annotationText: 'B comes second',
      annotationComment: '',
      annotationSortIndex: '00002',
    });
    const first = annotation({
      annotationType: 'highlight',
      annotationText: 'A comes first',
      annotationComment: '',
      annotationSortIndex: '00001',
    });
    const ink = annotation({
      annotationType: 'ink',
      annotationSortIndex: '00003',
    });

    const fileAttachment = createZoteroItemMock({});
    fileAttachment.isFileAttachment.mockReturnValue(true);
    fileAttachment.getAnnotations.mockReturnValue([second, first, ink]);

    const linkAttachment = createZoteroItemMock({});
    linkAttachment.isFileAttachment.mockReturnValue(false);

    const item = createZoteroItemMock({});
    item.getAttachments.mockReturnValue([fileAttachment.id, linkAttachment.id]);

    const result = readItemAnnotations(item, annotationTags);
    expect(result.map((node) => node.name)).toEqual([
      'A comes first',
      'B comes second',
    ]);
  });

  it('returns nothing for an item with no attachments', () => {
    const item = createZoteroItemMock({});
    expect(readItemAnnotations(item, annotationTags)).toEqual([]);
  });
});
