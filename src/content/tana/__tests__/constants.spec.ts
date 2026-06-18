import { describe, expect, it } from 'vite-plus/test';

import { effectiveFieldName } from '../constants';

describe('effectiveFieldName', () => {
  it('uses the catalog default when the name is blank, else the rename', () => {
    expect(effectiveFieldName('creators', '')).toBe('Creators');
    expect(effectiveFieldName('creators', '  ')).toBe('Creators');
    expect(effectiveFieldName('creators', 'Authors')).toBe('Authors');
  });
});
