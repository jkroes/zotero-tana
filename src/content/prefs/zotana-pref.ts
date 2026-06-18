import { FluentMessageId } from '../../locale/fluent-types';
import { MissingPrefError } from '../errors';

export enum ZotanaPref {
  collectionSyncConfigs = 'collectionSyncConfigs',
  pageTitleFormat = 'pageTitleFormat',
  syncOnModifyItems = 'syncOnModifyItems',
  tanaToken = 'tanaToken',
  tanaParentNodeId = 'tanaParentNodeId',
  tanaBaseUrl = 'tanaBaseUrl',
  tanaWorkspaceId = 'tanaWorkspaceId',
  /** JSON-serialized SchemaConfig (tag name + per-field name/enabled). */
  schemaConfig = 'schemaConfig',
}

export enum PageTitleFormat {
  itemAuthorDateCitation = 'itemAuthorDateCitation',
  itemCitationKey = 'itemCitationKey',
  itemFullCitation = 'itemFullCitation',
  itemInTextCitation = 'itemInTextCitation',
  itemShortTitle = 'itemShortTitle',
  itemTitle = 'itemTitle',
}

export const PAGE_TITLE_FORMAT_L10N_IDS: Record<
  PageTitleFormat,
  FluentMessageId
> = {
  [PageTitleFormat.itemAuthorDateCitation]:
    'zotana-page-title-format-item-author-date-citation',
  [PageTitleFormat.itemCitationKey]:
    'zotana-page-title-format-item-citation-key',
  [PageTitleFormat.itemFullCitation]:
    'zotana-page-title-format-item-full-citation',
  [PageTitleFormat.itemInTextCitation]:
    'zotana-page-title-format-item-in-text-citation',
  [PageTitleFormat.itemShortTitle]: 'zotana-page-title-format-item-short-title',
  [PageTitleFormat.itemTitle]: 'zotana-page-title-format-item-title',
};

type ZotanaPrefValue = Partial<{
  [ZotanaPref.collectionSyncConfigs]: string;
  [ZotanaPref.pageTitleFormat]: PageTitleFormat;
  [ZotanaPref.syncOnModifyItems]: boolean;
  [ZotanaPref.tanaToken]: string;
  [ZotanaPref.tanaParentNodeId]: string;
  [ZotanaPref.tanaBaseUrl]: string;
  [ZotanaPref.tanaWorkspaceId]: string;
  [ZotanaPref.schemaConfig]: string;
}>;

function buildFullPrefName(pref: ZotanaPref): string {
  return `extensions.zotana.${pref}`;
}

function getBooleanPref(value: Zotero.Prefs.Value): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getStringPref(value: Zotero.Prefs.Value): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isPageTitleFormat(
  value: Zotero.Prefs.Value,
): value is PageTitleFormat {
  return (
    typeof value === 'string' &&
    Object.values<string>(PageTitleFormat).includes(value)
  );
}

function getPageTitleFormatPref(
  value: Zotero.Prefs.Value,
): PageTitleFormat | undefined {
  return isPageTitleFormat(value) ? value : undefined;
}

function convertRawPrefValue<P extends ZotanaPref>(
  pref: P,
  value: Zotero.Prefs.Value,
): ZotanaPrefValue[P] {
  const booleanPref = getBooleanPref(value);
  const stringPref = getStringPref(value);

  const pageTitleFormatPref =
    (pref === ZotanaPref.pageTitleFormat && getPageTitleFormatPref(value)) ||
    undefined;

  return {
    [ZotanaPref.collectionSyncConfigs]: stringPref,
    [ZotanaPref.pageTitleFormat]: pageTitleFormatPref,
    [ZotanaPref.syncOnModifyItems]: booleanPref,
    [ZotanaPref.tanaToken]: stringPref,
    [ZotanaPref.tanaParentNodeId]: stringPref,
    [ZotanaPref.tanaBaseUrl]: stringPref,
    [ZotanaPref.tanaWorkspaceId]: stringPref,
    [ZotanaPref.schemaConfig]: stringPref,
  }[pref];
}

export function clearZotanaPref(pref: ZotanaPref): void {
  Zotero.Prefs.clear(buildFullPrefName(pref), true);
}

export function getZotanaPref<P extends ZotanaPref>(
  pref: P,
): ZotanaPrefValue[P] {
  const value = Zotero.Prefs.get(buildFullPrefName(pref), true);
  return convertRawPrefValue(pref, value);
}

export function getRequiredZotanaPref<P extends ZotanaPref>(
  pref: P,
): NonNullable<ZotanaPrefValue[P]> {
  const value = getZotanaPref(pref);

  if (value) return value;

  throw new MissingPrefError(pref);
}

export function setZotanaPref<P extends ZotanaPref>(
  pref: P,
  value: ZotanaPrefValue[P],
): void {
  Zotero.Prefs.set(buildFullPrefName(pref), value, true);
}

export function registerZotanaPrefObserver<P extends ZotanaPref>(
  pref: P,
  handler: (value: ZotanaPrefValue[P]) => void,
): symbol {
  return Zotero.Prefs.registerObserver(
    buildFullPrefName(pref),
    (value: Zotero.Prefs.Value) => {
      handler(convertRawPrefValue(pref, value));
    },
    true,
  );
}

export function unregisterZotanaPrefObserver(symbol: symbol): void {
  Zotero.Prefs.unregisterObserver(symbol);
}
