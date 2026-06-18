# Zotana

A [Zotero](https://www.zotero.org/) 7 plugin that live-syncs library items into
[Tana](https://tana.inc/) as structured `#reference` nodes. Items sync when added
to a watched collection and whenever they're modified, and **update in place** on
re-sync: the same `#reference` node is updated rather than duplicated, so its
identity and any links into it survive. (Individual field *values* are rewritten
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
specific field *value* node would break when that value changes — Zotana detects
that case, leaves the field untouched, and reports it as a sync warning.

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
4. **Local API URL** — optional; defaults to `http://localhost:8262`.
5. In the **schema** panel, pick the workspace, keep or rename the reference tag
   and fields (blank field names use their defaults), choose which fields sync,
   and click **Create / refresh schema in Tana** to create the tag + fields.
6. Enable the collections you want to sync, and choose the reference node title
   format.

Then right-click a collection or items → **Sync to Tana**, or rely on automatic
sync-on-modify.

## Known limitations

- **Clickable URL fields (DOI, URL, Item).** Tana only renders a clickable link
  from imported content (on create). The plugin emits `[url](url)` so newly-synced
  items get clickable URL nodes. But on a later re-sync that **changes** one of
  these fields, the new value is written through the Local API as **plain text**
  (Tana doesn't render links via the API). To re-link them, run Tana's
  **`Iterate and convert URLs to URL nodes`** command on your `#reference` items.

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

## Status

Alpha. The mapping and sync engine are ported and unit-tested, and the core
write path (import, rename, field updates, schema creation) is validated against
a running Local API server. What remains is a full end-to-end pass in Zotero —
creating the schema and syncing items live — plus note syncing, which is not yet
implemented. See `CLAUDE.md` for the architecture and the open-work list.

## Credits

Built on [Notero](https://github.com/dvanoni/notero) by David Hoff-Vanoni
(MIT-licensed).
