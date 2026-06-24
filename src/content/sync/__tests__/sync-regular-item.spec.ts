import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { createZoteroItemMock } from '../../../../test/utils';
import {
  getTanaSyncData,
  saveTanaSyncData,
  saveTanaTag,
} from '../../data/item-data';
import { type TanaClient } from '../../tana/client';
import { buildReference, TitleFormat } from '../../tana/reference-builder';
import type { ResolvedSchema } from '../../tana/schema';
import type { TanaReferenceNode } from '../../tana/tana-paste';
import { syncRegularItem } from '../sync-regular-item';

vi.mock('../../tana/reference-builder');
vi.mock('../../data/item-data');
// Stub `contentSignature` (its own reference build is irrelevant here) while
// keeping the real `fieldSignature` that the per-field diff under test relies on.
vi.mock('../content-signature', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../content-signature')>()),
  contentSignature: vi.fn().mockResolvedValue('test-content-sig'),
}));

const mockedBuildReference = vi.mocked(buildReference);
const mockedGetTanaSyncData = vi.mocked(getTanaSyncData);
const mockedSaveTanaSyncData = vi.mocked(saveTanaSyncData);

/** Synthetic resolved-schema fixtures (real IDs are resolved by name at runtime). */
const TAG = {
  reference: 'tag-ref',
  Person: 'tag-person',
  Organization: 'tag-org',
};

const FIELD = {
  item: { name: 'Item Link', id: 'fid-item' },
  doi: { name: 'DOI', id: 'fid-doi' },
  date: { name: 'Date', id: 'fid-date' },
  itemType: { name: 'Item Type', id: 'fid-itemType' },
  creators: { name: 'Creators', id: 'fid-creators' },
  abstract: { name: 'Abstract', id: 'fid-abstract' },
};

const schema: ResolvedSchema = {
  workspaceId: 'ws',
  tagId: TAG.reference,
  tagName: 'reference',
  entityTagIds: { Person: TAG.Person, Organization: TAG.Organization },
  entityTagNames: { Person: 'Person', Organization: 'Organization' },
  annotationTags: {
    highlight: {
      tagId: 'tag-highlight',
      annotationFieldId: 'fid-hl',
      pageFieldId: 'pid-hl',
      orderFieldId: 'oid-hl',
    },
    comment: {
      tagId: 'tag-comment',
      annotationFieldId: 'fid-cm',
      pageFieldId: 'pid-cm',
      orderFieldId: 'oid-cm',
    },
    image: {
      tagId: 'tag-image',
      annotationFieldId: 'fid-im',
      pageFieldId: 'pid-im',
      orderFieldId: 'oid-im',
    },
  },
  annotationsFieldId: 'fid-annotations',
  fields: {
    item: FIELD.item,
    doi: FIELD.doi,
    date: FIELD.date,
    itemType: FIELD.itemType,
    creators: FIELD.creators,
    abstract: FIELD.abstract,
  },
  optionsByFieldId: new Map(),
};

function createClientMock() {
  return {
    import: vi.fn(),
    setFieldContent: vi.fn().mockResolvedValue(undefined),
    setFieldOption: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    trash: vi.fn().mockResolvedValue(undefined),
    readNode: vi.fn().mockResolvedValue({ markdown: '' }),
    search: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Stub `client.search` per tag. Both the reachability check (#reference) and
 * entity resolution (#Person/#Organization) go through `search`; this routes by
 * the query's leading `hasType` so each gets its own result set.
 */
function mockSearchByType(
  client: ReturnType<typeof createClientMock>,
  byType: Record<string, { id: string; name: string; inTrash?: boolean }[]>,
) {
  client.search.mockImplementation((query: any) =>
    Promise.resolve(byType[query?.and?.[0]?.hasType] ?? []),
  );
}

const referenceNode: TanaReferenceNode = {
  title: 'Vaswani, 2017',
  tag: 'reference',
  tagId: TAG.reference,
  entityTagNames: { Person: 'Person', Organization: 'Organization' },
  fields: [
    { ...FIELD.item, type: 'item', value: 'zotero://x' },
    { ...FIELD.doi, type: 'url', value: 'https://doi.org/10.x' },
    { ...FIELD.date, type: 'date', value: '2017-12-01' },
    { ...FIELD.itemType, type: 'options', value: 'Journal Article' },
    {
      ...FIELD.creators,
      type: 'links',
      links: [{ name: 'Ashish Vaswani', tag: 'Person' }],
    },
  ],
};

/** Field signatures persisted for referenceNode (the back-link is excluded). */
const expectedFieldSignatures = {
  [FIELD.doi.id]: 'https://doi.org/10.x',
  [FIELD.date.id]: '2017-12-01',
  [FIELD.itemType.id]: 'Journal Article',
  [FIELD.creators.id]: 'Person:Ashish Vaswani',
};

function makeParams(client: ReturnType<typeof createClientMock>) {
  return {
    client: client as unknown as TanaClient,
    schema,
    parentNodeId: 'parent',
    entityParentNodeId: 'stash',
    citationFormat: 'apa',
    titleFormat: TitleFormat.authorDateCitation,
  };
}

beforeEach(() => {
  mockedBuildReference.mockResolvedValue(referenceNode);
});

describe('syncRegularItem — create path', () => {
  it('imports the paste, captures the node ID, and stores sync data + tag', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue(undefined);
    client.import.mockResolvedValue({
      createdNodes: [
        { id: 'node1', name: 'Vaswani, 2017' },
        { id: 'fieldval', name: '' },
      ],
    });

    await syncRegularItem(item, makeParams(client));

    expect(client.import).toHaveBeenCalledWith(
      'parent',
      expect.stringContaining('#reference'),
    );
    expect(client.update).not.toHaveBeenCalled();
    expect(mockedSaveTanaSyncData).toHaveBeenCalledWith(item, {
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: expectedFieldSignatures,
      contentSig: 'test-content-sig',
      createdAt: expect.any(Number),
      titleSyncedAt: expect.any(Number),
      annotations: {},
    });
    expect(saveTanaTag).toHaveBeenCalledWith(item);
  });
});

describe('syncRegularItem — update path', () => {
  it('renames, sets each field, skips the back-link, and clears absent fields', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Old',
      // Abstract was set last sync but is absent now -> it should be cleared. The
      // other fields have no prior signature, so they're all (re)written.
      fields: { [FIELD.abstract.id]: 'a stale abstract' },
      annotations: {},
    });
    mockSearchByType(client, {
      [TAG.reference]: [{ id: 'node1', name: 'Old', inTrash: false }],
      [TAG.Person]: [{ id: 'person1', name: 'Ashish Vaswani', inTrash: false }],
    });

    await syncRegularItem(item, makeParams(client));

    // node not re-imported on update; the existing entity is reused, not created
    expect(client.import).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalledWith('node1', {
      name: 'Vaswani, 2017',
    });

    expect(client.setFieldContent).toHaveBeenCalledWith(
      'node1',
      FIELD.doi.id,
      'https://doi.org/10.x',
    );
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'node1',
      FIELD.date.id,
      '2017-12-01',
    );
    // Item Type is an options field with no matching predefined option here, so
    // it falls back to a string write (which auto-collects), with an explicit mode.
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'node1',
      FIELD.itemType.id,
      'Journal Article',
      'replace',
    );
    expect(client.setFieldOption).toHaveBeenCalledWith(
      'node1',
      FIELD.creators.id,
      'person1',
      'replace',
    );

    // the immutable back-link is never written
    const setItemBacklink = client.setFieldContent.mock.calls.some(
      (call: unknown[]) => call[1] === FIELD.item.id,
    );
    expect(setItemBacklink).toBe(false);

    // a field absent from the built node is cleared
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'node1',
      FIELD.abstract.id,
      null,
    );

    expect(mockedSaveTanaSyncData).toHaveBeenCalledWith(item, {
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: expectedFieldSignatures,
      contentSig: 'test-content-sig',
      titleSyncedAt: expect.any(Number),
      annotations: {},
    });
  });

  it('writes an options value BY ID when it matches a predefined option', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: {},
      annotations: {},
    });
    mockSearchByType(client, {
      [TAG.reference]: [{ id: 'node1', name: 'Vaswani, 2017', inTrash: false }],
      [TAG.Person]: [{ id: 'person1', name: 'Ashish Vaswani', inTrash: false }],
    });

    // Item Type has a predefined "Journal Article" option in the schema.
    const params = makeParams(client);
    params.schema = {
      ...schema,
      optionsByFieldId: new Map([
        [FIELD.itemType.id, new Map([['Journal Article', 'opt-ja']])],
      ]),
    };

    await syncRegularItem(item, params);

    // referenced by id, not string-written (which would mint a duplicate node)
    expect(client.setFieldOption).toHaveBeenCalledWith(
      'node1',
      FIELD.itemType.id,
      'opt-ja',
      'replace',
    );
    const wroteItemTypeString = client.setFieldContent.mock.calls.some(
      (call: unknown[]) => call[1] === FIELD.itemType.id,
    );
    expect(wroteItemTypeString).toBe(false);
  });

  it('writes nothing when no field changed since the last sync', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017', // unchanged title
      fields: expectedFieldSignatures, // every field matches the built node
      annotations: {},
    });
    mockSearchByType(client, {
      [TAG.reference]: [{ id: 'node1', name: 'Vaswani, 2017', inTrash: false }],
    });

    await syncRegularItem(item, makeParams(client));

    // nothing rewritten -> no value nodes trashed; entity resolution skipped too
    expect(client.update).not.toHaveBeenCalled();
    expect(client.setFieldContent).not.toHaveBeenCalled();
    expect(client.import).not.toHaveBeenCalled();
    // reachability check is the only search (no Person lookup)
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(mockedSaveTanaSyncData).toHaveBeenCalledWith(item, {
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: expectedFieldSignatures,
      contentSig: 'test-content-sig',
      annotations: {},
    });
  });

  it('skips a changed field whose value node is referenced, and warns', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    // Only DOI changed; everything else matches last sync (so it's untouched).
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: { ...expectedFieldSignatures, [FIELD.doi.id]: 'old-doi' },
      annotations: {},
    });
    client.readNode.mockResolvedValue({
      markdown: `- **DOI**: old-doi <!-- node-id: doinode -->`,
    });
    client.search.mockImplementation((query: any) => {
      if (query?.ownedBy) return Promise.resolve([{ id: 'doinode' }]); // we own it
      if (query?.linksTo) return Promise.resolve([{ id: 'x', name: 'A note' }]);
      return Promise.resolve(
        query?.and?.[0]?.hasType === TAG.reference
          ? [{ id: 'node1', name: 'Vaswani, 2017', inTrash: false }]
          : [],
      );
    });

    const warnings = await syncRegularItem(item, makeParams(client));

    // DOI was referenced -> left unchanged and reported
    expect(warnings).toEqual(['DOI']);
    // The ownedBy search must not send `recursive` (the Local API rejects the
    // string "true" a GET query carries; default is already recursive).
    const ownedCall = client.search.mock.calls.find(
      (call: unknown[]) => (call[0] as { ownedBy?: unknown })?.ownedBy,
    );
    expect(ownedCall?.[0].ownedBy).toEqual({ nodeId: 'node1' });
    const wroteDoi = client.setFieldContent.mock.calls.some(
      (call: unknown[]) => call[1] === FIELD.doi.id,
    );
    expect(wroteDoi).toBe(false);
    // its old signature is kept so the next sync retries
    expect(mockedSaveTanaSyncData).toHaveBeenCalledWith(
      item,
      expect.objectContaining({
        fields: expect.objectContaining({ [FIELD.doi.id]: 'old-doi' }),
      }),
    );
  });

  it('skips a link field when we own the referenced entity (a Tana swap)', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: { ...expectedFieldSignatures, [FIELD.creators.id]: 'Person:Old' },
      annotations: {},
    });
    client.readNode.mockResolvedValue({
      markdown: `- **Creators**: \n    - [Old #Person](tana:person1)`,
    });
    client.search.mockImplementation((query: any) => {
      if (query?.ownedBy) return Promise.resolve([{ id: 'person1' }]); // swapped in
      if (query?.linksTo) return Promise.resolve([{ id: 'x', name: 'note' }]);
      return Promise.resolve(
        query?.and?.[0]?.hasType === TAG.reference
          ? [{ id: 'node1', name: 'Vaswani, 2017', inTrash: false }]
          : [],
      );
    });

    const warnings = await syncRegularItem(item, makeParams(client));

    expect(warnings).toEqual(['Creators']);
    const wroteCreators = client.setFieldOption.mock.calls.some(
      (call: unknown[]) => call[1] === FIELD.creators.id,
    );
    expect(wroteCreators).toBe(false);
    expect(client.import).not.toHaveBeenCalled(); // no entity resolution attempted
  });

  it('updates a link field whose entity is referenced but owned elsewhere', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: { ...expectedFieldSignatures, [FIELD.creators.id]: 'Person:Old' },
      annotations: {},
    });
    client.readNode.mockResolvedValue({
      markdown: `- **Creators**: \n    - [Ashish Vaswani #Person](tana:person1)`,
    });
    client.search.mockImplementation((query: any) => {
      if (query?.ownedBy) return Promise.resolve([]); // entity owned by the Library
      if (query?.linksTo) return Promise.resolve([{ id: 'x' }]); // shared across papers
      const type = query?.and?.[0]?.hasType;
      if (type === TAG.reference)
        return Promise.resolve([
          { id: 'node1', name: 'Vaswani, 2017', inTrash: false },
        ]);
      if (type === TAG.Person)
        return Promise.resolve([
          { id: 'resolved', name: 'Ashish Vaswani', inTrash: false },
        ]);
      return Promise.resolve([]);
    });

    const warnings = await syncRegularItem(item, makeParams(client));

    // Not protected: shared authors re-point without trashing the entity.
    expect(warnings).toEqual([]);
    expect(client.setFieldOption).toHaveBeenCalledWith(
      'node1',
      FIELD.creators.id,
      'resolved',
      'replace',
    );
  });

  it('rebuilds from scratch when the stored node is unreachable in Tana', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'dead-node',
      title: 'Old',
      fields: {},
      annotations: { a: { nodeId: 'dead-quote', name: 'q', description: '' } },
    });
    // The stored node is still readable (an orphaned "ghost" left by an emptied
    // trash readNode-200s) but search can't find it -> treat as unsynced. This
    // also covers a hard-purged (404) or manually-trashed node, all absent from
    // search.
    mockSearchByType(client, { [TAG.reference]: [] });
    client.import.mockResolvedValue({
      createdNodes: [{ id: 'fresh-node', name: 'Vaswani, 2017' }],
    });

    await syncRegularItem(item, makeParams(client));

    // create path used (fresh import), not the in-place update
    expect(client.import).toHaveBeenCalledWith(
      'parent',
      expect.stringContaining('#reference'),
    );
    expect(client.update).not.toHaveBeenCalled();
    // stale annotation map is discarded; the new node is stored
    expect(mockedSaveTanaSyncData).toHaveBeenCalledWith(item, {
      nodeId: 'fresh-node',
      title: 'Vaswani, 2017',
      fields: expectedFieldSignatures,
      contentSig: 'test-content-sig',
      createdAt: expect.any(Number),
      titleSyncedAt: expect.any(Number),
      annotations: {},
    });
  });

  it('rebuilds when search returns the stored node but flagged inTrash', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: {},
      annotations: {},
    });
    // The search DOES return trashed nodes (inTrash: true); a node the user
    // trashed must not count as reachable, or we'd update it inside the trash.
    mockSearchByType(client, {
      [TAG.reference]: [{ id: 'node1', name: 'Vaswani, 2017', inTrash: true }],
    });
    client.import.mockResolvedValue({
      createdNodes: [{ id: 'fresh-node', name: 'Vaswani, 2017' }],
    });

    await syncRegularItem(item, makeParams(client));

    expect(client.import).toHaveBeenCalledWith(
      'parent',
      expect.stringContaining('#reference'),
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('keeps a just-created node that search has not indexed yet (within grace)', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Old',
      fields: {},
      // Created moments ago: a search miss is index lag, not a gone node.
      createdAt: Date.now(),
      annotations: {},
    });
    // Reference search misses (not indexed yet); Person resolves so no entity import.
    mockSearchByType(client, {
      [TAG.reference]: [],
      [TAG.Person]: [{ id: 'person1', name: 'Ashish Vaswani', inTrash: false }],
    });

    await syncRegularItem(item, makeParams(client));

    // updated in place on the stored node, NOT rebuilt
    expect(client.update).toHaveBeenCalledWith('node1', {
      name: 'Vaswani, 2017',
    });
    expect(client.import).not.toHaveBeenCalled();
    expect(mockedSaveTanaSyncData).toHaveBeenCalledWith(
      item,
      expect.objectContaining({
        nodeId: 'node1',
        createdAt: expect.any(Number),
      }),
    );
  });

  it('rebuilds a search-missing node once its create time is past the grace window', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'old-node',
      title: 'Old',
      fields: {},
      // Created long ago: a search miss now means trashed/orphaned/purged.
      createdAt: Date.now() - 5 * 60_000,
      annotations: {},
    });
    mockSearchByType(client, { [TAG.reference]: [] });
    client.import.mockResolvedValue({
      createdNodes: [{ id: 'fresh-node', name: 'Vaswani, 2017' }],
    });

    await syncRegularItem(item, makeParams(client));

    expect(client.import).toHaveBeenCalledWith(
      'parent',
      expect.stringContaining('#reference'),
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('keeps a recently-renamed node search has not reindexed (rename grace, old createdAt)', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Old',
      fields: {},
      // Created long ago, but renamed moments ago (e.g. a title-format change):
      // a search miss is the index lagging the rename, not a deleted node. Without
      // titleSyncedAt this rebuilt a duplicate.
      createdAt: Date.now() - 5 * 60_000,
      titleSyncedAt: Date.now(),
      annotations: {},
    });
    mockSearchByType(client, {
      [TAG.reference]: [],
      [TAG.Person]: [{ id: 'person1', name: 'Ashish Vaswani', inTrash: false }],
    });

    await syncRegularItem(item, makeParams(client));

    // updated in place on the stored node, NOT rebuilt into a duplicate
    expect(client.update).toHaveBeenCalledWith('node1', {
      name: 'Vaswani, 2017',
    });
    expect(client.import).not.toHaveBeenCalled();
  });

  it('creates a missing entity node and references the new ID', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Old',
      fields: {},
      annotations: {},
    });
    // reference node reachable (update path); no existing Person -> create it
    mockSearchByType(client, {
      [TAG.reference]: [{ id: 'node1', name: 'Old', inTrash: false }],
      [TAG.Person]: [],
    });
    client.import.mockResolvedValue({
      createdNodes: [{ id: 'newperson', name: 'Ashish Vaswani' }],
    });

    await syncRegularItem(item, makeParams(client));

    expect(client.search).toHaveBeenCalledWith(
      { and: [{ hasType: TAG.Person }, { textContains: 'Ashish Vaswani' }] },
      { limit: 50, workspaceIds: ['ws'] },
    );
    // new entity nodes are created under the workspace Library (entityParentNodeId)
    expect(client.import).toHaveBeenCalledWith(
      'stash',
      expect.stringContaining('#[[^' + TAG.Person + ']]'),
    );
    expect(client.setFieldOption).toHaveBeenCalledWith(
      'node1',
      FIELD.creators.id,
      'newperson',
      'replace',
    );
  });

  it('writes each optionList value as its own option (replace then append)', async () => {
    const item = createZoteroItemMock();
    const client = createClientMock();
    mockedBuildReference.mockResolvedValue({
      title: 'Vaswani, 2017',
      tag: 'reference',
      tagId: TAG.reference,
      entityTagNames: { Person: 'Person', Organization: 'Organization' },
      fields: [
        {
          name: 'Tags',
          id: 'fid-tags',
          type: 'optionList',
          values: ['philosophy', 'reading'],
        },
      ],
    });
    mockedGetTanaSyncData.mockReturnValue({
      nodeId: 'node1',
      title: 'Vaswani, 2017',
      fields: {},
      annotations: {},
    });
    mockSearchByType(client, {
      [TAG.reference]: [{ id: 'node1', name: 'Vaswani, 2017', inTrash: false }],
    });

    await syncRegularItem(item, makeParams(client));

    expect(client.setFieldContent).toHaveBeenCalledWith(
      'node1',
      'fid-tags',
      'philosophy',
      'replace',
    );
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'node1',
      'fid-tags',
      'reading',
      'append',
    );
  });
});
