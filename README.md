# CA-R Sheets add-ons

California Revealed's internal Google Sheets add-ons, built from one repo:

| Add-on | Tools | Installed for |
|---|---|---|
| **CA-R Tools** (`addons/team`) | MD update compare, Apply reviewed MD updates, Highlight repeated IDs | Whole CA-R team |
| **CA-R DG Tools** (`addons/dg`, not built yet) | Filename parsing, AccessParts / ObjectIDParts, CARParts, Infix to part label | DG group only |

Each add-on is published privately to the California Revealed Google Workspace and installed by an admin for a Google Group. Who sees which tools is decided in the Admin console, not in code.

The tools appear under **Extensions → CA-R Tools** in every Sheet, but they only run on spreadsheets saved in the **California Revealed shared drive**. Anywhere else, they show a message and stop. Google doesn't offer a way to limit an add-on to a single shared drive, so this check is how the tools stay scoped.

---

## Layout

```
addons/
  team/              CA-R Tools: addon.json (file list), Menu.js, Config.js, appsscript.json
shared/
  SharedDrive.js     shared-drive check used by every add-on
tools/
  md-compare/        car-md-compare, vendored whole (its own tests, docs, library and bound installs)
  highlight-repeated-ids/
build.js             assembles an add-on into dist/<addon>/
test/run.js          all tests
docs/PUBLISHING.md   Cloud project, Marketplace SDK and admin install, step by step
```

`addons/<name>/addon.json` lists the source files that go into that add-on. Nothing outside the list gets pushed.

`tools/md-compare` still contains its library (`stub/`), bound (`bound/`) and standalone add-on (`addon/`) installs. This repo doesn't use any of them. `addons/team/Menu.js` replaces them here, and `docs/PUBLISHING.md` replaces `tools/md-compare/docs/ADDON.md`.

---

## Setup (once)

1. Install Node.js 18 or newer, then clasp: `npm install -g @google/clasp`
2. `clasp login` with your California Revealed Google account.
3. Turn on the Apps Script API for your account at <https://script.google.com/home/usersettings>.
4. Create the CA-R Tools script project. Follow `docs/PUBLISHING.md` step 1, which has you create it in the shared drive.
5. `cp addons/team/.clasp.json.example addons/team/.clasp.json` and paste in that project's script ID (**Project Settings → Script ID**). `.clasp.json` is gitignored.

## Everyday commands

```bash
npm test               # all tests: MD Compare suite, HRI, shared-drive check, build checks
npm run build:team     # assemble dist/team without pushing
npm run push:team      # build, then clasp push to the CA-R Tools script project
node build.js          # lists the add-ons and asks which to build
```

The build stops, with exit code 1, if the assembled project has:

- more than one `onOpen`. Apps Script silently uses whichever loads last, which is how menus have disappeared before.
- the same top-level function or `var` in two files
- a menu item, `google.script.run` call or HTML file reference that points at something not in the project

## Adding a tool

1. Put it in `tools/<tool-name>/`. Namespace its internals in a closure (like `HRI`), and give its global entry points a short prefix (like `HRI_openDialog`) so they can't collide with other tools.
2. Call `CAR_requireSharedDrive_()` at the top of any entry point that reads or changes the sheet. Exit if it returns `false`.
3. Add its files to the right `addons/<name>/addon.json`.
4. Add its menu items to that add-on's `Menu.js`. Don't add an `onOpen` anywhere else.
5. Add tests to `test/run.js`, then run `npm test` and `npm run build:<name>`.
6. Note it in `CHANGELOG.md`, bump `VERSION` in that add-on's `Config.js`, then publish a new version (`docs/PUBLISHING.md`, "Shipping updates").

## The shared-drive check

`shared/SharedDrive.js` asks the Drive API which shared drive the open spreadsheet is in, and compares it with `SHARED_DRIVE_IDS` in `Config.js`. Currently that's `0AJYT4SOhT2pmUk9PVA`, the California Revealed shared drive. A few things to know:

- It only checks the spreadsheet you have open. MD Compare can still read an incoming partner sheet saved somewhere else.
- It needs the read-only Drive metadata scope (file names and locations, not contents), the Drive advanced service in the manifest, and the Drive API enabled in the Cloud project.
- If the check itself fails, for example because the Drive API isn't enabled, the tool doesn't run and shows the error. A tool silently running everywhere would be worse.
- To turn the check off for testing, set `REQUIRE_SHARED_DRIVE: false` in `Config.js`. Don't publish with it off.

## Tools

**MD update compare / Apply reviewed MD updates.** Key-matched comparison of a current and an incoming metadata sheet. See `tools/md-compare/README.md`.

**Highlight repeated IDs.** Highlights rows where an ID (column C by default) appears more than once with a given type (column F, `prsv` by default). The dialog asks for:

- the ID column and type column (with header names shown)
- the type value
- exact match, or anywhere in the cell
- only the rows with that type, or every row for the ID
- whole row, or the ID cell only
- whether to ignore stray spaces
- header row count and color

It writes an ordinary conditional formatting rule, so the highlighting stays live as the sheet changes and anyone can see or edit the rule under **Format → Conditional formatting**. **Remove repeated-ID highlighting** removes only the rules this tool added to the current tab.
