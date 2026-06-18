import { beforeEach, describe, expect, it } from 'vite-plus/test';

import { createZoteroItemMock, zoteroMock } from '../../../../test/utils';
import { bucketCreators } from '../entities';

const AUTHOR = 1;
const EDITOR = 2;
const SERIES_EDITOR = 3;
const TRANSLATOR = 4;

function creator(overrides: Partial<Zotero.Creator>): Zotero.Creator {
  return {
    firstName: '',
    lastName: '',
    fieldMode: 0,
    creatorTypeID: 0,
    ...overrides,
  };
}

beforeEach(() => {
  zoteroMock.CreatorTypes.getPrimaryIDForType.mockReturnValue(AUTHOR);
  zoteroMock.CreatorTypes.getID.mockImplementation((name: number | string) => {
    const ids: Record<string, number> = {
      editor: EDITOR,
      seriesEditor: SERIES_EDITOR,
    };
    return (typeof name === 'string' && ids[name]) || false;
  });
});

describe('bucketCreators', () => {
  it('routes the primary role to lead, editor roles to editors, rest to contributors', () => {
    const item = createZoteroItemMock({ itemTypeID: 1 });
    item.getCreators.mockReturnValue([
      creator({
        firstName: 'Ashish',
        lastName: 'Vaswani',
        creatorTypeID: AUTHOR,
      }),
      creator({ firstName: 'Ed', lastName: 'Itor', creatorTypeID: EDITOR }),
      creator({
        firstName: 'Sue',
        lastName: 'Ries',
        creatorTypeID: SERIES_EDITOR,
      }),
      creator({
        firstName: 'Trans',
        lastName: 'Lator',
        creatorTypeID: TRANSLATOR,
      }),
    ]);

    expect(bucketCreators(item)).toStrictEqual({
      lead: [{ name: 'Ashish Vaswani', tag: 'Person' }],
      editors: [
        { name: 'Ed Itor', tag: 'Person' },
        { name: 'Sue Ries', tag: 'Person' },
      ],
      contributors: [{ name: 'Trans Lator', tag: 'Person' }],
    });
  });

  it('routes institutional creators (fieldMode 1) to Organization using the single-field name', () => {
    const item = createZoteroItemMock({ itemTypeID: 1 });
    item.getCreators.mockReturnValue([
      creator({
        lastName: 'World Health Organization',
        fieldMode: 1,
        creatorTypeID: AUTHOR,
      }),
    ]);

    expect(bucketCreators(item).lead).toStrictEqual([
      { name: 'World Health Organization', tag: 'Organization' },
    ]);
  });

  it('skips creators with empty names', () => {
    const item = createZoteroItemMock({ itemTypeID: 1 });
    item.getCreators.mockReturnValue([
      creator({ creatorTypeID: AUTHOR }),
      creator({ firstName: 'Real', lastName: 'Person', creatorTypeID: AUTHOR }),
    ]);

    expect(bucketCreators(item).lead).toStrictEqual([
      { name: 'Real Person', tag: 'Person' },
    ]);
  });
});
