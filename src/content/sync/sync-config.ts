/**
 * Local-preference helpers shared by the sync job and the change-detection
 * signature: the Quick Copy citation style and the node-title format. Kept in
 * their own module so `content-signature.ts` can reuse them without importing
 * `sync-job.ts` (which would create an import cycle).
 */

import {
  PageTitleFormat,
  ZotanaPref,
  getZotanaPref,
} from '../prefs/zotana-pref';
import { APA_STYLE } from '../tana/constants';
import { TitleFormat } from '../tana/reference-builder';

const PAGE_TITLE_FORMAT_TO_TITLE_FORMAT: Record<PageTitleFormat, TitleFormat> = {
  [PageTitleFormat.itemAuthorDateCitation]: TitleFormat.authorDateCitation,
  [PageTitleFormat.itemCitationKey]: TitleFormat.citationKey,
  [PageTitleFormat.itemFullCitation]: TitleFormat.fullCitation,
  [PageTitleFormat.itemInTextCitation]: TitleFormat.inTextCitation,
  [PageTitleFormat.itemShortTitle]: TitleFormat.shortTitle,
  [PageTitleFormat.itemTitle]: TitleFormat.title,
};

/** Quick Copy citation style for live CSL, falling back to APA. */
export function getCitationFormat(): string {
  const format = Zotero.Prefs.get('export.quickCopy.setting');
  if (typeof format === 'string' && format) return format;
  return APA_STYLE;
}

/** Node-name format mapped from the "Page Title" preference. */
export function getTitleFormat(): TitleFormat {
  const pref = getZotanaPref(ZotanaPref.pageTitleFormat);
  return pref
    ? PAGE_TITLE_FORMAT_TO_TITLE_FORMAT[pref]
    : TitleFormat.authorDateCitation;
}
