#!/usr/bin/env node
/*
 * Build script — merakit portal + simulator per-sheet jadi HTML statis
 * yang bisa dibuka langsung (atau di-hosting via GitHub Pages dari
 * folder docs/), tanpa butuh Claude atau proses build lain (no deps,
 * pure Node.js core modules saja).
 *
 * Cara pakai:
 *   node scripts/build.js
 *
 * Sumber:
 *   engine/sim-engine.js           -> engine simulasi (sama untuk semua sheet)
 *   templates/sheet.template.html  -> template UI per-sheet
 *   templates/portal.template.html -> template UI portal/menu
 *   data/sheets.json               -> daftar master 34 sheet (status & slug)
 *   data/netlists/<slug>.json      -> netlist per sheet (hanya ada utk sheet yg sudah digarap)
 *
 * Output:
 *   docs/index.html                -> portal (siap di-serve GitHub Pages)
 *   docs/sheets/<slug>.html        -> simulator tiap sheet yang netlist-nya ada
 *
 * Status "done"/"pending" di data/sheets.json otomatis disinkronkan
 * berdasar ADA/TIDAKNYA file data/netlists/<slug>.json — jadi untuk
 * menambah sheet baru, cukup taruh netlist JSON-nya di situ lalu build
 * ulang, tidak perlu edit status manual.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'engine', 'sim-engine.js');
const SHEET_TPL_PATH = path.join(ROOT, 'templates', 'sheet.template.html');
const PORTAL_TPL_PATH = path.join(ROOT, 'templates', 'portal.template.html');
const SHEETS_JSON_PATH = path.join(ROOT, 'data', 'sheets.json');
const NETLIST_DIR = path.join(ROOT, 'data', 'netlists');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_SHEETS_DIR = path.join(OUT_DIR, 'sheets');

function read(p) { return fs.readFileSync(p, 'utf-8'); }
function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function main() {
  const engineJs = read(ENGINE_PATH);
  const sheetTpl = read(SHEET_TPL_PATH);
  const portalTpl = read(PORTAL_TPL_PATH);
  const sheetsData = JSON.parse(read(SHEETS_JSON_PATH));

  // pass 1: tentukan sheet mana yang punya netlist (sudah "done") —
  // urutannya mengikuti urutan nomor sheet di sheets.json, dipakai untuk
  // link navigasi "sheet sebelumnya/berikutnya" di tiap halaman simulator.
  const doneEntries = sheetsData.sheets.filter(function (entry) {
    return entry.slug && fs.existsSync(path.join(NETLIST_DIR, entry.slug + '.json'));
  });

  let builtCount = 0;
  sheetsData.sheets.forEach(function (entry) {
    if (!entry.slug) return;
    const netlistPath = path.join(NETLIST_DIR, entry.slug + '.json');
    if (!fs.existsSync(netlistPath)) {
      entry.status = 'pending';
      entry.url = null;
      return;
    }
    const netlistJson = read(netlistPath);
    const netlist = JSON.parse(netlistJson); // validasi JSON sekalian

    const doneIdx = doneEntries.indexOf(entry);
    const prevEntry = doneEntries[doneIdx - 1] || null;
    const nextEntry = doneEntries[doneIdx + 1] || null;
    const nav = {
      portalUrl: '../index.html',
      prev: prevEntry ? { sheet: prevEntry.sheet, tag: prevEntry.tag, url: prevEntry.slug + '.html' } : null,
      next: nextEntry ? { sheet: nextEntry.sheet, tag: nextEntry.tag, url: nextEntry.slug + '.html' } : null
    };

    let html = sheetTpl;
    html = html.replace('<!--TITLE_BLOCK-->', '<title>Simulator ' + (netlist.title || netlist.id || entry.slug) + '</title>');
    html = html.replace('<!--TITLE_TAG-->', '');
    html = html.replace('<!--ENGINE_JS-->', engineJs);
    html = html.replace('<!--NETLIST_JSON-->', netlistJson);
    html = html.replace('<!--NAV_JSON-->', JSON.stringify(nav));

    writeFile(path.join(OUT_SHEETS_DIR, entry.slug + '.html'), html);
    entry.status = 'done';
    entry.url = 'sheets/' + entry.slug + '.html';
    builtCount++;
    console.log('  + sheet ' + String(entry.sheet).padStart(3, '0') + ' (' + entry.tag + ') -> docs/sheets/' + entry.slug + '.html');
  });

  // portal
  let portalHtml = portalTpl;
  portalHtml = portalHtml.replace('<!--TITLE_BLOCK-->', '<title>Portal Simulator SIS — 105-UC (34 Sheet)</title>');
  portalHtml = portalHtml.replace('<!--TITLE_TAG-->', '');
  portalHtml = portalHtml.replace('<!--SHEETS_JSON-->', JSON.stringify(sheetsData, null, 2));
  writeFile(path.join(OUT_DIR, 'index.html'), portalHtml);

  // .nojekyll supaya GitHub Pages tidak memproses folder docs/ lewat Jekyll
  writeFile(path.join(OUT_DIR, '.nojekyll'), '');

  // simpan balik sheets.json dengan status/url yang sudah disinkronkan
  writeFile(SHEETS_JSON_PATH, JSON.stringify(sheetsData, null, 2) + '\n');

  console.log('Build selesai: ' + builtCount + ' sheet + 1 portal -> docs/');
}

main();
