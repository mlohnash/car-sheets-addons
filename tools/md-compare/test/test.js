/**
 * Run with:  node test/test.js
 *
 * Loads src/Code.js into a stubbed Apps Script environment and exercises the
 * comparison against the synthetic fixture in test/fixture.js.
 */

const { active, Sheet } = require('./harness');
const fs = require('fs');
eval(fs.readFileSync(__dirname + '/../src/Headers.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../src/Code.js', 'utf8'));

let failures = 0;
function check(label, fn) {
  try { fn(); console.log('PASS  ' + label); }
  catch (e) { failures++; console.log('FAIL  ' + label + '\n      ' + e.message); }
}
function clone(d) { return d.map(r => r.slice()); }
function addSheet(name, data) {
  const existing = active.getSheetByName(name);
  if (existing) active.sheets.splice(active.sheets.indexOf(existing), 1);
  active.sheets.push(new Sheet(name, data));
}
function summaryText() {
  return active.getSheetByName('Diff_Summary').data.map(r => r.join(' :: ')).join('\n');
}
function gridHeader() {
  return active.getSheetByName('Diff_Grid').data[0];
}

const base = active.getSheetByName('Partner').data;
const IGNORE = ['obj_workflow_state__label', 'obj_notes_to_vendor'];
const opts = {
  currentRef: '', currentSheet: 'Processing',
  incomingRef: '', incomingSheet: 'Partner',
  keyField: '', headerRow: 1, diffCellFormat: 'both', ignoreFields: IGNORE
};

/* ---- matching is order independent ------------------------------------ */

const run = runComparison(Object.assign({}, opts));

check('every record matches despite reversed row order', () => {
  if (run.matched !== 40) throw new Error('matched ' + run.matched);
});
check('columns match by name despite a different column order', () => {
  if (run.keyField !== 'node_uuid_no_changes') throw new Error('key ' + run.keyField);
  if (run.changed !== 5) throw new Error('expected 5 changed records, got ' + run.changed);
  if (run.cells !== 5) throw new Error('expected 5 changed cells, got ' + run.cells);
});
check('only fields that actually differ become grid columns', () => {
  const h = gridHeader();
  ['obj_call_number', 'obj_alternative_title', 'obj_print_item_parts__ip_print_format',
   'label', 'obj_created_date__date_free'].forEach(f => {
    if (h.indexOf(f) < 0) throw new Error('missing column ' + f);
  });
  if (h.indexOf('obj_temporary_id') >= 0) throw new Error('unchanged field became a column');
});
check('a case-only change is reported', () => {
  const grid = active.getSheetByName('Diff_Grid').data;
  const col = gridHeader().indexOf('obj_print_item_parts__ip_print_format');
  const hit = grid.slice(1).some(r => /periodical[\s\S]*Periodical/.test(String(r[col] || '')));
  if (!hit) throw new Error('case-only change not found');
});
check('a trailing-whitespace-only change is reported', () => {
  if (gridHeader().indexOf('label') < 0) throw new Error('label column absent');
});
check('a blank-to-populated change is reported', () => {
  const grid = active.getSheetByName('Diff_Grid').data;
  const col = gridHeader().indexOf('obj_alternative_title');
  const hit = grid.slice(1).some(r => /\(empty\)[\s\S]*An alternative title/.test(String(r[col] || '')));
  if (!hit) throw new Error('empty token not rendered');
});

/* ---- systematic fields ------------------------------------------------- */

check('ignored fields are excluded and named in the summary', () => {
  const s = summaryText();
  if (!/Ignored by request :: 2/.test(s)) throw new Error('count not reported');
  if (!/obj_workflow_state__label  \(Workflow State\)/.test(s)) throw new Error('label missing');
  if (!/obj_notes_to_vendor  \(Notes to Vendor\)/.test(s)) throw new Error('label missing');
});
check('without the ignore list, systematic fields are flagged', () => {
  const r = runComparison(Object.assign({}, opts, { ignoreFields: [] }));
  if (r.changed !== 40) throw new Error('expected all 40 records changed, got ' + r.changed);
  if (!/systematic; likely an internal field/.test(summaryText())) throw new Error('no systematic flag');
});

/* ---- key fallback ------------------------------------------------------ */

function dropColumn(data, name) {
  const i = data[0].indexOf(name);
  if (i < 0) throw new Error('no column ' + name);
  return data.map(r => r.filter((_, j) => j !== i));
}

addSheet('NoUuid', dropColumn(clone(base), 'node_uuid_no_changes'));
check('falls back to obj_call_number when node_uuid_no_changes is absent', () => {
  const r = runComparison(Object.assign({}, opts, { incomingSheet: 'NoUuid' }));
  if (r.keyField !== 'obj_call_number') throw new Error('got ' + r.keyField);
});

addSheet('NoUuidNoCall', dropColumn(dropColumn(clone(base), 'node_uuid_no_changes'), 'obj_call_number'));
check('falls back to obj_temporary_id when the first two keys are absent', () => {
  const r = runComparison(Object.assign({}, opts, { incomingSheet: 'NoUuidNoCall' }));
  if (r.keyField !== 'obj_temporary_id') throw new Error('got ' + r.keyField);
});

const blanked = clone(base);
const ui = blanked[0].indexOf('node_uuid_no_changes');
for (let r = 1; r < blanked.length; r++) blanked[r][ui] = '';
addSheet('EmptyUuid', blanked);
check('a present-but-empty key column falls through to the next key', () => {
  const r = runComparison(Object.assign({}, opts, { incomingSheet: 'EmptyUuid' }));
  if (r.keyField !== 'obj_call_number') throw new Error('got ' + r.keyField);
});

/* ---- unmatched and duplicate records ----------------------------------- */

const edited = clone(base);
edited.splice(3, 2);
const extra = edited[6].slice();
extra[ui] = 'NEW-RECORD-0001';
edited.push(extra);
addSheet('Edited', edited);
runComparison(Object.assign({}, opts, { incomingSheet: 'Edited' }));
check('records missing from incoming are counted', () => {
  if (!/Only in CURRENT \(partner dropped or renamed\?\) :: 2/.test(summaryText())) throw new Error('not reported');
});
check('records new in incoming are counted', () => {
  if (!/Only in INCOMING \(new records\?\) :: 1/.test(summaryText())) throw new Error('not reported');
});

const dup = clone(base);
dup.push(dup[5].slice());
addSheet('Dup', dup);
runComparison(Object.assign({}, opts, { incomingSheet: 'Dup' }));
check('duplicate keys are reported and the extra copy is left unpaired', () => {
  const s = summaryText();
  if (!/Duplicate keys :: 1/.test(s)) throw new Error('duplicate not counted');
  if (!/unpaired duplicate/.test(s)) throw new Error('unpaired copy not listed');
});

/* ---- guards ------------------------------------------------------------ */

check('comparing a sheet against itself is rejected', () => {
  try { runComparison(Object.assign({}, opts, { currentSheet: 'Partner', incomingSheet: 'Partner' })); }
  catch (e) { return; }
  throw new Error('no error raised');
});

addSheet('PartnerCopy', clone(base));
check('identical sheets report zero differences', () => {
  const r = runComparison(Object.assign({}, opts, { currentSheet: 'Partner', incomingSheet: 'PartnerCopy' }));
  if (r.changed !== 0 || r.cells !== 0) throw new Error(JSON.stringify(r));
});

/* ---- human-readable header translation --------------------------------- */

const HUMAN = {
  'node_uuid_no_changes': 'Archipealgo UUID',
  'obj_call_number': 'Call Number',
  'obj_temporary_id': 'Temporary Identifier',
  'label': 'Title',
  'obj_created_date__date_free': 'Created Date',
  'obj_alternative_title': 'Alternative Title',
  'obj_print_item_parts__ip_print_format': 'Format',
  'obj_workflow_state__label': 'Workflow State',
  'obj_notes_to_vendor': 'Notes to Vendor'
};

function relabel(data, mapFn) {
  const out = clone(data);
  out[0] = out[0].map(mapFn);
  return out;
}

// Incoming sheet headed entirely in human-readable labels.
addSheet('HumanHeaders', relabel(base, h => HUMAN[h] || h));
check('a human-headed incoming sheet compares against a machine-headed current sheet', () => {
  const r = runComparison(Object.assign({}, opts, { incomingSheet: 'HumanHeaders' }));
  if (r.keyField !== 'node_uuid_no_changes') throw new Error('key ' + r.keyField);
  if (r.matched !== run.matched) throw new Error('matched ' + r.matched + ' vs ' + run.matched);
  if (r.changed !== run.changed || r.cells !== run.cells) {
    throw new Error('changed ' + r.changed + '/' + r.cells + ' vs ' + run.changed + '/' + run.cells);
  }
});
check('translated headers are listed in the summary', () => {
  const s = summaryText();
  if (!/Human-readable headers translated :: 9/.test(s)) throw new Error('count wrong');
  if (!/INCOMING  "Call Number"  →  obj_call_number/.test(s)) throw new Error('translation not listed');
});
check('the grid still uses machine names as column headings', () => {
  if (gridHeader().indexOf('obj_call_number') < 0) throw new Error('heading not machine-readable');
});

// Loose spelling: different case, spacing and punctuation.
addSheet('LooseHeaders', relabel(base, h => (HUMAN[h] || h).toUpperCase() + ' '));
check('human labels are matched loosely on case, spacing and punctuation', () => {
  const r = runComparison(Object.assign({}, opts, { incomingSheet: 'LooseHeaders' }));
  if (r.changed !== run.changed || r.cells !== run.cells) {
    throw new Error('changed ' + r.changed + '/' + r.cells);
  }
});

// The documented alias for the dictionary's misspelling.
addSheet('AliasHeaders', relabel(base, h => (h === 'node_uuid_no_changes' ? 'Archipelago UUID' : h)));
check('HEADER_ALIASES resolves the corrected UUID spelling', () => {
  const r = runComparison(Object.assign({}, opts, { incomingSheet: 'AliasHeaders' }));
  if (r.keyField !== 'node_uuid_no_changes') throw new Error('key ' + r.keyField);
  if (r.matched !== 40) throw new Error('matched ' + r.matched);
});

// The key itself given in human-readable form on both sides.
addSheet('HumanCurrent', relabel(active.getSheetByName('Processing').data, h => HUMAN[h] || h));
check('both sheets headed in human-readable labels still compare', () => {
  const r = runComparison(Object.assign({}, opts, {
    currentSheet: 'HumanCurrent', incomingSheet: 'HumanHeaders'
  }));
  if (r.keyField !== 'node_uuid_no_changes') throw new Error('key ' + r.keyField);
  if (r.matched !== 40) throw new Error('matched ' + r.matched);
});

/* ---- unrecognised headers ---------------------------------------------- */

function appendColumn(data, header, valueFn) {
  const out = clone(data);
  out[0].push(header);
  for (let i = 1; i < out.length; i++) out[i].push(valueFn(i));
  return out;
}

let curLocal = appendColumn(active.getSheetByName('Processing').data, 'Local Shelf Note', i => 'shelf ' + i);
let incLocal = appendColumn(base, 'local shelf note', i => (i === 3 ? 'MOVED' : 'shelf ' + (base.length - i)));
addSheet('CurLocal', curLocal);
addSheet('IncLocal', incLocal);
check('an unrecognised header present in both sheets is still compared', () => {
  const r = runComparison(Object.assign({}, opts, {
    currentSheet: 'CurLocal', incomingSheet: 'IncLocal'
  }));
  const h = gridHeader();
  if (h.indexOf('Local Shelf Note') < 0) throw new Error('unrecognised column missing from grid: ' + h.join(','));
  if (r.cells <= run.cells) throw new Error('difference in the unrecognised column was not counted');
});
check('unrecognised headers are flagged in the summary', () => {
  const s = summaryText();
  if (!/Headers not in the dictionary :: 2/.test(s)) throw new Error('not flagged');
  if (!/CURRENT   "Local Shelf Note"/.test(s)) throw new Error('current header not listed');
  if (!/INCOMING  "local shelf note"/.test(s)) throw new Error('incoming header not listed');
});
check('the unrecognised column heading is marked in the grid', () => {
  const g = active.getSheetByName('Diff_Grid');
  const col = gridHeader().indexOf('Local Shelf Note') + 1;
  const marked = g.fmt.some(f => f[0] === 'bg' && f[1] === 1 && f[2] === col && f[5] === STYLE.UNKNOWN_HDR_BG);
  if (!marked) throw new Error('heading not highlighted');
  if (!/Not in the CA-R Metadata Dictionary/.test(g.notes['1,' + col] || '')) throw new Error('note missing');
});

// An unrecognised header on one side only must not be silently compared.
addSheet('IncNoLocal', clone(base));
check('an unrecognised header on one side only is reported as uncompared', () => {
  runComparison(Object.assign({}, opts, { currentSheet: 'CurLocal', incomingSheet: 'IncNoLocal' }));
  if (!/Local Shelf Note  \[not in dictionary\]/.test(summaryText())) throw new Error('not reported');
});

/* ---- translation can be turned off ------------------------------------- */

check('with translation off, a human-headed sheet no longer lines up', () => {
  let threw = false;
  let r = null;
  try {
    r = runComparison(Object.assign({}, opts, {
      incomingSheet: 'HumanHeaders', translateHeaders: false
    }));
  } catch (e) { threw = true; }
  if (!threw && r && r.matched === 40) throw new Error('translation appears to still be on');
});

check('ignore entries may be given as human-readable labels', () => {
  const r = runComparison(Object.assign({}, opts, {
    ignoreFields: ['Workflow State', 'Notes to Vendor']
  }));
  if (r.changed !== run.changed || r.cells !== run.cells) {
    throw new Error('human-readable ignore entry did not resolve: ' + r.changed + '/' + r.cells);
  }
});

/* ---- library packaging -------------------------------------------------- */

// The public surface a consuming script is allowed to touch. Everything else
// in Code.js ends in an underscore and is private to the library.
const PUBLIC_API = {
  showCompareDialog, showAbout,
  carmd_getDefaults, carmd_getSpreadsheetInfo, carmd_runComparison,
  getDefaults, getSpreadsheetInfo, runComparison,
  getVersion, setConfig, addHeaderAliases
};

check('every function the dialog calls exists on the public surface', () => {
  const dialog = fs.readFileSync(__dirname + '/../src/Dialog.html', 'utf8');
  const called = (dialog.match(/google\.script\.run[\s\S]*?\.(carmd_\w+)\(/g) || [])
    .map(m => m.match(/(carmd_\w+)\($/)[1]);
  const wanted = ['carmd_getDefaults', 'carmd_getSpreadsheetInfo', 'carmd_runComparison'];
  wanted.forEach(f => {
    if (typeof PUBLIC_API[f] !== 'function') throw new Error(f + ' is not exposed');
  });
  const stray = called.filter(f => wanted.indexOf(f) < 0);
  if (stray.length) throw new Error('dialog calls unexposed function(s): ' + stray.join(', '));
});

check('the stub mirrors every dialog callback', () => {
  const stub = fs.readFileSync(__dirname + '/../stub/Stub.js', 'utf8');
  ['carmd_getDefaults', 'carmd_getSpreadsheetInfo', 'carmd_runComparison', 'onOpen']
    .forEach(f => {
      if (!new RegExp('function\\s+' + f + '\\s*\\(').test(stub)) {
        throw new Error('stub is missing ' + f + ' — the dialog would fail under a library install');
      }
    });
});

check('setConfig rejects an unrecognised key', () => {
  try { setConfig({ IGNOR_FIELDS: [] }); }
  catch (e) {
    if (!/Unknown configuration key/.test(e.message)) throw new Error('wrong error: ' + e.message);
    return;
  }
  throw new Error('a typo in a config key was accepted silently');
});

check('getVersion reports the library version', () => {
  if (!/^\d+\.\d+\.\d+$/.test(getVersion())) throw new Error('got ' + getVersion());
});

// Load the bound stub the way a consuming project would, with the library
// bound to the CARCompare identifier.
function loadStub(lib) {
  const src = fs.readFileSync(__dirname + '/../stub/Stub.js', 'utf8');
  const factory = new Function('CARCompare', 'SpreadsheetApp', src +
    '\nreturn { onOpen: onOpen, showCompareDialog: showCompareDialog, showAbout: showAbout,' +
    ' carmd_getDefaults: carmd_getDefaults, carmd_getSpreadsheetInfo: carmd_getSpreadsheetInfo,' +
    ' carmd_runComparison: carmd_runComparison, carmd_version: carmd_version,' +
    ' INSTALL_CONFIG: INSTALL_CONFIG };');
  return factory(lib, SpreadsheetApp);
}

const savedIgnore = CONFIG.IGNORE_FIELDS;
const stub = loadStub(PUBLIC_API);

check('the stub drives a full comparison through the library surface', () => {
  const r = stub.carmd_runComparison(Object.assign({}, opts, { ignoreFields: [] }));
  if (r.matched !== 40) throw new Error('matched ' + r.matched);
  // INSTALL_CONFIG ignores the two systematic fields, so the stub should reach
  // the same answer as an explicit per-run ignore list.
  if (r.changed !== run.changed || r.cells !== run.cells) {
    throw new Error('INSTALL_CONFIG was not applied: ' + r.changed + '/' + r.cells);
  }
});

check('the stub can add team header aliases', () => {
  const src = fs.readFileSync(__dirname + '/../stub/Stub.js', 'utf8');
  if (!/INSTALL_HEADER_ALIASES/.test(src)) throw new Error('no alias hook in the stub');
  addHeaderAliases({ 'Shelf Location Note': 'obj_call_number' });
  const r = resolveHeader_('shelf location note', true);
  if (r.field !== 'obj_call_number' || r.how !== 'human') throw new Error(JSON.stringify(r));
});

check('the stub reports the library version', () => {
  if (stub.carmd_version() !== getVersion()) throw new Error('version mismatch');
});

setConfig({ IGNORE_FIELDS: savedIgnore });

/* ---- entry-point files are mutually exclusive --------------------------- */

const ENTRY_POINTS = {
  'bound/Bound.js': 'bound install',
  'stub/Stub.js': 'library install',
  'addon/Addon.js': 'add-on install'
};

function topLevelFunctions(src) {
  return (src.match(/^function\s+(\w+)\s*\(/gm) || [])
    .map(m => m.match(/^function\s+(\w+)/)[1]);
}
function topLevelVars(src) {
  return (src.match(/^var\s+(\w+)\s*=/gm) || [])
    .map(m => m.match(/^var\s+(\w+)/)[1]);
}

const engineSrc = fs.readFileSync(__dirname + '/../src/Code.js', 'utf8') + '\n' +
                  fs.readFileSync(__dirname + '/../src/Headers.js', 'utf8');
const engineNames = topLevelFunctions(engineSrc).concat(topLevelVars(engineSrc));

check('the engine defines no onOpen, so each install mode owns its menu', () => {
  if (engineNames.indexOf('onOpen') >= 0) {
    throw new Error('Code.js defines onOpen; it would collide with the entry-point file');
  }
});

Object.keys(ENTRY_POINTS).forEach(file => {
  const src = fs.readFileSync(__dirname + '/../' + file, 'utf8');
  const names = topLevelFunctions(src).concat(topLevelVars(src));

  check(file + ' defines exactly one onOpen', () => {
    const n = names.filter(x => x === 'onOpen').length;
    if (n !== 1) throw new Error('found ' + n);
  });

  check(file + ' collides with nothing in the engine', () => {
    // The library stub lives in its own project, so overlap there is harmless.
    if (file === 'stub/Stub.js') return;
    const clash = names.filter(x => engineNames.indexOf(x) >= 0);
    if (clash.length) {
      throw new Error('duplicate top-level name(s), the later definition would ' +
        'silently win: ' + clash.join(', '));
    }
  });

  check(file + ' exposes settings under the shared INSTALL_ names', () => {
    if (names.indexOf('INSTALL_CONFIG') < 0) throw new Error('no INSTALL_CONFIG');
    if (names.indexOf('INSTALL_HEADER_ALIASES') < 0) throw new Error('no INSTALL_HEADER_ALIASES');
  });
});

check('the add-on uses createAddonMenu and handles the unauthorised open', () => {
  const src = fs.readFileSync(__dirname + '/../addon/Addon.js', 'utf8');
  if (!/createAddonMenu\(\)/.test(src)) throw new Error('not using createAddonMenu');
  if (/\.createMenu\(/.test(src)) throw new Error('createMenu would be relocated on publication');
  if (!/AuthMode\.NONE/.test(src)) throw new Error('no AuthMode.NONE guard');
  if (!/function\s+onInstall\s*\(/.test(src)) throw new Error('no onInstall; menu would be missing until reload');
});

check('the add-on manifest requests the scopes the tool actually uses', () => {
  const m = JSON.parse(fs.readFileSync(__dirname + '/../addon/appsscript.json', 'utf8'));
  const scopes = m.oauthScopes || [];
  if (scopes.indexOf('https://www.googleapis.com/auth/spreadsheets') < 0) {
    throw new Error('cross-file comparison needs the full spreadsheets scope');
  }
  if (scopes.indexOf('https://www.googleapis.com/auth/spreadsheets.currentonly') >= 0) {
    throw new Error('currentonly forbids opening the partner file');
  }
  if (Object.keys(m.dependencies || {}).length) {
    throw new Error('an add-on should not depend on the library — that pins two projects');
  }
});

check('INSTALL_CONFIG is picked up without wrapping anything', () => {
  global.INSTALL_CONFIG = { DIFF_CELL_FORMAT: 'incoming' };
  try {
    applyInstallDefaults_();
    if (CONFIG.DIFF_CELL_FORMAT !== 'incoming') throw new Error('not applied');
  } finally {
    delete global.INSTALL_CONFIG;
    setConfig({ DIFF_CELL_FORMAT: 'both' });
  }
});

/* ---- review sheet and applying changes back ----------------------------- */

function reviewSheet() { return active.getSheetByName('Diff_Review'); }
function reviewRows() { return reviewSheet().data.slice(1).filter(r => r[REVIEW_COL.KEY - 1]); }
function reviewHeader() { return reviewSheet().data[0]; }

// Fresh comparison so the review sheet and apply context match each other.
addSheet('ApplyTarget', clone(active.getSheetByName('Processing').data));
const applyOpts = Object.assign({}, opts, { currentSheet: 'ApplyTarget', incomingSheet: 'Partner' });
const applyRun = runComparison(applyOpts);

function markAll(decision) {
  reviewSheet().data.slice(1).forEach(r => {
    if (r[REVIEW_COL.KEY - 1] && r[REVIEW_COL.APPLY - 1] !== '') {
      r[REVIEW_COL.DECISION - 1] = decision;
    }
  });
}

check('every line starts on skip, so nothing is written unreviewed', () => {
  const decisions = reviewRows().map(r => r[REVIEW_COL.DECISION - 1]);
  if (!decisions.every(d => d === 'skip')) throw new Error('found a line defaulted to apply');
  const p = applyReview_(true);
  if (p.applied !== 0) throw new Error(p.applied + ' cells would be written with no review');
  if (p.skip !== reviewRows().length) throw new Error('skip count ' + p.skip);
});

check('the review sheet has one row per differing cell', () => {
  if (reviewRows().length !== applyRun.cells) {
    throw new Error(reviewRows().length + ' rows for ' + applyRun.cells + ' differing cells');
  }
});

check('current and incoming values sit in their own labelled columns', () => {
  const h = reviewHeader();
  ['current_value', 'incoming_value', 'decision', 'value_to_apply', 'result']
    .forEach(c => { if (h.indexOf(c) < 0) throw new Error('missing column ' + c); });
  const row = reviewRows()[0];
  if (String(row[REVIEW_COL.CUR - 1]).indexOf('CURRENT:') >= 0) {
    throw new Error('values are still combined into one cell');
  }
});

check('value_to_apply is pre-filled with the incoming value', () => {
  reviewRows().forEach(r => {
    if (r[REVIEW_COL.APPLY - 1] !== r[REVIEW_COL.INC - 1]) {
      throw new Error('row ' + r[0] + ' was not pre-filled');
    }
  });
});

check('rows are grouped by field so a repeated edit is judged once', () => {
  const fields = reviewRows().map(r => r[REVIEW_COL.FIELD - 1]);
  const firstSeen = {};
  fields.forEach((f, i) => { if (!(f in firstSeen)) firstSeen[f] = i; });
  fields.forEach((f, i) => {
    // every occurrence of a field must be contiguous with its first
    if (i > 0 && fields[i - 1] !== f && firstSeen[f] !== i) {
      throw new Error('field ' + f + ' is split across the sheet');
    }
  });
});

check('the decision column is a dropdown, not free text', () => {
  const v = reviewSheet().validation;
  if (!v || !v.rule || !v.rule.values) throw new Error('no data validation');
  if (v.rule.values.join(',') !== 'apply,skip') throw new Error('unexpected options');
  if (v.rule.allowInvalid !== false) throw new Error('invalid entries are allowed');
});

check('a dry run reports what would be written without touching the sheet', () => {
  markAll('apply');
  const before = JSON.stringify(active.getSheetByName('ApplyTarget').data);
  const p = applyReview_(true);
  if (!p.dryRun) throw new Error('not flagged as a dry run');
  if (p.applied !== applyRun.cells) throw new Error('expected ' + applyRun.cells + ', got ' + p.applied);
  if (JSON.stringify(active.getSheetByName('ApplyTarget').data) !== before) {
    throw new Error('the dry run modified the target sheet');
  }
});

check('skipped rows are not written', () => {
  const sheet = reviewSheet();
  sheet.data[1][REVIEW_COL.DECISION - 1] = 'skip';
  sheet.data[2][REVIEW_COL.DECISION - 1] = 'skip';
  const p = applyReview_(true);
  if (p.skip !== 2) throw new Error('skip count ' + p.skip);
  if (p.applied !== applyRun.cells - 2) throw new Error('applied ' + p.applied);
  sheet.data[1][REVIEW_COL.DECISION - 1] = 'apply';
  sheet.data[2][REVIEW_COL.DECISION - 1] = 'apply';
});

check('an edited value_to_apply is what gets written, not the incoming value', () => {
  reviewSheet().data[1][REVIEW_COL.APPLY - 1] = 'HAND EDITED';
  applyReview_(false);
  const target = active.getSheetByName('ApplyTarget');
  const row = Number(reviewSheet().data[1][REVIEW_COL.ROW_CUR - 1]);
  const field = reviewSheet().data[1][REVIEW_COL.FIELD - 1];
  const col = target.data[0].indexOf(field) + 1;
  if (target.data[row - 1][col - 1] !== 'HAND EDITED') {
    throw new Error('got ' + target.data[row - 1][col - 1]);
  }
});

check('each review line records its outcome', () => {
  const results = reviewRows().map(r => r[REVIEW_COL.RESULT - 1]);
  if (!results.every(x => /^applied \d{4}-\d{2}-\d{2}/.test(String(x)))) {
    throw new Error('missing or malformed result stamps');
  }
});

check('applying makes the two sheets agree', () => {
  const r = runComparison(applyOpts);
  // Only the hand-edited cell should still differ.
  if (r.cells !== 1) throw new Error(r.cells + ' cells still differ after applying');
});

check('a cell edited since the comparison is reported stale, not overwritten', () => {
  addSheet('StaleTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'StaleTarget' }));
  markAll('apply');
  const target = active.getSheetByName('StaleTarget');
  const rv = reviewSheet();
  const row = Number(rv.data[1][REVIEW_COL.ROW_CUR - 1]);
  const col = target.data[0].indexOf(rv.data[1][REVIEW_COL.FIELD - 1]) + 1;
  target.data[row - 1][col - 1] = 'SOMEONE ELSE EDITED THIS';

  const p = applyReview_(false);
  if (p.stale !== 1) throw new Error('stale count ' + p.stale);
  if (target.data[row - 1][col - 1] !== 'SOMEONE ELSE EDITED THIS') {
    throw new Error('a stale cell was overwritten');
  }
  if (!/^stale —/.test(String(reviewSheet().data[1][REVIEW_COL.RESULT - 1]))) {
    throw new Error('stale row not reported');
  }
});

check('a record deleted from the current sheet is reported, not guessed at', () => {
  addSheet('GoneTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'GoneTarget' }));
  markAll('apply');
  const target = active.getSheetByName('GoneTarget');
  const key = String(reviewSheet().data[1][REVIEW_COL.KEY - 1]);
  const ki = target.data[0].indexOf('node_uuid_no_changes');
  target.data = target.data.filter((r, i) => i === 0 || String(r[ki]) !== key);

  const p = applyReview_(true);
  if (p.missingRecord !== 1) throw new Error('missingRecord ' + p.missingRecord);
});

check('the apply guard refuses an implausibly large write', () => {
  addSheet('GuardTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'GuardTarget' }));
  markAll('apply');
  const saved = CONFIG.MAX_APPLY_CELLS;
  setConfig({ MAX_APPLY_CELLS: 1 });
  try {
    applyReview_(true);
    throw new Error('no guard fired');
  } catch (e) {
    if (!/above the 1 limit/.test(e.message)) throw new Error('wrong error: ' + e.message);
  } finally {
    setConfig({ MAX_APPLY_CELLS: saved });
  }
});

check('applying without a comparison on record fails clearly', () => {
  PropertiesService.getDocumentProperties().deleteProperty('carmd_apply_context');
  try { applyReview_(true); }
  catch (e) {
    if (!/Run "MD update compare" first/.test(e.message)) {
      throw new Error('unhelpful error: ' + e.message);
    }
    return;
  }
  throw new Error('no error raised');
});

check('every entry point offers the apply action', () => {
  Object.keys(ENTRY_POINTS).forEach(file => {
    const src = fs.readFileSync(__dirname + '/../' + file, 'utf8');
    if (!/'applyReviewedChanges'/.test(src)) throw new Error(file + ' has no menu item');
  });
  const stub = fs.readFileSync(__dirname + '/../stub/Stub.js', 'utf8');
  if (!/function\s+applyReviewedChanges\s*\(/.test(stub)) {
    throw new Error('the library stub has no applyReviewedChanges wrapper');
  }
});

/* ---- backup before applying --------------------------------------------- */

function backupsIn(ss) {
  return ss.getSheets().map(s => s.getName()).filter(n => /_backup_/.test(n));
}

check('a backup copy is taken before the first write', () => {
  addSheet('BackupTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'BackupTarget' }));
  markAll('apply');

  const before = backupsIn(active).length;
  const stats = applyReview_(false);
  const made = backupsIn(active).filter(n => /^BackupTarget_backup_/.test(n));
  if (backupsIn(active).length !== before + 1) throw new Error('no backup sheet created');
  if (!stats.backup) throw new Error('backup name not reported');
  if (!/^BackupTarget_backup_\d{4}-\d{2}-\d{2}_\d{4}$/.test(stats.backup)) {
    throw new Error('unexpected backup name: ' + stats.backup);
  }
  if (made.indexOf(stats.backup) < 0) throw new Error('reported name does not match the sheet');
});

check('the backup holds the sheet as it stood before the write', () => {
  const target = active.getSheetByName('BackupTarget');
  const backup = active.getSheetByName(backupsIn(active).filter(n => /^BackupTarget_/.test(n))[0]);
  if (JSON.stringify(backup.data) === JSON.stringify(target.data)) {
    throw new Error('backup matches the post-write sheet, so it was taken too late');
  }
  // The backup must match what the review sheet recorded as current.
  const rv = reviewSheet().data[1];
  const col = backup.data[0].indexOf(rv[REVIEW_COL.FIELD - 1]);
  const row = Number(rv[REVIEW_COL.ROW_CUR - 1]);
  if (String(backup.data[row - 1][col] || '') !== String(rv[REVIEW_COL.CUR - 1] || '')) {
    throw new Error('backup does not hold the pre-write value');
  }
});

check('a dry run takes no backup', () => {
  addSheet('DryTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'DryTarget' }));
  markAll('apply');
  const before = backupsIn(active).length;
  applyReview_(true);
  if (backupsIn(active).length !== before) throw new Error('a dry run created a backup');
});

check('a run with nothing to write takes no backup', () => {
  addSheet('NoopTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'NoopTarget' }));
  const before = backupsIn(active).length;   // every line still on the skip default
  const stats = applyReview_(false);
  if (stats.applied !== 0) throw new Error('expected no writes');
  if (backupsIn(active).length !== before) throw new Error('backed up with nothing to write');
  if (stats.backup) throw new Error('reported a backup that was not taken');
});

check('BACKUP_BEFORE_APPLY can be turned off', () => {
  addSheet('NoBackupTarget', clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: 'NoBackupTarget' }));
  markAll('apply');
  setConfig({ BACKUP_BEFORE_APPLY: false });
  try {
    const before = backupsIn(active).length;
    const stats = applyReview_(false);
    if (backupsIn(active).length !== before) throw new Error('backed up anyway');
    if (stats.backup) throw new Error('reported a backup');
    if (!stats.applied) throw new Error('nothing was written');
  } finally {
    setConfig({ BACKUP_BEFORE_APPLY: true });
  }
});

check('backup names stay inside the 100-character sheet-name limit', () => {
  const longName = 'x'.repeat(95);
  addSheet(longName, clone(active.getSheetByName('Processing').data));
  runComparison(Object.assign({}, applyOpts, { currentSheet: longName }));
  markAll('apply');
  const stats = applyReview_(false);
  if (stats.backup.length > 100) throw new Error('name is ' + stats.backup.length + ' chars');
  if (!/_backup_\d{4}-\d{2}-\d{2}_\d{4}$/.test(stats.backup)) {
    throw new Error('timestamp was trimmed instead of the base name: ' + stats.backup);
  }
});

/* ---- menu wording -------------------------------------------------------- */

check('the menu uses the CA-R labels and no trailing ellipses', () => {
  Object.keys(ENTRY_POINTS).forEach(file => {
    const src = fs.readFileSync(__dirname + '/../' + file, 'utf8');
    if (!/'MD update compare'/.test(src)) throw new Error(file + ': compare item mislabelled');
    if (!/'Apply reviewed MD updates'/.test(src)) throw new Error(file + ': apply item mislabelled');
  });
});

check('no trailing ellipsis survives in any user-facing string', () => {
  ['src/Code.js', 'src/Dialog.html', 'bound/Bound.js', 'stub/Stub.js', 'addon/Addon.js']
    .forEach(file => {
      const src = fs.readFileSync(__dirname + '/../' + file, 'utf8');
      src.split('\n').forEach((line, i) => {
        // Leading ellipses mark elision and are meant to stay; trailing ones read
        // as an unfinished thought.
        if (/…(?!\[truncated)(?!and )/.test(line) && !/…[a-z]/.test(line)) {
          throw new Error(file + ':' + (i + 1) + ' ' + line.trim());
        }
      });
    });
});

/* ---- forgiving whitespace and case -------------------------------------- */

function wsSheet(name, values) {
  const data = [['node_uuid_no_changes', 'label', 'obj_description']];
  values.forEach((v, i) => data.push(['uuid-' + i, v[0], v[1]]));
  addSheet(name, data);
}

const WS_CUR = [
  ['Community Hall for Jenner', 'A description'],
  ['Second Title', 'Brown, Mike Stewart, Architect'],
  ['Third Title', 'Text'],
  ['Fourth Title', 'unchanged']
];
const WS_INC = [
  ['Community Hall for Jenner ', 'A description'],      // trailing space
  ['Second Title', 'Brown, Mike Stewart,  Architect'],  // doubled internal space
  ['Third Title', 'text'],                              // case only
  ['Fourth Title', 'genuinely different']               // a real edit
];

wsSheet('WsCurrent', WS_CUR);
wsSheet('WsIncoming', WS_INC);
const wsOpts = { currentRef: '', currentSheet: 'WsCurrent', incomingRef: '',
                 incomingSheet: 'WsIncoming', keyField: '', headerRow: 1,
                 diffCellFormat: 'both', ignoreFields: [] };

check('exact mode reports every whitespace and case difference', () => {
  const r = runComparison(Object.assign({}, wsOpts,
    { ignoreWhitespace: 'none', ignoreCase: false }));
  if (r.cells !== 4) throw new Error('expected 4 differences, got ' + r.cells);
});

check('edge mode forgives leading and trailing whitespace only', () => {
  const r = runComparison(Object.assign({}, wsOpts,
    { ignoreWhitespace: 'edges', ignoreCase: false }));
  if (r.cells !== 3) throw new Error('expected 3, got ' + r.cells);
  if (!/Differences set aside :: 1/.test(summaryText())) throw new Error('not counted in summary');
  if (!/whitespace only :: 1/.test(summaryText())) throw new Error('kind not reported');
});

check('all mode also forgives repeated internal whitespace', () => {
  const r = runComparison(Object.assign({}, wsOpts,
    { ignoreWhitespace: 'all', ignoreCase: false }));
  if (r.cells !== 2) throw new Error('expected 2, got ' + r.cells);
});

check('ignoring case is independent of whitespace', () => {
  const r = runComparison(Object.assign({}, wsOpts,
    { ignoreWhitespace: 'none', ignoreCase: true }));
  if (r.cells !== 3) throw new Error('expected 3, got ' + r.cells);
  if (!/case only :: 1/.test(summaryText())) throw new Error('case not reported');
});

check('both together leave only the real edit', () => {
  const r = runComparison(Object.assign({}, wsOpts,
    { ignoreWhitespace: 'all', ignoreCase: true }));
  if (r.cells !== 1) throw new Error('expected 1, got ' + r.cells);
  if (!/Differences set aside :: 3/.test(summaryText())) throw new Error('suppression count wrong');
});

check('a forgiven difference is set aside, never silently rewritten', () => {
  runComparison(Object.assign({}, wsOpts, { ignoreWhitespace: 'all', ignoreCase: true }));
  const rows = reviewRows();
  if (rows.length !== 1) throw new Error(rows.length + ' review rows');
  if (rows[0][REVIEW_COL.INC - 1] !== 'genuinely different') {
    throw new Error('wrong row survived: ' + rows[0][REVIEW_COL.INC - 1]);
  }
});

check('values reach the review sheet exactly as they are in the source', () => {
  const r = runComparison(Object.assign({}, wsOpts,
    { ignoreWhitespace: 'none', ignoreCase: false }));
  const row = reviewRows().filter(x => x[REVIEW_COL.FIELD - 1] === 'label')[0];
  if (row[REVIEW_COL.INC - 1] !== 'Community Hall for Jenner ') {
    throw new Error('trailing space was stripped from the displayed value');
  }
  if (row[REVIEW_COL.APPLY - 1] !== 'Community Hall for Jenner ') {
    throw new Error('value_to_apply was normalised — write-back would alter data');
  }
});

check('the summary states the comparison mode in force', () => {
  runComparison(Object.assign({}, wsOpts, { ignoreWhitespace: 'edges', ignoreCase: true }));
  const s = summaryText();
  if (!/leading and trailing whitespace ignored/.test(s)) throw new Error('whitespace mode missing');
  if (!/letter case ignored/.test(s)) throw new Error('case mode missing');
  runComparison(Object.assign({}, wsOpts, { ignoreWhitespace: 'none', ignoreCase: false }));
  if (!/whitespace exact; letter case exact/.test(summaryText())) throw new Error('exact mode missing');
});

/* ---- values are stored as text, not reinterpreted ------------------------ */

check('value columns are forced to plain text before writing', () => {
  runComparison(Object.assign({}, wsOpts, { ignoreWhitespace: 'none' }));
  const f = reviewSheet().formats || {};
  [REVIEW_COL.CUR, REVIEW_COL.INC, REVIEW_COL.APPLY, REVIEW_COL.KEY].forEach(c => {
    if (f['2,' + c] !== '@') {
      throw new Error('column ' + c + ' left on Automatic; Sheets would reinterpret ' +
        '"1970-03-01" as a date and eat any trailing space');
    }
  });
});

check('the grid is forced to plain text too', () => {
  runComparison(Object.assign({}, wsOpts, { ignoreWhitespace: 'none' }));
  const f = active.getSheetByName('Diff_Grid').formats || {};
  if (f['2,1'] !== '@') throw new Error('grid left on Automatic');
});

check('a date-shaped value keeps its exact source form through review', () => {
  addSheet('DateCurrent', [
    ['node_uuid_no_changes', 'obj_created_date__date_free'],
    ['uuid-d1', '1970-03-01']
  ]);
  addSheet('DateIncoming', [
    ['node_uuid_no_changes', 'obj_created_date__date_free'],
    ['uuid-d1', '1970-03-01 ']
  ]);
  const r = runComparison(Object.assign({}, wsOpts,
    { currentSheet: 'DateCurrent', incomingSheet: 'DateIncoming', ignoreWhitespace: 'none' }));
  if (r.cells !== 1) throw new Error('expected the trailing space to be a difference');
  const row = reviewRows()[0];
  if (row[REVIEW_COL.CUR - 1] !== '1970-03-01') throw new Error('current value altered');
  if (row[REVIEW_COL.INC - 1] !== '1970-03-01 ') throw new Error('trailing space lost');
});

setConfig({ IGNORE_WHITESPACE: 'none', IGNORE_CASE: false });

/* ---- a key that never matches must not read as a clean run --------------- */

function keySheet(name, header, rows) {
  addSheet(name, [header].concat(rows));
}

// Both sides carry a full obj_temporary_id column, but the naming conventions
// differ, so not one value appears in both. This is the cajecc case.
keySheet('ConvCurrent', ['obj_temporary_id', 'label'], [
  ['J003-D.pdf', 'Title three'], ['J006-D.pdf', 'Title six'], ['J007-D.pdf', 'Title seven']
]);
keySheet('ConvIncoming', ['obj_temporary_id', 'label'], [
  ['J003-D_prsv.pdf', 'Title three EDITED'], ['J006-D_prsv.pdf', 'Title six'],
  ['J007-D_prsv.pdf', 'Title seven']
]);

const convOpts = { currentRef: '', currentSheet: 'ConvCurrent', incomingRef: '',
                   incomingSheet: 'ConvIncoming', keyField: '', headerRow: 1,
                   diffCellFormat: 'both', ignoreFields: [] };

check('a populated key whose values never meet is not used unprompted', () => {
  const r = runComparison(Object.assign({}, convOpts));
  if (!r.needsConsent) throw new Error('a key with zero overlap was used without asking');
  if (!/no value appears in both/.test(r.proposal.reason)) throw new Error('reason not explained');
});

check('nothing is written while consent is outstanding', () => {
  addSheet('Diff_Grid', [['sentinel']]);
  const r = runComparison(Object.assign({}, convOpts));
  if (!r.needsConsent) throw new Error('expected a consent request');
  if (active.getSheetByName('Diff_Grid').data[0][0] !== 'sentinel') {
    throw new Error('output was written before consent');
  }
});

check('a key with no describable fix still fails outright', () => {
  keySheet('WildA', ['obj_temporary_id', 'label'], [['alpha', '1'], ['beta', '2']]);
  keySheet('WildB', ['obj_temporary_id', 'label'], [['zulu', '1'], ['yankee', '2']]);
  try {
    runComparison(Object.assign({}, convOpts, { currentSheet: 'WildA', incomingSheet: 'WildB' }));
  } catch (e) {
    if (!/No usable matching key/.test(e.message)) throw new Error('wrong error: ' + e.message);
    return;
  }
  throw new Error('unrelated keys produced a proposal');
});

check('forcing a key overrides the overlap check', () => {
  const r = runComparison(Object.assign({}, convOpts, { keyField: 'obj_temporary_id' }));
  if (r.matched !== 0) throw new Error('expected 0 matches, got ' + r.matched);
});

check('a zero-match run says so instead of reporting a clean result', () => {
  runComparison(Object.assign({}, convOpts, { keyField: 'obj_temporary_id' }));
  const grid = String(active.getSheetByName('Diff_Grid').data[0][0]);
  if (/^No differences found/.test(grid)) {
    throw new Error('a failed match reads as a clean run: ' + grid);
  }
  if (!/NOTHING MATCHED/.test(grid)) throw new Error('grid message: ' + grid);
  const rv = String(reviewSheet().data[0][0]);
  if (!/NOTHING MATCHED/.test(rv)) throw new Error('review message: ' + rv);
  const sum = summaryText();
  if (!/NOTHING MATCHED/.test(sum)) throw new Error('summary has no banner');
  if (sum.indexOf('NOTHING MATCHED') > sum.indexOf('MATCHING KEY')) {
    throw new Error('the banner is buried below the run details');
  }
});

check('a genuinely clean run still reads as clean', () => {
  keySheet('CleanA', ['obj_temporary_id', 'label'], [['J003-D.pdf', 'Same']]);
  keySheet('CleanB', ['obj_temporary_id', 'label'], [['J003-D.pdf', 'Same']]);
  const r = runComparison(Object.assign({}, convOpts,
    { currentSheet: 'CleanA', incomingSheet: 'CleanB' }));
  if (r.cells !== 0) throw new Error('expected no differences');
  const grid = String(active.getSheetByName('Diff_Grid').data[0][0]);
  if (!/^No differences found across 1 matched record/.test(grid)) {
    throw new Error('clean run mislabelled: ' + grid);
  }
  if (/NOTHING MATCHED/.test(summaryText())) throw new Error('false alarm on a clean run');
});

check('a partial match rate is flagged', () => {
  keySheet('HalfA', ['obj_temporary_id', 'label'],
    [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']]);
  keySheet('HalfB', ['obj_temporary_id', 'label'],
    [['a', '1'], ['x', '2'], ['y', '3'], ['z', '4']]);
  runComparison(Object.assign({}, convOpts, { currentSheet: 'HalfA', incomingSheet: 'HalfB' }));
  const sum = summaryText();
  if (!/LOW MATCH RATE/.test(sum)) throw new Error('25% match rate not flagged');
  if (!/25% of the smaller sheet/.test(sum)) throw new Error('rate not reported');
});

check('the key trail records why each candidate was rejected', () => {
  try { runComparison(Object.assign({}, convOpts)); } catch (e) { /* expected */ }
  keySheet('TrailA', ['obj_temporary_id', 'obj_call_number', 'label'], [['a', '', '1']]);
  keySheet('TrailB', ['obj_temporary_id', 'obj_call_number', 'label'], [['a', '', '2']]);
  runComparison(Object.assign({}, convOpts, { currentSheet: 'TrailA', incomingSheet: 'TrailB' }));
  const sum = summaryText();
  if (!/node_uuid_no_changes — not present in either sheet/.test(sum)) {
    throw new Error('missing-key reason not recorded');
  }
  if (!/obj_call_number — present but empty in both sheets/.test(sum)) {
    throw new Error('empty-key reason not recorded');
  }
  if (!/obj_temporary_id — used .*values appear in both/.test(sum)) {
    throw new Error('overlap count not recorded');
  }
});

/* ---- consenting to key normalisation ------------------------------------ */

const proposal = runComparison(Object.assign({}, convOpts)).proposal;

check('the proposal names the field and the omissions in plain words', () => {
  if (proposal.field !== 'obj_temporary_id') throw new Error('field ' + proposal.field);
  const labels = proposal.steps.map(s => s.label).join(' | ');
  // Both sides already end .pdf here, so dropping extensions would pair
  // nothing extra and should not be proposed. Only the convention marker is.
  if (!/Remove "prsv" from incoming keys/.test(labels)) throw new Error('token not found: ' + labels);
  if (/Ignore file extensions/.test(labels)) {
    throw new Error('an omission that pairs no extra records was proposed: ' + labels);
  }
  proposal.steps.forEach(s => {
    if (!s.detail || s.detail.length < 20) throw new Error('step "' + s.label + '" has no explanation');
  });
});

check('the proposal states how many records it would pair', () => {
  if (proposal.overlap !== 3) throw new Error('overlap ' + proposal.overlap);
  if (proposal.rate !== 100) throw new Error('rate ' + proposal.rate);
  if (proposal.currentRows !== 3 || proposal.incomingRows !== 3) throw new Error('row counts wrong');
});

check('the proposal shows worked examples', () => {
  if (!proposal.examples.length) throw new Error('no examples');
  const e = proposal.examples[0];
  if (!e.cur || !e.inc || !e.as) throw new Error('example is incomplete');
  if (e.cur === e.inc) throw new Error('example does not demonstrate a difference');
});

check('consenting runs the comparison with the agreed rules', () => {
  const r = runComparison(Object.assign({}, convOpts, { keyRules: proposal.ruleIds }));
  if (r.needsConsent) throw new Error('asked again after consent');
  if (r.matched !== 3) throw new Error('matched ' + r.matched);
  if (r.cells !== 1) throw new Error('expected the single label edit, got ' + r.cells);
});

check('an unknown rule id is refused rather than guessed at', () => {
  try { runComparison(Object.assign({}, convOpts, { keyRules: ['token:incoming:../etc'] })); }
  catch (e) {
    if (!/Unknown key normalisation rule|No usable matching key/.test(e.message)) {
      throw new Error('wrong error: ' + e.message);
    }
    return;
  }
  throw new Error('an arbitrary rule id was accepted');
});

/* ---- the proposed-matches tab ------------------------------------------- */

function keyMatchSheet() { return active.getSheetByName('Diff_KeyMatches'); }
function keyMatchRows() { return keyMatchSheet().data.slice(1); }

check('a matches tab is written whenever normalisation is used', () => {
  runComparison(Object.assign({}, convOpts, { keyRules: proposal.ruleIds }));
  const h = keyMatchSheet().data[0];
  ['status', 'current_obj_temporary_id', 'incoming_obj_temporary_id', 'matched_as',
   'row_current', 'row_incoming'].forEach(c => {
    if (h.indexOf(c) < 0) throw new Error('missing column ' + c);
  });
});

check('both original key values are shown, in separate columns', () => {
  const row = keyMatchRows()[0];
  if (row[2] !== 'J003-D.pdf') throw new Error('current key: ' + row[2]);
  if (row[3] !== 'J003-D_prsv.pdf') throw new Error('incoming key: ' + row[3]);
  if (row[4] === row[2] || row[4] === row[3]) throw new Error('matched_as should be the normalised form');
});

check('every pairing appears, with its source rows', () => {
  const rows = keyMatchRows().filter(r => r[1] === 'matched');
  if (rows.length !== 3) throw new Error(rows.length + ' matched rows');
  rows.forEach(r => {
    if (!r[5] || !r[6]) throw new Error('a pairing is missing its row numbers');
  });
});

check('records that did not pair are listed too, not just the successes', () => {
  keySheet('OddCurrent', ['obj_temporary_id', 'label'],
    [['J003-D.pdf', 'a'], ['J004-D.pdf', 'b'], ['J005-D.pdf', 'c'], ['J999-D.pdf', 'orphan']]);
  keySheet('OddIncoming', ['obj_temporary_id', 'label'],
    [['J003-D_prsv.pdf', 'a'], ['J004-D_prsv.pdf', 'b'], ['J005-D_prsv.pdf', 'c'],
     ['J888-D_prsv.pdf', 'newcomer']]);
  const p = runComparison(Object.assign({}, convOpts,
    { currentSheet: 'OddCurrent', incomingSheet: 'OddIncoming' })).proposal;
  runComparison(Object.assign({}, convOpts,
    { currentSheet: 'OddCurrent', incomingSheet: 'OddIncoming', keyRules: p.ruleIds }));
  const st = keyMatchRows().map(r => r[1]);
  if (st.filter(x => x === 'matched').length !== 3) throw new Error('matched count');
  if (st.indexOf('current only') < 0) throw new Error('unpaired current record not listed');
  if (st.indexOf('incoming only') < 0) throw new Error('unpaired incoming record not listed');
});

check('the summary records that normalisation was used and why', () => {
  runComparison(Object.assign({}, convOpts, { keyRules: proposal.ruleIds }));
  const sum = summaryText();
  if (!/KEY NORMALISATION/.test(sum)) throw new Error('no section');
  if (!/Applied with consent/.test(sum)) throw new Error('consent not recorded');
  if (!/Remove "prsv" from incoming keys/.test(sum)) throw new Error('rules not listed');
  if (!/Diff_KeyMatches/.test(sum)) throw new Error('does not point at the matches tab');
});

check('a normal run writes no matches tab', () => {
  const before = active.getSheetByName('Diff_KeyMatches');
  if (before) active.sheets.splice(active.sheets.indexOf(before), 1);
  runComparison(Object.assign({}, convOpts, { currentSheet: 'CleanA', incomingSheet: 'CleanB' }));
  if (active.getSheetByName('Diff_KeyMatches')) {
    throw new Error('matches tab written when no normalisation was needed');
  }
});

check('write-back uses the same normalisation the comparison did', () => {
  keySheet('ApplyCur', ['obj_temporary_id', 'label'],
    [['J003-D.pdf', 'old title'], ['J004-D.pdf', 'x'], ['J005-D.pdf', 'y']]);
  keySheet('ApplyInc', ['obj_temporary_id', 'label'],
    [['J003-D_prsv.pdf', 'new title'], ['J004-D_prsv.pdf', 'x'], ['J005-D_prsv.pdf', 'y']]);
  const p = runComparison(Object.assign({}, convOpts,
    { currentSheet: 'ApplyCur', incomingSheet: 'ApplyInc' })).proposal;
  runComparison(Object.assign({}, convOpts,
    { currentSheet: 'ApplyCur', incomingSheet: 'ApplyInc', keyRules: p.ruleIds }));
  reviewSheet().data[1][REVIEW_COL.DECISION - 1] = 'apply';
  const stats = applyReview_(false);
  if (stats.applied !== 1) throw new Error('applied ' + stats.applied + ', stale ' + stats.stale +
    ', missing ' + stats.missingRecord);
  if (active.getSheetByName('ApplyCur').data[1][1] !== 'new title') throw new Error('not written');
});

check('the dialog handles the consent round trip', () => {
  const html = fs.readFileSync(__dirname + '/../src/Dialog.html', 'utf8');
  if (!/needsConsent/.test(html)) throw new Error('dialog ignores the consent response');
  if (!/keyRules: agreedRules/.test(html)) throw new Error('dialog never sends the agreed rules back');
  if (!/askConsent/.test(html)) throw new Error('no consent panel');
  // The proposal must be shown, not auto-accepted.
  if (/keyRules: p\.ruleIds/.test(html)) throw new Error('dialog accepts the proposal without asking');
});

check('only omissions that pair extra records are proposed', () => {
  // "draft" is on every incoming key and no current key, but removing it pairs
  // nothing extra because the identifiers themselves still disagree.
  keySheet('NoiseA', ['obj_temporary_id', 'label'],
    [['J003-D.pdf', 'a'], ['J004-D.pdf', 'b'], ['J005-D.pdf', 'c'], ['J006-D.pdf', 'd']]);
  keySheet('NoiseB', ['obj_temporary_id', 'label'],
    [['J003-D_prsv_draft.pdf', 'a'], ['J004-D_prsv_draft.pdf', 'b'],
     ['J005-D_prsv_draft.pdf', 'c'], ['J006-D_prsv_draft.pdf', 'd']]);
  const p = runComparison(Object.assign({}, convOpts,
    { currentSheet: 'NoiseA', incomingSheet: 'NoiseB' })).proposal;
  // Neither prsv nor draft pairs anything alone; both are needed together.
  if (p.overlap !== 4) throw new Error('overlap ' + p.overlap);
  p.steps.forEach(s => {
    if (!/Remove|Ignore/.test(s.label)) throw new Error('odd step: ' + s.label);
  });
});

check('the number of proposed omissions is capped', () => {
  const saved = CONFIG.MAX_KEY_RULES;
  setConfig({ MAX_KEY_RULES: 1 });
  try {
    keySheet('CapA', ['obj_temporary_id', 'label'], [['J003-D', 'a']]);
    keySheet('CapB', ['obj_temporary_id', 'label'], [['J003-D_prsv_copy_v2', 'a']]);
    const r = runComparison(Object.assign({}, convOpts,
      { currentSheet: 'CapA', incomingSheet: 'CapB' }));
    if (r.proposal && r.proposal.steps.length > 2) {
      throw new Error(r.proposal.steps.length + ' omissions proposed under a cap of 1');
    }
  } catch (e) {
    if (!/No usable matching key|omissions proposed/.test(e.message)) throw e;
    if (/omissions proposed/.test(e.message)) throw e;
  } finally {
    setConfig({ MAX_KEY_RULES: saved });
  }
});

check('a token rule states its measured frequency, not an assumption', () => {
  const step = proposal.steps.filter(s => /prsv/.test(s.label))[0];
  if (!/\d+% of incoming keys and \d+% of current ones/.test(step.detail)) {
    throw new Error('frequency not reported: ' + step.detail);
  }
});

check('a token belonging to one record is never treated as a convention', () => {
  // J999 exists only in current, J888 only in incoming. Removing both would
  // pair two unrelated records that then agree on nothing but their shape.
  keySheet('TrapCurrent', ['obj_temporary_id', 'label'],
    [['J003-D.pdf', 'a'], ['J004-D.pdf', 'b'], ['J005-D.pdf', 'c'], ['J999-D.pdf', 'orphan']]);
  keySheet('TrapIncoming', ['obj_temporary_id', 'label'],
    [['J003-D_prsv.pdf', 'a'], ['J004-D_prsv.pdf', 'b'], ['J005-D_prsv.pdf', 'c'],
     ['J888-D_prsv.pdf', 'newcomer']]);
  const p = runComparison(Object.assign({}, convOpts,
    { currentSheet: 'TrapCurrent', incomingSheet: 'TrapIncoming' })).proposal;
  const labels = p.steps.map(s => s.label).join(' | ');
  if (/j999|j888/i.test(labels)) throw new Error('a record identifier was proposed for removal: ' + labels);
  if (p.overlap !== 3) throw new Error('overlap ' + p.overlap + ' — the orphans should not pair');

  runComparison(Object.assign({}, convOpts,
    { currentSheet: 'TrapCurrent', incomingSheet: 'TrapIncoming', keyRules: p.ruleIds }));
  const paired = keyMatchRows().filter(r => r[1] === 'matched');
  if (paired.some(r => /J999|J888/.test(String(r[2]) + String(r[3])))) {
    throw new Error('the orphan records were falsely paired');
  }
});

check('the proposal reports how many records it would make ambiguous', () => {
  if (proposal.ambiguous === undefined) throw new Error('not reported');
  if (proposal.ambiguous !== 0) throw new Error('clean fixture reported as ambiguous');
});

keySheet('MergeCurrent', ['obj_temporary_id', 'label'],
  [['J003-D.pdf', 'a'], ['J004-D.pdf', 'b'], ['J005-D.pdf', 'c']]);
keySheet('MergeIncoming', ['obj_temporary_id', 'label'],
  [['J003-D_prsv.pdf', 'a'], ['J003-D_prsv.tif', 'a2'],
   ['J004-D_prsv.pdf', 'b'], ['J005-D_prsv.pdf', 'c']]);
const mergeOpts = Object.assign({}, convOpts,
  { currentSheet: 'MergeCurrent', incomingSheet: 'MergeIncoming' });

check('pruning prefers the rule set that does not merge distinct records', () => {
  const p = runComparison(Object.assign({}, mergeOpts)).proposal;
  const labels = p.steps.map(s => s.label).join(' | ');
  if (/Ignore file extensions/.test(labels)) {
    throw new Error('kept an omission that merges two incoming rows for no extra pairing');
  }
  if (p.ambiguous !== 0) throw new Error('the proposed set is ambiguous: ' + p.ambiguous);
});

check('ambiguity is measured and reported when the rules do merge records', () => {
  // Force the broader set the pruning declined, and confirm the cost is counted.
  const forced = ['extension', 'token:incoming:prsv'];
  runComparison(Object.assign({}, mergeOpts, { keyRules: forced }));
  const st = keyMatchRows().map(r => String(r[1]));
  if (!st.some(x => /^ambiguous/.test(x))) {
    throw new Error('two incoming rows collapsed to one key without being flagged');
  }
});

check('the consent panel surfaces the ambiguity count', () => {
  const html = fs.readFileSync(__dirname + '/../src/Dialog.html', 'utf8');
  if (!/ambiguous/.test(html)) throw new Error('the dialog never mentions ambiguity');
});

/* ---- multi-value delimiter spacing --------------------------------------- */

function mvSheet(name, rows) {
  const data = [['node_uuid_no_changes', 'obj_creator__name_label_creator_role',
                 'obj_call_number', 'obj_significance']];
  rows.forEach((r, i) => data.push(['mv-' + i, r[0], r[1] === undefined ? '' : r[1],
                                    r[2] === undefined ? '' : r[2]]));
  addSheet(name, data);
}

const mvOpts = { currentRef: '', currentSheet: 'MvCurrent', incomingRef: '',
                 incomingSheet: 'MvIncoming', keyField: '', headerRow: 1,
                 diffCellFormat: 'both', ignoreFields: [],
                 ignoreWhitespace: 'none', ignoreCase: false };

check('a missing space after the delimiter is not a difference', () => {
  mvSheet('MvCurrent', [['Russian River News, De Salvio, John;The West Sonoma County Paper, Roth, Tom.']]);
  mvSheet('MvIncoming', [['Russian River News, De Salvio, John; The West Sonoma County Paper, Roth, Tom.']]);
  const r = runComparison(Object.assign({}, mvOpts, { multivalueSpacing: true }));
  if (r.cells !== 0) throw new Error(r.cells + ' differences reported');
  if (!/multi-value delimiter spacing only :: 1/.test(summaryText())) {
    throw new Error('not reported as set aside');
  }
});

check('turning the setting off restores the strict comparison', () => {
  const r = runComparison(Object.assign({}, mvOpts, { multivalueSpacing: false }));
  if (r.cells !== 1) throw new Error('expected the spacing to count, got ' + r.cells);
});

check('spacing on either side of the delimiter is forgiven', () => {
  mvSheet('MvCurrent', [['A ;B'], ['A; B'], ['A ; B']]);
  mvSheet('MvIncoming', [['A;B'], ['A;B'], ['A;B']]);
  const r = runComparison(Object.assign({}, mvOpts, { multivalueSpacing: true }));
  if (r.cells !== 0) throw new Error(r.cells + ' differences');
});

check('a genuine change to a list member is still reported', () => {
  mvSheet('MvCurrent', [['Smith, J;Jones, K']]);
  mvSheet('MvIncoming', [['Smith, J; Jones, Karen']]);
  const r = runComparison(Object.assign({}, mvOpts, { multivalueSpacing: true }));
  if (r.cells !== 1) throw new Error('a real edit was suppressed');
});

check('adding or removing a list member is still reported', () => {
  mvSheet('MvCurrent', [['Smith, J;Jones, K']]);
  mvSheet('MvIncoming', [['Smith, J;Jones, K;Brown, L']]);
  const r = runComparison(Object.assign({}, mvOpts, { multivalueSpacing: true }));
  if (r.cells !== 1) throw new Error('a new list member was suppressed');
});

check('reordering list members is still reported', () => {
  mvSheet('MvCurrent', [['Smith, J;Jones, K']]);
  mvSheet('MvIncoming', [['Jones, K;Smith, J']]);
  const r = runComparison(Object.assign({}, mvOpts, { multivalueSpacing: true }));
  if (r.cells !== 1) throw new Error('reordering was treated as equivalent');
});

check('single-value fields are untouched by the setting', () => {
  // obj_call_number is multi-value, obj_significance is not; use a field the
  // dictionary calls single-valued and confirm its spacing still counts.
  const L = headerLookup_();
  const single = Object.keys(L.humanOf).filter(f => !L.delimiterOf[f])[0];
  if (!single) throw new Error('no single-value field in the dictionary');
  addSheet('SvCurrent', [['node_uuid_no_changes', single], ['sv-1', 'A;B']]);
  addSheet('SvIncoming', [['node_uuid_no_changes', single], ['sv-1', 'A; B']]);
  const r = runComparison(Object.assign({}, mvOpts,
    { currentSheet: 'SvCurrent', incomingSheet: 'SvIncoming', multivalueSpacing: true }));
  if (r.cells !== 1) throw new Error('spacing was forgiven in a single-value field');
});

check('leading and trailing whitespace stays governed by IGNORE_WHITESPACE', () => {
  mvSheet('MvCurrent', [['Smith, J;Jones, K']]);
  mvSheet('MvIncoming', [['Smith, J;Jones, K ']]);   // trailing space on the whole value
  let r = runComparison(Object.assign({}, mvOpts,
    { multivalueSpacing: true, ignoreWhitespace: 'none' }));
  if (r.cells !== 1) throw new Error('multi-value spacing swallowed a trailing space');
  r = runComparison(Object.assign({}, mvOpts,
    { multivalueSpacing: true, ignoreWhitespace: 'edges' }));
  if (r.cells !== 0) throw new Error('edge trimming did not apply');
});

check('a value with no delimiter in it is left completely alone', () => {
  mvSheet('MvCurrent', [['Smith, J']]);
  mvSheet('MvIncoming', [[' Smith, J']]);
  const r = runComparison(Object.assign({}, mvOpts,
    { multivalueSpacing: true, ignoreWhitespace: 'none' }));
  if (r.cells !== 1) throw new Error('a single value was trimmed by the multi-value rule');
});

check('the delimiter map comes from the dictionary, not a hardcoded list', () => {
  const L = headerLookup_();
  if (L.multivalueCount < 300) throw new Error('only ' + L.multivalueCount + ' multi-value fields');
  if (!L.delimiterOf['obj_creator__name_label_creator_role']) throw new Error('creator roles missing');
  if (!L.delimiterOf['obj_subject__topic']  && !L.delimiterOf['obj_spatial_coverage__label']) {
    throw new Error('subject and spatial coverage both missing from the map');
  }
  const src = fs.readFileSync(__dirname + '/../src/Headers.js', 'utf8');
  if (!/FIELD_DELIMITERS/.test(src)) throw new Error('delimiters are not generated');
});

check('pilcrow fields treat a line break as the delimiter', () => {
  const L = headerLookup_();
  const pil = Object.keys(L.delimiterOf).filter(f => L.delimiterOf[f] === '\u00b6')[0];
  if (!pil) throw new Error('no pilcrow field in the dictionary');
  addSheet('PilCurrent', [['node_uuid_no_changes', pil], ['p-1', 'one\ntwo']]);
  addSheet('PilIncoming', [['node_uuid_no_changes', pil], ['p-1', 'one \ntwo']]);
  const r = runComparison(Object.assign({}, mvOpts,
    { currentSheet: 'PilCurrent', incomingSheet: 'PilIncoming',
      multivalueSpacing: true, ignoreWhitespace: 'none' }));
  if (r.cells !== 0) throw new Error('line-break spacing not forgiven');
});

setConfig({ MULTIVALUE_DELIMITER_SPACING: true, IGNORE_WHITESPACE: 'none', IGNORE_CASE: false });

console.log(failures ? '\n' + failures + ' failure(s)' : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
