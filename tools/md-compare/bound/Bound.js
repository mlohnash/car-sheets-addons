/**
 * CA-R Metadata Sheet Comparator — bound install
 * ------------------------------------------------------------------
 * Use this when the comparator is pasted directly into one spreadsheet's
 * script project, alongside Code.js, Headers.js, and Dialog.html.
 *
 * For the library install use stub/Stub.js instead; for a published add-on use
 * addon/Addon.js. Exactly one of the three belongs in a project — each defines
 * onOpen, and Apps Script silently lets the last definition win.
 */

/**
 * Optional. Defaults for this spreadsheet, applied on every run. Any CONFIG key
 * from Code.js works; setConfig throws on an unrecognised one.
 */
var INSTALL_CONFIG = {
  IGNORE_FIELDS: [
    'Workflow State',      // obj_workflow_state__label — internal, never partner-supplied
    'Notes to Vendor'      // obj_notes_to_vendor — internal
  ]
};

/** Optional. Partner header spellings the dictionary does not carry. */
var INSTALL_HEADER_ALIASES = {
  // 'Object Title': 'label',
  // 'Reel Number': 'obj_call_number'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CA-R Tools')
    .addItem('MD update compare', 'showCompareDialog')
    .addItem('Apply reviewed MD updates', 'applyReviewedChanges')
    .addSeparator()
    .addItem('About', 'showAbout')
    .addToUi();
}
