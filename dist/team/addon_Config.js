/**
 * CA-R Tools — settings. These ship with each published version, so a
 * change here means publishing a new version.
 */

var CAR_ADDON_CONFIG = {
  ADDON_NAME: 'CA-R Tools',
  VERSION: '1.0.0',

  // Tools refuse to run on spreadsheets outside these shared drives.
  // 0AJYT4SOhT2pmUk9PVA = California Revealed shared drive.
  SHARED_DRIVE_IDS: ['0AJYT4SOhT2pmUk9PVA'],
  SHARED_DRIVE_LABEL: 'California Revealed shared drive',
  REQUIRE_SHARED_DRIVE: true
};

/* ---- MD Compare team defaults (read by applyInstallDefaults_ in Code.js) ---- */

/** Any CONFIG key from tools/md-compare/src/Code.js; setConfig throws on an unknown one. */
var INSTALL_CONFIG = {
  IGNORE_FIELDS: [
    'Workflow State',      // obj_workflow_state__label — internal, never partner-supplied
    'Notes to Vendor'      // obj_notes_to_vendor — internal
  ]
};

/** Partner header spellings the Metadata Dictionary doesn't carry. */
var INSTALL_HEADER_ALIASES = {
  // 'Object Title': 'label',
  // 'Reel Number': 'obj_call_number'
};
