import type { Zotana, ZoteroWithZotana } from '../zotana';

/**
 * Return the `Zotana` object from the global `Zotero` object.
 * This can be used from any script, such as the main bootstrap entrypoint and
 * the preferences window, to access global Zotana functionality.
 */
export function getGlobalZotana(): Zotana {
  const zotana = (Zotero as ZoteroWithZotana).Zotana;
  if (zotana) return zotana;
  throw new Error('Zotero.Zotana object not available');
}
