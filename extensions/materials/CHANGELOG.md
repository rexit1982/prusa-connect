# Changelog

What an operator sees change when they upgrade this module, newest release
first. `version:` in `module.yaml` is the newest heading below.

Write the entry in the same change as the code. One bullet per behaviour a
person outside this repository can observe: a route, a setting, a screen, a
refusal. Name the route and the setting key, never a function or a file.

## 0.2.7 - 2026-11-19

### Added

- `GET /materials` rows and `GET /materials/{uuid}` carry `free_g`, the grams on the material's spools that no printer holds.

### Changed

- The default order of `GET /materials` puts materials with filament on a spool no printer holds right after the caller's favourites, most filament first. The caller's custom materials without such filament follow them, so they can sit lower than before.
- A row of the printer header material picker counts only the spools no printer holds, and says how many kilograms are on them.

## 0.2.6 - 2026-11-16

### Added

- Printer headers show Materials assignments. Their material picker is one search: the printer's own reading first, then favourites, then the catalogue, with colour, type and manufacturer as optional filters. It assigns a catalogue material or a spool, gives the tool back to what the printer reports, and stars a material from its row.
- The printer header material picker can add a spool to the selected material and select the new spool for assignment. The form shows the remaining weight first and expands to show optional fields.

### Changed

- The Tools tab uses the same slot labels as Materials, for example Slot 5.
- The Tools tab shows a tile per tool, with the label and nozzle on one line. Below them sit the material's colour circle, centred at the same height in every tile, its name and what is left of its spool. Full-width Assign or Change, Unload and Unassign sit at the foot, and the info mark that says why one is refused sits beside the label. Assign and Change open the same material picker as the header chip and the Tools table, in a dialog.
- A spool row on a material's page offers Unassign for a printer on the host and Unload for a connected print head. While the printer prints or is paused, the row shows why neither is offered.

### Fixed

- The Catalogue and Locations tabs of the extension page have the same padding as the other settings tabs. Catalogue lists its facts as label and value rows, and Download from GitHub sits in the button band at the foot of the pane. The content touched the pane's edges before.
- The Create custom material, Add material, Edit material and Edit spool dialogs fit the window and scroll. A window shorter than the form hid the title, the close button and the save button, and nothing scrolled them back.
- The Base material / type field of a custom material shows the chosen type, and stands level with the fields beside it. It showed its own label, cut short, in place of the type.
- Unload filament on an MMU printer's tools, refused for a reason the page does not know, says the material cannot be changed in the printer's current state. It said the printer was changing filament, though none was happening.
- The materials list keeps its height while it loads, so the page no longer grows by about a row when the materials arrive.

## 0.2.5 - 2026-11-16

### Changed

- `module.yaml` lists under `egress` every connection the module makes outside Prusa Connect, with why and what it sends.

## 0.2.4 - 2026-11-16

### Changed

- `module.yaml` names the licence the extension is released under, OCL v1.1 + Micro v1 + NoSaaS v1 + SWAtt v1.

## 0.2.3 - 2026-11-16

### Changed

- Nothing changes in use. The code comments and the API reference are reworded.

## 0.2.2 - 2026-11-11

### Changed

- Built with Go 1.26.11 for GO-2026-6859.

## 0.2.1 - 2026-11-09

### Added

- Each tool of `GET /printers/tools` carries `color_family`, the family of its colour such as black or blue, so another extension can ask for a colour whatever the brand and shade.

## 0.2.0 - 2026-11-06

### Added

- A printer page has a Tools tab: each tool or MMU slot with its material, its spool and the grams left, and Assign, Change, Unload and Unassign.
- A spool can be put on a printer tool from its row on the material page. The rules apply: a printing printer refuses, and a printer that reports its material takes only a matching one.
- A spool whose NFC tag a printer reads is added to stock, and a spool a person added can be merged into it.
- A printer removed from the server lets go of its tools, and the spools on them go back to stock.
- A spool on a tool loses the filament the tool feeds, counted from the printer's odometer, or from the tag's grams while the printer reads it.
- A spool can be archived with a reason and restored.
- `GET /printers/tools` lists each tool of a page of printers with its material, brand, spool and grams left, and `GET /spools` lists every spool in stock. The `tool` and `spool` events say when one changes.

### Changed

- The install asks to check whether a person may operate a printer, under `checks`, and warns of nothing. It needs a server that reads `checks`.
- A spool's condition is no longer shown or stored.

## 0.1.4 - 2026-11-06

### Changed

- Built with Vite 8.2.4, the release that fixes the advisories against 8.2.2.
  Nothing on the page changes.

## 0.1.3 - 2026-11-05

### Changed

- Shift-click ticks a range of spools, and the header box shows a dash when only some are ticked.

## 0.1.2 - 2026-11-04

### Fixed

- The materials list, the add-material dialog and the location field look like the rest of Prusa Connect.

## 0.1.1 - 2026-11-04

### Fixed

- A search or a filter that matches nothing offers the way back to every row.

## 0.1.0 - 2026-10-28

### Added

- Materials: a page of its own, with an entry in the sidebar. It lists the
  catalogue and custom materials with search, filters, sorting and the stock
  totals, and lets a person star a material.
- Material: a page for one material, kept out of the sidebar, with its spools
  and packages. A person adds spools of a material (1 to 100 at once), copies
  one, edits them and deletes them, one or the ticked ones together.
- Tools: a tab on each printer's page. A one-tool printer gets the Extruder
  view with its spool, its Tool settings and the material's details. Several
  tools get a tile each, and an MMU a group of slot tiles. A person who may
  operate the printer assigns a material or a spool, changes it and unloads
  the active tool. They unassign a slot, or a tool of a printer that is not
  connected. They add a spool the printer read off its NFC tag.
- Material: each spool row names the printer and the tool the spool is on,
  and marks a spool a printer read with an NFC badge. Assign puts a spool on a
  printer tool, and Merge folds a manual spool into a printer spool of
  the same material. A spool on a tool cannot be deleted or ticked, and a
  tooltip on its Delete says why, on a pointer or a tap. Its Edit changes
  its notes and location only, as the printer counts its weight.
- Materials: the On a printer filter keeps the materials a printer tool holds.
  The Spools column marks the spools on a printer with a printer icon and a
  count in brackets, such as `3 (1)`, and a tooltip says what the count is.
- Material: a spool on a printer tool loses the filament the tool feeds, as
  the printer reports it. A spool read off its NFC tag takes the weight its
  tag reports.
- Other extensions read every printer tool with its spool (`GET /printers/tools`)
  and every spool in stock (`GET /spools`) through the host. They are told of
  each change on the `tool` and `spool` events.
- Material: the printer's Tools tab and a material's spool rows update
  as the printer reports, without a reload.
- `PATCH /spools/{id}` archives a spool with `archived`, and an optional
  `archive_reason` and `archive_reason_note`. An archived spool carries
  `archived_at`, leaves the stock totals, the location counts and
  `max_spools`, and is refused on a printer tool or in a merge with
  `materials/SPOOL_ARCHIVED`. A printer that reads its tag brings it back.
- `GET /printers/{device}/tools` tells each tool's `kind` (head or slot),
  whether it is `active`, its `nozzle` (diameter, high flow, hardened, high
  temperature) and, for a slot, the `feeder` model.
- Material: a spool's Edit dialog archives it, with an optional reason and
  note, and unticking Archived restores it. An archived spool is marked
  Archived in the spool list, with its reason on hover, and is offered
  neither for Assign nor for Merge.
- Catalogue: a tab on the module's page under Settings, Extensions. It loads
  the OpenPrintTag material catalogue from GitHub in the background and shows
  when it was last loaded.
- `GET /catalogue`, `POST /catalogue/download`, `GET /catalogue/brands` and `GET /types`.
- `GET /materials` and `GET /materials/{uuid}`, with `GET /materials/{uuid}/spools`.
  `GET /materials?assigned=true` keeps the materials on a printer tool, and
  each row's `assigned_spools` counts its spools on one.
- `POST /custom-materials`, `PATCH /custom-materials/{uuid}` and
  `DELETE /custom-materials/{uuid}`: a person's own materials.
- `PUT /favourites/{uuid}` and `DELETE /favourites/{uuid}`.
- `POST /spools`, `PATCH /spools/{id}`, `DELETE /spools/{id}` and
  `POST /spools/delete`, which deletes up to 100 spools all or none.
- `GET`, `POST`, `PATCH /{id}` and `DELETE /{id}` on `/locations`: the places
  spools are kept, shared by everyone. A spool's place is picked when it is
  added, and renamed or deleted under Settings, Extensions, Materials.
- `GET /list-filters` and `PUT /list-filters`: the filters and order each
  person last gave the list, so it opens the way they left it.
- Every spool has a `uuid` of its own and a `source`, `manual` for a spool a person
  added. A spool that existed before gets a new uuid when the module starts.
- `GET /printers` and `GET /printers/{device}/tools`: the printers a person
  may observe, and what is on each tool with why a change would be refused.
  `GET /printers` answers each printer's `model`, sorted by name. It is
  searched by name, model or id with `q`, and read a page at a time with
  `limit` and `offset`, `next` naming the next page.
- Material: the dialog that assigns a spool to a printer draws each printer
  with its picture, model and state, as Core's printer list does. It
  searches the printers and reads the next page as the list scrolls.
- `PUT /printers/{device}/tools/{tool}` assigns a material or a spool to a
  tool, and `DELETE` unassigns it. A tool that reports a material keeps what
  the printer reports. Both take `operate` on the printer, and
  the rules decide whether the printer's state allows the change.
- `POST /printers/{device}/tools/{tool}/spool` adds the spool a printer read
  off its NFC tag, with the uuid of the tag and the source `printer`. A tag a
  spool already carries adds nothing.
- `POST /spools/{id}/merge` merges a manual spool into the spool a
  printer read. The printer's spool keeps its uuid, and takes the location and
  the notes of the other where it has none.
- A spool on a printer tool names the tool, and cannot be changed or deleted
  until it is unassigned.
- The setting `max_spools` sets how many spools the module holds, 2000 by
  default.
- The settings `catalogue_url` and `catalogue_ca` point the catalogue
  download at a mirror over https, and trust a certificate of the
  operator's own beside the system roots.
