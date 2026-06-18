import { describe, expect, it, vi } from 'vite-plus/test';

import type { SchemaConfig } from '../../prefs/schema-config';
import { type TanaClient } from '../client';
import {
  ensureSchema,
  parseSeedOptionIds,
  parseTagSchemaFields,
} from '../schema';

const SCHEMA_MARKDOWN = `# Tag definition: zotero (id:tag-zotero)

## Template Fields
- **Creators** (id:field-Creators):: Options
  - __zotana_seed__ (id:seed-1)
- **Abstract** (id:field-Abstract):: Content
- **Item Type** (id:field-ItemType):: Options
  - Article (id:opt-article)
`;

describe('parseTagSchemaFields', () => {
  it('maps field names to attribute ids', () => {
    const fields = parseTagSchemaFields(SCHEMA_MARKDOWN);
    expect(fields.get('Creators')).toBe('field-Creators');
    expect(fields.get('Abstract')).toBe('field-Abstract');
    expect(fields.get('Item Type')).toBe('field-ItemType');
    // option children are not fields
    expect(fields.has('Article')).toBe(false);
  });
});

describe('parseSeedOptionIds', () => {
  it('finds the seed placeholder option ids', () => {
    expect(parseSeedOptionIds(SCHEMA_MARKDOWN)).toEqual(['seed-1']);
    expect(parseSeedOptionIds('- **X** (id:a):: Content')).toEqual([]);
  });
});

function createClientMock() {
  return {
    listWorkspaceTags: vi.fn().mockResolvedValue([]),
    createTag: vi
      .fn()
      .mockImplementation((_ws: string, { name }: { name: string }) =>
        Promise.resolve({ tagId: `tag-${name}`, tagName: name, message: '' }),
      ),
    getTagSchema: vi.fn().mockResolvedValue(''),
    addField: vi
      .fn()
      .mockImplementation((_tag: string, { name }: { name: string }) =>
        Promise.resolve({ fieldId: `field-${name}`, fieldName: name }),
      ),
    trash: vi.fn().mockResolvedValue(undefined),
  };
}

const config: SchemaConfig = {
  tagName: 'zotero',
  fields: [
    { key: 'creators', name: 'Creators', enabled: true }, // options + transient seed
    { key: 'itemType', name: 'Item Type', enabled: true }, // options + real seed
    { key: 'abstract', name: 'Abstract', enabled: true }, // plain
    { key: 'shortTitle', name: 'Short Title', enabled: false }, // skipped
  ],
};

describe('ensureSchema — bootstrap (nothing exists)', () => {
  it('creates the tag + entity/quote tags, creates enabled fields, and trashes entity seeds', async () => {
    const client = createClientMock();
    // First schema read (existing fields) is empty; the post-create read exposes
    // the entity field's seed option to trash.
    client.getTagSchema
      .mockResolvedValueOnce('')
      .mockResolvedValue(
        '- **Creators** (id:field-Creators):: Options\n  - __zotana_seed__ (id:seed-1)',
      );

    const schema = await ensureSchema(client as unknown as TanaClient, config, {
      workspaceId: 'ws1',
      optionSeeds: { itemType: ['Article', 'Book'] },
    });

    expect(schema.tagId).toBe('tag-zotero');
    expect(schema.entityTagIds.Person).toBe('tag-Person');
    expect(schema.entityTagIds.Organization).toBe('tag-Organization');
    expect(schema.quoteTagId).toBe('tag-quote');

    // enabled fields resolved; disabled field absent
    expect(schema.fields.creators).toEqual({
      name: 'Creators',
      id: 'field-Creators',
    });
    expect(schema.fields.abstract).toEqual({
      name: 'Abstract',
      id: 'field-Abstract',
    });
    expect(schema.fields.shortTitle).toBeUndefined();

    const addCalls = client.addField.mock.calls;
    const byName = (name: string) =>
      addCalls.find(
        (call: unknown[]) => (call[1] as { name: string }).name === name,
      )?.[1] as Record<string, unknown> | undefined;

    // disabled field never created
    expect(byName('Short Title')).toBeUndefined();
    // entity options field gets the throwaway seed + multi-value
    expect(byName('Creators')).toMatchObject({
      dataType: 'options',
      isMultiValue: true,
      options: ['__zotana_seed__'],
    });
    // item type options field gets the real seed override
    expect(byName('Item Type')).toMatchObject({
      dataType: 'options',
      options: ['Article', 'Book'],
    });
    // plain field has no options
    expect(byName('Abstract')).toMatchObject({ dataType: 'plain' });
    expect(byName('Abstract')?.options).toBeUndefined();

    // the entity seed option was trashed
    expect(client.trash).toHaveBeenCalledWith('seed-1');
  });
});

describe('ensureSchema — blank names resolve to the catalog default', () => {
  it('creates a field under its catalog default name when the config name is blank', async () => {
    const client = createClientMock();
    const blankConfig: SchemaConfig = {
      tagName: 'zotero',
      fields: [{ key: 'abstract', name: '', enabled: true }],
    };

    const schema = await ensureSchema(
      client as unknown as TanaClient,
      blankConfig,
      { workspaceId: 'ws1' },
    );

    // resolved + created under the catalog default, not the empty string
    expect(schema.fields.abstract).toEqual({
      name: 'Abstract',
      id: 'field-Abstract',
    });
    expect(client.addField).toHaveBeenCalledWith(
      'tag-zotero',
      expect.objectContaining({ name: 'Abstract' }),
    );
  });
});

describe('ensureSchema — resolve (everything exists)', () => {
  it('reuses existing tag + fields without creating or trashing', async () => {
    const client = createClientMock();
    client.listWorkspaceTags.mockResolvedValue([
      { id: 'tag-zotero', name: 'zotero' },
      { id: 'tag-Person', name: 'Person' },
      { id: 'tag-Organization', name: 'Organization' },
      { id: 'tag-quote', name: 'quote' },
    ]);
    client.getTagSchema.mockResolvedValue(
      [
        '- **Creators** (id:field-Creators):: Options',
        '- **Item Type** (id:field-ItemType):: Options',
        '- **Abstract** (id:field-Abstract):: Content',
      ].join('\n'),
    );

    const schema = await ensureSchema(client as unknown as TanaClient, config, {
      workspaceId: 'ws1',
    });

    expect(client.createTag).not.toHaveBeenCalled();
    expect(client.addField).not.toHaveBeenCalled();
    expect(client.trash).not.toHaveBeenCalled();
    expect(schema.fields.itemType).toEqual({
      name: 'Item Type',
      id: 'field-ItemType',
    });
  });
});
