import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { createZoteroItemMock } from '../../../../test/utils';
import type { StoredAnnotation } from '../../data/item-data';
import { TanaApiError, type TanaClient } from '../../tana/client';
import { type AnnotationNode, readItemAnnotations } from '../annotations';
import { syncAnnotations } from '../sync-annotations';

vi.mock('../annotations');

const annotationTags = {
  highlight: {
    tagId: 'highlight-tag',
    annotationFieldId: 'hl-field',
    pageFieldId: 'hl-page',
    orderFieldId: 'hl-order',
  },
  comment: {
    tagId: 'comment-tag',
    annotationFieldId: 'cm-field',
    pageFieldId: 'cm-page',
    orderFieldId: 'cm-order',
  },
  image: {
    tagId: 'image-tag',
    annotationFieldId: 'im-field',
    pageFieldId: 'im-page',
    orderFieldId: 'im-order',
  },
};

const mockedReadItemAnnotations = vi.mocked(readItemAnnotations);

function createClientMock() {
  return {
    import: vi.fn().mockResolvedValue({
      createdNodes: [{ id: 'new-node', name: 'Zotana annotation' }],
    }),
    update: vi.fn().mockResolvedValue(undefined),
    setFieldContent: vi.fn().mockResolvedValue(undefined),
    trash: vi.fn().mockResolvedValue(undefined),
    // The reachability search; tests set the live node IDs they expect.
    search: vi.fn().mockResolvedValue([]),
  };
}

/** Make the reachability search report the given node IDs as live. */
function setLiveNodes(
  client: ReturnType<typeof createClientMock>,
  ...ids: string[]
) {
  client.search.mockResolvedValue(ids.map((id) => ({ id })));
}

function run(
  client: ReturnType<typeof createClientMock>,
  stored: Record<string, StoredAnnotation>,
) {
  return syncAnnotations(
    client as unknown as TanaClient,
    annotationTags,
    createZoteroItemMock({}),
    'ref-node',
    stored,
  );
}

const highlight: AnnotationNode = {
  key: 'AAA',
  name: 'A highlighted sentence',
  description: 'with a comment',
  tagId: 'highlight-tag',
  annotationFieldId: 'hl-field',
  pageFieldId: 'hl-page',
  page: '5',
  orderFieldId: 'hl-order',
  link: 'zotero://open-pdf/library/items/ATT?annotation=AAA',
};

beforeEach(() => {
  mockedReadItemAnnotations.mockReturnValue([]);
});

describe('syncAnnotations — create', () => {
  it('imports a #highlight node with the back-link field and sets text + comment', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {});

    expect(client.import).toHaveBeenCalledWith('ref-node', expect.any(String));
    const paste = client.import.mock.calls[0]?.[1] as string;
    expect(paste).toContain('#[[^highlight-tag]]');
    // back-link written as plain text under the Annotation field
    expect(paste).toContain('[[^hl-field]]:: ' + highlight.link);
    // page label written under the Page field
    expect(paste).toContain('[[^hl-page]]:: 5');
    expect(client.update).toHaveBeenCalledWith('new-node', {
      name: 'A highlighted sentence',
      description: 'with a comment',
    });
    // reading-order rank (1-based) written to the Order field
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'new-node',
      'hl-order',
      '1',
    );
    expect(result.AAA).toMatchObject({
      nodeId: 'new-node',
      name: 'A highlighted sentence',
      description: 'with a comment',
      order: 1,
    });
    expect(result.AAA?.createdAt).toEqual(expect.any(Number));
  });

  it('does not run the reachability search when nothing was stored', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    await run(client, {});

    expect(client.search).not.toHaveBeenCalled();
  });

  it('imports a #comment node with the back-link field for a note annotation', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([
      {
        key: 'N1',
        name: 'a note',
        description: '',
        tagId: 'comment-tag',
        annotationFieldId: 'cm-field',
        pageFieldId: 'cm-page',
        page: '',
        orderFieldId: 'cm-order',
        link: 'zotero://open-pdf/library/items/ATT?annotation=N1',
      },
    ]);

    await run(client, {});

    const paste = client.import.mock.calls[0]?.[1] as string;
    expect(paste).toContain('#[[^comment-tag]]');
    expect(paste).toContain('[[^cm-field]]::');
    // no comment -> description omitted
    expect(client.update).toHaveBeenCalledWith('new-node', { name: 'a note' });
  });
});

describe('syncAnnotations — update in place (still reachable)', () => {
  it('updates only the fields that changed', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'existing');
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: {
        nodeId: 'existing',
        name: 'old text',
        description: 'with a comment',
      },
    });

    expect(client.import).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalledWith('existing', {
      name: 'A highlighted sentence',
    });
    expect(result.AAA?.nodeId).toBe('existing');
  });

  it('clears the description when a comment was removed', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'existing');
    mockedReadItemAnnotations.mockReturnValue([
      { ...highlight, description: '' },
    ]);

    await run(client, {
      AAA: { nodeId: 'existing', name: highlight.name, description: 'old' },
    });

    expect(client.update).toHaveBeenCalledWith('existing', {
      description: null,
    });
  });

  it('does nothing for an unchanged, reachable annotation at the same rank', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'existing');
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    await run(client, {
      AAA: {
        nodeId: 'existing',
        name: highlight.name,
        description: highlight.description,
        order: 1,
      },
    });

    expect(client.import).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
    expect(client.setFieldContent).not.toHaveBeenCalled();
    expect(client.trash).not.toHaveBeenCalled();
  });

  it('preserves createdAt across an in-place update', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'existing');
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: {
        nodeId: 'existing',
        name: 'old text',
        description: highlight.description,
        createdAt: 111,
      },
    });

    expect(result.AAA?.createdAt).toBe(111);
  });

  it('backfills a missing createdAt on an in-place update', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'existing');
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: { nodeId: 'existing', name: 'old text', description: '' },
    });

    expect(result.AAA?.createdAt).toEqual(expect.any(Number));
  });

  it('recreates the node when an update 404s (purged after the reachability check)', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'dead');
    mockedReadItemAnnotations.mockReturnValue([highlight]);
    // Only the first update (on the dead node) 404s; the recreate's update succeeds.
    client.update.mockRejectedValueOnce(new TanaApiError(404, '', 'not found'));

    const result = await run(client, {
      AAA: { nodeId: 'dead', name: 'old text', description: '' },
    });

    // falls back to a fresh import + literal name/description write
    expect(client.import).toHaveBeenCalledWith(
      'ref-node',
      expect.stringContaining('#[[^highlight-tag]]'),
    );
    expect(result.AAA?.nodeId).toBe('new-node');
  });
});

describe('syncAnnotations — Order field', () => {
  it('rewrites Order when an annotation rank shifts, without touching text', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'existing');
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    // Stored at rank 3, but now first in reading order → rank 1.
    await run(client, {
      AAA: {
        nodeId: 'existing',
        name: highlight.name,
        description: highlight.description,
        order: 3,
      },
    });

    expect(client.update).not.toHaveBeenCalled();
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'existing',
      'hl-order',
      '1',
    );
  });

  it('writes ranks in reading order for multiple new annotations', async () => {
    const client = createClientMock();
    const second: AnnotationNode = {
      ...highlight,
      key: 'BBB',
      name: 'second highlight',
    };
    mockedReadItemAnnotations.mockReturnValue([highlight, second]);

    const result = await run(client, {});

    expect(client.setFieldContent).toHaveBeenCalledWith(
      'new-node',
      'hl-order',
      '1',
    );
    expect(client.setFieldContent).toHaveBeenCalledWith(
      'new-node',
      'hl-order',
      '2',
    );
    expect(result.AAA?.order).toBe(1);
    expect(result.BBB?.order).toBe(2);
  });
});

describe('syncAnnotations — unreachable (deleted in Tana)', () => {
  it('recreates a trashed node even when the annotation text is unchanged', async () => {
    const client = createClientMock();
    // Search reports nothing live; the stored node was created long ago (no grace).
    setLiveNodes(client);
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: {
        nodeId: 'trashed',
        name: highlight.name,
        description: highlight.description,
        createdAt: 1,
      },
    });

    expect(client.import).toHaveBeenCalledWith('ref-node', expect.any(String));
    expect(result.AAA?.nodeId).toBe('new-node');
  });

  it('recreates a trashed node whose annotation text changed', async () => {
    const client = createClientMock();
    setLiveNodes(client);
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: {
        nodeId: 'trashed',
        name: 'old text',
        description: '',
        createdAt: 1,
      },
    });

    expect(client.import).toHaveBeenCalled();
    expect(result.AAA?.nodeId).toBe('new-node');
  });

  it('recreates a node with no createdAt that the search no longer finds', async () => {
    const client = createClientMock();
    setLiveNodes(client);
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: {
        nodeId: 'trashed',
        name: highlight.name,
        description: highlight.description,
      },
    });

    expect(client.import).toHaveBeenCalled();
    expect(result.AAA?.nodeId).toBe('new-node');
  });
});

describe('syncAnnotations — index-lag grace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a just-created node the search index has not caught up to', async () => {
    const client = createClientMock();
    setLiveNodes(client); // search miss
    mockedReadItemAnnotations.mockReturnValue([highlight]);
    // createdAt is "now", so the miss is within the index-lag grace.
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    const result = await run(client, {
      AAA: {
        nodeId: 'fresh',
        name: highlight.name,
        description: highlight.description,
        createdAt: 9_000,
        order: 1,
      },
    });

    expect(client.import).not.toHaveBeenCalled();
    expect(result.AAA?.nodeId).toBe('fresh');
  });

  it('recreates once a missing node is older than the grace window', async () => {
    const client = createClientMock();
    setLiveNodes(client); // search miss
    mockedReadItemAnnotations.mockReturnValue([highlight]);
    // createdAt is well past the 30s grace.
    vi.spyOn(Date, 'now').mockReturnValue(100_000);

    const result = await run(client, {
      AAA: {
        nodeId: 'stale',
        name: highlight.name,
        description: highlight.description,
        createdAt: 1_000,
      },
    });

    expect(client.import).toHaveBeenCalled();
    expect(result.AAA?.nodeId).toBe('new-node');
  });
});

describe('syncAnnotations — delete', () => {
  it('trashes a live node for an annotation removed from Zotero', async () => {
    const client = createClientMock();
    setLiveNodes(client, 'keep', 'gone');
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {
      AAA: {
        nodeId: 'keep',
        name: highlight.name,
        description: highlight.description,
      },
      BBB: { nodeId: 'gone', name: 'old quote', description: '' },
    });

    expect(client.trash).toHaveBeenCalledWith('gone');
    expect(client.trash).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('BBB');
    expect(result.AAA?.nodeId).toBe('keep');
  });

  it('does not trash an already-deleted node (avoids re-trash 400)', async () => {
    const client = createClientMock();
    setLiveNodes(client); // BBB is not live — the user already deleted it
    mockedReadItemAnnotations.mockReturnValue([]);

    const result = await run(client, {
      BBB: { nodeId: 'gone', name: 'old quote', description: '', createdAt: 1 },
    });

    expect(client.trash).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('BBB');
  });
});
