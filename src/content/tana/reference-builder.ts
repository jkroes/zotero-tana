/**
 * Builds the structured #reference node for one Zotero item, reading the live
 * Zotero API (ported from the original fixture-driven mapping harness).
 *
 * Field reads use Zotero BASE fields (publicationTitle, place, date, type,
 * number, volume, pages, publisher) so one #reference tag covers every item type;
 * itemType is demoted to the Item Type options field. Zotero resolves base fields
 * from the type-specific field, so getField('publicationTitle') works on a book's
 * equivalent field, etc.
 *
 * The result is an ordered list of Tana field entries (TanaReferenceNode),
 * destined for Tana Paste (create) or per-field upsert (update).
 */

import { type FieldKey } from './constants';
import { bucketCreators } from './entities';
import type { ResolvedSchema } from './schema';
import type {
  TanaField,
  TanaLink,
  TanaReferenceNode,
  TanaScalarType,
} from './tana-paste';

/** Node-name format. Mirrors zotana's "Page Title" setting; default author-date. */
export enum TitleFormat {
  authorDateCitation = 'authorDateCitation',
  citationKey = 'citationKey',
  fullCitation = 'fullCitation',
  inTextCitation = 'inTextCitation',
  shortTitle = 'shortTitle',
  title = 'title',
}

export type BuildReferenceParams = {
  item: Zotero.Item;
  schema: ResolvedSchema;
  citationFormat: string;
  titleFormat?: TitleFormat;
};

/**
 * The 4-digit year from Zotero's multipart SQL date (`YYYY-MM-DD…`), or null when
 * there's no real year (`0000`). Returned as a string for the Number field.
 */
export function extractYear(sqlDate: string | undefined): string | null {
  const match = (sqlDate ?? '').match(/(\d{4})/);
  return match && match[1] && match[1] !== '0000' ? match[1] : null;
}

/**
 * Emit a Zotero date at the granularity it actually has — full `YYYY-MM-DD`,
 * year-month `YYYY-MM`, or year-only `YYYY` (Tana accepts all three). Zotero stores
 * a multipart SQL date with `00` for missing parts; partial and freeform/seasonal
 * dates (e.g. "Spring 2016") parse to a year with `00` month/day, so they emit just
 * the year. No real year → null.
 */
export function normalizeDate(sqlDate: string | undefined): string | null {
  const match = (sqlDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (!year || year === '0000') return null;
  if (!month || month === '00') return year;
  if (!day || day === '00') return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

/**
 * zotero://select back-link as a `[url](url)` markdown link (clickable when pasted,
 * no alias — consistent with DOI/URL); the upsert key on the Zotero side. Handles
 * group libraries by deriving the group ID from the item's web URI (Zotero.Libraries
 * is not in the bundled type defs).
 */
function zoteroLink(item: Zotero.Item): string {
  const uri = Zotero.URI.getItemURI(item);
  const groupMatch = uri.match(/\/groups\/(\d+)\/items\//);
  const selectURL = groupMatch
    ? `zotero://select/groups/${groupMatch[1]}/items/${item.key}`
    : `zotero://select/library/items/${item.key}`;
  return `[${selectURL}](${selectURL})`;
}

export function buildReference(
  params: BuildReferenceParams,
): Promise<TanaReferenceNode> {
  return new ReferenceBuilder(params).build();
}

class ReferenceBuilder {
  private readonly item: Zotero.Item;
  private readonly schema: ResolvedSchema;
  private readonly citationFormat: string;
  private readonly titleFormat: TitleFormat;
  private readonly fields: TanaField[] = [];

  public constructor({
    item,
    schema,
    citationFormat,
    titleFormat,
  }: BuildReferenceParams) {
    this.item = item;
    this.schema = schema;
    this.citationFormat = citationFormat;
    this.titleFormat = titleFormat ?? TitleFormat.authorDateCitation;
  }

  public async build(): Promise<TanaReferenceNode> {
    const item = this.item;
    const isPodcast = item.itemType === 'podcast';

    // Back-link first (the upsert key).
    this.pushScalar('item', 'item', zoteroLink(item));

    // People (primary-role-aware; institutional → Organization).
    const { lead, editors, contributors } = bucketCreators(item);
    this.pushLinks('creators', lead);
    this.pushLinks('editors', editors);
    this.pushLinks('contributors', contributors);

    // Container / publisher / place. Podcast has no publicationTitle base field
    // and overloads seriesTitle for the show name, so promote it to Container.
    this.pushScalar(
      'container',
      'options',
      this.getField('publicationTitle') ||
        (isPodcast ? this.getField('seriesTitle') : undefined),
    );
    const publisher = this.getField('publisher');
    if (publisher) {
      this.pushLinks('publisher', [{ name: publisher, tag: 'Organization' }]);
    }
    this.pushScalar('place', 'plain', this.getField('place'));

    // Dates.
    // Zotero's multipart SQL date (YYYY-MM-DD with 00 for missing parts).
    const sqlDate = this.item.getField('date', true, true);
    this.pushScalar('date', 'date', normalizeDate(sqlDate));
    this.pushScalar('year', 'number', extractYear(sqlDate));

    // Bibliographic detail.
    this.pushScalar('volume', 'plain', this.getField('volume'));
    this.pushScalar('issue', 'plain', this.getField('issue'));
    this.pushScalar('pages', 'plain', this.getField('pages'));
    this.pushScalar('edition', 'plain', this.getField('edition'));
    this.pushScalar(
      'series',
      'plain',
      isPodcast
        ? undefined
        : this.getField('series') || this.getField('seriesTitle'),
    );
    this.pushScalar('number', 'plain', this.getField('number'));
    this.pushScalar('typeDetail', 'plain', this.getField('type'));
    this.pushScalar(
      'itemType',
      'options',
      Zotero.ItemTypes.getLocalizedString(item.itemTypeID),
    );

    // Links / identifiers.
    const doi = this.getField('DOI');
    this.pushScalar('doi', 'url', doi ? `https://doi.org/${doi}` : undefined);
    this.pushScalar('url', 'url', this.getField('url'));

    // Text.
    this.pushScalar('abstract', 'plain', this.getField('abstractNote'));
    this.pushScalar('fullCitation', 'plain', await this.getCitation(false));
    this.pushScalar('inTextCitation', 'plain', await this.getCitation(true));
    this.pushOptionList('collections', this.getCollections());
    this.pushOptionList('tags', this.getTags());
    this.pushScalar('extra', 'plain', this.getField('extra'));
    this.pushScalar('citationKey', 'plain', this.getField('citationKey'));
    this.pushScalar('dateAdded', 'date', isoDate(item.dateAdded));
    this.pushScalar('dateModified', 'date', isoDate(item.dateModified));
    this.pushScalar('filePath', 'plain', await this.getFilePath());
    this.pushScalar('shortTitle', 'plain', this.getField('shortTitle'));

    return {
      title: await this.buildTitle(),
      tag: this.schema.tagName,
      tagId: this.schema.tagId,
      fields: this.fields,
    };
  }

  private getField(name: string): string | undefined {
    return this.item.getField(name) || undefined;
  }

  private pushScalar(
    key: FieldKey,
    type: TanaScalarType,
    value: string | null | undefined,
  ): void {
    if (value === undefined || value === null || value === '') return;
    const field = this.schema.fields[key];
    if (!field) return; // field disabled or unresolved → skip
    this.fields.push({ name: field.name, id: field.id, type, value });
  }

  private pushLinks(key: FieldKey, links: TanaLink[]): void {
    if (!links.length) return;
    const field = this.schema.fields[key];
    if (!field) return; // field disabled or unresolved → skip
    this.fields.push({ name: field.name, id: field.id, type: 'links', links });
  }

  /** A multi-value options field: one option node per value (e.g. Tags). */
  private pushOptionList(key: FieldKey, values: string[]): void {
    if (!values.length) return;
    const field = this.schema.fields[key];
    if (!field) return; // field disabled or unresolved → skip
    this.fields.push({
      name: field.name,
      id: field.id,
      type: 'optionList',
      values,
    });
  }

  private getCollections(): string[] {
    return Zotero.Collections.get(this.item.getCollections())
      .map((collection) => collection.name)
      .filter(Boolean);
  }

  private getTags(): string[] {
    return this.item
      .getTags()
      .map(({ tag }) => tag)
      .filter(Boolean);
  }

  private async getFilePath(): Promise<string | undefined> {
    const attachment = await this.item.getBestAttachment();
    if (!attachment) return undefined;
    return (await attachment.getFilePathAsync()) || undefined;
  }

  // --- Title -------------------------------------------------------------

  private async buildTitle(): Promise<string> {
    const fallback = this.item.getDisplayTitle() || 'Untitled';
    switch (this.titleFormat) {
      case TitleFormat.citationKey:
        return this.getField('citationKey') || fallback;
      case TitleFormat.shortTitle:
        return this.getField('shortTitle') || fallback;
      case TitleFormat.title:
        return fallback;
      case TitleFormat.fullCitation:
        return (await this.getCitation(false)) || fallback;
      case TitleFormat.inTextCitation:
        return (await this.getCitation(true)) || fallback;
      case TitleFormat.authorDateCitation:
      default:
        return this.getAuthorDateCitation() || fallback;
    }
  }

  /** Lead creator(s) + year, via Zotero's own first-creator string. */
  private getAuthorDateCitation(): string {
    let citation =
      this.item.getField('firstCreator') || this.item.getDisplayTitle();
    let date = this.item.getField('date', true, true);
    if (date && (date = date.substring(0, 4)) !== '0000') {
      citation += `, ${date}`;
    }
    return citation;
  }

  // --- Citations (live CSL via Quick Copy) -------------------------------

  private readonly cachedCitations = new Map<string, string | null>();

  private async getCitation(inText: boolean): Promise<string | null> {
    const cacheKey = String(inText);
    if (!this.cachedCitations.has(cacheKey)) {
      this.cachedCitations.set(cacheKey, await this.fetchCitation(inText));
    }
    return this.cachedCitations.get(cacheKey) ?? null;
  }

  private fetchCitation(inText: boolean): Promise<string | null> {
    return new Promise((resolve) => {
      const result = Zotero.QuickCopy.getContentFromItems(
        [this.item],
        this.citationFormat,
        (obj, worked) => {
          resolve(worked ? obj.string.trim() : null);
        },
        inText,
      );

      if (result === false) {
        resolve(null);
      } else if (result !== true) {
        resolve(result.text.trim());
      }
    });
  }
}

function isoDate(date: string | undefined): string | null {
  if (!date) return null;
  return date.slice(0, 10);
}
