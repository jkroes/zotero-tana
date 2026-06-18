# Privacy Policy

The Zotana plugin interacts only with the user's local Zotero client and a local
Tana instance. This document describes the data the plugin accesses and how it is
used.

## Tana Authorization

Zotana talks to the **Tana Local API**, which the Tana desktop app exposes on the
user's own machine (by default `http://localhost:8262`). Authorization uses a
**Personal Access Token** that the user creates in Tana's account settings and
pastes into the plugin's preferences. The token is stored locally within the
[Zotero profile directory][] and is sent only to the local Tana API. It is not
transmitted to the plugin author or any third party.

## User Data

Zotana stores user-specific data — such as the Tana node IDs of synced items and
the configured schema — on the user's local computer within the
[Zotero profile directory][].

As part of synchronization, user-generated Zotero item data (titles, creators,
dates, abstracts, annotations, and other item fields) is transmitted to the local
Tana API so it can be written into the user's Tana workspace. Because the Local
API runs on the user's own machine, this data does not leave the user's computer
by way of the plugin. Data stored in Tana is subject to Tana's own terms and
privacy policy.

The Zotana plugin does not communicate with any remote services.

[Zotero profile directory]: https://www.zotero.org/support/kb/profile_directory
