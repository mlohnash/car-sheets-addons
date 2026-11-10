# Sharing the comparator with the team

Four ways to get this in front of more than one person. They differ mainly in
how much work an update costs.

| | Setup per person | Cost of shipping an update | Good for |
|---|---|---|---|
| **Library + stub** | Add library, paste ~30-line stub | Bump one version number | A small team, central control — **recommended** |
| Copy the code into each sheet | Paste three files | Repaste everywhere, forever | One-off or a colleague outside the org |
| Template spreadsheet | Make a copy | Copies made before the update never get it | A fixed per-project workflow |
| Workspace add-on | Nothing — admin installs it | Redeploy through Cloud console | Wide rollout, if you want to own a GCP project |

The rest of this document covers the library route, then sketches the add-on.

---

## Library route

The comparator lives in one standalone script project you own. Each
spreadsheet that needs it gets a small bound stub that points at the library.
Fixing a bug means deploying a new library version; nobody repastes anything.

### 1. Publish the library (once)

1. Go to [script.google.com](https://script.google.com) → **New project**.
   A standalone project, not one bound to a spreadsheet.
2. Rename it something recognisable — `CA-R Metadata Comparator (library)`.
3. Add the three source files. The library holds the engine only — no
   entry-point file, since `onOpen` has to live in the consuming project:
   - `Code.gs` ← `src/Code.js`
   - `Headers.gs` ← `src/Headers.js` (**File → New → Script file**, name `Headers`)
   - `Dialog.html` ← `src/Dialog.html` (**File → New → HTML file**, name `Dialog`)
4. **Project Settings** → tick *Show "appsscript.json" manifest file*, then
   paste in `src/appsscript.json`.
5. **Deploy → New deployment → Library**, give it a description such as
   `1.0.0 — initial`, and deploy. This creates version 1.
6. **Project Settings → Script ID** — copy it. That is what the team needs.
   For CA-R's library that is
   `115uX0956bX_En1st2ZMYldRP-k0hj3dHYjCsSDUdypX44kQK3e506vrK`, already filled
   in for you in `stub/appsscript.json`.
7. **Share** (top right) → give your team **Viewer** access. Viewer is enough to
   *use* a library; do not give Editor unless you want them able to change it.

With clasp instead of pasting:

```bash
cp .clasp.json.example .clasp.json     # scriptId = the library project
clasp push
clasp version "1.0.0 — initial"
```

### 2. Add it to a spreadsheet (per spreadsheet)

1. Open the spreadsheet → **Extensions → Apps Script**.
2. **Libraries (+)** in the left sidebar → paste the library script ID → **Look
   up** → choose the version → set **Identifier** to exactly `CARCompare` →
   **Add**.
3. Paste `stub/Stub.js` into `Code.gs`.
4. **Project Settings** → show the manifest → paste `stub/appsscript.json`,
   replacing `PASTE_THE_LIBRARY_SCRIPT_ID_HERE` with the real ID and `version`
   with the version you chose.
5. Save, reload the spreadsheet. **CA-R Tools** appears in the menu bar.

First run asks for authorisation, as any script does.

### 3. Ship an update

1. Change the source in the library project.
2. **Deploy → Manage deployments → Edit → Version: New version**, describe it,
   deploy.
3. In each consuming project, **Libraries → CARCompare → Version →** pick the
   new number, save.

Step 3 is the only per-spreadsheet action, and it is a dropdown. If you would
rather skip it entirely, set `developmentMode: true` in the stub manifest and
consumers always run the library's saved HEAD — but that requires giving them
**Editor** access to the library project, and it means an unfinished edit of
yours is live for the whole team. Pin to versions unless you have a reason not
to.

---

## Things that bite when moving to a library

These are the reasons `stub/Stub.js` looks the way it does. None of them are
optional.

**Dialog callbacks resolve against the consumer, not the library.** When
library code opens an HTML dialog, `google.script.run.foo()` in that dialog
looks for `foo` in the *bound* script. The library's own copy is invisible to
it. That is why the stub defines `carmd_getDefaults`,
`carmd_getSpreadsheetInfo`, and `carmd_runComparison` as one-line pass-throughs.
Drop any of them and the dialog opens but does nothing. The test suite asserts
that the stub mirrors every name the dialog calls, so this cannot drift
silently.

**`onOpen` only fires from the bound script.** Simple triggers do not run from
libraries. The menu has to be built in the stub.

**Scopes are not inherited.** Apps Script works out which OAuth scopes a project
needs by scanning its code — and it does not scan library code. A stub that
does nothing but call into the library can therefore end up requesting nothing
and failing at run time. Declaring `oauthScopes` explicitly in the stub manifest
avoids this; `stub/appsscript.json` already has the two the comparator needs.

**Underscore-suffixed functions are private.** Everything internal in `Code.js`
ends in `_` and is invisible to consumers, which is deliberate — it keeps the
public surface to the eleven functions listed at the top of the file. If you
add something a consumer needs to call, it must not end in an underscore.

**Library calls are slower.** Noticeable on a chatty API, irrelevant here: the
comparator makes a handful of library calls per run and does all the work
inside one of them.

**Quota and logs belong to the caller.** Each person's runs count against their
own Apps Script quota and appear in their execution log, not yours. Good for
fairness, awkward for support — ask for the `Diff_Summary` tab when someone
reports a problem. It records the library version, the sheets compared, the key
field used, and the header translation counts, which is usually enough.

---

## Team defaults

`INSTALL_CONFIG` at the top of the stub is where shared settings live, so nobody
has to remember to type them into the dialog:

```js
var INSTALL_CONFIG = {
  IGNORE_FIELDS: ['Workflow State', 'Notes to Vendor']
};
```

Any `CONFIG` key from the library works, and `setConfig` throws on an
unrecognised key so a typo shows up on the next run rather than being quietly
ignored. `INSTALL_HEADER_ALIASES` does the same for partner header spellings the
dictionary does not carry — better than forking the generated `Headers.js`,
which gets overwritten on the next dictionary revision.

Different partner sets can carry different stubs. The library stays common.

---

## Workspace add-on, if the team outgrows this

An editor add-on published privately to the domain removes the per-spreadsheet
setup entirely: an admin installs it once and the menu appears in every sheet
for everyone. The trade is that you take on a Google Cloud project, an OAuth
consent screen, and a deployment review flow, and updates go out through the
Cloud console rather than a version dropdown.

Worth it somewhere north of a dozen spreadsheets or if people outside your team
start asking for it. Below that, the library is less machinery for the same
result. The source needs no changes either way — the same `Code.js`,
`Headers.js`, and `Dialog.html` back both, and only the entry-point file
differs. See [ADDON.md](ADDON.md) for the walkthrough.
