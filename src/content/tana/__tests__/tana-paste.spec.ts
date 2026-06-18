import { describe, expect, it } from 'vite-plus/test';

import { linkMarkup, toTanaPaste, type TanaReferenceNode } from '../tana-paste';

function node(
  fields: TanaReferenceNode['fields'],
  title = 'Vaswani, 2017',
): TanaReferenceNode {
  return { title, tag: 'reference', tagId: 'p5LeXSkgwLnh', fields };
}

describe('toTanaPaste', () => {
  it('emits the %%tana%% header and the tagged title line', () => {
    const paste = toTanaPaste(node([]));
    expect(paste).toBe('%%tana%%\n- Vaswani, 2017 #reference');
  });

  it('omits the header when withHeader is false', () => {
    const paste = toTanaPaste(node([]), { withHeader: false });
    expect(paste).toBe('- Vaswani, 2017 #reference');
  });

  it('emits single-word field names bare and multi-word names bracketed', () => {
    const paste = toTanaPaste(
      node([
        { name: 'Container', id: 'c', type: 'plain', value: 'NeurIPS' },
        {
          name: 'Item Type',
          id: 't',
          type: 'options',
          value: 'Journal Article',
        },
      ]),
    );
    expect(paste).toContain('  - Container:: NeurIPS');
    expect(paste).toContain('  - [[Item Type]]:: Journal Article');
  });

  it('wraps date-typed values in [[date:...]]', () => {
    const paste = toTanaPaste(
      node([{ name: 'Date', id: 'd', type: 'date', value: '2017-12-01' }]),
    );
    expect(paste).toContain('  - Date:: [[date:2017-12-01]]');
  });

  it('wraps url-typed values as a [url](url) markdown link', () => {
    const paste = toTanaPaste(
      node([
        { name: 'DOI', id: 'd', type: 'url', value: 'https://doi.org/10.x' },
      ]),
    );
    expect(paste).toContain(
      '  - DOI:: [https://doi.org/10.x](https://doi.org/10.x)',
    );
  });

  it('renders an optionList field as one indented plain-text node per value', () => {
    const paste = toTanaPaste(
      node([
        {
          name: 'Tags',
          id: 'tg',
          type: 'optionList',
          values: ['philosophy', 'reading'],
        },
      ]),
    );
    expect(paste).toContain('  - Tags::');
    expect(paste).toContain('    - philosophy');
    expect(paste).toContain('    - reading');
  });

  it('renders link fields as an indented list of entity references', () => {
    const paste = toTanaPaste(
      node([
        {
          name: 'Creators',
          id: 'cr',
          type: 'links',
          links: [
            { name: 'Ashish Vaswani', tag: 'Person' },
            { name: 'Google Brain', tag: 'Organization' },
          ],
        },
      ]),
    );
    expect(paste).toContain('  - Creators::');
    expect(paste).toContain('    - [[Ashish Vaswani #Person]]');
    expect(paste).toContain('    - [[Google Brain #Organization]]');
  });
});

describe('linkMarkup', () => {
  it('formats an entity reference', () => {
    expect(linkMarkup({ name: 'Ada Lovelace', tag: 'Person' })).toBe(
      '[[Ada Lovelace #Person]]',
    );
  });
});
