import { loadSyncEnabledCollectionIDs } from '../prefs/collection-sync-config';
import { getZotanaPref, ZotanaPref } from '../prefs/zotana-pref';
import { performSyncJob } from '../sync/sync-job';
import { getAllCollectionItems, logger } from '../utils';

import type { EventManager, NotifierEventParams } from './event-manager';
import type { Service, ServiceParams } from './service';

const SYNC_DEBOUNCE_MS = 2000;

type QueuedSync = {
  readonly itemIDs: Set<Zotero.Item['id']>;
  timeoutID?: ReturnType<typeof setTimeout>;
};

export class SyncManager implements Service {
  private eventManager!: EventManager;

  private queuedSync?: QueuedSync;

  private syncInProgress = false;

  public startup({
    dependencies: { eventManager },
  }: ServiceParams<'eventManager'>) {
    this.eventManager = eventManager;

    const { addListener } = this.eventManager;

    addListener('notifier-event', this.handleNotifierEvent);
    addListener('request-sync-collection', this.handleSyncCollection);
    addListener('request-sync-items', this.handleSyncItems);
  }

  public shutdown() {
    const { removeListener } = this.eventManager;

    removeListener('notifier-event', this.handleNotifierEvent);
    removeListener('request-sync-collection', this.handleSyncCollection);
    removeListener('request-sync-items', this.handleSyncItems);
  }

  private handleNotifierEvent = (...params: NotifierEventParams) => {
    const items = this.getItemsForNotifierEvent(...params);
    if (!items.length) return;

    const syncedCollectionIDs = loadSyncEnabledCollectionIDs();
    if (!syncedCollectionIDs.size) return;

    const isItemInSyncedCollection = (item: Zotero.Item) =>
      item
        .getCollections()
        .some((collectionID) => syncedCollectionIDs.has(collectionID));

    const validItems = items.filter(
      (item) =>
        !item.deleted && item.isRegularItem() && isItemInSyncedCollection(item),
    );

    this.enqueueItemsToSync(validItems);
  };

  private handleSyncCollection = (collection: Zotero.Collection) => {
    const validItems = collection
      .getChildItems(false)
      .filter((item) => !item.deleted && item.isRegularItem());

    this.enqueueItemsToSync(validItems);
  };

  private handleSyncItems = (items: Zotero.Item[]) => {
    if (!items.length) return;

    const validItems = items.filter(
      (item) => !item.deleted && item.isRegularItem(),
    );

    this.enqueueItemsToSync(validItems);
  };

  /**
   * Return the Zotero items (if any) that should be synced for the given
   * notifier event. Only regular items are synced (note syncing is deferred).
   */
  private getItemsForNotifierEvent(
    ...[event, ids]: NotifierEventParams
  ): Zotero.Item[] {
    const syncOnModifyItems = getZotanaPref(ZotanaPref.syncOnModifyItems);

    if (!syncOnModifyItems && event !== 'collection-item.add') {
      return [];
    }

    switch (event) {
      case 'collection.delete':
      case 'collection.modify':
        return this.getItemsFromCollectionIDs(ids);
      case 'collection-item.add':
        return Zotero.Items.get(this.getIndexedIDs(1, ids));
      case 'item.modify':
        return Zotero.Items.get(ids).filter((item) => item.isRegularItem());
      case 'item-tag.modify':
      case 'item-tag.remove':
        return Zotero.Items.get(this.getIndexedIDs(0, ids));
      default:
        return [];
    }
  }

  /**
   * Extract IDs from compound IDs (e.g. `'${id0}-${id1}'`) at the given index.
   */
  private getIndexedIDs(this: void, index: 0 | 1, ids: [number, number][]) {
    return ids.map((compoundID) => compoundID[index]);
  }

  private getItemsFromCollectionIDs(this: void, ids: number[]) {
    const allItems = Zotero.Collections.get(ids).reduce(
      (items: Zotero.Item[], collection) =>
        items.concat(getAllCollectionItems(collection)),
      [],
    );

    // Deduplicate items in multiple collections
    return Array.from(new Set(allItems));
  }

  /**
   * Enqueue Zotero items to sync to Tana.
   *
   * Because Zotero items can be updated multiple times in short succession,
   * any subsequent updates after the first can sometimes occur before the
   * initial sync has finished and stored the Tana node ID. This has the
   * potential to create duplicate Tana nodes.
   *
   * To address this, we use two strategies:
   * - Debounce syncs so that they occur, at most, every `SYNC_DEBOUNCE_MS` ms
   * - Prevent another sync from starting until the previous one has finished
   */
  private enqueueItemsToSync(items: readonly Zotero.Item[]) {
    if (!items.length) {
      logger.debug('No valid items to sync');
      return;
    }

    const idsToSync = items.map(({ id }) => id);

    logger.groupCollapsed(
      `Enqueue ${idsToSync.length} item(s) to sync with IDs`,
      idsToSync,
    );
    logger.table(items, ['_id', '_displayTitle']);
    logger.groupEnd();

    if (this.queuedSync?.timeoutID) {
      clearTimeout(this.queuedSync.timeoutID);
    }

    const itemIDs = new Set([
      ...(this.queuedSync?.itemIDs.values() ?? []),
      ...idsToSync,
    ]);

    const timeoutID = setTimeout(() => {
      if (!this.queuedSync) return;

      this.queuedSync.timeoutID = undefined;
      if (!this.syncInProgress) {
        void this.performSync();
      }
    }, SYNC_DEBOUNCE_MS);

    this.queuedSync = { itemIDs, timeoutID };
  }

  private async performSync() {
    if (!this.queuedSync) return;

    const mainWindow = Zotero.getMainWindow();
    if (!mainWindow) {
      logger.warn('Zotero main window not available - cannot sync items');
      return;
    }

    const { itemIDs } = this.queuedSync;
    this.queuedSync = undefined as QueuedSync | undefined;
    this.syncInProgress = true;

    await performSyncJob(itemIDs, mainWindow);

    if (this.queuedSync && !this.queuedSync.timeoutID) {
      await this.performSync();
    }

    this.syncInProgress = false;
  }
}
