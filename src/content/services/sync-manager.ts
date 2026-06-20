import { getTanaSyncData } from '../data/item-data';
import { loadSyncEnabledCollectionIDs } from '../prefs/collection-sync-config';
import { getZotanaPref, ZotanaPref } from '../prefs/zotana-pref';
import { contentSignature } from '../sync/content-signature';
import { performSyncJob } from '../sync/sync-job';
import { getAllCollectionItems, logger } from '../utils';

import type { EventManager, NotifierEventParams } from './event-manager';
import type { Service, ServiceParams } from './service';

/**
 * How long to wait after the last edit before syncing. Editing an item in the
 * pane commits one `item.modify` per field, so this coalesces a burst of edits
 * into one sync once the user settles (each edit resets the timer).
 */
const SYNC_DEBOUNCE_MS = 5000;

type QueuedSync = {
  readonly itemIDs: Set<Zotero.Item['id']>;
  timeoutID?: ReturnType<typeof setTimeout>;
};

export class SyncManager implements Service {
  private eventManager!: EventManager;

  private queuedSync?: QueuedSync;

  private syncInProgress = false;

  /**
   * IDs of items whose sync is currently running. The modify path ignores these
   * so a sync's own follow-on `item.modify` notifications can't re-enqueue it.
   * In particular, editing a title makes Zotero auto-rename the linked file
   * (File Renaming pref), which fires a delayed `modify` on the parent item ~250ms
   * later — landing while the sync is still persisting its new content signature.
   * Without this guard that notification races the persist, reads the stale
   * signature, and starts a duplicate sync (a second "Synced" ProgressWindow).
   */
  private readonly syncingItemIDs = new Set<Zotero.Item['id']>();

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

    // Auto-sync (modify) path only: skip items whose synced content didn't
    // actually change, so edits to non-synced or volatile fields don't trigger a
    // pointless network sync + ProgressWindow. Manual menu syncs below bypass this.
    void this.enqueueChangedItems(validItems);
  };

  /**
   * Filter to items whose synced source content changed since their last sync,
   * then enqueue those. The modify path only ever updates an item that already
   * has a Tana node (never-synced items are filtered out upstream in
   * `getItemsForNotifierEvent`); an item synced before content signatures
   * existed has no baseline and always syncs as an update.
   */
  private async enqueueChangedItems(items: readonly Zotero.Item[]) {
    const changed: Zotero.Item[] = [];
    for (const item of items) {
      if (await this.hasSyncableChange(item)) changed.push(item);
    }
    // Auto-sync path: debounce to coalesce a burst of `item.modify` edits.
    this.enqueueItemsToSync(changed, SYNC_DEBOUNCE_MS);
  }

  private async hasSyncableChange(item: Zotero.Item): Promise<boolean> {
    // Ignore notifications for an item whose sync is still running — they are our
    // own write-back cascade (see syncingItemIDs), not a fresh user edit. A real
    // edit after the sync finishes recomputes a different signature and syncs then.
    if (this.syncingItemIDs.has(item.id)) return false;

    const stored = getTanaSyncData(item);
    if (!stored?.contentSig) return true;
    try {
      return (await contentSignature(item)) !== stored.contentSig;
    } catch (error) {
      logger.warn(
        'Failed to compute content signature; syncing item anyway',
        error,
      );
      return true;
    }
  }

  private handleSyncCollection = (collection: Zotero.Collection) => {
    const validItems = collection
      .getChildItems(false)
      .filter((item) => !item.deleted && item.isRegularItem());

    // Manual sync: run now (no debounce); still serialized via syncInProgress.
    this.enqueueItemsToSync(validItems, 0);
  };

  private handleSyncItems = (items: Zotero.Item[]) => {
    if (!items.length) return;

    const validItems = items.filter(
      (item) => !item.deleted && item.isRegularItem(),
    );

    // Manual sync: run now (no debounce); still serialized via syncInProgress.
    this.enqueueItemsToSync(validItems, 0);
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
        // A modify only UPDATES an item that already has a Tana node; it never
        // creates one. This stops deleting the hidden "Tana" sync attachment
        // (which makes Zotero fire item.modify on the parent) from recreating
        // the node — the deletion disconnects the item; creation stays on
        // collection-add / manual sync. Non-"Tana" attachment edits are already
        // no-op-skipped via the content signature.
        return Zotero.Items.get(ids).filter(
          (item) => item.isRegularItem() && getTanaSyncData(item) !== undefined,
        );
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
   * The guard against that is serialization: `syncInProgress` lets only one
   * sync run at a time, and anything enqueued meanwhile is merged into
   * `queuedSync.itemIDs` (a Set, so overlapping items dedupe) and run after.
   * Both the auto and manual paths funnel through here, so a manual sync can't
   * race an in-flight auto-sync (or vice versa).
   *
   * `delayMs` only controls how long to wait before firing: the auto path
   * passes `SYNC_DEBOUNCE_MS` to coalesce a burst of edits; manual syncs pass
   * `0` to run on the next tick. The delay is a coalescing knob, not the
   * duplicate guard — that's `syncInProgress`.
   */
  private enqueueItemsToSync(items: readonly Zotero.Item[], delayMs: number) {
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
    }, delayMs);

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

    itemIDs.forEach((id) => this.syncingItemIDs.add(id));
    try {
      await performSyncJob(itemIDs, mainWindow);
    } finally {
      itemIDs.forEach((id) => this.syncingItemIDs.delete(id));
    }

    if (this.queuedSync && !this.queuedSync.timeoutID) {
      await this.performSync();
    }

    this.syncInProgress = false;
  }
}
