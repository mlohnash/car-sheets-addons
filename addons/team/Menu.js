/**
 * CA-R Tools — whole-team Editor add-on. Menu and entry points.
 *
 * This is the only onOpen in the project. The build fails if it finds a
 * second one, because Apps Script silently uses whichever loads last.
 *
 * onOpen runs in AuthMode.NONE before a user has authorized the add-on, so
 * it must touch nothing but the UI. The shared-drive check happens when an
 * item is clicked instead.
 */

function onOpen(e) {
  SpreadsheetApp.getUi().createAddonMenu()
    .addItem('MD update compare', 'CART_mdCompare')
    .addItem('Apply reviewed MD updates', 'CART_mdApply')
    .addSeparator()
    .addItem('Highlight repeated IDs', 'HRI_openDialog')
    .addItem('Remove repeated-ID highlighting', 'HRI_removeRules')
    .addSeparator()
    .addItem('About CA-R Tools', 'CART_about')
    .addToUi();
}

/** Without this the menu only appears after the next reload. */
function onInstall(e) {
  onOpen(e);
}

function CART_mdCompare() {
  if (!CAR_requireSharedDrive_()) return;
  showCompareDialog();
}

function CART_mdApply() {
  if (!CAR_requireSharedDrive_()) return;
  applyReviewedChanges();
}

function CART_about() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    CAR_ADDON_CONFIG.ADDON_NAME + ' ' + CAR_ADDON_CONFIG.VERSION,
    'Tools in this add-on:\n' +
    '  MD update compare / Apply reviewed MD updates (MD Compare ' + VERSION + ')\n' +
    '  Highlight repeated IDs (' + HRI.VERSION + ')\n\n' +
    'Tools run only on spreadsheets saved in the ' + CAR_ADDON_CONFIG.SHARED_DRIVE_LABEL + '.',
    ui.ButtonSet.OK
  );
}
