# Publishing CA-R Tools privately

This walks through publishing **CA-R Tools** (`addons/team`) as a private Google Workspace Editor add-on, then installing it for the CA-R team. CA-R DG Tools follows the same steps with its own script project, Cloud project and Google Group.

A private add-on is visible only inside the California Revealed Workspace organization and is listed under the Marketplace's **Internal apps**. Google doesn't review private apps, so publishing is immediate.

> **Two things that can't be undone**
> - **Private vs public is permanent** once saved in the Marketplace SDK. Choose Private.
> - **The add-on belongs to the organization.** Create the script project in the **shared drive**, not your My Drive, or it becomes hard to maintain if the owning account is ever removed.

## Before you start

- [ ] A Google account in California Revealed's Workspace domain (not a personal gmail account)
- [ ] Permission to create Google Cloud projects in the organization
- [ ] A Workspace super-admin for step 8. To check whether that's you, open <https://admin.google.com> and look at your own user's **Admin roles and privileges**.
- [ ] A Google Group of CA-R staff to install it for, e.g. `car-team@…`. CA-R DG Tools will need a DG group.
- [ ] `npm test` passes

---

## 1. Create the script project

1. In the California Revealed shared drive, choose **New → More → Google Apps Script**. This makes a standalone project, which is what Editor add-ons are published from. Don't use one bound to a spreadsheet.
2. Name it **CA-R Tools**.
3. Copy its **Script ID** (**Project Settings**) into `addons/team/.clasp.json`. See the README's Setup section.
4. Run `npm run push:team`. Then open the project, delete the starter `Code.gs` if it's still there, and confirm the files from `dist/team` are present.

## 2. Test before publishing

1. **Deploy → Test deployments → Editor add-on → Create new test.** Pick a spreadsheet in the shared drive, save, then **Execute**.
2. In that spreadsheet, check that **Extensions → CA-R Tools** shows all five items.
3. Run **MD update compare** end to end, and **Highlight repeated IDs** with the defaults.
4. Test a spreadsheet in your My Drive. Each tool should show the shared-drive message and stop.

The first time you run a tool, you'll get the authorization screen. The Drive API error from the shared-drive check is expected until step 4 is done, so finish step 4 and then retest.

## 3. Create a version

**Deploy → Manage deployments → create a version**, or `clasp version "CA-R Tools 1.0.0"` from `dist/team`. Note the **version number**. Editor add-ons are published by version number, not deployment ID, which is a common mix-up in tutorials.

## 4. Create a standard Cloud project and link it

The Cloud project Apps Script creates automatically can't be used for publishing.

1. Go to <https://console.cloud.google.com> and choose **New project**. Make sure **Organization** is California Revealed's. If it isn't, step 5's **Internal** option won't be available. Name it `car-tools-addon`.
2. **APIs & Services → Library**, then enable:
   - **Google Drive API** (for the shared-drive check)
   - **Google Workspace Marketplace SDK**
3. Copy the **project number** from the Cloud project's dashboard.
4. In Apps Script, go to **Project Settings → Google Cloud Platform (GCP) Project → Change project**, paste the number and confirm.

## 5. OAuth consent screen

In the Cloud project, go to **APIs & Services → OAuth consent screen**. Depending on the console version, this may be called **Google Auth Platform → Branding / Audience**.

- **User type / Audience: Internal.** Internal apps skip Google's verification and the "unverified app" warning.
- App name **CA-R Tools**, plus a support email and developer contact.
- Scopes. These are the same three as `addons/team/appsscript.json`:

| Scope | Why | What the person approving it should know |
|---|---|---|
| `…/auth/spreadsheets` | MD Compare reads the incoming sheet, which can be any spreadsheet the user can open | Read and write to the user's spreadsheets. It's broad, but needed for comparing against another file. |
| `…/auth/script.container.ui` | Dialogs and alerts | Shows UI inside Sheets only |
| `…/auth/drive.metadata.readonly` | Shared-drive check | Can see file names and locations, never contents |

## 6. Configure the Marketplace SDK

In the Cloud project, open **APIs & Services → Enabled APIs → Google Workspace Marketplace SDK → App Configuration**:

- **App visibility: Private.** This is the irreversible setting.
- **Installation settings: Admin Only Install**, so access is controlled by group.
- **App integration: Editor add-on → Sheets add-on**. Enter the **Script ID** and the **version number** from step 3.
- **OAuth scopes:** the same three as above.
- Developer name, email and links, then **Save**.

## 7. Store listing

A private app still needs a listing. Under **Store Listing**, add:

- name, short description and detailed description
- a category
- a 128×128 icon
- at least one 1280×800 screenshot
- terms of service, privacy policy and support URLs

For a private app, all three URLs can point to one internal Google Doc.

Then click **Publish**. A private app is live for the organization right away.

## 8. Install it for the team (super-admin)

1. Go to <https://admin.google.com> → **Apps → Google Workspace Marketplace apps → Apps list → Add app → Add internal app**. You can also use the admin install link on the store listing.
2. Choose **CA-R Tools** and install it for the CA-R team **group**, not the whole domain.
3. If the organization uses a Marketplace allowlist, add the app to it.

Users see **Extensions → CA-R Tools** after their next reload. Each person authorizes it the first time they run a tool.

---

## Shipping updates

1. Make the change, update `CHANGELOG.md`, and bump `VERSION` in `addons/team/Config.js`.
2. Run `npm test`, then `npm run push:team`, and check it with the test deployment from step 2.
3. Create a new version (step 3).
4. In **Marketplace SDK → App Configuration**, change the Editor add-on version number and **Save**.

Users get the update on their next reload. Nobody reinstalls anything.

If an update adds a new scope, every user has to re-authorize. Add the scope in step 5 and step 6 as well as in `appsscript.json`.

## Reference

- [Configure the Marketplace SDK](https://developers.google.com/workspace/marketplace/sdk)
- [Publish apps to the Google Workspace Marketplace](https://developers.google.com/workspace/marketplace/how-to-publish)
- [Editor add-on authorization lifecycle](https://developers.google.com/workspace/add-ons/concepts/editor-auth-lifecycle)
- [Test Editor add-ons](https://developers.google.com/workspace/add-ons/how-tos/testing-editor-addons)
