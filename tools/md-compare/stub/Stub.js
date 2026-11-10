/**
 * CA-R Metadata Sheet Comparator — bound stub
 * ------------------------------------------------------------------
 * Paste this into the Apps Script project of any spreadsheet that should have
 * the comparator, then add the library:
 *
 *   Extensions → Apps Script → Libraries (+) → paste the library script ID
 *   → pick a version → set the identifier to CARCompare → Add
 *
 *   Library script ID:
 *   115uX0956bX_En1st2ZMYldRP-k0hj3dHYjCsSDUdypX44kQK3e506vrK
 *
 * Nothing else is needed. Updating everyone to a new build is a matter of
 * bumping the library version in this project, not repasting code.
 *
 * Why the wrappers below exist: a dialog opened by a library resolves its
 * google.script.run calls against THIS script, not against the library. The
 * three carmd_* functions are what the dialog calls, so they have to live
 * here. onOpen is a simple trigger and likewise only fires from the bound
 * project.
 *
 * This is one of three mutually exclusive entry-point files — see also
 * bound/Bound.js and addon/Addon.js. Never put more than one in a project.
 */

/**
 * Team defaults. These are applied on every call, so a change here takes
 * effect on the next run with no library redeployment. Named INSTALL_CONFIG to
 * match bound/Bound.js and addon/Addon.js, which use the same two variables.
 *
 * Any CONFIG key from the library can go in here. The most useful are:
 *
 *   IGNORE_FIELDS       fields that always differ and are never partner edits.
 *                       Machine or human-readable names both work.
 *   DIFF_CELL_FORMAT    'both' | 'incoming' | 'current'
 *   KEY_MATCH_CASE_SENSITIVE
 *   TRANSLATE_HEADERS
 *   GRID_SHEET / SUMMARY_SHEET   output tab names
 *
 * setConfig throws on an unrecognised key, so a typo surfaces immediately
 * rather than being silently ignored.
 */
var INSTALL_CONFIG = {
  IGNORE_FIELDS: [
    'Workflow State',      // obj_workflow_state__label — internal, never partner-supplied
    'Notes to Vendor'      // obj_notes_to_vendor — internal
  ]
};

/**
 * Header spellings partners use that the dictionary does not carry. Add to
 * this rather than editing the library's generated Headers.js.
 */
var INSTALL_HEADER_ALIASES = {
  // 'Object Title': 'label',
  // 'Reel Number': 'obj_call_number'
};

function applyTeamSettings_() {
  CARCompare.setConfig(INSTALL_CONFIG);
  CARCompare.addHeaderAliases(INSTALL_HEADER_ALIASES);
}

/* ---- menu (simple trigger; must be in the bound script) ---------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CA-R Tools')
    .addItem('MD update compare', 'showCompareDialog')
    .addItem('Apply reviewed MD updates', 'applyReviewedChanges')
    .addSeparator()
    .addItem('About', 'showAbout')
    .addToUi();
}

function showCompareDialog() {
  applyTeamSettings_();
  CARCompare.showCompareDialog();
}

function applyReviewedChanges() {
  applyTeamSettings_();
  CARCompare.applyReviewedChanges();
}

function showAbout() {
  applyTeamSettings_();
  CARCompare.showAbout();
}

/* ---- dialog callbacks (names must match those in Dialog.html) ---------- */

function carmd_getDefaults() {
  applyTeamSettings_();
  return CARCompare.carmd_getDefaults();
}

function carmd_getSpreadsheetInfo(ref) {
  applyTeamSettings_();
  return CARCompare.carmd_getSpreadsheetInfo(ref);
}

function carmd_runComparison(params) {
  applyTeamSettings_();
  return CARCompare.carmd_runComparison(params);
}

/* ---- optional: which library build is in use --------------------------- */

function carmd_version() {
  return CARCompare.getVersion();
}
