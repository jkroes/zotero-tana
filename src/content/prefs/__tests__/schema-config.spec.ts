import { describe, expect, it } from 'vite-plus/test';

import { CATALOG, DEFAULT_TAG_NAME } from '../../tana/constants';
import { defaultSchemaConfig, mergeSchemaConfig } from '../schema-config';

describe('defaultSchemaConfig', () => {
  it('defaults the tag name and enables every catalog field with no name override', () => {
    const config = defaultSchemaConfig();
    expect(config.tagName).toBe(DEFAULT_TAG_NAME);
    expect(config.fields).toHaveLength(CATALOG.length);
    expect(config.fields.every((field) => field.enabled)).toBe(true);
    expect(config.fields.every((field) => field.name === '')).toBe(true);
  });
});

describe('mergeSchemaConfig', () => {
  it('returns defaults for a non-object', () => {
    expect(mergeSchemaConfig(null)).toEqual(defaultSchemaConfig());
    expect(mergeSchemaConfig('nope')).toEqual(defaultSchemaConfig());
  });

  it('keeps stored tag name, renames, and disabled flags', () => {
    const config = mergeSchemaConfig({
      tagName: 'bibliography',
      fields: [
        { key: 'creators', name: 'Authors', enabled: true },
        { key: 'abstract', name: 'Abstract', enabled: false },
      ],
    });

    expect(config.tagName).toBe('bibliography');
    const creators = config.fields.find((f) => f.key === 'creators');
    const abstract = config.fields.find((f) => f.key === 'abstract');
    expect(creators).toEqual({
      key: 'creators',
      name: 'Authors',
      enabled: true,
    });
    expect(abstract?.enabled).toBe(false);
  });

  it('fills in catalog fields the stored config is missing, in catalog order', () => {
    const config = mergeSchemaConfig({
      tagName: 'zotero',
      fields: [{ key: 'abstract', name: 'Abstract', enabled: false }],
    });

    expect(config.fields).toHaveLength(CATALOG.length);
    expect(config.fields.map((f) => f.key)).toEqual(CATALOG.map((e) => e.key));
  });

  it('drops unknown keys; blank names are stored empty, real input kept verbatim', () => {
    const config = mergeSchemaConfig({
      tagName: '  ',
      fields: [
        { key: 'not-a-real-field', name: 'X', enabled: true },
        { key: 'creators', name: '   ', enabled: true },
        { key: 'abstract', name: 'Abstract', enabled: true }, // matches default
      ],
    });

    expect(config.tagName).toBe(DEFAULT_TAG_NAME); // blank → default
    // unknown key dropped → only catalog keys remain
    expect(config.fields).toHaveLength(CATALOG.length);
    const keys = config.fields.map((f): string => f.key);
    expect(keys).not.toContain('not-a-real-field');
    // blank → '' (resolved to the default at sync time)
    expect(config.fields.find((f) => f.key === 'creators')?.name).toBe('');
    // real input is kept verbatim, even when it matches the catalog default
    expect(config.fields.find((f) => f.key === 'abstract')?.name).toBe(
      'Abstract',
    );
  });
});
