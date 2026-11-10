/**
 * Run with:  npm test   (or node test/run.js)
 *
 * 1. MD Compare's own test suite, unchanged
 * 2. Highlight repeated IDs formula self test
 * 3. Shared-drive guard against a mocked Drive service
 * 4. Build checks (catches a second onOpen, duplicate globals, broken menu wiring)
 * 5. The built CA-R Tools project loaded into one sandbox, the way Apps Script loads it
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { build, checkProject } = require('../build');

const ROOT = path.join(__dirname, '..');
const DRIVE_ID = '0AJYT4SOhT2pmUk9PVA';
let failures = 0;
function check(label, fn) {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { failures++; console.log('FAIL  ' + label + '\n      ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* ---- 1. MD Compare suite ---------------------------------------------- */
console.log('\n# MD Compare');
check('MD Compare test suite passes', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/md-compare/test/test.js')], { encoding: 'utf8' });
  if (r.status !== 0) {
    const fails = (r.stdout || '').split('\n').filter(l => /^FAIL/.test(l)).join('\n      ');
    throw new Error('exit ' + r.status + '\n      ' + (fails || r.stderr));
  }
});

/* ---- 2. HRI ----------------------------------------------------------- */
console.log('\n# Highlight repeated IDs');
check('formula self test passes', () => {
  const ctx = { Logger: { log() {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/highlight-repeated-ids/HighlightRepeatedIds.js'), 'utf8'), ctx);
  const msg = vm.runInContext('HRI_selfTest()', ctx);
  assert(/^All \d+ checks passed$/.test(msg), msg);
});

/* ---- 3. Shared-drive guard -------------------------------------------- */
console.log('\n# Shared-drive guard');
function guardCtx(driveImpl) {
  const ctx = { Drive: { Files: { get: driveImpl } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared/SharedDrive.js'), 'utf8'), ctx);
  return ctx;
}
check('a file in the CA-R shared drive is allowed', () => {
  let args;
  const ctx = guardCtx((id, opts) => { args = opts; return { driveId: DRIVE_ID }; });
  const r = ctx.CAR_checkSharedDrive_('file1', [DRIVE_ID], 'CA-R drive');
  assert(r.ok, JSON.stringify(r));
  assert(args.supportsAllDrives === true, 'supportsAllDrives must be set or shared-drive files 404');
});
check('a file in My Drive is refused with a clear reason', () => {
  const ctx = guardCtx(() => ({}));
  const r = ctx.CAR_checkSharedDrive_('f', [DRIVE_ID], 'CA-R drive');
  assert(!r.ok && /My Drive/.test(r.message), r.message);
});
check('a file in another shared drive is refused', () => {
  const ctx = guardCtx(() => ({ driveId: '0AOTHER' }));
  const r = ctx.CAR_checkSharedDrive_('f', [DRIVE_ID], 'CA-R drive');
  assert(!r.ok && /different shared drive/.test(r.message), r.message);
});
check('a Drive error refuses to run and shows the error', () => {
  const ctx = guardCtx(() => { throw new Error('Drive API has not been used in project'); });
  const r = ctx.CAR_checkSharedDrive_('f', [DRIVE_ID], 'CA-R drive');
  assert(!r.ok && /Drive API has not been used/.test(r.message), r.message);
});
check('no configured drive refuses to run', () => {
  const ctx = guardCtx(() => ({ driveId: DRIVE_ID }));
  const r = ctx.CAR_checkSharedDrive_('f', [], 'CA-R drive');
  assert(!r.ok && /SHARED_DRIVE_IDS/.test(r.message), r.message);
});

/* ---- 4. Build checks -------------------------------------------------- */
console.log('\n# Build checks');
const base = [
  { src: 'a/Menu.js', out: 'a_Menu.js', code: "function onOpen(){ ui.addItem('Go', 'go'); }\nfunction go(){}" }
];
check('a consistent project passes', () => {
  const p = checkProject(base);
  assert(!p.length, p.join('; '));
});
check('a second onOpen is caught', () => {
  const p = checkProject(base.concat([{ src: 'b/Other.js', out: 'b_Other.js', code: 'function onOpen(){}' }]));
  assert(p.some(x => /exactly one onOpen/.test(x)), p.join('; '));
});
check('a duplicated global is caught', () => {
  const p = checkProject(base.concat([{ src: 'b/Other.js', out: 'b_Other.js', code: 'var go = 1;' }]));
  assert(p.some(x => /"go" is defined in more than one file/.test(x)), p.join('; '));
});
check('a menu item pointing at a missing function is caught', () => {
  const p = checkProject([{ src: 'a/Menu.js', out: 'a_Menu.js', code: "function onOpen(){ ui.addItem('Go', 'nope'); }" }]);
  assert(p.some(x => /calls nope/.test(x)), p.join('; '));
});
check('a dialog calling a missing server function is caught', () => {
  const p = checkProject(base.concat([{ src: 'a/D.html', out: 'D.html', code: '<script>google.script.run.withSuccessHandler(f).missingFn()</script>' }]));
  assert(p.some(x => /missingFn/.test(x)), p.join('; '));
});
check('a missing HTML file is caught', () => {
  const p = checkProject([{ src: 'a/Menu.js', out: 'a_Menu.js', code: "function onOpen(){}\nHtmlService.createHtmlOutputFromFile('Nope');" }]);
  assert(p.some(x => /"Nope"/.test(x)), p.join('; '));
});

/* ---- 5. Built CA-R Tools project ------------------------------------- */
console.log('\n# Built CA-R Tools project');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'car-build-'));
let built;
check('CA-R Tools builds without problems', () => {
  built = build('team', { distDir: tmp, quiet: true });
});

function loadBuilt(driveId) {
  const calls = { alerts: [], dialogs: [], menu: [] };
  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' }, Button: { OK: 'OK' },
    alert(...a) { calls.alerts.push(a); return 'OK'; },
    showModalDialog(html, title) { calls.dialogs.push(title); },
    createAddonMenu() {
      const m = {
        addItem(label, fn) { calls.menu.push([label, fn]); return m; },
        addSeparator() { return m; },
        addToUi() {}
      };
      return m;
    }
  };
  const htmlOut = { setWidth() { return htmlOut; }, setHeight() { return htmlOut; } };
  const ctx = {
    Logger: { log() {} },
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ({ getId: () => 'sheet1' }) },
    HtmlService: { createHtmlOutputFromFile: () => htmlOut },
    ScriptApp: { AuthMode: { NONE: 'NONE' } },
    Drive: { Files: { get: () => (driveId ? { driveId } : {}) } }
  };
  vm.createContext(ctx);
  const manifest = JSON.parse(fs.readFileSync(path.join(built.outDir, 'appsscript.json'), 'utf8'));
  built.files.filter(f => f.endsWith('.js')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(built.outDir, f), 'utf8'), ctx, { filename: f });
  });
  return { ctx, calls, manifest };
}

check('onOpen builds the menu in AuthMode.NONE without touching Drive', () => {
  const { ctx, calls } = loadBuilt(DRIVE_ID);
  ctx.Drive.Files.get = () => { throw new Error('Drive touched in onOpen'); };
  ctx.onOpen({ authMode: 'NONE' });
  const labels = calls.menu.map(m => m[0]);
  ['MD update compare', 'Apply reviewed MD updates', 'Highlight repeated IDs',
    'Remove repeated-ID highlighting', 'About CA-R Tools'].forEach(l => assert(labels.includes(l), 'missing ' + l));
  calls.menu.forEach(([l, fn]) => assert(typeof ctx[fn] === 'function', l + ' -> ' + fn + ' is not defined'));
  assert(!labels.some(l => /\.\.\.|…$/.test(l)), 'menu labels should not end in an ellipsis');
});
check('MD update compare opens inside the CA-R shared drive', () => {
  const { ctx, calls } = loadBuilt(DRIVE_ID);
  ctx.CART_mdCompare();
  assert(calls.dialogs.includes('MD update compare'), 'dialog did not open; alerts: ' + JSON.stringify(calls.alerts));
});
check('MD update compare refuses outside the shared drive', () => {
  const { ctx, calls } = loadBuilt(null);
  ctx.CART_mdCompare();
  assert(!calls.dialogs.length, 'dialog opened anyway');
  assert(calls.alerts.length === 1 && /only runs on spreadsheets saved/.test(calls.alerts[0][1]), JSON.stringify(calls.alerts));
});
check('Highlight repeated IDs is guarded too', () => {
  const { ctx, calls } = loadBuilt(null);
  ctx.HRI_openDialog();
  assert(!calls.dialogs.length && calls.alerts.length === 1, 'not guarded');
});
check('MD Compare team defaults are applied', () => {
  const { ctx } = loadBuilt(DRIVE_ID);
  vm.runInContext('applyInstallDefaults_()', ctx);
  const ignored = vm.runInContext('CONFIG.IGNORE_FIELDS', ctx);
  assert(ignored.includes('Workflow State'), JSON.stringify(ignored));
});
check('manifest has the Drive service and the narrow Drive scope', () => {
  const { manifest } = loadBuilt(DRIVE_ID);
  const svc = (manifest.dependencies.enabledAdvancedServices || []).find(s => s.serviceId === 'drive');
  assert(svc && svc.userSymbol === 'Drive' && svc.version === 'v3', 'Drive v3 advanced service missing');
  assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.metadata.readonly'), 'drive.metadata.readonly missing');
  assert(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'), 'full Drive scope should not be requested');
});
check('About lists both tools', () => {
  const { ctx, calls } = loadBuilt(DRIVE_ID);
  ctx.CART_about();
  const text = calls.alerts[0][1];
  assert(/MD Compare \d/.test(text) && /Highlight repeated IDs \(\d/.test(text), text);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? '\n' + failures + ' failure(s)' : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
