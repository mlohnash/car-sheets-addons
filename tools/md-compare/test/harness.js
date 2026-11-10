/* Minimal Apps Script stubs so Code.js can run under Node for testing. */
const fs = require('fs');

function revive(v) {
  if (v && typeof v === 'object' && v.__date__) return new Date(v.__date__);
  return v === null ? '' : v;
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    for (let i = 0; i < vals.length; i++) {
      const ri = this.r - 1 + i;
      if (!this.sheet.data[ri]) this.sheet.data[ri] = [];
      for (let j = 0; j < vals[i].length; j++) this.sheet.data[ri][this.c - 1 + j] = vals[i][j];
    }
    this.sheet.maxRows = Math.max(this.sheet.maxRows, this.r + vals.length - 1);
    this.sheet.maxCols = Math.max(this.sheet.maxCols, this.c + (vals[0] ? vals[0].length : 0) - 1);
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setBackground(x) { this.sheet.fmt.push(['bg', this.r, this.c, this.nr, this.nc, x]); return this; }
  setNotes(notes) {
    this.sheet.notes = this.sheet.notes || {};
    for (let i = 0; i < notes.length; i++)
      for (let j = 0; j < notes[i].length; j++)
        this.sheet.notes[(this.r + i) + ',' + (this.c + j)] = notes[i][j];
    return this;
  }
  setNote(n) { return this.setNotes([[n]]); }
  setNumberFormat(f) {
    this.sheet.formats = this.sheet.formats || {};
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++)
        this.sheet.formats[(this.r + i) + ',' + (this.c + j)] = f;
    return this;
  }
  setDataValidation(r) { this.sheet.validation = { r: this.r, c: this.c, nr: this.nr, rule: r }; return this; }
  createFilter() { this.sheet.filter = { r: this.r, c: this.c, nr: this.nr, nc: this.nc }; return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setVerticalAlignment() { return this; }
  setWrap() { return this; }
}

class Sheet {
  constructor(name, data) {
    this.name = name;
    this.data = data || [];
    this.fmt = [];
    this.frozenRows = 0; this.frozenCols = 0;
    this.maxRows = Math.max(1000, this.data.length);
    this.maxCols = Math.max(26, this.data.reduce((m, r) => Math.max(m, r.length), 0));
  }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  clear() { this.data = []; this.fmt = []; }
  clearConditionalFormatRules() {}
  getFrozenRows() { return this.frozenRows; }
  getFrozenColumns() { return this.frozenCols; }
  setFrozenRows(n) { this.frozenRows = n; }
  setFrozenColumns(n) { this.frozenCols = n; }
  setColumnWidth() { return this; }
  setName(n) { this.name = n; return this; }
  copyTo(ss) {
    const copy = new Sheet('Copy of ' + this.name, this.data.map(r => r.slice()));
    ss.sheets.push(copy);
    return copy;
  }
}

class Spreadsheet {
  constructor(id, name, sheets) { this.id = id; this.name = name; this.sheets = sheets; }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  getSpreadsheetTimeZone() { return 'America/Los_Angeles'; }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets.push(s); return s; }
}

const fx = require('./fixture');
const active = new Spreadsheet('ACTIVE', 'test workbook', [
  new Sheet('Processing', fx.current.map(r => r.map(revive))),
  new Sheet('Partner', fx.incoming.map(r => r.map(revive)))
]);

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => active,
  openById: (id) => { if (id === 'ACTIVE') return active; throw new Error('no such id ' + id); },
  getUi: () => ({ alert: console.log, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) })
};
global.PropertiesService = (() => {
  const store = {};
  const api = {
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); return api; },
    deleteProperty: k => { delete store[k]; return api; }
  };
  return { getDocumentProperties: () => api, getScriptProperties: () => api, getUserProperties: () => api };
})();

global.SpreadsheetApp.newDataValidation = () => {
  const rule = { values: null, allowInvalid: true };
  const b = {
    requireValueInList(v) { rule.values = v; return b; },
    setAllowInvalid(x) { rule.allowInvalid = x; return b; },
    build() { return rule; }
  };
  return b;
};

global.HtmlService = { createHtmlOutputFromFile: () => ({ setWidth() { return this; }, setHeight() { return this; } }) };
global.Utilities = {
  // Faithful enough for the format strings the code uses: yyyy MM dd HH mm ss z,
  // with quoted literals passed through.
  formatDate: (d, tz, fmt) => {
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const tok = { yyyy: d.getFullYear(), MM: p(d.getMonth() + 1), dd: p(d.getDate()),
                  HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()), z: 'PDT' };
    return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|z/g,
      (m, lit) => (lit !== undefined ? lit : String(tok[m])));
  }
};

module.exports = { active, Sheet, Spreadsheet };
