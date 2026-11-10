#!/usr/bin/env node
/**
 * Assembles one add-on into dist/<addon>/, ready for `clasp push`.
 *
 *   node build.js team        build CA-R Tools
 *   node build.js             lists the add-ons and asks which to build
 *   node build.js --all       build every add-on
 *
 * Apps Script puts every file in a project into one global namespace, so
 * before writing anything the build checks for the problems that has
 * caused before:
 *   - more than one onOpen (Apps Script silently uses the last one loaded)
 *   - the same top-level function or var defined in two files
 *   - a menu item, dialog call, or HTML file reference that points at
 *     something not in the project
 * Any of these stops the build with exit code 1.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = __dirname;
const ADDONS_DIR = path.join(ROOT, 'addons');
const DIST_DIR = path.join(ROOT, 'dist');

function listAddons() {
  return fs.readdirSync(ADDONS_DIR)
    .filter(d => fs.existsSync(path.join(ADDONS_DIR, d, 'addon.json')))
    .sort();
}

function readAddon(id) {
  const file = path.join(ADDONS_DIR, id, 'addon.json');
  if (!fs.existsSync(file)) throw new Error('No add-on called "' + id + '". Available: ' + listAddons().join(', '));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** tools/md-compare/src/Code.js -> md-compare_Code.js ; addons/team/Menu.js -> addon_Menu.js */
function outName(src) {
  const parts = src.split('/');
  const base = parts[parts.length - 1];
  if (base.endsWith('.html')) return base; // HtmlService looks these up by bare name
  let prefix;
  if (parts[0] === 'tools') prefix = parts[1];
  else if (parts[0] === 'addons') prefix = 'addon';
  else prefix = parts[0];
  return prefix + '_' + base;
}

function topLevelNames(code) {
  const names = [];
  const re = /^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|var\s+([A-Za-z_$][\w$]*)\b|const\s+([A-Za-z_$][\w$]*)\b|let\s+([A-Za-z_$][\w$]*)\b)/gm;
  let m;
  while ((m = re.exec(code))) names.push(m[1] || m[2] || m[3] || m[4]);
  return names;
}

/**
 * Server function names called through google.script.run in a dialog.
 * Walks each call chain (.withSuccessHandler(...).withFailureHandler(...).fn(...)),
 * skipping balanced parentheses so handler bodies aren't mistaken for calls.
 */
function serverCalls(code) {
  const HANDLERS = new Set(['withSuccessHandler', 'withFailureHandler', 'withUserObject']);
  const names = [];
  const marker = 'google.script.run';
  let i = code.indexOf(marker);
  while (i !== -1) {
    let p = i + marker.length;
    for (;;) {
      while (/\s/.test(code[p] || '')) p++;
      if (code[p] !== '.') break;
      p++;
      while (/\s/.test(code[p] || '')) p++;
      const m = /^[A-Za-z_$][\w$]*/.exec(code.slice(p));
      if (!m) break;
      p += m[0].length;
      while (/\s/.test(code[p] || '')) p++;
      if (code[p] !== '(') break;
      let depth = 0;
      for (; p < code.length; p++) {
        if (code[p] === '(') depth++;
        else if (code[p] === ')' && --depth === 0) { p++; break; }
      }
      if (!HANDLERS.has(m[0])) names.push(m[0]);
    }
    i = code.indexOf(marker, i + marker.length);
  }
  return names;
}

/** Returns a list of problems; empty means the project is consistent. */
function checkProject(files) {
  const problems = [];
  const js = files.filter(f => f.out.endsWith('.js'));
  const html = files.filter(f => f.out.endsWith('.html'));

  const defined = new Map(); // name -> [files]
  js.forEach(f => topLevelNames(f.code).forEach(n => {
    if (!defined.has(n)) defined.set(n, []);
    defined.get(n).push(f.src);
  }));

  const onOpens = defined.get('onOpen') || [];
  if (onOpens.length !== 1) {
    problems.push('Expected exactly one onOpen, found ' + onOpens.length +
      (onOpens.length ? ' (' + onOpens.join(', ') + ')' : ''));
  }
  defined.forEach((where, name) => {
    if (where.length > 1 && name !== 'onOpen') {
      problems.push('"' + name + '" is defined in more than one file: ' + where.join(', '));
    }
  });

  const isFn = name => js.some(f => new RegExp('^function\\s+' + name + '\\s*\\(', 'm').test(f.code));

  js.forEach(f => {
    const re = /\.addItem\(\s*['"][^'"]*['"]\s*,\s*['"]([\w$]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(f.code))) {
      if (!isFn(m[1])) problems.push('Menu item in ' + f.src + ' calls ' + m[1] + ', which is not defined');
    }
    const hre = /createHtml(?:Output|Template)FromFile\(\s*['"]([^'"]+)['"]/g;
    while ((m = hre.exec(f.code))) {
      const want = m[1] + '.html';
      if (!html.some(h => h.out === want)) problems.push(f.src + ' opens HTML file "' + m[1] + '", which is not in the project');
    }
  });

  html.forEach(h => {
    serverCalls(h.code).forEach(name => {
      if (!isFn(name)) problems.push(h.src + ' calls google.script.run.' + name + ', which is not defined');
    });
  });

  const seen = new Map();
  files.forEach(f => {
    if (seen.has(f.out)) problems.push('Two sources would both be written as ' + f.out + ': ' + seen.get(f.out) + ', ' + f.src);
    seen.set(f.out, f.src);
  });

  return problems;
}

function loadFiles(addon) {
  return addon.sources.map(src => {
    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) throw new Error('Source listed in addon.json does not exist: ' + src);
    return { src, out: outName(src), code: fs.readFileSync(abs, 'utf8') };
  });
}

function build(id, opts) {
  opts = opts || {};
  const addon = readAddon(id);
  const files = loadFiles(addon);
  const problems = checkProject(files);
  if (problems.length) {
    const err = new Error('Build of "' + id + '" stopped:\n  - ' + problems.join('\n  - '));
    err.problems = problems;
    throw err;
  }

  const outDir = path.join(opts.distDir || DIST_DIR, id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  files.forEach(f => fs.writeFileSync(path.join(outDir, f.out), f.code));
  fs.copyFileSync(path.join(ROOT, addon.manifest), path.join(outDir, 'appsscript.json'));

  const clasp = path.join(ADDONS_DIR, id, '.clasp.json');
  const haveClasp = fs.existsSync(clasp);
  if (haveClasp) fs.copyFileSync(clasp, path.join(outDir, '.clasp.json'));

  if (!opts.quiet) {
    console.log('Built ' + addon.name + ' -> ' + path.relative(ROOT, outDir) + ' (' + files.length + ' files + manifest)');
    if (!haveClasp) {
      console.log('  No addons/' + id + '/.clasp.json yet, so clasp push will not know where to go.');
      console.log('  Copy addons/' + id + '/.clasp.json.example to .clasp.json and paste in the script ID.');
    }
  }
  return { outDir, files: files.map(f => f.out) };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a.trim()); }));
}

async function main() {
  const args = process.argv.slice(2);
  let ids;
  if (args.includes('--all')) {
    ids = listAddons();
  } else if (args.length) {
    ids = args;
  } else {
    const all = listAddons();
    all.forEach((id, i) => console.log('  ' + (i + 1) + '. ' + id + ' (' + readAddon(id).name + ')'));
    const a = await ask('Which add-on should I build? Enter a number or name: ');
    const pick = /^\d+$/.test(a) ? all[Number(a) - 1] : a;
    if (!pick) { console.error('Nothing chosen.'); process.exit(1); }
    ids = [pick];
  }
  let failed = false;
  ids.forEach(id => {
    try { build(id); } catch (e) { failed = true; console.error(e.message); }
  });
  process.exit(failed ? 1 : 0);
}

module.exports = { build, checkProject, serverCalls, outName, topLevelNames, listAddons };

if (require.main === module) main();
