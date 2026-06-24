# Changelog

All notable changes to this project will be documented in this file.

## 0.5.0

Stop duplicating predefined options field values.

- **Reference existing options instead of writing duplicate values.** Options
  fields (Item Type, Container, Tags, Collections) were written as plain text. A
  text write that matches a value Tana itself collected is reused, but one that
  collides with a **predefined** option (e.g. the preset Item Type list) is not —
  Tana mints a fresh detached value node every sync, so each item got its own
  duplicate "Report", "Book Section", etc. instead of pointing at the shared
  option. Sync now resolves each value to its existing option's id (read from the
  tag schema) and writes it by id via `setFieldOption`, falling back to a text
  write only for genuinely new values. Applies to every options field on both the
  create and update paths.

## 0.4.1

- **Warn and skip a removed annotation that another Tana node links to.** Before
  trashing the Tana node for an annotation removed from Zotero, sync now checks
  whether another node links to it; if so it leaves the node untrashed, reports it
  as a warning, and keeps tracking it so a later sync trashes it once the link is
  gone — mirroring the reference node's warn-and-skip. (Annotation edits need no
  guard: name/description changes preserve the node id, so inbound links survive.)

## 0.4.0

Group annotations under an Annotations field; fix trashed-node reachability.
Verified end-to-end against live Zotero + Tana.

- **Annotations container field.** Annotations now sync into a single
  `Annotations` field on the reference node instead of as bare children.
  `ensureSchema` always creates the field; its tuple node id is resolved lazily,
  persisted, and reused so repeated imports don't spawn duplicate fields, and a
  tuple the user deleted in Tana is detected and recreated.
- **Field renames:** `Item` → `Item Link`, `Annotation` → `Annotation Link`.
- **Trashed-node reachability fix.** `/nodes/search` returns trashed nodes
  (`inTrash: true`) — the assumption that trashed nodes drop out of search was
  wrong, so a node the user deleted in Tana counted as reachable and was updated
  in place inside the trash instead of rebuilt. Reachability/usefulness checks now
  filter `inTrash`.

## 0.3.1

Workspace configuration by ID, and two duplicate-node fixes for title-format
changes.

- **Configure the workspace by ID, not a live dropdown.** The schema panel now has
  a Workspace ID text field (the source of truth) plus a Detect button and an
  on-demand picker, replacing the old dropdown that loaded once at mount (blank if
  Tana wasn't running then, and never refreshed after a new token). Sync resolves
  the workspace strictly from the configured ID. Detect requires the account-level
  Personal Access Token; a per-workspace Input-API token is rejected by the Local
  API. README clarifies the token requirement.
- **Scope every sync search to the configured workspace.** `/nodes/search` defaults
  to whatever workspace is focused in the Tana app, so reachability searches could
  miss and rebuild duplicate reference/entity/annotation nodes. All sync searches
  now pass `workspaceIds`.
- **Extend the index-lag grace to renames.** Changing a node's title format renames
  it in Tana; a quick re-sync within the search-index lag missed it and rebuilt a
  duplicate. The reachability grace now anchors to the last create OR rename
  (`titleSyncedAt`), so a format change renames the existing node in place.

## 0.3.0

Annotation syncing fixes and richer annotation metadata.

- **Recreate annotation nodes deleted in Tana on re-sync.** Annotation upserts now
  check whether each annotation's Tana node is still reachable (a scoped `ownedBy`
  search), recreating any that were trashed/deleted instead of trusting a stale
  node id. Previously a deleted annotation was never rebuilt, and an edit to a
  changed annotation was silently written into the trashed node. Includes an
  index-lag grace so a just-created node isn't re-created as a duplicate.
- **`Page` field on every annotation tag** — holds the annotation's Zotero page
  label.
- **`Order` field on every annotation tag** — the annotation's 1-based
  reading-order rank, rewritten whenever ranks shift. Sort by `Order` in Tana to
  see annotations in reading order regardless of the node tree order.
- The image-annotation placeholder is now simply `Image annotation` (the page
  moved to the `Page` field) instead of `Image annotation (p. N)`.

## 0.2.0

Annotations, configurable schema, title formats, and a reliable auto-sync.

- Sync each PDF/EPUB annotation into its own `#highlight` / `#comment` / `#image`
  node (replacing 0.1.0's single `#quote`), each carrying an `Annotation`
  `zotero://open-pdf` back-link to the exact spot in the PDF.
- Make every supertag name user-configurable (the reference tag, `#Person` /
  `#Organization`, and the annotation tags), resolved/bootstrapped by name.
- Add a `Title` field and six node-title formats (author-date citation, citation
  key, full citation, in-text citation, short title, title).
- Sync-on-modify auto-resync with a content-signature no-op skip; the modify path
  only updates items that already have a Tana node (never creates).
- Per-field diff on update — write only changed fields, clear only previously-set
  ones — plus reference-preserving warn-and-skip for value nodes others link to.
- Rebuild reference nodes deleted/trashed/purged in Tana, with an index-lag grace
  and an in-flight guard to avoid duplicate nodes.
- Group-library back-links and partial-date granularity (`YYYY`, `YYYY-MM`,
  `YYYY-MM-DD`).
- URL fields (DOI / URL / Item / annotation back-links) are written as plain text;
  convert them with Tana's "Iterate and convert URLs to URL nodes" command.

## 0.1.0

Initial release of Zotana, a Zotero 7 plugin that live-syncs library items into
Tana as structured `#reference` nodes via the Tana Local API.

- Maps Zotero items to a single `#reference` supertag built on Zotero base fields.
- Splits creators into Creators / Editors / Contributors and links them as
  `#Person` / `#Organization` entities.
- Upserts in place on re-sync, preserving each Tana node's identity and inbound
  links.
- Bootstraps the Tana tag and its fields automatically as a sync preflight.
- Syncs Zotero annotations into `#quote` nodes.

Zotana is a fork of [Notero](https://github.com/dvanoni/notero), with the Notion
integration replaced by the Tana Local API.
