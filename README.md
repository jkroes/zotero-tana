# Zotana

A [Zotero](https://www.zotero.org/) 7 plugin that live-syncs library items into
[Tana](https://tana.inc/) as structured `#reference` nodes. Items sync when added
to a watched collection and whenever they're modified, and **update in place** on
re-sync: the same `#reference` node is updated rather than duplicated, so its
identity and any links into it survive. (Individual field _values_ are rewritten
as they change — see How it works.)

Zotana is a fork of [Notero](https://github.com/dvanoni/notero) (which syncs to
Notion), with the Notion layer replaced by Tana's **Local API**.

## How it works

Each Zotero item becomes a `#reference` node in Tana, built on Zotero **base
fields** so a single supertag covers every item type. Creators are split
primary-role-aware (Creators / Editors / Contributors) and linked as `#Person` or
`#Organization` entities (institutions route to `#Organization`). The `#reference` node
ID is stored on the item as a "Tana" child attachment so that re-syncs find and update the existing node.

When a re-sync changes a field, Tana replaces that field's value node (it trashes
the old one and creates a new one); unchanged fields are left alone. So a link
pointing at the `#reference` node itself always survives, but a link pointing at a
specific field _value_ node would break when that value changes — Zotana detects
that case, leaves the field untouched, and reports it as a sync warning.

### Annotations

An item's PDF/EPUB annotations sync as child nodes under its `#reference` node,
each keyed by its Zotero annotation key so re-syncs update them in place:

- **Highlights / underlines** → `#highlight` — the selected text is the node
  name; any comment becomes the node's description.
- **Notes / text** → `#comment` — the typed note is the node name.
- **Image annotations** → `#image` — a fixed **text placeholder** (`Image
annotation`); the actual cropped image is **not** synced, because the Tana Local
  API has no way to upload image data. Any comment becomes the description.
- **Ink** annotations are skipped (no text content).

Every annotation node also carries three fields:

- **`Annotation`** — a `zotero://open-pdf` back-link that jumps straight to the
  annotation in the PDF (plain text, like all URL fields — see Known
  limitations). Written once at creation.
- **`Page`** — the annotation's Zotero page label. Written once at creation.
- **`Order`** — the annotation's 1-based **reading-order rank**. Unlike the other
  two, this is rewritten whenever the rank shifts (inserting or deleting an
  annotation moves the ones after it). **Sort by `Order`** in Tana to see your
  annotations in reading order regardless of the node tree order (see the
  reordering note under Known limitations).

**Three `Annotation` fields, and merging them:** schema creation gives each of
`#highlight`, `#comment`, and `#image` its **own** `Annotation` field — Tana's
Local API can only create a field on a tag, never reuse one across tags, so you
get three. You can safely **merge them into a single `Annotation` field** in
Tana: Zotana finds the field by its name on each tag every sync, so as long as
all three tags still have a field named `Annotation` (kept as a URL field) after
the merge, annotation syncing keeps working. Don't rename it or remove it from
any of the three tags — the next sync would recreate a fresh `Annotation` field
on whichever tag is missing one, bringing the duplicates back. The same is true
of the `Page` field: each annotation tag gets its own, resolved by name, and you
can merge them the same way.

**Replacing an image placeholder with the real image:** you can paste the image
directly onto the placeholder node in Tana and it will survive every future
sync. Zotana never reads the live node content — it only rewrites a node when the
text it _would_ produce differs from what it last wrote, and an image
annotation's placeholder text is the fixed string `Image annotation`, so it never
changes. Just edit the **existing** node in place — deleting it and creating a new
image node loses the id Zotana tracks, so it would recreate the placeholder.

### What gets overwritten vs. left alone

- **The `#reference` node and annotation nodes keep their identity** across
  re-syncs — links pointing _at these nodes_ always survive.
- **Field values are rewritten only when the source field changes** in Zotero;
  unchanged fields are never touched.
- **A value node that something else links to is left alone** and reported as a
  sync warning, rather than being replaced.
- **Manual edits to a synced field's value** will be overwritten the next time
  that field changes in Zotero — Zotana is the source of truth for fields it
  syncs. Edits to _non-synced_ fields, and content you add as **separate child
  nodes**, are never touched.
- **Deleting the hidden "Tana" attachment disconnects the item** — automatic
  sync-on-modify only _updates_ items that already have a Tana node, so removing
  that attachment stops the link without recreating the node. Run **Sync to
  Tana** on the item to rebuild it.

## Requirements

- Zotero 7+ (running)
- Tana Outliner desktop app (running)
- A Tana **Personal Access Token**, created from Tana's account settings
  (top-right).

## Install

Download the latest `.xpi` from the
[Releases page](https://github.com/jkroes/zotana/releases), then in Zotero go to
**Tools → Plugins**, click the gear icon → **Install Plugin From File…**, and
select the `.xpi`. Or build it yourself (see Development).

## Setup

In Zotero → Settings → Zotana:

1. **API Token** — paste your Tana personal access token.
2. **Parent Node ID** — paste the ID of the Tana node where new reference nodes
   are created (e.g. Library).
3. **Local API URL** — optional; defaults to `http://localhost:8262`.
4. Enable the collections you want to sync, and tick **Sync when items are
   modified** to turn on automatic re-sync (it's in the same Sync Preferences
   group; leave it off to sync only on demand or when an item is added to a
   watched collection).
5. In the **Tana Schema** panel (at the bottom): pick the workspace; name every
   supertag Zotana creates (Person / Organization / highlight / comment / image,
   and the reference tag); choose the **reference node title** format; keep or
   rename the fields (blank field names use their defaults) and choose which sync;
   then click **Create / refresh schema in Tana** to create the tags + fields.

Then right-click a collection → **Sync Items to Tana**, or right-click items →
**Sync to Tana**, or rely on automatic sync-on-modify.

### Renaming tags & fields vs. Create / refresh

Zotana links to Tana **by name**, and it can only **create or find** a tag/field
— it never renames one that already exists in Tana. Keep that distinction in
mind:

- **Create / refresh schema** makes sure every tag and enabled field _exists_ in
  Tana, creating any that are missing. You need it for **first-time setup**, after
  **enabling a new field** (or adding a tag) you want created, or to **validate**
  the connection up front. You don't strictly have to press it — Zotana runs the
  same check automatically before every sync — but the button does it on demand
  and shows a status.
- **Renaming** keeps an existing tag/field and its data. Because Zotana matches by
  the configured name, a name that matches a tag/field in Tana is **reused**
  (identity, values, and inbound links preserved); a name that doesn't match makes
  Zotana **create a new one**, orphaning the old. So to rename without losing
  anything, do it in **both** places: rename it in **Tana's UI** (Tana keeps the
  underlying tag/field, just changes its name) **and** set the **same** name in
  the Zotana schema panel. Renaming in only one place produces a duplicate.

| Goal                                           | Do this                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Add the schema / a newly-enabled field to Tana | **Create / refresh** (or just sync — it runs the same check) |
| Rename a tag/field and keep its data           | Rename in **Tana** _and_ set the matching name in Zotana     |
| Change which fields sync, field order, etc.    | Edit in Zotana; the next sync applies it                     |

For the **reference and entity tags** specifically, existing nodes are updated in
place and keep whatever tag they were created with — so a Zotana-only rename leaves
old nodes on the old tag and new nodes on the new one (a mix). Renaming in Tana
first avoids that, since Tana preserves the tag for every node already using it.

## Known limitations

- **URL fields are plain text (DOI, URL, Item, annotation back-links).** Tana's
  clickable-link rendering on import proved unreliable — some URL fields/nodes
  rendered as links and others didn't — so the plugin writes every URL as **plain
  text**, on both create and update. To make them clickable, run Tana's
  **`Iterate and convert URLs to URL nodes`** command on your synced items.
- **The hidden "Tana" attachment may not appear until you refresh the row.** When
  an item is first synced, Zotana writes its sync-tracking "Tana" child attachment
  without notifying Zotero's UI (deliberately — that notification would re-trigger
  a sync). The attachment is saved correctly, but Zotero's item tree won't show it
  until you **collapse and expand the item** (or reselect it). Purely cosmetic.
- **Standalone notes are not synced.** Zotana syncs regular items (and their PDF/
  EPUB annotations); standalone Zotero note items are skipped. An item's own
  abstract still syncs as a field — only note _items_ are out of scope.
- **Annotation node tree order isn't maintained — sort by the `Order` field
  instead.** New annotation nodes are appended under the reference node, so the
  raw child order can drift from reading order (e.g. a node deleted in Tana and
  rebuilt comes back last). Zotana doesn't physically reorder nodes — Tana's
  node-move operation has spawned duplicates in testing. Instead, every annotation
  node carries an `Order` number field with its reading-order rank, rewritten each
  sync when it changes; **sort by `Order`** in Tana to get reading order
  regardless of the tree order.

## Development

```sh
pnpm install
pnpm build        # one-off build → build/
pnpm start        # launch Zotero with the plugin (see zotero.config)
pnpm test         # run the test suite
pnpm typecheck
pnpm create-xpi   # repackage build/ into xpi/
```

The build toolchain (esbuild + vite-plus), Zotero scaffolding, and collection /
sync-on-modify services are inherited from Notero.

### Releasing

Bump `version` in `package.json`, commit, then push a matching `v*` tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The [`Release` workflow](.github/workflows/release.yml) builds the `.xpi`,
attaches it to a GitHub Release for that tag, and publishes the auto-update
manifest under the `release` tag.

## Credits

Built on [Notero](https://github.com/dvanoni/notero) by David Hoff-Vanoni
(MIT-licensed).
