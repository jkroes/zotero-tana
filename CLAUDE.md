# Zotana — project guide

Zotero 7 plugin that live-syncs library items into Tana as structured reference
nodes, updating **in place** on re-sync. Fork of
[Notero](https://github.com/dvanoni/notero) with the Notion layer replaced by
Tana's **Local API**. User-facing overview and setup are in `README.md`.

## Commands

```sh
pnpm install
pnpm build         # one-off esbuild → build/
pnpm start         # launch Zotero with the plugin (see zotero.config.json)
pnpm test          # vitest
pnpm typecheck     # tsc
pnpm create-xpi    # repackage build/ into xpi/ (build only compiles to build/)
```

`vp check` = format + lint + types (whole repo); `vp run verify` adds tests. The
`check`/`verify` scripts pass `--no-error-on-unmatched-pattern` so `pnpm check
<path>` tolerates a non-lintable path (e.g. a `.md`); bare `vp check <path>`
without that flag errors with "Linting could not start / No files found to lint".

Release workflow (green-first, then tag; never move a published version tag) is
in `docs/RELEASING.md`.

## After pushing: watch CI to green

Two git hooks (husky, auto-installed by the `prepare` script) front-run CI:

- **pre-commit** (`.husky/pre-commit` → lint-staged) runs `vp fmt` on staged
  source/doc files, so formatting is auto-fixed before it's committed.
- **pre-push** (`.husky/pre-push`) runs `pnpm verify && pnpm build` — the same
  gate as CI's Build job (format + lint + types, tests, then esbuild build). A
  failing push is blocked locally, so CI rarely surprises you. Bypass with
  `git push --no-verify` for WIP.

The **Build** workflow re-runs `vp run verify` + build on a clean machine as the
source of truth. After any push, watch it through to completion and don't
consider the work done until it's green:

```sh
gh run watch $(gh run list --branch main --workflow Build --limit 1 \
  --json databaseId -q '.[0].databaseId') --exit-status
```

If Build fails, read the failed step and act on the _kind_ of failure:

- **Real code/format failure** (e.g. `vp check` formatting, failing test, type
  error, build error): fix it locally, verify with `pnpm verify`, commit, push,
  and watch again.
- **Transient infra failure** (e.g. `actions/checkout` "Repository not found",
  network/runner blips — the job dies before `vp run verify`): don't change code.
  Re-run the same run with `gh run rerun <run-id>` and watch again.

Repeat until Build is green. Only then is the change actually verified — and only
a green `main` is eligible to be tagged for release (see `docs/RELEASING.md`).

## Architecture

Source lives under `src/content/`.

- **`tana/client.ts`** — thin REST client for the Tana Local API (injected
  `fetch` + Bearer token). `health`, `import`, `setFieldContent` (accepts `null`
  to clear), `setFieldOption`, `setTags`, `trash`, `readNode`, `search`,
  `update` (flat `{name?, description?}`), and schema ops `listWorkspaces`,
  `listWorkspaceTags`, `createTag`, `addField`, `getTagSchema`.
- **`tana/constants.ts`** — the field `CATALOG` (per field: `key`,
  `defaultName`, `dataType`, `multiValue`, `transientSeed`, …). **No hardcoded
  attribute/tag IDs.** `CATALOG` is ordered alphabetically by `defaultName` and
  is the single source of truth for that order (drives the prefs table, stored
  config, and field-creation order). `effectiveFieldName(key, name)` resolves a
  blank configured name to the catalog default.
- **`tana/schema.ts`** — `ensureSchema(client, config, {workspaceId,
optionSeeds})`: finds the tag by name (creates it + `#Person` /
  `#Organization` and the annotation tags `#highlight` / `#comment` / `#image`,
  each with an `Annotation` back-link field, if missing), parses
  `/tags/{id}/schema` markdown for name→id, creates missing **enabled** fields
  with their catalog `dataType`,
  and seed-then-trashes the placeholder option needed to create empty Options
  fields. Returns `ResolvedSchema`. Run as a sync preflight, so the first sync
  auto-bootstraps.
- **`prefs/schema-config.ts`** — `SchemaConfig { tagName, fields:[{key, name,
enabled}] }`, persisted as JSON in the `schemaConfig` pref. `mergeSchemaConfig`
  reconciles a stored config against the catalog (fills new fields, drops unknown
  keys, trims names; blank stays blank). A blank `name` means "use the catalog
  default" (rendered as a grey placeholder) and is resolved at sync time.
- **`prefs/schema-panel.tsx`** — schema prefs UI: workspace dropdown, tag-name
  input, per-field table (sync checkbox + rename + read-only type), and a
  **Create / refresh schema in Tana** button.
- **`prefs/preferences.tsx` + `preferences.xhtml`** — token, parent node ID,
  optional Local API URL, title-format dropdown, sync-on-modify, collection table.
- **`data/item-data.ts`** — stores `{nodeId, title}` + the annotation map +
  per-field signature map in a hidden Zotero link attachment (the upsert key).
- **`sync/sync-job.ts`** — builds the client from prefs, runs `ensureSchema`,
  maps title format, skips note items.
- **`sync/sync-regular-item.ts`** — the upsert (reachability check, per-field
  diff, warn-and-skip; see decisions below).
- **`sync/content-signature.ts`** — network-free signature of an item's synced
  _source_ fields (excludes `dateModified` / `year` / citations). The
  sync-on-modify path skips a sync when it matches the last one, so edits to
  non-synced or volatile fields don't trigger a pointless sync. `fieldSignature`
  lives here.
- **`sync/sync-config.ts`** — shared `getCitationFormat` / `getTitleFormat` pref
  readers (split out so `content-signature` doesn't import `sync-job`).
- **`sync/sync-annotations.ts`** — per-annotation upsert into `#highlight` /
  `#comment` / `#image` nodes, each carrying a `zotero://open-pdf` back-link in its
  `Annotation` field (`sync/annotations.ts` normalizes Zotero annotations to these).
- **`tana/reference-builder.ts`, `tana/entities.ts`, `tana/tana-paste.ts`** —
  item → reference node (base-field reads, six title formats, live CSL via
  `Zotero.QuickCopy`) → creator bucketing/routing → Tana Paste serialization.

The build toolchain (esbuild + vite-plus), Zotero scaffolding, and the
collection service are inherited from Notero. `services/sync-manager.ts` (the
debounce + the modify-path no-op skip) is Zotana's; see decisions below.

## Key design decisions

- **In-place per-field upsert** to preserve the Tana node's identity and inbound
  links. The Tana node ID is stored on the Zotero item.
- **Schema configured by name, resolved/bootstrapped at runtime** — no hardcoded
  workspace IDs; renaming a field in prefs (and in Tana) keeps the link working.
- **Entity fields (Creators / Editors / Contributors / Publisher) are Options
  fields written by-id via `setFieldOption`**, NOT `setFieldContent`
  (`setFieldContent` would store the node id as literal text). This reuses the
  existing `#Person` / `#Organization` node (no duplicates) and auto-collects a
  mixed-tag picker. The REST API can't create an empty Options field (400), so
  bootstrap seeds `__zotana_seed__` then trashes it.
- **Deleted-node policy = reachability, not read-200.** `GET /nodes/{id}` returns
  200 for live, trashed, AND orphaned-"ghost" nodes (404s only once fully
  purged), so a bare read can't tell a usable node from a dead one.
  `sync-regular-item` searches by tag + stored title and checks the stored nodeId
  is among the hits: reachable → update in place; unreachable (trashed / orphaned
  / purged all collapse here) → rebuild.
- **Index-lag grace on reachability.** Tana's search index lags a few seconds
  behind a freshly created node, so a re-sync within that window (e.g. drop-to-
  collection auto-sync, then a manual collection sync) would search-miss the
  just-made node and rebuild a duplicate. Each node stores a `createdAt`; a search
  miss within `INDEX_LAG_GRACE_MS` (30 s) of creation is trusted (keep), a later
  miss is real (rebuild). Age cleanly separates "not yet indexed" from "no longer
  indexed" because lag is short/self-correcting and trashing is permanent — no
  `readNode` (it 200s for live/trashed/orphaned alike, so it can't disambiguate).
- **Per-field diff** — a `setFieldContent` replace trashes the prior value node,
  so an unconditional rewrite buried ~20 nodes in the Tana trash every sync. Only
  changed fields are written; only previously-set fields are cleared.
- **Reference-preserving warn-and-skip** — before overwriting/clearing a scalar
  value node, check whether other Tana nodes link to it
  (`search({linksTo:[valueNodeId]})`); if so, leave it and report the field in the
  ProgressWindow ("Synced with warnings"). Relies on `readNode` markdown carrying
  `<!-- node-id -->` comments (see Open work).
- **Entity nodes land in the workspace Library** (`{workspaceId}_STASH`); Tana
  files inline `[[Name #Person]]` refs there regardless of import parent, so the
  update path matches.
- **Partial-date granularity** — emit `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` from
  Zotero's multipart SQL date; no season→month padding.
- **Sync-on-modify = global debounce + content-signature no-op skip.**
  `item.modify` fires for _any_ edit, so the modify path compares
  `contentSignature(item)` (source fields only) against the last sync and drops
  no-ops before enqueuing. Surviving edits feed one **global** `SYNC_DEBOUNCE_MS`
  (3 s) timer — a single batched job across all queued items, serialized by
  `syncInProgress`; no per-item timers. A deselect-flush (sync on item-tree
  `onSelect`) was tried and **removed**: `onSelect` also fires on our own
  attachment writes, re-entering `performSync` and creating duplicate nodes.

## The Tana Local API

- REST at `http://localhost:8262` (`GET /openapi.json`, "Tana Local API"); `/mcp`
  is just the AI-client façade. The Tana desktop app must be running with the
  Local API enabled and the target workspace loaded.
- **Auth gotcha:** the Local API needs a **Personal Access Token**
  (`type:"personal"`), created from Tana's **account settings (top-right)**. The
  cloud **"Get API Token" / "Make API token"** JWT is **rejected with 401** — do
  not use it.
- Key endpoints: `POST /nodes/{parent}/import` · `POST
/nodes/{nodeId}/fields/{attributeId}/content` · `.../option` · `POST
/nodes/{nodeId}/tags|trash|update|move` · `GET /nodes/search` · `GET
/nodes/{nodeId}` · `GET /workspaces[/{ws}/tags]` · `POST /tags/{tagId}/fields` ·
  `GET /tags/{tagId}/schema` · `GET /health`.
- `dataType` ∈ `plain | number | date | url | email | checkbox | user | instance
| options`. `instance` needs `sourceTagId`; `options` needs a non-empty seed.
- **Verified behaviors:** `import` returns created node IDs (the reference node is
  the created node whose `name` === the title); `zotero://` links are accepted;
  inline `[[Name #Person]]` dedups by **exact name**; Options fields auto-collect
  values; field-name emission is collision-safe (paste scopes field resolution to
  the applied supertag); REST `addField` creates **global** (not tag-private)
  field defs.
- **Search rejects boolean query params.** `/nodes/search` validates booleans
  strictly and 400s on the string `"true"` a GET query string carries (e.g.
  `query[ownedBy][recursive]`) — numbers like `limit` _are_ coerced, booleans are
  not. Omit the boolean and rely on the documented default (`ownedBy.recursive`
  defaults `true`).

## Known limitations

- **URL fields (DOI / URL / Item / annotation back-links) are always written as
  plain text** — on create and on update alike. Markdown-link rendering on import
  proved unreliable (clickable for some fields/nodes, not others), so Zotana emits
  raw URLs and the user converts them with Tana's `Iterate and convert URLs to URL
nodes` command. (Also in README.)
- **Entity resolution** substring-searches with `limit: 50` and matches the name
  exactly client-side; an exact match beyond the first 50 hits is missed (rare).

## Open work

- **v0.2 fully live-verified + landed on `main` (2026-06-19, PR #7).** The complete
  live walk against real Zotero + Tana passed: create, in-place update, multi-item
  batch, sync-on-modify no-op skip, Title field, **Test D** (both trashed _and_
  purged nodes rebuild + attachment repoint), **warn-and-skip** (value node
  preserved; releases when the backlink is removed), **field-clear** (value cleared
  - node name re-renders), all **six title formats**, **group-library** items
    (back-links use `/groups/{id}/`), and **date granularity** (YYYY / YYYY-MM /
    YYYY-MM-DD). It also shipped two duplicate-class fixes — the in-flight guard in
    `sync-manager.ts` (`syncingItemIDs`, for the File-Renaming `item.modify` cascade
    that raced the contentSig persist) and the `createdAt` index-lag grace (both under
    Key design decisions) — the **annotation tags + PDF back-links**, and the
    **plain-text-URL** downgrade (Known limitations). Caveat: `linksTo` only indexes a
    reference made in the Tana UI, not one created via the API/Inbox. Not yet tagged
    for release (separate green-`main`-then-tag step; see `docs/RELEASING.md`).
- **Rich-text note syncing** — deferred. `sync-job` skips note items; supporting
  them needs an HTML→Tana-Paste converter (Notero's `html-to-notion` is the
  reference).
- **Clean `tsc`:** `typecheck` reports errors inside `node_modules/@voidzero-dev/*`
  (vite-plus's own `.d.ts`); add `"skipLibCheck": true` to `tsconfig.json` if a
  clean run is wanted.
