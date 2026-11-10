/**
 * CA-R Metadata Sheet Comparator
 * ------------------------------------------------------------------
 * Key-matched, order-independent comparison of two metadata sheets.
 *
 * Compares a CURRENT sheet (California Revealed processing metadata) against
 * an INCOMING sheet (partner-returned corrections). Rows are matched on a
 * stable key rather than position, and columns are matched by header name
 * rather than position, so either sheet may be sorted or reordered freely.
 *
 * Version: 1.0.0
 * License: MIT
 */

var VERSION = '1.0.0';

var CONFIG = {
  // Row number (1-indexed) that holds the machine-readable column headers.
  HEADER_ROW: 1,

  // Record matching key, in priority order. The first field present in BOTH
  // sheets (and populated in both) is used.
  KEY_FIELDS: ['node_uuid_no_changes', 'obj_call_number', 'obj_temporary_id'],

  // Keys are always trimmed before matching. Set true to also require an
  // exact case match on the key value.
  KEY_MATCH_CASE_SENSITIVE: false,

  // How much whitespace difference to forgive when deciding whether two
  // values match:
  //   'none'  exact — a trailing space is a difference
  //   'edges' ignore leading and trailing whitespace
  //   'all'   ignore leading and trailing, and collapse internal runs of
  //           whitespace to a single space
  //
  // This only affects the MATCH test. Values reach the review sheet exactly as
  // they are in the source, and value_to_apply still writes the incoming value
  // verbatim. Suppressed differences are counted in the summary rather than
  // vanishing silently.
  IGNORE_WHITESPACE: 'none',

  // Forgive letter-case differences in the same way.
  IGNORE_CASE: false,

  // For fields the CA-R Metadata Dictionary marks as multi-value, ignore
  // spacing around the delimiter, so that "Smith, J;Jones, K" and
  // "Smith, J; Jones, K" read as the same list. Whether a space follows the
  // semicolon is a typing habit, not a metadata change, and it is common
  // enough in partner returns to bury everything else.
  //
  // Only the values are compared this way. Nothing is rewritten, and the
  // delimiter for each field comes from the dictionary rather than a list
  // maintained here.
  MULTIVALUE_DELIMITER_SPACING: true,

  // Fields never compared. Useful for internal-only columns that the partner
  // sheet will never carry current values for, e.g.:
  //   ['obj_workflow_state__label', 'obj_notes_to_vendor', 'obj_qc_state']
  // These can also be set per-run in the dialog. Human-readable names work
  // here too: 'Workflow State' resolves to obj_workflow_state__label.
  IGNORE_FIELDS: [],

  // Resolve human-readable column headers ("Call Number") to their
  // machine-readable equivalents ("obj_call_number") using the CA-R Metadata
  // Dictionary map in Headers.js, so a sheet labelled one way can be compared
  // against a sheet labelled the other way. Headers the dictionary does not
  // recognise are kept as-is and still compared.
  TRANSLATE_HEADERS: true,

  // Diff cell contents: 'both' | 'incoming' | 'current'
  //   both     -> two lines, CURRENT: ... / INCOMING: ...
  //   incoming -> partner value only (paste-ready correction grid)
  //   current  -> existing value only
  DIFF_CELL_FORMAT: 'both',

  // Rendered in place of an empty value so blank-vs-populated is visible.
  EMPTY_TOKEN: '(empty)',

  // A field differing on at least this share of matched records is flagged in
  // the summary as systematic (i.e. probably an internal field, not a partner
  // correction).
  SYSTEMATIC_THRESHOLD: 0.5,

  // Values longer than this are truncated in the grid (Sheets caps cells at
  // 50,000 characters; long fields like obj_significance are unreadable inline).
  MAX_CELL_CHARS: 4000,

  // Ceiling for values carried into the review sheet, where they must stay
  // verbatim because the apply step writes them back. Sheets caps a cell at
  // 50,000 characters; anything above this is marked and forced to skip.
  MAX_APPLY_CHARS: 45000,

  // Output tab names. Existing tabs with these names are cleared and reused.
  GRID_SHEET: 'Diff_Grid',
  SUMMARY_SHEET: 'Diff_Summary',
  REVIEW_SHEET: 'Diff_Review',

  // Written only when key normalisation was used, so the pairings it produced
  // can be audited rather than taken on trust.
  KEY_MATCH_SHEET: 'Diff_KeyMatches',

  // The grid is the at-a-glance view; the review sheet is the working one.
  // Set false to skip the grid entirely.
  WRITE_GRID: true,

  // What the decision column starts on: 'apply' or 'skip'. Defaults to 'skip',
  // so nothing is written until it has been looked at and marked. Set to
  // 'apply' if you would rather tick the exceptions than the acceptances.
  DEFAULT_DECISION: 'skip',

  // Duplicate the target tab before the first write of an apply run, as
  // <name>_backup_YYYY-MM-DD_HHMM in the same spreadsheet. No writes, no
  // backup. Sheets version history covers script writes too, but a named tab
  // sitting next to the original is easier to reach for and easier to diff.
  BACKUP_BEFORE_APPLY: true,

  // A token must appear in at least this many keys before it can be treated
  // as a convention marker. Without a floor, a token belonging to a single
  // record looks exactly like a convention on a small sheet, and removing it
  // pairs two unrelated records that then agree on nothing but their shape.
  MIN_KEY_RULE_SUPPORT: 3,

  // Ceiling on how many convention markers key normalisation may propose.
  // More than a few omissions stops being a naming difference and starts
  // being a guess.
  MAX_KEY_RULES: 3,

  // Flag the run in the summary when fewer than this share of the smaller
  // sheet's records found a partner. A low rate almost always means the key is
  // wrong rather than that the sheets genuinely diverge.
  LOW_MATCH_WARNING: 0.5,

  // Refuse to write more than this many cells in one apply run. A guard against
  // a mis-set decision column rewriting a sheet wholesale.
  MAX_APPLY_CELLS: 2000,

  // Cap on how many unmatched / duplicate keys are listed in the summary.
  MAX_LIST_ITEMS: 250
};

var STYLE = {
  HEADER_BG: '#1c3d5a',
  HEADER_FG: '#ffffff',
  SECTION_BG: '#dce6f1',
  DIFF_BG: '#fff2cc',
  WARN_BG: '#fce4d6',
  KEY_BG: '#f2f2f2',
  MATCH_BG: '#e2efda',
  UNKNOWN_HDR_BG: '#8a5a00',
  APPLY_BG: '#e2efda'
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */
/*
 * These are the entry points a consuming script may call. Everything else in
 * this file ends in an underscore and is private to the library.
 *
 * When this project is deployed as an Apps Script library, a dialog opened by
 * the library resolves its google.script.run calls against the CONSUMING
 * script, not against the library. The carmd_* names below therefore have to
 * be mirrored by thin wrappers in the bound stub — see stub/Stub.js. Keeping
 * the dialog on prefixed names avoids colliding with anything else the team
 * already has in a bound project.
 */

function carmd_getDefaults() { applyInstallDefaults_(); return getDefaults(); }
function carmd_getSpreadsheetInfo(ref) { applyInstallDefaults_(); return getSpreadsheetInfo(ref); }
function carmd_runComparison(params) { applyInstallDefaults_(); return runComparison(params); }

/** Library version, so a consumer can report which build produced a report. */
function getVersion() { return VERSION; }

/**
 * Overrides CONFIG for the current execution. Team-wide defaults belong here,
 * set from the bound stub, rather than in a forked copy of this file.
 *
 *   CARCompare.setConfig({ IGNORE_FIELDS: ['Workflow State', 'Notes to Vendor'] });
 *
 * Apps Script runs each server call in a fresh execution, so the stub must
 * apply these at the top of every entry point it exposes.
 */
function setConfig(overrides) {
  if (!overrides) return CONFIG;
  for (var k in overrides) {
    if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
    if (!Object.prototype.hasOwnProperty.call(CONFIG, k)) {
      throw new Error('Unknown configuration key "' + k + '". Valid keys: ' +
        Object.keys(CONFIG).join(', '));
    }
    CONFIG[k] = overrides[k];
  }
  HEADER_LOOKUP = null;   // aliases may have changed
  return CONFIG;
}

/** Adds header aliases at run time, for team-specific partner spellings. */
function addHeaderAliases(aliases) {
  if (typeof HEADER_ALIASES === 'undefined') return;
  for (var k in aliases) {
    if (Object.prototype.hasOwnProperty.call(aliases, k)) HEADER_ALIASES[k] = aliases[k];
  }
  HEADER_LOOKUP = null;
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */
/*
 * onOpen lives in the install-mode file, not here, because the three install
 * modes need three different menus and Apps Script silently lets the last
 * definition of a duplicated function name win:
 *
 *   bound/Bound.js    a top-level CA-R Tools menu, for a single spreadsheet
 *   stub/Stub.js      the same, in a project that calls this as a library
 *   addon/Addon.js    an Extensions submenu, required for a published add-on
 *
 * Whichever of those is in the project may also declare INSTALL_CONFIG and
 * INSTALL_HEADER_ALIASES; applyInstallDefaults_ picks them up on every call
 * without needing to wrap anything.
 */

function applyInstallDefaults_() {
  if (typeof INSTALL_CONFIG !== 'undefined') setConfig(INSTALL_CONFIG);
  if (typeof INSTALL_HEADER_ALIASES !== 'undefined') addHeaderAliases(INSTALL_HEADER_ALIASES);
}

function showCompareDialog() {
  applyInstallDefaults_();
  var html = HtmlService.createHtmlOutputFromFile('Dialog')
    .setWidth(560)
    .setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'MD update compare');
}

function showAbout() {
  applyInstallDefaults_();
  SpreadsheetApp.getUi().alert(
    'CA-R Metadata Sheet Comparator ' + VERSION + '\n\n' +
    'Matches records on ' + CONFIG.KEY_FIELDS.join(' → ') + ' and columns on ' +
    'header name, so row order and column order do not have to agree between ' +
    'the two sheets.\n\nHuman-readable column headers are resolved against the ' +
    'CA-R Metadata Dictionary (' + headerLookup_().size + ' field pairs), so a ' +
    'sheet headed "Call Number" compares correctly against one headed ' +
    '"obj_call_number". Headers the dictionary does not recognise are kept and ' +
    'still compared.\n\nComparison is exact: trailing whitespace and letter ' +
    'case count as differences.'
  );
}

/* ------------------------------------------------------------------ */
/* Dialog support                                                      */
/* ------------------------------------------------------------------ */

/**
 * Returns the tab list for a spreadsheet, for populating the dialog dropdowns.
 * An empty/blank reference means the active spreadsheet.
 */
function getSpreadsheetInfo(ref) {
  var ss = openSpreadsheet_(ref);
  return {
    id: ss.getId(),
    name: ss.getName(),
    sheets: ss.getSheets().map(function (s) { return s.getName(); })
  };
}

function getDefaults() {
  var L = headerLookup_();
  return {
    ignoreFields: CONFIG.IGNORE_FIELDS.join('\n'),
    diffCellFormat: CONFIG.DIFF_CELL_FORMAT,
    headerRow: CONFIG.HEADER_ROW,
    translateHeaders: CONFIG.TRANSLATE_HEADERS,
    ignoreWhitespace: CONFIG.IGNORE_WHITESPACE,
    ignoreCase: CONFIG.IGNORE_CASE,
    multivalueSpacing: CONFIG.MULTIVALUE_DELIMITER_SPACING,
    multivalueCount: L.multivalueCount,
    dictionarySize: L.size,
    keyFields: CONFIG.KEY_FIELDS.map(function (f) {
      return { field: f, label: f + (L.humanOf[f] ? '  (' + L.humanOf[f] + ')' : '') };
    })
  };
}

function openSpreadsheet_(ref) {
  if (!ref || !String(ref).trim()) return SpreadsheetApp.getActiveSpreadsheet();
  ref = String(ref).trim();
  var m = ref.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  var id = m ? m[1] : ref;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Could not open spreadsheet "' + ref + '". Check the URL ' +
      'or ID, and that your account has access. (' + e.message + ')');
  }
}

/* ------------------------------------------------------------------ */
/* Value handling                                                      */
/* ------------------------------------------------------------------ */

/**
 * Canonical string form of a cell value.
 *
 * Dates and numbers are normalised so that identical underlying data formatted
 * differently in the two sheets does not read as a difference. Text is left
 * byte-for-byte intact: trailing whitespace and case ARE differences.
 */
function serialize_(v, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return Utilities.formatDate(v, tz, hasTime ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/**
 * The form used to decide whether two values match.
 *
 * Only ever applied to the comparison itself. Display, the review sheet, and
 * write-back all use the raw value, so forgiving a trailing space never means
 * writing a silently altered value back into the sheet.
 */
function normalizeForCompare_(s) {
  var v = s;
  if (CONFIG.IGNORE_WHITESPACE === 'all') {
    v = v.replace(/\s+/g, ' ').replace(/^ | $/g, '');
  } else if (CONFIG.IGNORE_WHITESPACE === 'edges') {
    v = v.replace(/^\s+|\s+$/g, '');
  }
  if (CONFIG.IGNORE_CASE) v = v.toLowerCase();
  return v;
}

/** Why two differing raw values were treated as a match, for the summary. */
function suppressionKind_(a, b) {
  if (a.replace(/^\s+|\s+$/g, '') === b.replace(/^\s+|\s+$/g, '')) return 'whitespace';
  if (a.replace(/\s+/g, ' ').replace(/^ | $/g, '') ===
      b.replace(/\s+/g, ' ').replace(/^ | $/g, '')) return 'whitespace';
  if (a.toLowerCase() === b.toLowerCase()) return 'case';
  return 'whitespace and case';
}

function normalizeKey_(s) {
  var k = String(s == null ? '' : s).trim();
  return CONFIG.KEY_MATCH_CASE_SENSITIVE ? k : k.toLowerCase();
}

function truncate_(s) {
  if (s.length <= CONFIG.MAX_CELL_CHARS) return s;
  return s.substring(0, CONFIG.MAX_CELL_CHARS) + ' …[truncated, ' + s.length + ' chars]';
}

function display_(s) {
  return s === '' ? CONFIG.EMPTY_TOKEN : truncate_(s);
}

/* ------------------------------------------------------------------ */
/* Header resolution                                                   */
/* ------------------------------------------------------------------ */

var HEADER_LOOKUP = null;

/**
 * Loose form of a header used for lookup and for matching unrecognised
 * headers across sheets: lowercased, with every run of non-alphanumeric
 * characters collapsed to a single space.
 *
 *   'obj_call_number'  -> 'obj call number'
 *   'Call Number '     -> 'call number'
 *   'Visible to Public?' -> 'visible to public'
 */
function looseHeader_(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^ | $/g, '');
}

/** Delimiter for a field, or '' when the dictionary calls it single-valued. */
function fieldDelimiter_(field) {
  var L = headerLookup_();
  return Object.prototype.hasOwnProperty.call(L.delimiterOf, field) ? L.delimiterOf[field] : '';
}

/**
 * Canonical form of a multi-value cell: each value trimmed, rejoined with a
 * single delimiter. Applied only to the match test.
 *
 * The pilcrow the dictionary records for some fields stands for a line break,
 * so both it and a real newline are treated as the separator.
 */
function normalizeMultivalue_(value, delimiter) {
  if (!delimiter || value === '') return value;
  var pilcrow = delimiter === '\u00b6';
  var parts = pilcrow ? value.split(/[\u00b6\r\n]+/) : value.split(delimiter);
  if (parts.length < 2) return value;   // not actually a list

  // Only the space either side of a delimiter is normalised. The very start of
  // the first value and the very end of the last are left alone, because those
  // are ordinary leading and trailing whitespace — governed by
  // IGNORE_WHITESPACE, and a real difference when that is set to exact. Mixing
  // the two would make this setting quietly trim every multi-value field.
  for (var i = 0; i < parts.length; i++) {
    if (i > 0) parts[i] = parts[i].replace(/^\s+/, '');
    if (i < parts.length - 1) parts[i] = parts[i].replace(/\s+$/, '');
  }
  return parts.join(pilcrow ? '\n' : delimiter);
}

function headerLookup_() {
  if (HEADER_LOOKUP) return HEADER_LOOKUP;
  var machineExact = {};   // exact machine name -> machine name
  var machineLoose = {};   // loose machine name -> machine name
  var humanLoose = {};     // loose human label  -> machine name
  var humanOf = {};        // machine name       -> human label
  var delimiterOf = {};    // machine name       -> multi-value delimiter

  if (typeof HEADER_PAIRS !== 'undefined') {
    HEADER_PAIRS.forEach(function (p) {
      var m = p[0], h = p[1];
      machineExact[m] = m;
      machineLoose[looseHeader_(m)] = m;
      humanLoose[looseHeader_(h)] = m;
      humanOf[m] = h;
    });
  }
  if (typeof HEADER_ALIASES !== 'undefined') {
    for (var a in HEADER_ALIASES) {
      if (Object.prototype.hasOwnProperty.call(HEADER_ALIASES, a)) {
        humanLoose[looseHeader_(a)] = HEADER_ALIASES[a];
      }
    }
  }

  if (typeof FIELD_DELIMITERS !== 'undefined') {
    FIELD_DELIMITERS.forEach(function (p) { delimiterOf[p[0]] = p[1]; });
  }

  HEADER_LOOKUP = {
    machineExact: machineExact,
    delimiterOf: delimiterOf,
    multivalueCount: Object.keys(delimiterOf).length,
    machineLoose: machineLoose,
    humanLoose: humanLoose,
    humanOf: humanOf,
    size: Object.keys(machineExact).length
  };
  return HEADER_LOOKUP;
}

/**
 * Maps one raw header to the name the comparison will use.
 *
 * Returns { field, how, human }, where `how` is one of:
 *   'machine'     already machine-readable, used verbatim
 *   'machine~'    machine-readable after case/punctuation normalisation
 *   'human'       a recognised human-readable label, translated
 *   'unknown'     not in the dictionary; kept as-is and still compared
 */
function resolveHeader_(raw, translate) {
  var trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return { field: '', how: 'blank', human: '' };

  var L = headerLookup_();
  if (Object.prototype.hasOwnProperty.call(L.machineExact, trimmed)) {
    return { field: trimmed, how: 'machine', human: L.humanOf[trimmed] || '' };
  }
  if (translate) {
    var loose = looseHeader_(trimmed);
    if (Object.prototype.hasOwnProperty.call(L.machineLoose, loose)) {
      var m1 = L.machineLoose[loose];
      return { field: m1, how: m1 === trimmed ? 'machine' : 'machine~', human: L.humanOf[m1] || '' };
    }
    if (Object.prototype.hasOwnProperty.call(L.humanLoose, loose)) {
      var m2 = L.humanLoose[loose];
      return { field: m2, how: 'human', human: L.humanOf[m2] || trimmed };
    }
    // Not in the dictionary. Match it across sheets on its loose form so that
    // "Local Notes" and "local notes" still line up, but keep the raw text for
    // display.
    return { field: UNKNOWN_PREFIX + loose, how: 'unknown', human: '' };
  }
  return { field: trimmed, how: 'unknown', human: '' };
}

var UNKNOWN_PREFIX = '\u0000?';

function isUnknownField_(f) { return f.indexOf(UNKNOWN_PREFIX) === 0; }

/** Column heading for a resolved field in the grid. */
function fieldName_(field, cur, inc) {
  if (!isUnknownField_(field)) return field;
  return (cur.raw && cur.raw[field]) || (inc.raw && inc.raw[field]) ||
         field.substring(UNKNOWN_PREFIX.length);
}

/** Longer, human-facing description used in the summary lists. */
function fieldLabel_(field, cur, inc) {
  var name = fieldName_(field, cur, inc);
  if (isUnknownField_(field)) return name + '  [not in dictionary]';
  var L = headerLookup_();
  var human = L.humanOf[field];
  return human ? name + '  (' + human + ')' : name;
}

/** Resolves an ignore-list entry, which may be given either way round. */
function resolveIgnoreEntry_(entry, translate) {
  var r = resolveHeader_(entry, translate);
  return r.field;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function readTable_(ss, sheetName, headerRow, translate) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet "' + sheetName + '" not found in "' + ss.getName() + '".');

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < headerRow || lastCol < 1) {
    throw new Error('Sheet "' + sheetName + '" appears to be empty.');
  }

  var tz = ss.getSpreadsheetTimeZone();
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  var rawHeaders = values[headerRow - 1];
  var headers = [];          // resolved field names, in sheet order
  var raw = {};              // resolved field -> header text as it appeared
  var how = {};              // resolved field -> resolution kind
  var index = {};            // resolved field -> column index
  var duplicateHeaders = [];
  var translated = [];       // [rawText, machineName] for human-readable headers
  var unrecognised = [];     // raw header text

  for (var c = 0; c < rawHeaders.length; c++) {
    var r = resolveHeader_(rawHeaders[c], translate);
    headers.push(r.field);
    if (!r.field) continue;
    if (Object.prototype.hasOwnProperty.call(index, r.field)) {
      duplicateHeaders.push(String(rawHeaders[c]).trim());
      continue;
    }
    index[r.field] = c;
    raw[r.field] = String(rawHeaders[c]).trim();
    how[r.field] = r.how;
    if (r.how === 'human') translated.push([raw[r.field], r.field]);
    if (r.how === 'unknown') unrecognised.push(raw[r.field]);
  }

  var rows = [];
  var blankRows = 0;
  for (var rr = headerRow; rr < values.length; rr++) {
    var cells = new Array(lastCol);
    var any = false;
    for (var i = 0; i < lastCol; i++) {
      var s = serialize_(values[rr][i], tz);
      cells[i] = s;
      if (s !== '') any = true;
    }
    if (!any) { blankRows++; continue; }
    rows.push({ rowNum: rr + 1, cells: cells });
  }

  return {
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheetName: sheetName,
    headers: headers,
    raw: raw,
    how: how,
    index: index,
    duplicateHeaders: uniq_(duplicateHeaders),
    translated: translated,
    unrecognised: unrecognised,
    rows: rows,
    blankRows: blankRows
  };
}

function uniq_(a) {
  var seen = {}, out = [];
  a.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
  return out;
}

/* ------------------------------------------------------------------ */
/* Key selection and indexing                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Key normalisation                                                   */
/* ------------------------------------------------------------------ */
/*
 * When no candidate key has any values in common, the two sheets may still be
 * describing the same records under different naming conventions. Rather than
 * scoring similarity — which pairs records on a hunch and cannot be explained
 * afterwards — this works through a ladder of concrete, reversible rules. Each
 * one is a specific omission that can be stated in a sentence, shown to the
 * person, and recorded in the summary.
 *
 * Nothing here runs without consent.
 */

var KEY_RULE_EXTENSION = {
  id: 'extension',
  side: 'both',
  label: 'Ignore file extensions',
  detail: 'Drops a trailing .pdf, .tif, .tiff, .jpg and the like from each ' +
          'value, including each item in a semicolon-separated list.',
  apply: function (v) { return v.replace(/\.[a-z0-9]{1,5}(?=\s*;|\s*$)/g, ''); }
};

var KEY_RULE_PUNCTUATION = {
  id: 'punctuation',
  side: 'both',
  label: 'Ignore punctuation and spacing',
  detail: 'Removes every character that is not a letter, a digit or a ' +
          'semicolon, so that J001-D and J001_D read as the same value.',
  apply: function (v) { return v.replace(/[^a-z0-9;]+/g, ''); }
};

function tokenRule_(token, side, here, there) {
  var other = side === 'incoming' ? 'current' : 'incoming';
  var seen = (here === undefined)
    ? '"' + token + '" appears in ' + side + ' keys but not ' + other + ' ones'
    : '"' + token + '" appears in ' + Math.round(100 * here) + '% of ' + side +
      ' keys and ' + Math.round(100 * there) + '% of ' + other + ' ones';
  return {
    id: 'token:' + side + ':' + token,
    side: side,
    label: 'Remove "' + token + '" from ' + side + ' keys',
    detail: seen + ', and removing it pairs records that otherwise do not ' +
            'meet, so it reads as a naming convention rather than part of the ' +
            'identifier.',
    apply: function (v) {
      return v.replace(new RegExp('[^a-z0-9]?' + token + '(?![a-z0-9])', 'g'), '');
    }
  };
}

/** Applies the rules that are in force for one side of the comparison. */
function applyKeyRules_(value, rules, side) {
  var v = value;
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].side === 'both' || rules[i].side === side) v = rules[i].apply(v);
  }
  return v;
}

function normalizeKeyWith_(raw, rules, side) {
  var k = normalizeKey_(raw);
  if (!rules || !rules.length || k === '') return k;
  return applyKeyRules_(k, rules, side).replace(/^\s+|\s+$/g, '');
}

/** Distinct token frequency across one sheet's key column. */
function keyTokens_(t, colIdx) {
  var freq = {};
  var n = 0;
  for (var i = 0; i < t.rows.length; i++) {
    var k = normalizeKey_(t.rows[i].cells[colIdx]);
    if (k === '') continue;
    n++;
    var seen = {};
    var parts = k.split(/[^a-z0-9]+/);
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j];
      if (!p || /^[0-9]+$/.test(p) || p.length < 3) continue;
      if (seen[p]) continue;
      seen[p] = true;
      freq[p] = (freq[p] || 0) + 1;
    }
  }
  return { freq: freq, rows: n };
}

/**
 * Looks for a set of rules that would make the two key columns meet.
 * Returns null when nothing plausible is found — a wrong answer is worse than
 * no answer here, so the bar is deliberately high.
 */
function discoverKeyRules_(cur, inc, field) {
  var ci = cur.index[field], ii = inc.index[field];
  var curTok = keyTokens_(cur, ci);
  var incTok = keyTokens_(inc, ii);

  // Candidate convention markers: a token carried by a real share of one
  // side's keys and effectively never by the other's. The share is set low
  // because conventions in practice are mixed — a partner may append _prsv to
  // half a manifest — and a candidate only survives if removing it actually
  // pairs more records, which is a far stronger test than any frequency
  // threshold.
  var candidates = [];
  [['incoming', incTok, curTok], ['current', curTok, incTok]].forEach(function (pair) {
    var side = pair[0], mine = pair[1], theirs = pair[2];
    if (!mine.rows || !theirs.rows) return;
    Object.keys(mine.freq).forEach(function (tok) {
      var here = mine.freq[tok] / mine.rows;
      var there = (theirs.freq[tok] || 0) / theirs.rows;
      if (mine.freq[tok] >= CONFIG.MIN_KEY_RULE_SUPPORT && here >= 0.15 && there <= 0.02) {
        var rule = tokenRule_(tok, side, here, there);
        rule.strength = here - there;
        candidates.push(rule);
      }
    });
  });

  function score(rules) { return countKeyOverlap_(cur, inc, field, rules); }

  // Keep the strongest candidates only, so the search stays cheap and the
  // proposal stays short enough to actually read.
  candidates.sort(function (a, b) { return b.strength - a.strength; });
  candidates = candidates.slice(0, CONFIG.MAX_KEY_RULES);

  // Apply everything, then take away whatever turns out not to be load-bearing.
  //
  // Choosing omissions one at a time looks tidier but misses the common case:
  // where a value carries two convention markers, removing either one alone
  // pairs nothing, so a step-by-step search stalls at the first move and
  // concludes the sheets are unrelated. Starting from the full set and pruning
  // finds the same minimal answer without that blind spot.
  var full = [KEY_RULE_EXTENSION].concat(candidates);
  var best = score(full);
  if (score(full.concat([KEY_RULE_PUNCTUATION])) > best) {
    full = full.concat([KEY_RULE_PUNCTUATION]);
    best = score(full);
  }
  if (best === 0) return null;

  // Prune the broadest omissions first, so what survives is the narrowest set
  // that still pairs the same records. Anything whose removal costs nothing
  // was never doing any work, and every omission left in the proposal is one
  // more thing the person has to agree to.
  var order = [KEY_RULE_PUNCTUATION.id, KEY_RULE_EXTENSION.id];
  var rules = full.slice().sort(function (a, b) {
    return order.indexOf(b.id) - order.indexOf(a.id);
  });
  for (var i = 0; i < rules.length; i++) {
    var without = rules.slice(0, i).concat(rules.slice(i + 1));
    if (without.length && score(without) >= best) {
      rules = without;
      i--;
    }
  }

  // Present them in the order they read most naturally.
  rules.sort(function (a, b) {
    return full.indexOf(a) - full.indexOf(b);
  });

  if (!rules.length || best === 0) return null;

  return {
    field: field,
    rules: rules,
    overlap: best,
    examples: keyRuleExamples_(cur, inc, field, rules)
  };
}

/**
 * How many keys stop being unique once the rules are applied.
 *
 * Normalisation trades precision for reach, and this is the price. A record
 * whose key now collides with another cannot be paired with confidence, so the
 * number is put in front of the person before they agree rather than buried in
 * the output.
 */
function keyAmbiguity_(cur, inc, field, rules) {
  function collisions(t, colIdx, side) {
    var counts = {};
    for (var i = 0; i < t.rows.length; i++) {
      var k = normalizeKeyWith_(t.rows[i].cells[colIdx], rules, side);
      if (k !== '') counts[k] = (counts[k] || 0) + 1;
    }
    var n = 0;
    for (var key in counts) if (counts[key] > 1) n += counts[key];
    return n;
  }
  return collisions(cur, cur.index[field], 'current') +
         collisions(inc, inc.index[field], 'incoming');
}

/** A few before-and-after pairs, so the proposal can be judged on evidence. */
function keyRuleExamples_(cur, inc, field, rules) {
  var ci = cur.index[field], ii = inc.index[field];
  var incIdx = {};
  for (var j = 0; j < inc.rows.length; j++) {
    var nk = normalizeKeyWith_(inc.rows[j].cells[ii], rules, 'incoming');
    if (nk !== '' && !incIdx[nk]) incIdx[nk] = inc.rows[j].cells[ii];
  }
  var out = [];
  for (var i = 0; i < cur.rows.length && out.length < 4; i++) {
    var raw = cur.rows[i].cells[ci];
    var k = normalizeKeyWith_(raw, rules, 'current');
    if (k !== '' && incIdx[k]) out.push({ cur: raw, inc: incIdx[k], as: k });
  }
  return out;
}

/**
 * Rules travel to the dialog and back, and into the apply context, as plain
 * ids. Rebuilding them from the library rather than trusting a round-tripped
 * function keeps the set of possible transformations closed.
 */
function reviveKeyRules_(ids) {
  if (!ids || !ids.length) return null;
  return ids.map(function (id) {
    if (id === KEY_RULE_EXTENSION.id) return KEY_RULE_EXTENSION;
    if (id === KEY_RULE_PUNCTUATION.id) return KEY_RULE_PUNCTUATION;
    var m = /^token:(current|incoming):(.+)$/.exec(id);
    if (m) return tokenRule_(m[2], m[1]);
    throw new Error('Unknown key normalisation rule "' + id + '".');
  });
}

function keyRuleIds_(rules) {
  return (rules || []).map(function (r) { return r.id; });
}

/* ------------------------------------------------------------------ */
/* Key selection                                                       */
/* ------------------------------------------------------------------ */

function chooseKeyField_(cur, inc, forced, rules) {
  var candidates = forced ? [forced] : CONFIG.KEY_FIELDS;
  var trail = [];

  for (var i = 0; i < candidates.length; i++) {
    var f = candidates[i];
    var inCur = Object.prototype.hasOwnProperty.call(cur.index, f);
    var inInc = Object.prototype.hasOwnProperty.call(inc.index, f);

    if (!inCur || !inInc) {
      trail.push(f + ' — not present in ' +
        (!inCur && !inInc ? 'either sheet' : (!inCur ? 'the current sheet' : 'the incoming sheet')));
      continue;
    }
    var popCur = countPopulated_(cur, cur.index[f]);
    var popInc = countPopulated_(inc, inc.index[f]);
    if (popCur === 0 || popInc === 0) {
      trail.push(f + ' — present but empty in ' +
        (popCur === 0 && popInc === 0 ? 'both sheets' : (popCur === 0 ? 'the current sheet' : 'the incoming sheet')));
      continue;
    }

    // Being present and populated is not enough. Two sheets can both carry a
    // full column of temporary IDs that follow different naming conventions,
    // in which case matching on it silently produces nothing. Check that the
    // values actually meet before committing to the field.
    var overlap = countKeyOverlap_(cur, inc, f, rules || null);
    if (overlap === 0 && !forced) {
      trail.push(f + ' — populated on both sides (' + popCur + ' current, ' + popInc +
        ' incoming) but no value appears in both, so nothing would match');
      continue;
    }

    trail.push(f + ' — used (populated on ' + popCur + '/' + cur.rows.length +
      ' current, ' + popInc + '/' + inc.rows.length + ' incoming; ' + overlap +
      ' values appear in both)');
    return { field: f, trail: trail, overlap: overlap };
  }

  throw new Error('No usable matching key — none of ' + candidates.join(', ') +
    ' identifies the same records in both sheets.\n\n' + trail.join('\n') +
    '\n\nNothing was written. Add a shared identifier to the incoming sheet, ' +
    'or pick a key explicitly in the dialog if you know one of these should work.');
}

/**
 * Builds the offer shown to the person: which field, which omissions, how many
 * records it would pair, and worked examples.
 */
function proposeKeyRules_(cur, inc, forced) {
  var candidates = forced ? [forced] : CONFIG.KEY_FIELDS;
  for (var i = 0; i < candidates.length; i++) {
    var f = candidates[i];
    if (!Object.prototype.hasOwnProperty.call(cur.index, f)) continue;
    if (!Object.prototype.hasOwnProperty.call(inc.index, f)) continue;
    if (countPopulated_(cur, cur.index[f]) === 0) continue;
    if (countPopulated_(inc, inc.index[f]) === 0) continue;

    var found = discoverKeyRules_(cur, inc, f);
    if (!found) continue;

    var smaller = Math.min(cur.rows.length, inc.rows.length);
    return {
      field: f,
      fieldLabel: fieldLabel_(f, cur, inc),
      ruleIds: keyRuleIds_(found.rules),
      steps: found.rules.map(function (r) {
        return { label: r.label, detail: r.detail };
      }),
      overlap: found.overlap,
      rate: smaller ? Math.round(100 * found.overlap / smaller) : 0,
      ambiguous: keyAmbiguity_(cur, inc, f, found.rules),
      baselineAmbiguous: keyAmbiguity_(cur, inc, f, null),
      currentRows: cur.rows.length,
      incomingRows: inc.rows.length,
      examples: found.examples
    };
  }
  return null;
}

/** How many distinct key values appear in both sheets. */
function countKeyOverlap_(cur, inc, field, rules) {
  var seen = {};
  var ci = cur.index[field], ii = inc.index[field];
  for (var i = 0; i < cur.rows.length; i++) {
    var k = normalizeKeyWith_(cur.rows[i].cells[ci], rules, 'current');
    if (k !== '') seen[k] = true;
  }
  var n = 0;
  var counted = {};
  for (var j = 0; j < inc.rows.length; j++) {
    var m = normalizeKeyWith_(inc.rows[j].cells[ii], rules, 'incoming');
    if (m !== '' && seen[m] && !counted[m]) { counted[m] = true; n++; }
  }
  return n;
}

function countPopulated_(t, colIdx) {
  var n = 0;
  for (var i = 0; i < t.rows.length; i++) if (t.rows[i].cells[colIdx] !== '') n++;
  return n;
}

/**
 * Buckets rows by normalised key. Duplicate keys are kept in document order
 * and paired positionally against the other side.
 */
function indexByKey_(t, keyField, rules, side) {
  var colIdx = t.index[keyField];
  var map = {};
  var order = [];
  var unkeyed = [];
  for (var i = 0; i < t.rows.length; i++) {
    var row = t.rows[i];
    var raw = row.cells[colIdx];
    var k = normalizeKeyWith_(raw, rules, side);
    if (k === '') { unkeyed.push(row.rowNum); continue; }
    row.rawKey = String(raw).trim();
    if (!map[k]) { map[k] = []; order.push(k); }
    map[k].push(row);
  }
  return { map: map, order: order, unkeyed: unkeyed, colIdx: colIdx };
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

function runComparison(params) {
  var started = new Date();
  var headerRow = Number(params.headerRow) || CONFIG.HEADER_ROW;
  var translate = params.translateHeaders === undefined
    ? CONFIG.TRANSLATE_HEADERS : !!params.translateHeaders;
  if (params.ignoreWhitespace !== undefined) setConfig({ IGNORE_WHITESPACE: params.ignoreWhitespace });
  if (params.ignoreCase !== undefined) setConfig({ IGNORE_CASE: !!params.ignoreCase });
  if (params.multivalueSpacing !== undefined) {
    setConfig({ MULTIVALUE_DELIMITER_SPACING: !!params.multivalueSpacing });
  }

  var curSS = openSpreadsheet_(params.currentRef);
  var incSS = openSpreadsheet_(params.incomingRef);
  var cur = readTable_(curSS, params.currentSheet, headerRow, translate);
  var inc = readTable_(incSS, params.incomingSheet, headerRow, translate);

  if (cur.spreadsheetId === inc.spreadsheetId && cur.sheetName === inc.sheetName) {
    throw new Error('The current and incoming selections are the same sheet.');
  }

  var ignore = {};
  (params.ignoreFields || [])
    .concat(CONFIG.IGNORE_FIELDS)
    .forEach(function (f) {
      f = String(f).trim();
      if (f) ignore[resolveIgnoreEntry_(f, translate)] = true;
    });

  var keyRules = reviveKeyRules_(params.keyRules);

  var chosen;
  try {
    chosen = chooseKeyField_(cur, inc, params.keyField || null, keyRules);
  } catch (noKey) {
    // Nothing matched on any candidate. Before giving up, see whether a
    // describable naming difference explains it — and if so, hand the
    // proposal back rather than acting on it.
    if (keyRules) throw noKey;
    var proposal = proposeKeyRules_(cur, inc, params.keyField || null);
    if (!proposal) throw noKey;
    proposal.reason = noKey.message;
    return { needsConsent: true, proposal: proposal };
  }
  var keyField = chosen.field;

  var curIdx = indexByKey_(cur, keyField, keyRules, 'current');
  var incIdx = indexByKey_(inc, keyField, keyRules, 'incoming');

  // ---- field scope -------------------------------------------------
  var compared = [];
  var onlyInCurrent = [];
  var ignored = [];
  cur.headers.forEach(function (h) {
    if (!h) return;
    if (cur.index[h] === undefined) return;      // duplicate occurrence
    if (h === keyField) return;
    if (!Object.prototype.hasOwnProperty.call(inc.index, h)) { onlyInCurrent.push(fieldLabel_(h, cur, inc)); return; }
    if (ignore[h]) { ignored.push(fieldLabel_(h, cur, inc)); return; }
    compared.push(h);
  });
  var onlyInIncoming = [];
  inc.headers.forEach(function (h) {
    if (!h) return;
    if (inc.index[h] === undefined) return;
    if (!Object.prototype.hasOwnProperty.call(cur.index, h)) onlyInIncoming.push(fieldLabel_(h, cur, inc));
  });
  onlyInCurrent = uniq_(onlyInCurrent);
  onlyInIncoming = uniq_(onlyInIncoming);

  // ---- record matching --------------------------------------------
  var records = [];          // records with >= 1 difference
  var matchedPairs = 0;
  var onlyCurrentKeys = [];
  var onlyIncomingKeys = [];
  var duplicateKeys = [];
  var fieldCounts = {};
  var totalDiffCells = 0;
  var suppressed = { total: 0, byKind: {}, byField: {} };

  curIdx.order.forEach(function (k) {
    var a = curIdx.map[k];
    var b = incIdx.map[k];
    if (!b) { a.forEach(function (r) { onlyCurrentKeys.push(r.rawKey + ' (row ' + r.rowNum + ')'); }); return; }
    if (a.length > 1 || b.length > 1) {
      duplicateKeys.push(a[0].rawKey + ' — ' + a.length + '× current, ' + b.length + '× incoming');
    }
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) {
      matchedPairs++;
      var diffs = compareRow_(a[i], b[i], cur, inc, compared, suppressed);
      if (diffs.count > 0) {
        totalDiffCells += diffs.count;
        for (var f in diffs.byField) {
          fieldCounts[f] = (fieldCounts[f] || 0) + 1;
        }
        records.push({
          key: a[i].rawKey,
          curRow: a[i].rowNum,
          incRow: b[i].rowNum,
          count: diffs.count,
          byField: diffs.byField
        });
      }
    }
    for (var j = n; j < a.length; j++) onlyCurrentKeys.push(a[j].rawKey + ' (row ' + a[j].rowNum + ', unpaired duplicate)');
    for (var m = n; m < b.length; m++) onlyIncomingKeys.push(b[m].rawKey + ' (row ' + b[m].rowNum + ', unpaired duplicate)');
  });

  incIdx.order.forEach(function (k) {
    if (!curIdx.map[k]) {
      incIdx.map[k].forEach(function (r) { onlyIncomingKeys.push(r.rawKey + ' (row ' + r.rowNum + ')'); });
    }
  });

  var result = {
    started: started,
    elapsedMs: new Date().getTime() - started.getTime(),
    params: params,
    headerRow: headerRow,
    cur: cur,
    inc: inc,
    keyField: keyField,
    keyTrail: chosen.trail,
    keyRules: keyRules,
    keyRuleIds: keyRuleIds_(keyRules),
    translate: translate,
    compared: compared,
    ignored: uniq_(ignored),
    onlyInCurrent: onlyInCurrent,
    onlyInIncoming: onlyInIncoming,
    matchedPairs: matchedPairs,
    records: records,
    totalDiffCells: totalDiffCells,
    fieldCounts: fieldCounts,
    suppressed: suppressed,
    onlyCurrentKeys: onlyCurrentKeys,
    onlyIncomingKeys: onlyIncomingKeys,
    duplicateKeys: duplicateKeys,
    unkeyedCurrent: curIdx.unkeyed,
    unkeyedIncoming: incIdx.unkeyed
  };

  var out = SpreadsheetApp.getActiveSpreadsheet();
  if (keyRules) writeKeyMatches_(out, result, curIdx, incIdx);
  if (CONFIG.WRITE_GRID) writeGrid_(out, result, params.diffCellFormat || CONFIG.DIFF_CELL_FORMAT);
  writeReview_(out, result);
  writeSummary_(out, result);
  saveApplyContext_(result);

  return {
    matched: matchedPairs,
    changed: records.length,
    cells: totalDiffCells,
    keyField: keyField,
    fields: Object.keys(fieldCounts).length,
    seconds: Math.round(result.elapsedMs / 100) / 10
  };
}

function compareRow_(rowA, rowB, cur, inc, compared, suppressed) {
  var byField = {};
  var count = 0;
  for (var i = 0; i < compared.length; i++) {
    var f = compared[i];
    var a = rowA.cells[cur.index[f]];
    var b = rowB.cells[inc.index[f]];
    if (a === b) continue;

    // Multi-value fields first: whether a space follows the delimiter is a
    // typing habit rather than a metadata change.
    if (CONFIG.MULTIVALUE_DELIMITER_SPACING) {
      var delim = fieldDelimiter_(f);
      if (delim) {
        var na = normalizeMultivalue_(a, delim);
        var nb = normalizeMultivalue_(b, delim);
        if (na === nb || normalizeForCompare_(na) === normalizeForCompare_(nb)) {
          suppressed.total++;
          var mk = (na === nb) ? 'multi-value delimiter spacing'
                               : 'multi-value delimiter spacing, plus ' + suppressionKind_(na, nb);
          suppressed.byKind[mk] = (suppressed.byKind[mk] || 0) + 1;
          suppressed.byField[f] = (suppressed.byField[f] || 0) + 1;
          continue;
        }
      }
    }

    if (normalizeForCompare_(a) === normalizeForCompare_(b)) {
      // Differs only in ways this run has been told to forgive. Counted so the
      // summary can say how much was set aside and why.
      var kind = suppressionKind_(a, b);
      suppressed.total++;
      suppressed.byKind[kind] = (suppressed.byKind[kind] || 0) + 1;
      suppressed.byField[f] = (suppressed.byField[f] || 0) + 1;
      continue;
    }
    byField[f] = { cur: a, inc: b };
    count++;
  }
  return { byField: byField, count: count };
}

/* ------------------------------------------------------------------ */
/* Output: grid                                                        */
/* ------------------------------------------------------------------ */

/**
 * A clean run and a run that matched nothing both produce an empty report, and
 * they mean opposite things. "No differences found" is dangerously reassuring
 * when the truth is "these two sheets have no records in common", so the two
 * cases get different words everywhere they are reported.
 */
function emptyReportMessage_(res) {
  if (res.matchedPairs === 0) {
    return 'NOTHING MATCHED. Not one record in the current sheet was paired ' +
      'with a record in the incoming sheet, so no comparison was possible. ' +
      'This is not a clean result — see ' + CONFIG.SUMMARY_SHEET +
      ', section MATCHING KEY, for which key was used and why.';
  }
  return 'No differences found across ' + res.matchedPairs +
    ' matched records. See ' + CONFIG.SUMMARY_SHEET + ' for run details.';
}

/** Share of the smaller sheet that found a partner. */
function matchRate_(res) {
  var smaller = Math.min(res.cur.rows.length, res.inc.rows.length);
  return smaller ? res.matchedPairs / smaller : 0;
}

function writeGrid_(out, res, format) {
  var sheet = resetSheet_(out, CONFIG.GRID_SHEET);

  // Only fields that actually differ somewhere become columns, in the current
  // sheet's header order.
  var cols = res.compared.filter(function (f) { return res.fieldCounts[f]; });

  var fixed = [res.keyField, 'key_field', 'diff_count', 'row_current', 'row_incoming'];
  var header = fixed.concat(cols.map(function (f) { return fieldName_(f, res.cur, res.inc); }));

  if (!res.records.length) {
    sheet.getRange(1, 1).setValue(emptyReportMessage_(res));
    sheet.getRange(1, 1).setFontWeight('bold');
    if (res.matchedPairs === 0) sheet.getRange(1, 1).setBackground(STYLE.WARN_BG);
    return;
  }

  var data = [header];
  res.records.forEach(function (rec) {
    var row = [rec.key, res.keyField, rec.count, rec.curRow, rec.incRow];
    for (var i = 0; i < cols.length; i++) {
      var d = rec.byField[cols[i]];
      row.push(d ? renderDiff_(d, format) : '');
    }
    data.push(row);
  });

  ensureSize_(sheet, data.length, header.length);
  // Same reason as the review sheet: keep Sheets from reinterpreting values.
  sheet.getRange(1, 1, data.length, header.length).setNumberFormat('@');
  sheet.getRange(1, 1, data.length, header.length).setValues(data);

  // Note on each field heading: human-readable label, and the header text as
  // it actually appeared in each sheet.
  var notes = [fixed.map(function () { return ''; }).concat(cols.map(function (f) {
    return headerNote_(f, res.cur, res.inc);
  }))];
  sheet.getRange(1, 1, 1, header.length).setNotes(notes);

  var hdr = sheet.getRange(1, 1, 1, header.length);
  hdr.setBackground(STYLE.HEADER_BG).setFontColor(STYLE.HEADER_FG).setFontWeight('bold');
  // Columns whose header the dictionary did not recognise get a different
  // heading colour, so they are obvious rather than silently trusted.
  for (var u = 0; u < cols.length; u++) {
    if (isUnknownField_(cols[u])) {
      sheet.getRange(1, fixed.length + u + 1).setBackground(STYLE.UNKNOWN_HDR_BG);
    }
  }
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.getRange(2, 1, data.length - 1, fixed.length).setBackground(STYLE.KEY_BG);
  sheet.getRange(1, 1, data.length, header.length)
    .setVerticalAlignment('top')
    .setWrap(false);

  // Shade the populated (differing) cells only.
  for (var c = 0; c < cols.length; c++) {
    var colNum = fixed.length + c + 1;
    var rangeList = [];
    for (var r = 0; r < res.records.length; r++) {
      if (res.records[r].byField[cols[c]]) rangeList.push(r + 2);
    }
    contiguousRuns_(rangeList).forEach(function (run) {
      sheet.getRange(run[0], colNum, run[1] - run[0] + 1, 1).setBackground(STYLE.DIFF_BG);
    });
  }

  sheet.setColumnWidth(1, 260);
  for (var i = 2; i <= fixed.length; i++) sheet.setColumnWidth(i, 90);
  for (var j = fixed.length + 1; j <= header.length; j++) sheet.setColumnWidth(j, 320);
}

function headerNote_(field, cur, inc) {
  var L = headerLookup_();
  var parts = [];
  if (isUnknownField_(field)) {
    parts.push('Not in the CA-R Metadata Dictionary — compared as-is.');
  } else if (L.humanOf[field]) {
    parts.push(L.humanOf[field]);
  }
  var a = cur.raw[field], b = inc.raw[field];
  if (a !== undefined) parts.push('Current sheet header: ' + a);
  if (b !== undefined) parts.push('Incoming sheet header: ' + b);
  return parts.join('\n');
}

function renderDiff_(d, format) {
  if (format === 'incoming') return display_(d.inc);
  if (format === 'current') return display_(d.cur);
  return 'CURRENT:  ' + display_(d.cur) + '\nINCOMING: ' + display_(d.inc);
}

function contiguousRuns_(sortedRows) {
  var runs = [];
  var i = 0;
  while (i < sortedRows.length) {
    var start = sortedRows[i];
    var end = start;
    while (i + 1 < sortedRows.length && sortedRows[i + 1] === end + 1) { i++; end = sortedRows[i]; }
    runs.push([start, end]);
    i++;
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/* Output: proposed key matches                                        */
/* ------------------------------------------------------------------ */

/**
 * Every pairing the normalisation rules produced, with the two original key
 * values side by side and the normalised form they met on.
 *
 * Normalisation pairs records that do not literally agree, so the pairings are
 * a claim about the data rather than a fact about it. This tab is how that
 * claim gets checked, and it lists what did not pair as well as what did.
 */
function writeKeyMatches_(out, res, curIdx, incIdx) {
  var sheet = resetSheet_(out, CONFIG.KEY_MATCH_SHEET);
  var header = ['#', 'status', 'current_' + res.keyField, 'incoming_' + res.keyField,
                'matched_as', 'row_current', 'row_incoming'];
  var data = [header];
  var n = 0;

  curIdx.order.forEach(function (k) {
    var a = curIdx.map[k], b = incIdx.map[k];
    if (!b) {
      a.forEach(function (r) {
        data.push([++n, 'current only', r.rawKey, '', k, r.rowNum, '']);
      });
      return;
    }
    var pairs = Math.min(a.length, b.length);
    for (var i = 0; i < pairs; i++) {
      var ambiguous = a.length > 1 || b.length > 1;
      data.push([++n, ambiguous ? 'ambiguous — key appears more than once' : 'matched',
        a[i].rawKey, b[i].rawKey, k, a[i].rowNum, b[i].rowNum]);
    }
    for (var j = pairs; j < a.length; j++) {
      data.push([++n, 'current only (unpaired duplicate)', a[j].rawKey, '', k, a[j].rowNum, '']);
    }
    for (var m = pairs; m < b.length; m++) {
      data.push([++n, 'incoming only (unpaired duplicate)', '', b[m].rawKey, k, '', b[m].rowNum]);
    }
  });

  incIdx.order.forEach(function (k) {
    if (curIdx.map[k]) return;
    incIdx.map[k].forEach(function (r) {
      data.push([++n, 'incoming only', '', r.rawKey, k, '', r.rowNum]);
    });
  });

  ensureSize_(sheet, data.length + 1, header.length);
  sheet.getRange(1, 1, data.length, header.length).setNumberFormat('@');
  sheet.getRange(1, 1, data.length, header.length).setValues(data);

  var hdr = sheet.getRange(1, 1, 1, header.length);
  hdr.setBackground(STYLE.HEADER_BG).setFontColor(STYLE.HEADER_FG).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (data.length > 1) {
    sheet.getRange(1, 1, data.length, header.length).createFilter();
    for (var r = 2; r <= data.length; r++) {
      var st = String(data[r - 1][1]);
      sheet.getRange(r, 2).setBackground(st === 'matched' ? STYLE.MATCH_BG : STYLE.WARN_BG);
    }
  }
  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 300);
  sheet.setColumnWidth(5, 260);

  sheet.getRange(1, 5).setNote('The normalised form both values reduced to. ' +
    'This is what they were matched on, not a value from either sheet.');

  res.keyMatchRows = data.length - 1;
}

/* ------------------------------------------------------------------ */
/* Output: review sheet                                                */
/* ------------------------------------------------------------------ */

var REVIEW_COLS = [
  '#', 'key', 'field', 'field_label', 'row_current', 'row_incoming',
  'current_value', 'incoming_value', 'decision', 'value_to_apply', 'result'
];
var REVIEW_COL = {
  N: 1, KEY: 2, FIELD: 3, LABEL: 4, ROW_CUR: 5, ROW_INC: 6,
  CUR: 7, INC: 8, DECISION: 9, APPLY: 10, RESULT: 11
};

/**
 * One row per differing cell, with the two values in their own labelled
 * columns and an editable value_to_apply. This is the sheet you work from:
 * review a line, set its decision, then run Apply reviewed changes.
 *
 * Values here are NOT truncated the way the grid's are — the apply step writes
 * value_to_apply back verbatim, so a shortened value would silently corrupt
 * the record. Anything too long for a cell is marked and forced to skip.
 */
function writeReview_(out, res) {
  var sheet = resetSheet_(out, CONFIG.REVIEW_SHEET);
  var L = headerLookup_();

  if (!res.records.length) {
    ensureSize_(sheet, 1, 1);
    sheet.getRange(1, 1).setValue(emptyReportMessage_(res)).setFontWeight('bold');
    if (res.matchedPairs === 0) sheet.getRange(1, 1).setBackground(STYLE.WARN_BG);
    return;
  }

  var data = [REVIEW_COLS.slice()];
  var oversize = 0;
  var n = 0;

  // Grouped by field, in the current sheet's header order, so that a field
  // with the same edit on 28 records can be judged once instead of 28 times.
  res.compared.forEach(function (field) {
    if (!res.fieldCounts[field]) return;
    res.records.forEach(function (rec) {
      var d = rec.byField[field];
      if (!d) return;
      n++;
      var tooLong = d.inc.length > CONFIG.MAX_APPLY_CHARS || d.cur.length > CONFIG.MAX_APPLY_CHARS;
      if (tooLong) oversize++;
      data.push([
        n,
        rec.key,
        fieldName_(field, res.cur, res.inc),
        isUnknownField_(field) ? '[not in dictionary]' : (L.humanOf[field] || ''),
        rec.curRow,
        rec.incRow,
        tooLong ? '[too long to edit safely — ' + d.cur.length + ' chars]' : d.cur,
        tooLong ? '[too long to edit safely — ' + d.inc.length + ' chars]' : d.inc,
        tooLong ? 'skip' : CONFIG.DEFAULT_DECISION,
        tooLong ? '' : d.inc,
        ''
      ]);
    });
  });

  ensureSize_(sheet, data.length + 1, REVIEW_COLS.length);

  // Force the value columns to plain text BEFORE writing. Left on Automatic,
  // Sheets reinterprets what it is given: "1970-03-01" becomes a date, "1988"
  // becomes a number, and a trailing space is eaten in the process. That both
  // hides the difference being reviewed and, worse, means value_to_apply would
  // write a date back into a cell that held text.
  sheet.getRange(1, REVIEW_COL.CUR, data.length, 2).setNumberFormat('@');
  sheet.getRange(1, REVIEW_COL.APPLY, data.length, 1).setNumberFormat('@');
  sheet.getRange(1, REVIEW_COL.KEY, data.length, 1).setNumberFormat('@');

  sheet.getRange(1, 1, data.length, REVIEW_COLS.length).setValues(data);

  var hdr = sheet.getRange(1, 1, 1, REVIEW_COLS.length);
  hdr.setBackground(STYLE.HEADER_BG).setFontColor(STYLE.HEADER_FG).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var body = data.length - 1;
  sheet.getRange(2, REVIEW_COL.CUR, body, 1).setBackground(STYLE.KEY_BG);
  sheet.getRange(2, REVIEW_COL.INC, body, 1).setBackground(STYLE.DIFF_BG);
  sheet.getRange(2, REVIEW_COL.APPLY, body, 1).setBackground(STYLE.APPLY_BG);
  sheet.getRange(1, 1, data.length, REVIEW_COLS.length).setVerticalAlignment('top');

  // A dropdown rather than free text, so a typo can't be read as a decision.
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['apply', 'skip'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, REVIEW_COL.DECISION, body, 1).setDataValidation(rule);

  sheet.getRange(1, 1, data.length, REVIEW_COLS.length).createFilter();

  sheet.setColumnWidth(REVIEW_COL.N, 45);
  sheet.setColumnWidth(REVIEW_COL.KEY, 240);
  sheet.setColumnWidth(REVIEW_COL.FIELD, 260);
  sheet.setColumnWidth(REVIEW_COL.LABEL, 170);
  sheet.setColumnWidth(REVIEW_COL.ROW_CUR, 80);
  sheet.setColumnWidth(REVIEW_COL.ROW_INC, 85);
  sheet.setColumnWidth(REVIEW_COL.CUR, 300);
  sheet.setColumnWidth(REVIEW_COL.INC, 300);
  sheet.setColumnWidth(REVIEW_COL.DECISION, 90);
  sheet.setColumnWidth(REVIEW_COL.APPLY, 300);
  sheet.setColumnWidth(REVIEW_COL.RESULT, 200);

  sheet.getRange(1, REVIEW_COL.APPLY).setNote(
    'What gets written to the current sheet. Pre-filled with the incoming ' +
    'value; overwrite it to apply something else entirely.');
  sheet.getRange(1, REVIEW_COL.DECISION).setNote(
    'apply = write value_to_apply back to the current sheet.\n' +
    'skip  = leave the current sheet alone.\n\n' +
    'Every line starts on skip. Mark the ones you have reviewed and accepted, ' +
    'then run CA-R Tools \u2192 Apply reviewed MD updates.');

  res.reviewRows = body;
  res.reviewOversize = oversize;
}

/* ------------------------------------------------------------------ */
/* Applying reviewed changes                                           */
/* ------------------------------------------------------------------ */

var APPLY_CONTEXT_KEY = 'carmd_apply_context';

function saveApplyContext_(res) {
  try {
    PropertiesService.getDocumentProperties().setProperty(APPLY_CONTEXT_KEY, JSON.stringify({
      version: VERSION,
      generated: res.started.getTime(),
      spreadsheetId: res.cur.spreadsheetId,
      spreadsheetName: res.cur.spreadsheetName,
      sheetName: res.cur.sheetName,
      headerRow: res.headerRow,
      keyField: res.keyField,
      keyRules: res.keyRuleIds,
      translate: res.translate
    }));
  } catch (e) {
    // Not fatal — the comparison still stands, only the apply step needs this.
  }
}

function loadApplyContext_() {
  var raw;
  try {
    raw = PropertiesService.getDocumentProperties().getProperty(APPLY_CONTEXT_KEY);
  } catch (e) {
    raw = null;
  }
  if (!raw) {
    throw new Error('No comparison on record for this spreadsheet. Run ' +
      '"MD update compare" first, then apply.');
  }
  return JSON.parse(raw);
}

/**
 * Writes reviewed values back into the current sheet.
 *
 * Every write is guarded: the cell in the current sheet must still hold exactly
 * the value the report recorded as current_value. If someone has edited the
 * sheet since the comparison ran, that row is reported as stale and left alone
 * rather than overwritten with a decision made against outdated information.
 */
function applyReview_(dryRun) {
  var ctx = loadApplyContext_();
  var out = SpreadsheetApp.getActiveSpreadsheet();
  var review = out.getSheetByName(CONFIG.REVIEW_SHEET);
  if (!review) throw new Error('No "' + CONFIG.REVIEW_SHEET + '" tab. Run "MD update compare" first.');

  var lastRow = review.getLastRow();
  if (lastRow < 2) throw new Error('The review sheet has no rows to apply.');
  var rows = review.getRange(2, 1, lastRow - 1, REVIEW_COLS.length).getValues();

  var target = openSpreadsheet_(ctx.spreadsheetId);
  var cur = readTable_(target, ctx.sheetName, ctx.headerRow, ctx.translate);
  var idx = indexByKey_(cur, ctx.keyField, reviveKeyRules_(ctx.keyRules), 'current');
  var tz = target.getSpreadsheetTimeZone();

  var stats = { apply: 0, skip: 0, applied: 0, stale: 0, missingRecord: 0, missingField: 0, unchanged: 0 };
  var results = [];
  var writes = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var decision = String(r[REVIEW_COL.DECISION - 1] || '').trim().toLowerCase();
    var key = String(r[REVIEW_COL.KEY - 1] || '').trim();
    var field = String(r[REVIEW_COL.FIELD - 1] || '').trim();

    if (!key && !field) { results.push(['']); continue; }
    if (decision !== 'apply') { stats.skip++; results.push(['skipped']); continue; }
    stats.apply++;

    var resolved = resolveHeader_(field, ctx.translate).field;
    var colIdx = cur.index[resolved];
    if (colIdx === undefined) {
      stats.missingField++;
      results.push(['field not found in the current sheet']);
      continue;
    }

    var bucket = idx.map[normalizeKeyWith_(key, reviveKeyRules_(ctx.keyRules), 'current')];
    if (!bucket || !bucket.length) {
      stats.missingRecord++;
      results.push(['record not found — key ' + key]);
      continue;
    }
    if (bucket.length > 1) {
      stats.missingRecord++;
      results.push(['ambiguous — key appears ' + bucket.length + '× in the current sheet']);
      continue;
    }
    var row = bucket[0];

    var expected = String(r[REVIEW_COL.CUR - 1] == null ? '' : r[REVIEW_COL.CUR - 1]);
    var actual = row.cells[colIdx];
    if (actual !== expected) {
      stats.stale++;
      results.push(['stale — the current sheet now holds "' + truncate_(actual) + '"; not overwritten']);
      continue;
    }

    var value = serialize_(r[REVIEW_COL.APPLY - 1], tz);
    if (value === expected) {
      stats.unchanged++;
      results.push(['no change needed']);
      continue;
    }

    writes.push({ row: row.rowNum, col: colIdx + 1, value: r[REVIEW_COL.APPLY - 1] });
    results.push(['applied']);
  }

  if (writes.length > CONFIG.MAX_APPLY_CELLS) {
    throw new Error(writes.length + ' cells are marked to apply, above the ' +
      CONFIG.MAX_APPLY_CELLS + ' limit. Check the decision column, or raise ' +
      'CONFIG.MAX_APPLY_CELLS if this really is intended.');
  }

  stats.applied = writes.length;
  stats.target = ctx.spreadsheetName + ' › ' + ctx.sheetName;
  stats.dryRun = !!dryRun;

  if (dryRun) return stats;

  var sheet = target.getSheetByName(ctx.sheetName);
  if (writes.length && CONFIG.BACKUP_BEFORE_APPLY) {
    stats.backup = backupSheet_(target, sheet);
  }
  for (var w = 0; w < writes.length; w++) {
    sheet.getRange(writes[w].row, writes[w].col).setValue(writes[w].value);
  }

  // Record the outcome next to each decision, so a second pass shows what
  // already went through.
  var stamp = Utilities.formatDate(new Date(), out.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
  var stamped = results.map(function (x) {
    return [x[0] === 'applied' ? 'applied ' + stamp : x[0]];
  });
  review.getRange(2, REVIEW_COL.RESULT, stamped.length, 1).setValues(stamped);

  return stats;
}

/**
 * Duplicates a sheet in place, as <name>_backup_YYYY-MM-DD_HHMM.
 *
 * Sheet names are capped at 100 characters, so a long source name is trimmed
 * rather than allowed to throw part-way through an apply run. Returns the name
 * of the backup.
 */
function backupSheet_(ss, sheet) {
  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd_HHmm');
  var suffix = '_backup_' + stamp;
  var base = sheet.getName();
  if (base.length + suffix.length > 100) base = base.substring(0, 100 - suffix.length);

  var name = base + suffix;
  for (var n = 2; ss.getSheetByName(name); n++) {
    var tail = suffix + '_' + n;
    name = (base.length + tail.length > 100 ? base.substring(0, 100 - tail.length) : base) + tail;
  }

  var copy = sheet.copyTo(ss);
  copy.setName(name);
  return name;
}

/** Public: preview counts, confirm, then write. */
function applyReviewedChanges() {
  applyInstallDefaults_();
  var ui = SpreadsheetApp.getUi();
  var preview;
  try {
    preview = applyReview_(true);
  } catch (e) {
    ui.alert('Cannot apply changes', e.message, ui.ButtonSet.OK);
    return;
  }

  var sheetName = String(preview.target).split(' \u203a ').pop();
  var lines = [
    'Target: ' + preview.target,
    '',
    'Marked apply: ' + preview.apply,
    'Marked skip: ' + preview.skip,
    '',
    'Cells that will be written: ' + preview.applied
  ];
  if (preview.unchanged) lines.push('Already matching, nothing to do: ' + preview.unchanged);
  if (preview.stale) lines.push('Stale, will be left alone: ' + preview.stale);
  if (preview.missingRecord) lines.push('Record not found or ambiguous: ' + preview.missingRecord);
  if (preview.missingField) lines.push('Field not found: ' + preview.missingField);
  lines.push('');
  lines.push(preview.applied && CONFIG.BACKUP_BEFORE_APPLY
    ? 'A copy of the sheet will be saved first, as ' + sheetName + '_backup_<date>.'
    : 'No backup copy will be taken.');
  lines.push('', 'Write these changes to the current sheet?');

  if (ui.alert('Apply reviewed changes', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) {
    return;
  }

  var stats = applyReview_(false);
  var done = stats.applied + ' cell' + (stats.applied === 1 ? '' : 's') +
    ' written to ' + stats.target + '.';
  if (stats.backup) done += '\n\nThe sheet as it stood beforehand was saved as "' + stats.backup + '".';
  done += '\n\nThe result column in ' + CONFIG.REVIEW_SHEET +
    ' records what happened to each line.';
  ui.alert('Done', done, ui.ButtonSet.OK);
}

/* ------------------------------------------------------------------ */
/* Output: summary                                                     */
/* ------------------------------------------------------------------ */

function writeSummary_(out, res) {
  var sheet = resetSheet_(out, CONFIG.SUMMARY_SHEET);
  var rows = [];
  var sectionRows = [];
  var warnRows = [];

  function section(title) {
    sectionRows.push(rows.length + 1);
    rows.push([title, '']);
  }
  function line(k, v) { rows.push([k, v === undefined || v === null ? '' : String(v)]); }
  function warn(k, v) { warnRows.push(rows.length + 1); line(k, v); }
  function list(label, items) {
    if (!items.length) { line(label, 'none'); return; }
    line(label, items.length + ' — listed below');
    items.slice(0, CONFIG.MAX_LIST_ITEMS).forEach(function (x) { rows.push(['', x]); });
    if (items.length > CONFIG.MAX_LIST_ITEMS) {
      rows.push(['', '…and ' + (items.length - CONFIG.MAX_LIST_ITEMS) + ' more (raise CONFIG.MAX_LIST_ITEMS to see all)']);
    }
  }

  if (res.matchedPairs === 0 || matchRate_(res) < CONFIG.LOW_MATCH_WARNING) {
    warnRows.push(1);
    rows.push([res.matchedPairs === 0 ? 'NOTHING MATCHED' : 'LOW MATCH RATE',
      res.matchedPairs === 0
        ? 'No record in either sheet found a partner. The key below was the ' +
          'best available, but its values do not identify the same records in ' +
          'both sheets. Treat this run as failed, not as clean.'
        : Math.round(100 * matchRate_(res)) + '% of the smaller sheet matched. ' +
          'Check the key below before trusting the differences.']);
    rows.push(['', '']);
  }

  section('RUN');
  line('Generated', Utilities.formatDate(res.started, out.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss z'));
  line('Script version', VERSION);
  line('Elapsed', (Math.round(res.elapsedMs / 100) / 10) + ' s');
  var mode = [];
  mode.push(CONFIG.IGNORE_WHITESPACE === 'all'
    ? 'leading, trailing and repeated internal whitespace ignored'
    : (CONFIG.IGNORE_WHITESPACE === 'edges'
        ? 'leading and trailing whitespace ignored'
        : 'whitespace exact'));
  mode.push(CONFIG.IGNORE_CASE ? 'letter case ignored' : 'letter case exact');
  if (CONFIG.MULTIVALUE_DELIMITER_SPACING) {
    mode.push('delimiter spacing ignored in the ' + headerLookup_().multivalueCount +
      ' multi-value fields the dictionary defines');
  }
  line('Comparison mode', mode.join('; '));
  if (res.suppressed && res.suppressed.total) {
    line('Differences set aside', res.suppressed.total + ' — matched once the ' +
      'rules above were applied, so they are not in ' + CONFIG.REVIEW_SHEET);
    Object.keys(res.suppressed.byKind).sort().forEach(function (k) {
      rows.push(['  ' + k + ' only', String(res.suppressed.byKind[k])]);
    });
    var f = Object.keys(res.suppressed.byField).sort(function (a, b) {
      return res.suppressed.byField[b] - res.suppressed.byField[a];
    });
    f.slice(0, 10).forEach(function (n) {
      rows.push(['  in ' + fieldLabel_(n, res.cur, res.inc), String(res.suppressed.byField[n])]);
    });
  }
  line('Header row', res.headerRow);

  section('SHEETS');
  line('CURRENT (California Revealed)', res.cur.spreadsheetName + ' › ' + res.cur.sheetName);
  line('  data rows', res.cur.rows.length + (res.cur.blankRows ? '  (' + res.cur.blankRows + ' blank rows skipped)' : ''));
  line('  columns', res.cur.headers.filter(String).length);
  line('INCOMING (partner)', res.inc.spreadsheetName + ' › ' + res.inc.sheetName);
  line('  data rows', res.inc.rows.length + (res.inc.blankRows ? '  (' + res.inc.blankRows + ' blank rows skipped)' : ''));
  line('  columns', res.inc.headers.filter(String).length);

  section('MATCHING KEY');
  line('Key field used', fieldLabel_(res.keyField, res.cur, res.inc));
  line('  as headed in CURRENT', res.cur.raw[res.keyField]);
  line('  as headed in INCOMING', res.inc.raw[res.keyField]);
  line('Key case sensitivity', CONFIG.KEY_MATCH_CASE_SENSITIVE ? 'case sensitive' : 'case insensitive (keys are always trimmed)');
  res.keyTrail.forEach(function (t) { rows.push(['  tried', t]); });

  if (res.keyRules && res.keyRules.length) {
    section('KEY NORMALISATION');
    warnRows.push(rows.length + 1);
    line('Applied with consent', res.keyRules.length + ' rule' +
      (res.keyRules.length === 1 ? '' : 's') + ' — the two sheets did not share ' +
      'a single key value without them');
    res.keyRules.forEach(function (r) {
      rows.push(['  ' + r.label, r.detail]);
    });
    line('Pairings listed in', CONFIG.KEY_MATCH_SHEET + ' — check them before ' +
      'trusting the differences');
  }

  section('RECORDS');
  line('Matched on key', res.matchedPairs + ' (' + Math.round(100 * matchRate_(res)) +
    '% of the smaller sheet)');
  line('With at least one difference', res.records.length);
  line('Differing cells', res.totalDiffCells);
  if (res.reviewRows) {
    line('Review lines in ' + CONFIG.REVIEW_SHEET, res.reviewRows +
      ' — all start on "' + CONFIG.DEFAULT_DECISION + '"; mark the ones to ' +
      'accept, then CA-R Tools → Apply reviewed MD updates');
    if (res.reviewOversize) {
      warn('Values too long to apply automatically', res.reviewOversize +
        ' — forced to skip in the review sheet; edit these by hand');
    }
  }
  if (res.onlyCurrentKeys.length) warn('Only in CURRENT (partner dropped or renamed?)', res.onlyCurrentKeys.length);
  else line('Only in CURRENT', 0);
  if (res.onlyIncomingKeys.length) warn('Only in INCOMING (new records?)', res.onlyIncomingKeys.length);
  else line('Only in INCOMING', 0);
  if (res.duplicateKeys.length) warn('Duplicate keys', res.duplicateKeys.length + ' — paired in document order');
  if (res.unkeyedCurrent.length) warn('CURRENT rows with a blank key', res.unkeyedCurrent.length);
  if (res.unkeyedIncoming.length) warn('INCOMING rows with a blank key', res.unkeyedIncoming.length);

  section('HEADERS');
  if (!res.translate) {
    warn('Header translation', 'OFF — headers compared as literal text');
  } else {
    line('Header translation', 'ON — CA-R Metadata Dictionary, ' + headerLookup_().size + ' field pairs');
    line('Resolution order', 'machine name → machine name (loose) → human-readable label → kept as-is');
    var tr = res.cur.translated.map(function (t) { return 'CURRENT   "' + t[0] + '"  →  ' + t[1]; })
      .concat(res.inc.translated.map(function (t) { return 'INCOMING  "' + t[0] + '"  →  ' + t[1]; }));
    list('Human-readable headers translated', tr);
    var un = uniq_(res.cur.unrecognised.map(function (h) { return 'CURRENT   "' + h + '"'; })
      .concat(res.inc.unrecognised.map(function (h) { return 'INCOMING  "' + h + '"'; })));
    if (un.length) {
      warn('Headers not in the dictionary', un.length + ' — compared as-is where they appear in both sheets; listed below');
      un.slice(0, CONFIG.MAX_LIST_ITEMS).forEach(function (x) { rows.push(['', x]); });
      if (un.length > CONFIG.MAX_LIST_ITEMS) {
        rows.push(['', '…and ' + (un.length - CONFIG.MAX_LIST_ITEMS) + ' more']);
      }
    } else {
      line('Headers not in the dictionary', 'none');
    }
  }

  section('FIELDS');
  line('Compared', res.compared.length);
  if (res.ignored.length) list('Ignored by request', res.ignored);
  if (res.cur.duplicateHeaders.length) warn('Duplicate headers in CURRENT (first occurrence used)', res.cur.duplicateHeaders.join(', '));
  if (res.inc.duplicateHeaders.length) warn('Duplicate headers in INCOMING (first occurrence used)', res.inc.duplicateHeaders.join(', '));
  list('Not compared — only in CURRENT', res.onlyInCurrent);
  list('Not compared — only in INCOMING', res.onlyInIncoming);

  section('DIFFERENCES BY FIELD');
  var ranked = Object.keys(res.fieldCounts).sort(function (a, b) {
    return res.fieldCounts[b] - res.fieldCounts[a] || (a < b ? -1 : 1);
  });
  if (!ranked.length) {
    line('(no differences)', '');
  } else {
    rows.push(['field', 'records affected']);
    sectionRows.push(rows.length); // treat as a sub-header
    ranked.forEach(function (f) {
      var n = res.fieldCounts[f];
      var pct = res.matchedPairs ? Math.round(1000 * n / res.matchedPairs) / 10 : 0;
      var note = (res.matchedPairs && n / res.matchedPairs >= CONFIG.SYSTEMATIC_THRESHOLD)
        ? '  ← systematic; likely an internal field, consider ignoring it'
        : '';
      var r = [fieldLabel_(f, res.cur, res.inc), n + ' (' + pct + '%)' + note];
      if (note) warnRows.push(rows.length + 1);
      rows.push(r);
    });
  }

  if (res.onlyCurrentKeys.length || res.onlyIncomingKeys.length || res.duplicateKeys.length ||
      res.unkeyedCurrent.length || res.unkeyedIncoming.length) {
    section('UNMATCHED AND AMBIGUOUS RECORDS');
    list('Only in CURRENT', res.onlyCurrentKeys);
    list('Only in INCOMING', res.onlyIncomingKeys);
    list('Duplicate keys', res.duplicateKeys);
    list('CURRENT rows with a blank key', res.unkeyedCurrent.map(function (r) { return 'row ' + r; }));
    list('INCOMING rows with a blank key', res.unkeyedIncoming.map(function (r) { return 'row ' + r; }));
  }

  ensureSize_(sheet, rows.length, 2);
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sectionRows.forEach(function (r) {
    sheet.getRange(r, 1, 1, 2).setBackground(STYLE.SECTION_BG).setFontWeight('bold');
  });
  warnRows.forEach(function (r) {
    sheet.getRange(r, 1, 1, 2).setBackground(STYLE.WARN_BG);
  });
  sheet.setColumnWidth(1, 320);
  sheet.setColumnWidth(2, 760);
  sheet.getRange(1, 1, rows.length, 2).setVerticalAlignment('top');
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function resetSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
    sheet.clearConditionalFormatRules();
    if (sheet.getFrozenRows()) sheet.setFrozenRows(0);
    if (sheet.getFrozenColumns()) sheet.setFrozenColumns(0);
  } else {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

/** Grows the sheet so a rows × cols block can be written. */
function ensureSize_(sheet, rows, cols) {
  var maxR = sheet.getMaxRows();
  var maxC = sheet.getMaxColumns();
  if (rows > maxR) sheet.insertRowsAfter(maxR, rows - maxR);
  if (cols > maxC) sheet.insertColumnsAfter(maxC, cols - maxC);
}
