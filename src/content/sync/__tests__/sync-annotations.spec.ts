import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { createZoteroItemMock } from '../../../../test/utils';
import type { StoredAnnotation } from '../../data/item-data';
import { TanaApiError, type TanaClient } from '../../tana/client';
import { type AnnotationNode, readItemAnnotations } from '../annotations';
import { syncAnnotations } from '../sync-annotations';

vi.mock('../annotations');

const QUOTE_TAG_ID = 'quote-tag-id';
const mockedReadItemAnnotations = vi.mocked(readItemAnnotations);

function createClientMock() {
  return {
    import: vi.fn().mockResolvedValue({
      createdNodes: [{ id: 'new-node', name: 'Zotana annotation' }],
    }),
    update: vi.fn().mockResolvedValue(undefined),
    trash: vi.fn().mockResolvedValue(undefined),
  };
}

function run(
  client: ReturnType<typeof createClientMock>,
  stored: Record<string, StoredAnnotation>,
) {
  return syncAnnotations(
    client as unknown as TanaClient,
    QUOTE_TAG_ID,
    createZoteroItemMock({}),
    'ref-node',
    stored,
  );
}

const highlight: AnnotationNode = {
  key: 'AAA',
  name: 'A highlighted sentence',
  description: 'with a comment',
  tagId: QUOTE_TAG_ID,
};

beforeEach(() => {
  mockedReadItemAnnotations.mockReturnValue([]);
});

describe('syncAnnotations — create', () => {
  it('imports a #quote node under the reference and sets text + comment', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    const result = await run(client, {});

    expect(client.import).toHaveBeenCalledWith(
      'ref-node',
      expect.stringContaining('#[[^' + QUOTE_TAG_ID + ']]'),
    );
    expect(client.update).toHaveBeenCalledWith('new-node', {
      name: 'A highlighted sentence',
      description: 'with a comment',
    });
    expect(result).toEqual({
      AAA: {
        nodeId: 'new-node',
        name: 'A highlighted sentence',
        description: 'with a comment',
      },
    });
  });

  it('imports an untagged node (no supertag) for a note annotation', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([
      { key: 'N1', name: 'a note', description: '', tagId: null },
    ]);

    await run(client, {});

    expect(client.import).toHaveBeenCalledWith(
      'ref-node',
      expect.not.stringContaining('#[[^'),
    );
    // no comment -> description omitted
    expect(client.update).toHaveBeenCalledWith('new-node', { name: 'a note' });
  });
});

describe('syncAnnotations — update in place', () => {
  it('updates only the fields that changed', async () => {
    const client = createClientMock();
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

  it('recreates the node when an update 404s (hard-deleted in Tana)', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([highlight]);
    // Only the first update (on the dead node) 404s; the recreate's update succeeds.
    client.update.mockRejectedValueOnce(new TanaApiError(404, '', 'not found'));

    const result = await run(client, {
      AAA: { nodeId: 'dead', name: 'old text', description: '' },
    });

    // falls back to a fresh import + literal name/description write
    expect(client.import).toHaveBeenCalledWith(
      'ref-node',
      expect.stringContaining('#[[^' + QUOTE_TAG_ID + ']]'),
    );
    expect(result.AAA?.nodeId).toBe('new-node');
  });

  it('does nothing for an unchanged annotation', async () => {
    const client = createClientMock();
    mockedReadItemAnnotations.mockReturnValue([highlight]);

    await run(client, {
      AAA: {
        nodeId: 'existing',
        name: highlight.name,
        description: highlight.description,
      },
    });

    expect(client.import).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
    expect(client.trash).not.toHaveBeenCalled();
  });
});

describe('syncAnnotations — delete', () => {
  it('trashes nodes for annotations removed from Zotero', async () => {
    const client = createClientMock();
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
});
