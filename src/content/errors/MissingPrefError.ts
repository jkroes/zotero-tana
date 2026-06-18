import type { ZotanaPref } from '../prefs/zotana-pref';

import { ErrorL10nId, LocalizableError } from './LocalizableError';

const L10N_IDS: Partial<Record<ZotanaPref, ErrorL10nId>> = {
  tanaToken: 'zotana-error-missing-tana-token',
  tanaParentNodeId: 'zotana-error-missing-tana-parent-node',
};

export class MissingPrefError extends LocalizableError {
  public readonly name = 'MissingPrefError';

  public constructor(pref: ZotanaPref) {
    super(
      `Missing pref: ${pref}`,
      L10N_IDS[pref] || 'zotana-error-missing-pref',
      { l10nArgs: { pref } },
    );
  }
}
