import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import {
  createWindowMock,
  createZoteroCollectionMock,
  createZoteroItemMock,
  mockZoteroPrefs,
  zoteroMock,
} from '../../../../test/utils';
import { getTanaSyncData } from '../../data/item-data';
import { saveSyncConfigs } from '../../prefs/collection-sync-config';
import { ZotanaPref, setZotanaPref } from '../../prefs/zotana-pref';
import { contentSignature } from '../../sync/content-signature';
import { performSyncJob } from '../../sync/sync-job';
import { EventManager, SyncManager } from '../index';

vi.mock('../../sync/sync-job');
vi.mock('../../sync/content-signature');
vi.mock('../../data/item-data');

const mockedPerformSyncJob = vi.mocked(performSyncJob);
const mockedContentSignature = vi.mocked(contentSignature);
const mockedGetTanaSyncData = vi.mocked(getTanaSyncData);

const pluginInfo = {
  pluginID: 'test',
  rootURI: 'test',
  version: 'test',
};

const collection = createZoteroCollectionMock();

const regularItem = createZoteroItemMock({
  deleted: false,
  isRegularItem: () => true,
});

const deletedItem = createZoteroItemMock({
  deleted: true,
  isRegularItem: () => true,
});

const regularItemNotInCollection = createZoteroItemMock({
  deleted: false,
  isRegularItem: () => true,
});

regularItem.addToCollection(collection.id);
deletedItem.addToCollection(collection.id);

const fakeTagID = 1234;

const storedData = (contentSig: string) => ({
  nodeId: 'node-1',
  title: 'Title',
  fields: {},
  contentSig,
  annotations: {},
});

function setup({
  collectionSyncEnabled = true,
  syncOnModifyItems = true,
}: {
  collectionSyncEnabled?: boolean;
  syncOnModifyItems?: boolean;
} = {}) {
  mockZoteroPrefs();

  const eventManager = new EventManager();
  const syncManager = new SyncManager();

  syncManager.startup({ dependencies: { eventManager }, pluginInfo });

  zoteroMock.getMainWindow.mockReturnValue(createWindowMock());

  saveSyncConfigs({ [collection.id]: { syncEnabled: collectionSyncEnabled } });

  setZotanaPref(ZotanaPref.syncOnModifyItems, syncOnModifyItems);

  return { eventManager };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('SyncManager', () => {
  it('does not perform sync when window is not available', () => {
    const { eventManager } = setup();

    zoteroMock.getMainWindow.mockReturnValue(null);

    eventManager.emit('request-sync-items', [regularItem]);

    vi.runAllTimers();

    expect(performSyncJob).toHaveBeenCalledTimes(0);
  });

  it('performs sync using the latest available window', async () => {
    const { eventManager } = setup();

    const firstWindow = zoteroMock.getMainWindow();

    eventManager.emit('request-sync-items', [regularItem]);
    await vi.runAllTimersAsync();

    expect(mockedPerformSyncJob.mock.lastCall?.[1]).toBe(firstWindow);

    const secondWindow = createWindowMock();
    zoteroMock.getMainWindow.mockReturnValue(secondWindow);

    eventManager.emit('request-sync-items', [regularItem]);
    await vi.runAllTimersAsync();

    expect(mockedPerformSyncJob).toHaveBeenCalledTimes(2);
    expect(mockedPerformSyncJob.mock.lastCall?.[1]).toBe(secondWindow);
  });

  describe('receiving `request-sync-collection` event', () => {
    it('does not sync deleted items in collection', () => {
      const { eventManager } = setup();

      eventManager.emit('request-sync-collection', collection);

      vi.runAllTimers();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });

  describe('receiving `request-sync-items` event', () => {
    it('syncs regular items regardless of collection membership', () => {
      const { eventManager } = setup();

      eventManager.emit('request-sync-items', [
        regularItem,
        deletedItem,
        regularItemNotInCollection,
      ]);

      vi.runAllTimers();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id, regularItemNotInCollection.id]),
      );
    });
  });

  describe('receiving `collection.modify` notifier event', () => {
    it('does not perform sync when `syncOnModifyItems` is disabled', () => {
      const { eventManager } = setup({ syncOnModifyItems: false });

      eventManager.emit('notifier-event', 'collection.modify', [collection.id]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('does not perform sync when collection is not sync-enabled', () => {
      const { eventManager } = setup({ collectionSyncEnabled: false });

      eventManager.emit('notifier-event', 'collection.modify', [collection.id]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('syncs regular items in collection when enabled', async () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'collection.modify', [collection.id]);

      await vi.runAllTimersAsync();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });

  describe('receiving `collection-item.add` notifier event', () => {
    it('does not perform sync when item is not in sync-enabled collection', () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'collection-item.add', [
        [fakeTagID, regularItemNotInCollection.id],
      ]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('syncs the added item even when `syncOnModifyItems` is disabled', async () => {
      const { eventManager } = setup({ syncOnModifyItems: false });

      eventManager.emit('notifier-event', 'collection-item.add', [
        [collection.id, regularItem.id],
      ]);

      await vi.runAllTimersAsync();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });

  describe('receiving `item.modify` notifier event', () => {
    it('does not perform sync when `syncOnModifyItems` is disabled', () => {
      const { eventManager } = setup({ syncOnModifyItems: false });

      eventManager.emit('notifier-event', 'item.modify', [regularItem.id]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('does not perform sync when item is not in sync-enabled collection', () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'item.modify', [
        regularItemNotInCollection.id,
      ]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('does not perform sync when item is deleted', () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'item.modify', [deletedItem.id]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('syncs item when enabled and item is in sync-enabled collection', async () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'item.modify', [regularItem.id]);

      await vi.runAllTimersAsync();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });

  describe('receiving `item-tag.modify` notifier event', () => {
    it('does not perform sync when `syncOnModifyItems` is disabled', () => {
      const { eventManager } = setup({ syncOnModifyItems: false });

      eventManager.emit('notifier-event', 'item-tag.modify', [
        [regularItem.id, fakeTagID],
      ]);

      vi.runAllTimers();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('syncs item when enabled and item is in sync-enabled collection', async () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'item-tag.modify', [
        [regularItem.id, fakeTagID],
      ]);

      await vi.runAllTimersAsync();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });

  describe('no-op skip on the modify path', () => {
    it('skips sync when synced content is unchanged', async () => {
      const { eventManager } = setup();
      mockedGetTanaSyncData.mockReturnValueOnce(storedData('same-sig'));
      mockedContentSignature.mockResolvedValueOnce('same-sig');

      eventManager.emit('notifier-event', 'item.modify', [regularItem.id]);
      await vi.runAllTimersAsync();

      expect(performSyncJob).toHaveBeenCalledTimes(0);
    });

    it('syncs when synced content changed', async () => {
      const { eventManager } = setup();
      mockedGetTanaSyncData.mockReturnValueOnce(storedData('old-sig'));
      mockedContentSignature.mockResolvedValueOnce('new-sig');

      eventManager.emit('notifier-event', 'item.modify', [regularItem.id]);
      await vi.runAllTimersAsync();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });

    it('syncs an item with no stored signature', async () => {
      const { eventManager } = setup();
      mockedGetTanaSyncData.mockReturnValueOnce(undefined);

      eventManager.emit('notifier-event', 'item.modify', [regularItem.id]);
      await vi.runAllTimersAsync();

      expect(mockedContentSignature).not.toHaveBeenCalled();
      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });

  describe('receiving `item-tag.remove` notifier event', () => {
    it('syncs item when enabled and item is in sync-enabled collection', async () => {
      const { eventManager } = setup();

      eventManager.emit('notifier-event', 'item-tag.remove', [
        [regularItem.id, fakeTagID],
      ]);

      await vi.runAllTimersAsync();

      expect(mockedPerformSyncJob.mock.lastCall?.[0]).toStrictEqual(
        new Set([regularItem.id]),
      );
    });
  });
});
