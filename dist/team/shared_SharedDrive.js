/**
 * Shared-drive guard — used by every CA-R add-on built from this repo.
 *
 * An admin-installed add-on shows up in every Sheet its users open, and
 * Google gives no way to limit it to one shared drive. So each tool calls
 * CAR_requireSharedDrive_() when it's clicked, and refuses to run on a
 * spreadsheet saved anywhere other than the drives in
 * CAR_ADDON_CONFIG.SHARED_DRIVE_IDS.
 *
 * This can't happen in onOpen: before a user authorizes the add-on, onOpen
 * runs in AuthMode.NONE and any Drive call throws, which would leave no
 * menu at all.
 *
 * Needs the Drive advanced service (v3) and the drive.metadata.readonly
 * scope in appsscript.json, and the Drive API enabled in the Cloud project.
 */

/**
 * Pure check, separated out so it can be tested without a UI.
 * @param {string} fileId
 * @param {string[]} allowedDriveIds
 * @param {string} driveLabel  e.g. "California Revealed shared drive"
 * @return {{ok: boolean, message: (string|undefined)}}
 */
function CAR_checkSharedDrive_(fileId, allowedDriveIds, driveLabel) {
  var label = driveLabel || 'the CA-R shared drive';
  if (!allowedDriveIds || !allowedDriveIds.length) {
    return { ok: false, message: 'No shared drive is set for this add-on, so the tool didn\'t run. ' +
      'Ask the add-on maintainer to set SHARED_DRIVE_IDS in Config.js.' };
  }
  var meta;
  try {
    meta = Drive.Files.get(fileId, { fields: 'driveId', supportsAllDrives: true });
  } catch (err) {
    return { ok: false, message: 'Couldn\'t check where this spreadsheet is saved, so the tool didn\'t run.\n\n' +
      'Details: ' + (err && err.message ? err.message : err) };
  }
  var driveId = meta && meta.driveId ? meta.driveId : '';
  if (driveId && allowedDriveIds.indexOf(driveId) !== -1) return { ok: true };
  var where = driveId ? 'in a different shared drive' : 'in someone\'s My Drive, not a shared drive';
  return { ok: false, message: 'This tool only runs on spreadsheets saved in the ' + label + '. ' +
    'This spreadsheet is ' + where + '.\n\nMove it, or make a copy, into the ' + label + ' and try again.' };
}

/**
 * Call at the top of every menu entry point that does work.
 * Shows an alert and returns false when the tool shouldn't run.
 */
function CAR_requireSharedDrive_() {
  var cfg = (typeof CAR_ADDON_CONFIG !== 'undefined') ? CAR_ADDON_CONFIG : {};
  if (cfg.REQUIRE_SHARED_DRIVE === false) return true;
  var res = CAR_checkSharedDrive_(
    SpreadsheetApp.getActiveSpreadsheet().getId(),
    cfg.SHARED_DRIVE_IDS,
    cfg.SHARED_DRIVE_LABEL
  );
  if (res.ok) return true;
  var ui = SpreadsheetApp.getUi();
  ui.alert(cfg.ADDON_NAME || 'CA-R Tools', res.message, ui.ButtonSet.OK);
  return false;
}
