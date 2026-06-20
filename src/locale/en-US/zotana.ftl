## Menus

zotana-collection-menu-sync =
    .label = Sync Items to Tana
zotana-item-menu-sync =
    .label = Sync to Tana
zotana-tools-menu-preferences =
    .label = Zotana Preferences…

## Tana preferences

zotana-preferences-tana-groupbox-heading = Tana Connection
zotana-preferences-tana-groupbox-description = Zotana syncs items to Tana through the Tana Local API. Enable the Local API in the Tana desktop app, then create a Personal Access Token from your account settings (top-right) and paste it below. (Note: this is NOT the cloud "Get API Token" / "Make API token" — that token is rejected by the Local API.)
zotana-preferences-tana-token-label = API Token:
zotana-preferences-tana-token-input =
    .placeholder = Paste your Tana API token here
zotana-preferences-tana-parent-node-label = Parent Node ID:
zotana-preferences-tana-parent-node-input =
    .placeholder = Node ID where new references are created
zotana-preferences-tana-base-url-label = Local API URL:
zotana-preferences-tana-base-url-input =
    .placeholder = http://localhost:8262 (leave blank for default)

## Schema preferences

zotana-preferences-schema-groupbox-heading = Tana Schema
zotana-preferences-schema-groupbox-description = Name the reference supertag and its fields, and choose which fields sync. Use "Create / refresh schema in Tana" to create the tag and any missing fields in the selected workspace — existing ones are matched by name. If you rename a field here, rename it in Tana too so they stay linked.

## Property preferences

zotana-preferences-properties-groupbox-heading = Property Preferences
zotana-preferences-properties-groupbox-description = Customize how item properties sync to Tana.
zotana-preferences-page-title-format = Reference Node Title:

## Page title format options

zotana-page-title-format-item-author-date-citation =
    .label = Item Author-Date Citation
zotana-page-title-format-item-citation-key =
    .label = Item Citation Key (requires Better BibTeX)
zotana-page-title-format-item-full-citation =
    .label = Item Full Citation
zotana-page-title-format-item-in-text-citation =
    .label = Item In-Text Citation
zotana-page-title-format-item-short-title =
    .label = Item Short Title
zotana-page-title-format-item-title =
    .label = Item Title

## Sync preferences

zotana-preferences-sync-groupbox-heading = Sync Preferences
zotana-preferences-sync-groupbox-description1 = Zotana will monitor the collections enabled below. Items in the enabled collections will sync to Tana when added to that collection and whenever the items are modified.
zotana-preferences-sync-groupbox-description2 = To enable/disable a collection, either select the row and press the {"[Enter]"} key or double-click the row. To select multiple rows, hold {"[Shift]"} and then click.
zotana-preferences-collection-column = Collection
zotana-preferences-sync-enabled-column = Sync Enabled
zotana-preferences-sync-on-modify-items =
    .label = Sync when items are modified

## Progress window

zotana-progress-headline = Syncing items to Tana…
zotana-progress-item = Item { $step } of { $total }
zotana-warning-headline = Synced with warnings
zotana-warning-referenced-fields = Referenced in Tana, not updated: { $fields }

## Errors

zotana-error-missing-pref = Missing value for { $pref }. Please enter it in Zotana preferences.
zotana-error-missing-tana-token = Tana API token not set. Please enter it in Zotana preferences.
zotana-error-missing-tana-parent-node = Tana parent node ID not set. Please enter it in Zotana preferences.
zotana-error-missing-tana-workspace = Tana workspace ID not set. Please enter it in Zotana preferences.
zotana-error-tana-unreachable = Tana Local API is not reachable. Open the Tana app and enable the Local API.
zotana-error-import-no-node-id = Tana did not return a node ID for the imported reference.
