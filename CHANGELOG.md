# Changelog

All notable changes to this project will be documented in this file.

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
