import { ItemSyncError, LocalizableError } from '../errors';
import { getSchemaConfig } from '../prefs/schema-config';
import {
  ZotanaPref,
  getZotanaPref,
  getRequiredZotanaPref,
} from '../prefs/zotana-pref';
import { TanaClient } from '../tana/client';
import { TitleFormat } from '../tana/reference-builder';
import { ensureSchema, type ResolvedSchema } from '../tana/schema';
import { getLocalizedErrorMessage, logger } from '../utils';

import { ProgressWindow, type ItemWarning } from './progress-window';
import { getCitationFormat, getTitleFormat } from './sync-config';
import { syncRegularItem } from './sync-regular-item';

export type SyncJobParams = {
  client: TanaClient;
  /** Resolved tag + field IDs for this job (created/looked up by name). */
  schema: ResolvedSchema;
  /** Parent node under which new reference nodes are created. */
  parentNodeId: string;
  /**
   * Parent node under which new #Person/#Organization entity nodes are created.
   * Resolved to the workspace Library (`_STASH`) so entities match where Tana
   * files inline-created ones on the create path.
   */
  entityParentNodeId: string;
  citationFormat: string;
  titleFormat: TitleFormat;
};

export async function performSyncJob(
  itemIDs: Set<Zotero.Item['id']>,
  window: Window,
): Promise<void> {
  const items = Zotero.Items.get(Array.from(itemIDs));
  if (!items.length) return;

  const progressWindow = new ProgressWindow(items.length, window);
  await progressWindow.show();

  try {
    const params = await prepareSyncJob(window);
    await syncItems(items, progressWindow, params);
  } catch (error) {
    await handleError(error, progressWindow, window);
  }
}

async function prepareSyncJob(window: Window): Promise<SyncJobParams> {
  const token = getRequiredZotanaPref(ZotanaPref.tanaToken);
  const parentNodeId = getRequiredZotanaPref(ZotanaPref.tanaParentNodeId);
  const baseUrl = getZotanaPref(ZotanaPref.tanaBaseUrl);

  const client = new TanaClient({
    token,
    baseUrl,
    fetch: window.fetch.bind(window),
  });

  const healthy = await client.health();
  if (!healthy) {
    throw new LocalizableError(
      'Tana Local API is not reachable. Open Tana and enable the Local API.',
      'zotana-error-tana-unreachable',
    );
  }

  const workspaceId = getRequiredZotanaPref(ZotanaPref.tanaWorkspaceId);
  const schema = await ensureSchema(client, getSchemaConfig(), {
    workspaceId,
    optionSeeds: { itemType: zoteroItemTypeNames() },
  });

  return {
    client,
    schema,
    parentNodeId,
    // New entities land in the workspace Library, matching where Tana files the
    // inline `[[Name #Person]]` references the create path emits.
    entityParentNodeId: `${schema.workspaceId}_STASH`,
    citationFormat: getCitationFormat(),
    titleFormat: getTitleFormat(),
  };
}

/** Localized names of all Zotero item types, to seed the Item Type options field. */
function zoteroItemTypeNames(): string[] {
  try {
    return Zotero.ItemTypes.getTypes().map((type) =>
      Zotero.ItemTypes.getLocalizedString(type.id),
    );
  } catch (error) {
    logger.error(
      'Failed to enumerate Zotero item types for option seed',
      error,
    );
    return [];
  }
}

async function syncItems(
  items: Zotero.Item[],
  progressWindow: ProgressWindow,
  params: SyncJobParams,
) {
  const warnings: ItemWarning[] = [];

  for (const [index, item] of items.entries()) {
    const step = index + 1;
    logger.groupCollapsed(
      `Syncing item ${step} of ${items.length} with ID`,
      item.id,
    );
    logger.debug(item.getDisplayTitle());

    await progressWindow.updateText(step);

    try {
      if (item.isNote()) {
        // Standalone notes are out of scope (see CLAUDE.md "Known limitations").
        logger.debug('Skipping note item (note syncing not supported)');
      } else {
        const referencedFields = await syncRegularItem(item, params);
        if (referencedFields.length)
          warnings.push({ item, fields: referencedFields });
      }
    } catch (error) {
      throw new ItemSyncError(error, item);
    } finally {
      logger.groupEnd();
    }

    progressWindow.updateProgress(step);
  }

  await progressWindow.complete(warnings);
}

async function handleError(
  error: unknown,
  progressWindow: ProgressWindow,
  window: Window,
) {
  let cause = error;
  let failedItem: Zotero.Item | undefined;

  if (error instanceof ItemSyncError) {
    cause = error.cause;
    failedItem = error.item;
  }

  const errorMessage = await getLocalizedErrorMessage(
    cause,
    window.document.l10n,
  );

  logger.error(error, failedItem?.getDisplayTitle());

  progressWindow.fail(errorMessage, failedItem);
}
