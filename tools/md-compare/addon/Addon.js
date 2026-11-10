/**
 * CA-R Metadata Sheet Comparator — Editor add-on install
 * ------------------------------------------------------------------
 * Use this when the comparator is published as a Google Workspace Marketplace
 * Editor add-on. It goes in the same script project as Code.js, Headers.js,
 * and Dialog.html — an add-on is one self-contained project, not a stub
 * pointing at a library.
 *
 * For a single spreadsheet use bound/Bound.js; for the library install use
 * stub/Stub.js. Exactly one of the three belongs in a project — each defines
 * onOpen, and Apps Script silently lets the last definition win.
 *
 * See docs/ADDON.md for the publishing walkthrough.
 */

/**
 * Team defaults, applied on every run. Any CONFIG key from Code.js works;
 * setConfig throws on an unrecognised one.
 *
 * In an add-on these ship with the version, so changing them means publishing
 * a new version. If they need to vary by person or by spreadsheet, read them
 * from PropertiesService in applyInstallDefaults_ instead — but note the
 * AuthMode restriction below.
 */
var INSTALL_CONFIG = {
  IGNORE_FIELDS: [
    'Workflow State',      // obj_workflow_state__label — internal, never partner-supplied
    'Notes to Vendor'      // obj_notes_to_vendor — internal
  ]
};

/** Partner header spellings the dictionary does not carry. */
var INSTALL_HEADER_ALIASES = {
  // 'Object Title': 'label',
  // 'Reel Number': 'obj_call_number'
};

/**
 * Builds the add-on's submenu under Extensions.
 *
 * Two things differ from a bound script and both matter:
 *
 * 1. createAddonMenu(), not createMenu(). A published add-on's items belong
 *    under Extensions → CA-R Metadata Comparator. A top-level menu built with
 *    createMenu() gets relocated once the add-on is published, which is not the
 *    layout you tested.
 *
 * 2. onOpen runs before the user has authorised the add-on, in
 *    AuthMode.NONE. Anything needing authorisation — PropertiesService,
 *    SpreadsheetApp data access, UrlFetchApp — throws there, and a throw means
 *    no menu at all. Menu construction below touches nothing but the UI, so it
 *    is safe in every mode; the guard is here so it stays that way if items are
 *    added later.
 */
function onOpen(e) {
  var menu = SpreadsheetApp.getUi().createAddonMenu();
  menu.addItem('MD update compare', 'showCompareDialog');
  menu.addItem('Apply reviewed MD updates', 'applyReviewedChanges');
  if (!e || e.authMode !== ScriptApp.AuthMode.NONE) {
    // Room for items that need authorisation to decide whether to appear.
    menu.addSeparator();
    menu.addItem('About', 'showAbout');
  }
  menu.addToUi();
}

/**
 * Runs once, immediately after a user installs the add-on. Without it the menu
 * only appears after the next reload, which reads as a broken install.
 */
function onInstall(e) {
  onOpen(e);
}
