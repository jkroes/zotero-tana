import { describe, expect, it } from 'vite-plus/test';

import { extractYear, normalizeDate } from '../reference-builder';

describe('normalizeDate', () => {
  it('keeps a full date', () => {
    expect(normalizeDate('2016-03-21')).toBe('2016-03-21');
  });

  it('drops the day when it is missing (00)', () => {
    expect(normalizeDate('2016-03-00')).toBe('2016-03');
  });

  it('keeps only the year when month and day are missing', () => {
    expect(normalizeDate('2016-00-00')).toBe('2016');
  });

  it('emits just the year for a seasonal/freeform date', () => {
    // Zotero parses "Spring 2016" to year 2016 with 00 month/day.
    expect(normalizeDate('2016-00-00 Spring 2016')).toBe('2016');
  });

  it('returns null when there is no real year', () => {
    expect(normalizeDate('0000-00-00')).toBe(null);
    expect(normalizeDate('')).toBe(null);
    expect(normalizeDate(undefined)).toBe(null);
  });
});

describe('extractYear', () => {
  it('extracts the year', () => {
    expect(extractYear('2016-03-21')).toBe('2016');
    expect(extractYear('2016-00-00')).toBe('2016');
  });

  it('returns null for 0000 or empty', () => {
    expect(extractYear('0000-00-00')).toBe(null);
    expect(extractYear(undefined)).toBe(null);
  });
});
