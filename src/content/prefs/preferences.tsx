import React from 'react';
import ReactDOM from 'react-dom';
import type { createRoot } from 'react-dom/client';

import type { FluentMessageId } from '../../locale/fluent-types';
import { createXULElement, getXULElementById, logger } from '../utils';

import { SchemaPanel } from './schema-panel';
import { SyncConfigsTable } from './sync-configs-table';
import {
  ZotanaPref,
  PAGE_TITLE_FORMAT_L10N_IDS,
  PageTitleFormat,
  getZotanaPref,
  setZotanaPref,
} from './zotana-pref';

type ReactDOMClient = typeof ReactDOM & { createRoot: typeof createRoot };

type MenuItem = {
  disabled?: boolean;
  l10nId?: FluentMessageId;
  label?: string;
  value: string;
};

function setMenuItems(menuList: XUL.MenuListElement, items: MenuItem[]): void {
  menuList.menupopup.replaceChildren();

  items.forEach(({ disabled, l10nId, label, value }) => {
    const item = createXULElement(document, 'menuitem');
    item.value = value;
    item.disabled = Boolean(disabled);
    if (l10nId) {
      document.l10n.setAttributes(item, l10nId);
    } else {
      item.label = label || value;
    }
    menuList.menupopup.append(item);
  });
}

class Preferences {
  private pageTitleFormatMenu!: XUL.MenuListElement;

  public async init(): Promise<void> {
    await Zotero.uiReadyPromise;

    // oxlint-disable-next-line typescript/no-non-null-assertion
    this.pageTitleFormatMenu = getXULElementById('zotana-pageTitleFormat')!;

    this.initTextPref('zotana-tanaToken', ZotanaPref.tanaToken);
    this.initTextPref('zotana-tanaParentNodeId', ZotanaPref.tanaParentNodeId);
    this.initTextPref('zotana-tanaBaseUrl', ZotanaPref.tanaBaseUrl);

    await this.initPageTitleFormatMenu();
    this.initSchemaPanel();
    await this.initSyncConfigsTable();
  }

  private initSchemaPanel(): void {
    const container = document.getElementById('zotana-schemaPanel-container');
    if (!container) {
      logger.error('Failed to find schema panel container');
      return;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    (ReactDOM as ReactDOMClient).createRoot(container).render(<SchemaPanel />);
  }

  /**
   * Bind a plain text input to a string preference: populate from the stored
   * value and write back (trimmed) on input. Zotero's native `preference`
   * binding is reserved for the menulist/checkbox; text inputs are handled here.
   */
  private initTextPref(elementId: string, pref: ZotanaPref): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const input = document.getElementById(elementId) as HTMLInputElement | null;
    if (!input) {
      logger.error(`Failed to find input '${elementId}'`);
      return;
    }

    const current = getZotanaPref(pref);
    if (typeof current === 'string') input.value = current;

    input.addEventListener('input', () => {
      setZotanaPref(pref, input.value.trim());
    });
  }

  private async initPageTitleFormatMenu(): Promise<void> {
    const isBetterBibTeXActive = await this.isBetterBibTeXActive();

    const menuItems = Object.values(PageTitleFormat).map<MenuItem>(
      (format) => ({
        disabled:
          format === PageTitleFormat.itemCitationKey && !isBetterBibTeXActive,
        l10nId: PAGE_TITLE_FORMAT_L10N_IDS[format],
        value: format,
      }),
    );

    setMenuItems(this.pageTitleFormatMenu, menuItems);
    this.pageTitleFormatMenu.disabled = false;
  }

  private async initSyncConfigsTable(): Promise<void> {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const syncConfigsTableContainer = document.getElementById(
      'zotana-syncConfigsTable-container',
    )!;
    const collection = await document.l10n.formatValue(
      'zotana-preferences-collection-column',
    );
    const syncEnabled = await document.l10n.formatValue(
      'zotana-preferences-sync-enabled-column',
    );
    const columnLabels = {
      collectionFullName: collection || 'Collection',
      syncEnabled: syncEnabled || 'Sync Enabled',
    };

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    (ReactDOM as ReactDOMClient)
      .createRoot(syncConfigsTableContainer)
      .render(
        <SyncConfigsTable
          columnLabels={columnLabels}
          container={syncConfigsTableContainer}
        />,
      );
  }

  private async isBetterBibTeXActive(): Promise<boolean> {
    const { AddonManager } = ChromeUtils.importESModule(
      'resource://gre/modules/AddonManager.sys.mjs',
    );
    const addon = await AddonManager.getAddonByID(
      'better-bibtex@iris-advies.com',
    );
    return Boolean(addon?.isActive);
  }
}

type WindowWithZotanaPreferences = typeof window & {
  Zotana_Preferences: Preferences;
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
(window as WindowWithZotanaPreferences).Zotana_Preferences = new Preferences();
