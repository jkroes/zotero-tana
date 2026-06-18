# Zotana — load & verify in Zotero

End-to-end check of the live plugin in real Zotero. Everything below the REST/unit
level is unproven until this passes: annotation reading, the "Tana"
link-attachment, the prefs pane, the menu triggers, the Notifier.

## 0. Prerequisites

- **Tana desktop app running**, Main workspace loaded, **Local API enabled**.
- A **Local API Personal Access Token** (account settings → top-right → Personal
  Access Token — NOT the cloud "Get API Token").
- The built add-on under `xpi/` (e.g. `xpi/zotana-0.1.0-jkroes.Mac.attlocal.net.xpi`).

Useful Main-workspace IDs (for the test):

- Library (`_STASH`) — `NAoK7gu_J9RW_STASH` ← simplest parent node for a first run
- Inbox — `NAoK7gu_J9RW_CAPTURE_INBOX`
- `#reference` tag — `p5LeXSkgwLnh`; `#quote` — `ECOaVRR28Of0`

## 1. Install

1. Zotero → **Tools → Plugins** (Add-ons).
2. Gear icon → **Install Plugin From File…** → pick the `.xpi` above.
   (Or drag the `.xpi` onto the Plugins window.)
3. Confirm "Zotana" appears and is enabled. If it errors on install, capture the
   message (see Debugging).

## 2. Configure

1. **Tools → Zotana Preferences…** (also under the add-on's Options).
2. **API Token**: paste the Local API PAT.
3. **Parent Node ID**: `NAoK7gu_J9RW_STASH` for the first run.
4. **Local API URL**: leave blank (defaults to `http://localhost:8262`).
5. **Reference Node Title**: pick a format (default Author-Date is fine).
6. In the collection table, **enable a test collection** (one with a few items,
   ideally one item with a PDF that has annotations).

## 3. Test A — create

1. Right-click the enabled collection → **Sync Items to Tana** (or right-click a
   single item → **Sync to Tana**).
2. Watch the progress popup; it should finish without an error banner.
3. In Tana, under the Library, verify a new **`#reference`** node:
   - name = the computed title;
   - fields populated (Item Type, Date as a real date, DOI/URL, Container, etc.);
   - **Creators** point to **`#Person`** nodes (institutions → `#Organization`),
     and those entity nodes live in the **Library**;
   - the **Item** field is a `zotero://` back-link.
4. Back in Zotero, the item now has a child attachment titled **"Tana"** and a
   **`tana`** tag. (That attachment stores the sync state — don't delete it.)

## 4. Test B — annotations → #quote

1. Pick an item whose PDF has **highlights / underlines** (add a comment to at
   least one), plus optionally a **note** annotation and an **image** annotation.
2. Sync that item.
3. In Tana, under its `#reference` node, verify **direct children**:
   - each highlight/underline → a node tagged **`#quote`**, name = the selected
     text, and the **comment shows as the node's description**;
   - note/text annotation → a plain (untagged) child named by its content;
   - image annotation → a plain placeholder `Image annotation (p. N)`;
   - ink annotations → absent (skipped).

## 5. Test C — re-sync (in place)

1. Edit the Zotero item (e.g. change the title or a field). Either rely on
   sync-on-modify (enable it in prefs) or right-click → **Sync to Tana**.
2. In Tana, confirm the **same** `#reference` node updated in place — **no
   duplicate** node, fields reflect the change.
3. Add a new highlight in the PDF, re-sync → a new `#quote` child appears;
   existing quotes are untouched. Delete a highlight in Zotero, re-sync → its
   `#quote` node is trashed.

## 6. Test D — deleted-node rebuild

1. In Tana, **delete the `#reference` node and empty the trash** (purge it).
2. Re-sync the item in Zotero.
3. Confirm a **fresh** `#reference` node is created and the "Tana" attachment now
   points to it. (A node merely in trash — not emptied — is treated as live and
   updated in place instead; that's intended.)

## Debugging

- Zotero **Help → Debug Output Logging → View Output** (or **Tools → Developer →
  Error Console**) shows Zotana's logs and any stack traces. Enable logging
  before reproducing.
- API-shape failures surface as `TanaApiError: Tana Local API <METHOD> <path>
failed: <status>` — note the status/path.
- "Tana Local API is not reachable" → Tana app not running or Local API disabled.
- Auth errors → wrong token type (must be the Local API PAT).

## Report back

For each test: pass/fail + any error text or surprising Tana output. The most
likely first-run snags are field formats (date/options), the `zotero://`
back-link, and annotation reading across attachments — all verified at REST level
but not yet in the Zotero runtime.
