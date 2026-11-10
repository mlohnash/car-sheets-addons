/**
 * Highlight repeated IDs — CA-R Tools add-on
 * Version 1.0.0
 *
 * Adds a conditional formatting rule that highlights rows where an ID
 * (e.g. J001-D) appears more than once with a given file type
 * (e.g. "prsv"). Built from the COUNTIFS approach:
 *   =AND($F2="prsv", COUNTIFS($C:$C, $C2, $F:$F, "prsv")>1)
 *
 * Everything is prompted for in a dialog, with defaults of
 * ID = column C, type = column F, value = "prsv".
 *
 * Global entry points (google.script.run and menus can't call
 * namespaced functions):
 *   HRI_openDialog()   menu: Highlight repeated IDs
 *   HRI_removeRules()  menu: Remove repeated-ID highlighting
 *   HRI_apply(opts)    called from the dialog
 *   HRI_getSheetInfo() called from the dialog
 *   HRI_selfTest()     run from the editor
 */

var HRI = (function () {
  var VERSION = '1.0.0';
  var PROP_PREFIX = 'HRI_RULES_'; // + sheetId -> JSON array of formulas we created

  // ---------- column helpers ----------

  function colToIndex_(letters) {
    var s = String(letters || '').trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(s)) return -1;
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }

  function indexToCol_(n) {
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // ---------- formula building (pure, testable) ----------

  // Quote a value for use inside a formula string literal.
  function q_(v) {
    return '"' + String(v).replace(/"/g, '""') + '"';
  }

  // Escape COUNTIFS wildcards (* ? ~) so they match literally.
  function escWild_(v) {
    return String(v).replace(/([~*?])/g, '~$1');
  }

  /**
   * opts: { idCol, typeCol, value, match: 'exact'|'contains',
   *         rows: 'typed'|'all', trim: bool, startRow: int }
   */
  function buildFormula(opts) {
    var id = opts.idCol, ty = opts.typeCol, s = opts.startRow;
    var idCell = '$' + id + s;
    var tyCell = '$' + ty + s;
    var v = opts.value;
    var idNonBlank, rowTest, count;

    if (opts.trim) {
      var idRange = '$' + id + '$' + s + ':$' + id;
      var tyRange = '$' + ty + '$' + s + ':$' + ty;
      idNonBlank = 'TRIM(' + idCell + ')<>""';
      if (opts.match === 'contains') {
        rowTest = 'ISNUMBER(SEARCH(' + q_(v) + ',' + tyCell + '))';
        count = 'SUMPRODUCT((TRIM(' + idRange + ')=TRIM(' + idCell + '))*ISNUMBER(SEARCH(' + q_(v) + ',' + tyRange + ')))';
      } else {
        rowTest = 'TRIM(' + tyCell + ')=' + q_(v);
        count = 'SUMPRODUCT((TRIM(' + idRange + ')=TRIM(' + idCell + '))*(TRIM(' + tyRange + ')=' + q_(v) + '))';
      }
    } else {
      var idCols = '$' + id + ':$' + id;
      var tyCols = '$' + ty + ':$' + ty;
      idNonBlank = idCell + '<>""';
      if (opts.match === 'contains') {
        rowTest = 'ISNUMBER(SEARCH(' + q_(v) + ',' + tyCell + '))';
        count = 'COUNTIFS(' + idCols + ',' + idCell + ',' + tyCols + ',' + q_('*' + escWild_(v) + '*') + ')';
      } else {
        rowTest = tyCell + '=' + q_(v);
        count = 'COUNTIFS(' + idCols + ',' + idCell + ',' + tyCols + ',' + q_(escWild_(v)) + ')';
      }
    }

    var parts = [idNonBlank];
    if (opts.rows !== 'all') parts.push(rowTest);
    parts.push(count + '>1');
    return '=AND(' + parts.join(',') + ')';
  }

  // ---------- validation ----------

  function validate_(opts, sheet) {
    var errs = [];
    var maxCol = sheet.getMaxColumns();
    var idIdx = colToIndex_(opts.idCol);
    var tyIdx = colToIndex_(opts.typeCol);
    if (idIdx < 1 || idIdx > maxCol) errs.push('ID column "' + opts.idCol + '" is not a column in this sheet.');
    if (tyIdx < 1 || tyIdx > maxCol) errs.push('Type column "' + opts.typeCol + '" is not a column in this sheet.');
    if (idIdx > 0 && idIdx === tyIdx) errs.push('ID column and type column must be different.');
    if (!String(opts.value || '').trim()) errs.push('Enter the type value to look for (for example prsv).');
    var hr = Number(opts.headerRows);
    if (!(hr >= 0 && Math.floor(hr) === hr)) errs.push('Header rows must be a whole number (0 or more).');
    if (!/^#[0-9a-fA-F]{6}$/.test(String(opts.color || ''))) errs.push('Highlight color must be a hex color like #f4cccc.');
    return errs;
  }

  // ---------- sheet operations ----------

  function getSheetInfo() {
    var sheet = SpreadsheetApp.getActiveSheet();
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    var cols = headers.map(function (h, i) {
      return { letter: indexToCol_(i + 1), header: String(h).trim() };
    });
    return {
      sheetName: sheet.getName(),
      columns: cols,
      defaults: {
        idCol: lastCol >= 3 ? 'C' : 'A',
        typeCol: lastCol >= 6 ? 'F' : indexToCol_(Math.min(2, lastCol)),
        value: 'prsv',
        match: 'exact',
        rows: 'typed',
        target: 'row',
        trim: false,
        headerRows: 1,
        color: '#f4cccc'
      }
    };
  }

  function apply(opts) {
    var sheet = SpreadsheetApp.getActiveSheet();
    opts.idCol = String(opts.idCol || '').trim().toUpperCase();
    opts.typeCol = String(opts.typeCol || '').trim().toUpperCase();
    opts.value = String(opts.value || '').trim();
    opts.headerRows = Number(opts.headerRows);

    var errs = validate_(opts, sheet);
    if (errs.length) return { ok: false, message: errs.join('\n') };

    var startRow = opts.headerRows + 1;
    var maxRows = sheet.getMaxRows();
    if (startRow > maxRows) return { ok: false, message: 'There are no rows below the header rows.' };

    opts.startRow = startRow;
    var formula = buildFormula(opts);
    var numRows = maxRows - startRow + 1;

    var range = opts.target === 'id'
      ? sheet.getRange(startRow, colToIndex_(opts.idCol), numRows, 1)
      : sheet.getRange(startRow, 1, numRows, sheet.getMaxColumns());

    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground(opts.color)
      .setRanges([range])
      .build();

    var rules = sheet.getConditionalFormatRules();
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);

    var props = PropertiesService.getDocumentProperties();
    var key = PROP_PREFIX + sheet.getSheetId();
    var mine = JSON.parse(props.getProperty(key) || '[]');
    mine.push(formula);
    props.setProperty(key, JSON.stringify(mine));

    return {
      ok: true,
      message: 'Highlighting added to "' + sheet.getName() + '" (' + range.getA1Notation() + ').',
      formula: formula
    };
  }

  function removeRules() {
    var ui = SpreadsheetApp.getUi();
    var sheet = SpreadsheetApp.getActiveSheet();
    var props = PropertiesService.getDocumentProperties();
    var key = PROP_PREFIX + sheet.getSheetId();
    var mine = JSON.parse(props.getProperty(key) || '[]');
    if (!mine.length) {
      ui.alert('Remove repeated-ID highlighting', 'This tool hasn\'t added any highlighting to "' + sheet.getName() + '".', ui.ButtonSet.OK);
      return;
    }
    var rules = sheet.getConditionalFormatRules();
    var kept = rules.filter(function (r) {
      var c = r.getBooleanCondition();
      if (!c || c.getCriteriaType() !== SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) return true;
      return mine.indexOf(c.getCriteriaValues()[0]) === -1;
    });
    var removed = rules.length - kept.length;
    if (!removed) {
      props.deleteProperty(key);
      ui.alert('Remove repeated-ID highlighting', 'No matching rules were found. They may already have been deleted by hand.', ui.ButtonSet.OK);
      return;
    }
    var resp = ui.alert('Remove repeated-ID highlighting',
      'Remove ' + removed + ' highlighting rule' + (removed === 1 ? '' : 's') + ' from "' + sheet.getName() + '"? Other conditional formatting is left alone.',
      ui.ButtonSet.OK_CANCEL);
    if (resp !== ui.Button.OK) return;
    sheet.setConditionalFormatRules(kept);
    props.deleteProperty(key);
  }

  function openDialog() {
    var html = HtmlService.createHtmlOutputFromFile('HighlightRepeatedIds')
      .setWidth(440)
      .setHeight(600);
    SpreadsheetApp.getUi().showModalDialog(html, 'Highlight repeated IDs');
  }

  // ---------- self test ----------

  function selfTest() {
    var cases = [
      [{ idCol: 'C', typeCol: 'F', value: 'prsv', match: 'exact', rows: 'typed', trim: false, startRow: 2 },
        '=AND($C2<>"",$F2="prsv",COUNTIFS($C:$C,$C2,$F:$F,"prsv")>1)'],
      [{ idCol: 'C', typeCol: 'F', value: 'prsv', match: 'exact', rows: 'all', trim: false, startRow: 2 },
        '=AND($C2<>"",COUNTIFS($C:$C,$C2,$F:$F,"prsv")>1)'],
      [{ idCol: 'C', typeCol: 'F', value: 'prsv', match: 'contains', rows: 'typed', trim: false, startRow: 2 },
        '=AND($C2<>"",ISNUMBER(SEARCH("prsv",$F2)),COUNTIFS($C:$C,$C2,$F:$F,"*prsv*")>1)'],
      [{ idCol: 'C', typeCol: 'F', value: 'prsv', match: 'exact', rows: 'typed', trim: true, startRow: 2 },
        '=AND(TRIM($C2)<>"",TRIM($F2)="prsv",SUMPRODUCT((TRIM($C$2:$C)=TRIM($C2))*(TRIM($F$2:$F)="prsv"))>1)'],
      [{ idCol: 'AA', typeCol: 'B', value: 'a"b*', match: 'exact', rows: 'all', trim: false, startRow: 3 },
        '=AND($AA3<>"",COUNTIFS($AA:$AA,$AA3,$B:$B,"a""b~*")>1)']
    ];
    var fails = [];
    cases.forEach(function (c, i) {
      var got = buildFormula(c[0]);
      if (got !== c[1]) fails.push('Case ' + (i + 1) + '\n  expected ' + c[1] + '\n  got      ' + got);
    });
    if (colToIndex_('AA') !== 27 || indexToCol_(27) !== 'AA') fails.push('Column letter conversion failed');
    var msg = fails.length ? 'FAILED\n' + fails.join('\n') : 'All ' + (cases.length + 1) + ' checks passed';
    Logger.log('HRI v' + VERSION + ' self test: ' + msg);
    return msg;
  }

  return {
    VERSION: VERSION,
    buildFormula: buildFormula,
    getSheetInfo: getSheetInfo,
    apply: apply,
    removeRules: removeRules,
    openDialog: openDialog,
    selfTest: selfTest
  };
})();

// ---------- global entry points ----------

function HRI_openDialog() {
  // Shared-drive guard, once the add-on-wide helper exists.
  if (typeof CAR_requireSharedDrive_ === 'function' && !CAR_requireSharedDrive_()) return;
  HRI.openDialog();
}
function HRI_removeRules() { HRI.removeRules(); }
function HRI_getSheetInfo() { return HRI.getSheetInfo(); }
function HRI_apply(opts) { return HRI.apply(opts); }
function HRI_selfTest() { return HRI.selfTest(); }
