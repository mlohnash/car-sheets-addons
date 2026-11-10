# Changelog

## CA-R Tools 1.0.0 — 2026-11-02

First version of the whole-team add-on.

- **MD update compare** and **Apply reviewed MD updates**, from car-md-compare 1.0.0. The engine is unchanged; its team defaults moved to `addons/team/Config.js`.
- **Highlight repeated IDs** 1.0.0 (new). Adds a conditional formatting rule that highlights an ID appearing more than once with a given type, for example J001-D with two `prsv` rows. A dialog asks for the columns, value, match type and highlight style. **Remove repeated-ID highlighting** deletes only the rules this tool added.
- Every tool checks that the spreadsheet is saved in the California Revealed shared drive before it runs.
- Build script that assembles each add-on into `dist/` and stops if it finds a second `onOpen`, a duplicated global, or a menu item or dialog call pointing at a missing function.
