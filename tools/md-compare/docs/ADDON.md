# Publishing privately as a Workspace add-on

A *private* Marketplace app is visible only to users in your Google Workspace
organisation, and is listed under the Marketplace's **Internal apps** section.
Google does not review private apps before publication, so there is no wait and
no review correspondence — you fill in the configuration, submit, and it is live
for the domain immediately.

The pay-off over the library route is that per-spreadsheet setup disappears
entirely. An admin installs it once for the org and **CA-R Metadata Comparator**
appears under **Extensions** in every Sheet, for everyone, with no stub to
paste. The cost is a Google Cloud project and a store listing.

> **Two decisions you cannot undo.** Public vs private is permanent once saved —
> a private app can never be made public later, and vice versa. And an add-on
> published to your domain is your organisation's, not your personal account's:
> put the script in a **shared drive** before you start, or it becomes
> unmaintainable the day the owning account is deprovisioned.

You need to be able to create a Google Cloud project. In many organisations
that is restricted; check before you invest the afternoon.

---

## What goes in the project

An add-on is one self-contained script project. Do not have it call the
library — Google requires that a library used by a published add-on also be
pinned to a numbered version, which means every update becomes two version
bumps in two projects instead of one.

| File in this repo | Name it in Apps Script | Type |
|---|---|---|
| `src/Code.js` | `Code` | Script |
| `src/Headers.js` | `Headers` | Script |
| `src/Dialog.html` | `Dialog` | HTML |
| `addon/Addon.js` | `Addon` | Script |
| `addon/appsscript.json` | manifest | Manifest |

`addon/Addon.js` replaces `bound/Bound.js` and `stub/Stub.js` — never include
more than one of the three. Each defines `onOpen`, and Apps Script resolves a
duplicated function name by silently using the last definition it loads, so a
stray second copy produces a menu that is wrong in ways that are painful to
trace.

Two things in `Addon.js` are specific to add-ons and are the usual cause of a
first attempt failing:

- **`createAddonMenu()`, not `createMenu()`.** A published add-on's items belong
  under Extensions → the add-on's name. A top-level menu built with
  `createMenu()` gets relocated on publication, so the layout you tested is not
  the layout users get.
- **`onOpen` runs unauthorised.** Before a user has authorised the add-on it
  runs in `AuthMode.NONE`, where anything requiring authorisation throws — and a
  throw in `onOpen` means no menu appears at all. Menu construction must touch
  nothing but the UI.

There is nothing add-on-specific in the manifest itself; Editor add-ons use the
ordinary Apps Script manifest properties.

### A word about the scope

`addon/appsscript.json` requests `.../auth/spreadsheets` — full read and write
to all the user's spreadsheets. The narrower `spreadsheets.currentonly` would be
nicer, but the comparator's whole point is comparing the sheet you are in
against a partner file somewhere else in Drive, which `currentonly` forbids.

Expect that scope to appear on the authorisation screen and in the admin's
install dialog. Worth mentioning to whoever approves it, before they see it and
ask.

---

## Publishing

### 1. Create the script project

In a **shared drive**, create a standalone Apps Script project — not one bound
to a spreadsheet. Editor add-ons must be published from a standalone project.
Add the five files above.

### 2. Test it before publishing

**Deploy → Test deployments → Install**, pick **Editor add-on**, choose a
spreadsheet to test against, and save. This installs it as an unpublished
"developer add-on" for your account only. Confirm the Extensions menu appears,
the dialog opens, and a real comparison runs end to end.

Do not skip this. After publication the fix loop is longer.

### 3. Create a version

**Deploy → Manage deployments** (or `clasp version "1.0.0"`) and note the
**version number**. Editor add-ons are configured by version number; Google
Workspace add-ons use a deployment ID instead, which is a common source of
confusion when following half-matching tutorials.

### 4. Create a standard Cloud project and link it

Apps Script auto-creates a Cloud project for every script, but that default
project cannot be used for publishing. Create your own:

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project**
   → name it something like `car-md-compare-addon` → **Create**.
2. **Project Settings** in the Cloud console → copy the **project number**.
3. In Apps Script: **Project Settings → Google Cloud Platform (GCP) Project →
   Change project** → paste the number.

### 5. Configure the OAuth consent screen

In the Cloud project → **APIs & Services → OAuth consent screen**. Set the user
type to **Internal**, fill in the app name, support email, and developer contact,
and add the two scopes from `addon/appsscript.json`.

Internal apps skip OAuth verification. This is why the private route is fast.

### 6. Enable and configure the Marketplace SDK

In the Cloud project → **APIs & Services → Library** → search **Google Workspace
Marketplace SDK** → **Enable**. Then open its **App Configuration** page:

- **App visibility: Private** — restricted to your organisation. **This is the
  irreversible one.** Check it twice before saving.
- **Installation settings** — whether individual users may install it themselves
  or only an admin may install it for the org. Admin-only is the usual choice
  for a tool that writes to spreadsheets.
- **App integration: Editor add-on**, then Sheets, then the **version number**
  from step 3.
- **OAuth scopes** — the same two again.

### 7. Create the store listing

Still in the Marketplace SDK, open **Store Listing**. A private listing still
requires one: name, short and long description, a category, graphics
(a 128×128 icon and at least one 1280×800 screenshot), plus a terms-of-service
URL, privacy-policy URL, and support URL.

Point those three at internal pages — a Google Doc or an intranet page is fine
for a private app.

### 8. Publish

**Publish** in the Marketplace SDK. A private app goes live for the domain
immediately, with no review.

Depending on the installation setting from step 6, either people install it from
Marketplace → **Internal apps**, or an admin installs it org-wide from the Admin
console. Some organisations run a Marketplace allowlist; if yours does, the
admin has to add the app before anyone can install it.

---

## Shipping updates

1. Change the code, test with a test deployment.
2. Create a new version.
3. In the Marketplace SDK's App Configuration, point the Editor add-on
   integration at the new version number and save.

Users get it on their next reload; nobody reinstalls anything. That is the whole
argument for the add-on over the library — the update fan-out drops from
"every consuming project" to "one field".

---

## Is it worth it here?

| | Library + stub | Private add-on |
|---|---|---|
| Setup for you | ~15 minutes | An afternoon, plus a Cloud project |
| Setup per spreadsheet | Add library, paste a stub | None |
| Shipping an update | Bump the version in each project | Change one field in the SDK |
| Ownership risk | Script is yours; share the drive | Shared drive from the outset |
| Prerequisites | None | Cloud project creation rights, an admin willing to approve |

The library wins below roughly a dozen spreadsheets. Above that, or the moment
people outside your immediate team start asking for it, the per-project update
cost is what tips it.

The engine is identical either way — `Code.js`, `Headers.js`, and `Dialog.html`
are unchanged between the two, and only the entry-point file differs. Starting
with the library and moving later costs one file swap, so there is no reason to
take on the Cloud project before the team size actually justifies it.

---

## Reference

- [Publish an add-on — overview](https://developers.google.com/workspace/add-ons/how-tos/publish-add-on-overview)
- [Publish apps to the Google Workspace Marketplace](https://developers.google.com/workspace/marketplace/how-to-publish)
- [Enable and configure the Marketplace SDK](https://developers.google.com/workspace/marketplace/enable-configure-sdk)
- [Create a store listing](https://developers.google.com/workspace/marketplace/create-listing)
- [Custom menus for Editor add-ons](https://developers.google.com/workspace/add-ons/concepts/menus)
- [Editor add-on authorization lifecycle](https://developers.google.com/workspace/add-ons/concepts/editor-auth-lifecycle)
- [Test Editor add-ons](https://developers.google.com/workspace/add-ons/how-tos/testing-editor-addons)
