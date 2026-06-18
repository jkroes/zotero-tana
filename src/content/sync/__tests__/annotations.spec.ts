import { describe, expect, it } from 'vite-plus/test';

import { createZoteroItemMock } from '../../../../test/utils';
import { buildAnnotationNode, readItemAnnotations } from '../annotations';

const QUOTE_TAG_ID = 'quote-tag-id';

function annotation(props: Partial<Zotero.Item>): Zotero.Item {
  return createZoteroItemMock(props);
}

describe('buildAnnotationNode', () => {
  it('maps a highlight to a #quote node, comment as description', () => {
    const a = annotation({
      annotationType: 'highlight',
      annotationText: 'The selected text',
      annotationComment: 'my note',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)).toEqual({
      key: a.key,
      name: 'The selected text',
      description: 'my note',
      tagId: QUOTE_TAG_ID,
    });
  });

  it('maps an underline to a #quote node too', () => {
    const a = annotation({
      annotationType: 'underline',
      annotationText: 'underlined',
      annotationComment: '',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)?.tagId).toBe(QUOTE_TAG_ID);
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)?.description).toBe('');
  });

  it('strips HTML and collapses whitespace in the text', () => {
    const a = annotation({
      annotationType: 'highlight',
      annotationText: '<b>Hello</b>\n   world',
      annotationComment: '',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)?.name).toBe('Hello world');
  });

  it('skips a highlight with no text', () => {
    const a = annotation({
      annotationType: 'highlight',
      annotationText: '',
      annotationComment: 'orphan comment',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)).toBeNull();
  });

  it('maps a note annotation to an untagged node named by its comment', () => {
    const a = annotation({
      annotationType: 'note',
      annotationText: '',
      annotationComment: 'a standalone note',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)).toEqual({
      key: a.key,
      name: 'a standalone note',
      description: '',
      tagId: null,
    });
  });

  it('skips a note annotation with no comment', () => {
    const a = annotation({
      annotationType: 'note',
      annotationText: '',
      annotationComment: '',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)).toBeNull();
  });

  it('maps an image annotation to a placeholder with the page label', () => {
    const a = annotation({
      annotationType: 'image',
      annotationText: '',
      annotationComment: 'figure 2',
      annotationPageLabel: '12',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)).toEqual({
      key: a.key,
      name: 'Image annotation (p. 12)',
      description: 'figure 2',
      tagId: null,
    });
  });

  it('maps an image annotation without a page label', () => {
    const a = annotation({
      annotationType: 'image',
      annotationText: '',
      annotationComment: '',
      annotationPageLabel: '',
    });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)?.name).toBe('Image annotation');
  });

  it('skips ink annotations', () => {
    const a = annotation({ annotationType: 'ink' });
    expect(buildAnnotationNode(a, QUOTE_TAG_ID)).toBeNull();
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

    const result = readItemAnnotations(item, QUOTE_TAG_ID);
    expect(result.map((node) => node.name)).toEqual([
      'A comes first',
      'B comes second',
    ]);
  });

  it('returns nothing for an item with no attachments', () => {
    const item = createZoteroItemMock({});
    expect(readItemAnnotations(item, QUOTE_TAG_ID)).toEqual([]);
  });
});
