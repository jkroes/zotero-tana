/**
 * Creator-role bucketing + Person/Organization routing, reading the live
 * Zotero API instead of fixtures (ported from the original mapping harness).
 *
 *  - PRIMARY-ROLE-AWARE: the lead bucket holds the item type's *primary* creator
 *    role (author, but presenter/podcaster/director/... per type), resolved via
 *    Zotero.CreatorTypes.getPrimaryIDForType — so the real lead creator is
 *    captured for every item type.
 *  - fieldMode routing: institutional creators (single-field name, fieldMode 1)
 *    link to #Organization; everyone else to #Person. Tana dedups [[Name #Tag]]
 *    by exact name, so the same org as author + publisher resolves to one node.
 */

import type { TanaLink } from './tana-paste';

const EDITOR_ROLE_NAMES = ['editor', 'seriesEditor'] as const;

export type CreatorBuckets = {
  lead: TanaLink[];
  editors: TanaLink[];
  contributors: TanaLink[];
};

/** "First Last" for people; the single-field name for institutions. */
export function creatorName(creator: Zotero.Creator): string {
  if (creator.fieldMode === 1) return creator.lastName.trim();
  return [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim();
}

/** Institutional creators (fieldMode 1) → Organization; everyone else → Person. */
function targetTag(creator: Zotero.Creator): TanaLink['tag'] {
  return creator.fieldMode === 1 ? 'Organization' : 'Person';
}

/** Split an item's creators into { lead, editors, contributors }. */
export function bucketCreators(item: Zotero.Item): CreatorBuckets {
  const primaryID = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
  const editorIDs = new Set(
    EDITOR_ROLE_NAMES.map((name) => Zotero.CreatorTypes.getID(name)).filter(
      (id): id is number => typeof id === 'number',
    ),
  );

  const lead: TanaLink[] = [];
  const editors: TanaLink[] = [];
  const contributors: TanaLink[] = [];

  for (const creator of item.getCreators()) {
    const name = creatorName(creator);
    if (!name) continue;
    const entry: TanaLink = { name, tag: targetTag(creator) };

    if (primaryID !== false && creator.creatorTypeID === primaryID) {
      lead.push(entry);
    } else if (editorIDs.has(creator.creatorTypeID)) {
      editors.push(entry);
    } else {
      contributors.push(entry);
    }
  }

  return { lead, editors, contributors };
}
