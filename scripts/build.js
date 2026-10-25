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
const CE_TPL_PATH = path.join(ROOT, 'templates', 'causeeffect.template.html');
const PORTAL_TPL_PATH = path.join(ROOT, 'templates', 'portal.template.html');
const TOKENS_CSS_PATH = path.join(ROOT, 'templates', '_tokens.css');
const TAGSYNC_JS_PATH = path.join(ROOT, 'templates', '_tagsync.js');
const CROSSLINK_JS_PATH = path.join(ROOT, 'templates', '_crosslink.js');
const TAGS_JSON_PATH = path.join(ROOT, 'data', 'tags.json');
const SHEETS_JSON_PATH = path.join(ROOT, 'data', 'sheets.json');
const NETLIST_DIR = path.join(ROOT, 'data', 'netlists');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_SHEETS_DIR = path.join(OUT_DIR, 'sheets');

function read(p) { return fs.readFileSync(p, 'utf-8'); }
function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/* ======================= registry tag lintas sheet =======================
   Tag dengan label yang sama di beberapa sheet = satu tag fisik yang sama,
   jadi konfigurasinya (deskripsi, nomor tag, flag isReset/isMOS/
   healthyWhenTrue) harus identik di semua sheet. Sumber tunggalnya
   data/tags.json; fungsi ini (1) memvalidasi semua netlist & MENGGAGALKAN
   build kalau ada pelanggaran, (2) menyuntikkan konfigurasi registry ke
   node yang memakai tag itu, (3) menandai INPUT yang nilainya dihasilkan
   sheet lain (label yang sama jadi OUTPUT di sheet lain). */
const TAG_CONFIG_FIELDS = ['desc', 'isReset', 'isMOS', 'healthyWhenTrue'];
function applyTagRegistry(netlistsBySlug, sheetNoBySlug) {
  const registry = JSON.parse(read(TAGS_JSON_PATH)).tags || {};
  const usage = {}; // label -> [{ slug, id, type }]
  Object.keys(netlistsBySlug).forEach(function (slug) {
    const nodes = netlistsBySlug[slug].nodes;
    Object.keys(nodes).forEach(function (id) {
      const n = nodes[id];
      if ((n.type !== 'INPUT' && n.type !== 'OUTPUT') || !n.label) return;
      (usage[n.label] = usage[n.label] || []).push({ slug: slug, id: id, type: n.type });
    });
  });
  const errors = [];
  Object.keys(usage).forEach(function (label) {
    const uses = usage[label];
    const slugs = Array.from(new Set(uses.map(function (u) { return u.slug; })));
    const producers = uses.filter(function (u) { return u.type === 'OUTPUT'; });
    const producerSlugs = Array.from(new Set(producers.map(function (u) { return u.slug; })));
    if (slugs.length > 1 && !registry[label]) {
      errors.push('tag "' + label + '" dipakai di ' + slugs.join(', ') + ' tapi belum terdaftar di data/tags.json');
    }
    if (producerSlugs.length > 1) {
      errors.push('tag "' + label + '" jadi OUTPUT di lebih dari satu sheet (' + producerSlugs.join(', ') + ') -- satu tag hanya boleh dihasilkan satu sheet');
    }
    const reg = registry[label];
    uses.forEach(function (u) {
      const n = netlistsBySlug[u.slug].nodes[u.id];
      if (reg) {
        TAG_CONFIG_FIELDS.forEach(function (k) {
          if (k in n) errors.push(u.slug + ' / ' + u.id + ': field "' + k + '" tidak boleh ditulis di netlist utk tag terdaftar "' + label + '" (ambil dari data/tags.json)');
        });
        n.desc = (reg.tagNo ? reg.tagNo + ' — ' : '') + (reg.desc || '');
        ['isReset', 'isMOS', 'healthyWhenTrue'].forEach(function (k) { if (reg[k]) n[k] = true; });
        if (reg.tagNo) n.tagNo = reg.tagNo;
      }
      /* Hubungan antar sheet (dirender sbg keterangan + link navigasi,
         lihat renderCrossLinks di kedua template):
         - INPUT  .linkedFrom : sheet yang MENGHASILKAN tag ini (effect di sana)
         - INPUT  .alsoIn     : sheet lain yang memakai tag ini sbg cause juga
         - OUTPUT .linkedTo   : sheet yang MEMAKAI tag ini sbg cause/initiator */
      const others = slugs.filter(function (s) { return s !== u.slug; });
      if (u.type === 'INPUT') {
        const from = producerSlugs.filter(function (s) { return s !== u.slug; });
        if (from.length) n.linkedFrom = from;
        const also = others.filter(function (s) { return from.indexOf(s) === -1; });
        if (also.length) n.alsoIn = also;
      } else {
        const to = Array.from(new Set(uses.filter(function (x) { return x.type === 'INPUT' && x.slug !== u.slug; })
          .map(function (x) { return x.slug; })));
        if (to.length) n.linkedTo = to;
      }
    });
  });
  Object.keys(registry).forEach(function (label) {
    if (!usage[label]) console.warn('  ! data/tags.json: tag "' + label + '" tidak dipakai di sheet mana pun');
  });
  if (errors.length) {
    console.error('Build GAGAL — konfigurasi tag lintas sheet tidak konsisten:');
    errors.forEach(function (e) { console.error('  - ' + e); });
    process.exit(1);
  }
  const shared = Object.keys(usage).filter(function (l) { return new Set(usage[l].map(function (u) { return u.slug; })).size > 1; });
  console.log('  tag lintas sheet: ' + shared.length + ' (konfigurasi dari data/tags.json, status tersinkron saat runtime)');
}

function main() {
  const engineJs = read(ENGINE_PATH);
  const tokensCss = read(TOKENS_CSS_PATH);
  const tagSyncJs = read(TAGSYNC_JS_PATH);
  const crossLinkJs = read(CROSSLINK_JS_PATH);
  const sheetTpl = read(SHEET_TPL_PATH).replace('<!--SHARED_TOKENS-->', tokensCss).replace('<!--TAGSYNC_JS-->', tagSyncJs).replace('<!--CROSSLINK_JS-->', crossLinkJs);
  const ceTpl = read(CE_TPL_PATH).replace('<!--SHARED_TOKENS-->', tokensCss).replace('<!--TAGSYNC_JS-->', tagSyncJs).replace('<!--CROSSLINK_JS-->', crossLinkJs);
  const portalTpl = read(PORTAL_TPL_PATH).replace('<!--SHARED_TOKENS-->', tokensCss);
  const sheetsData = JSON.parse(read(SHEETS_JSON_PATH));

  // pass 1: tentukan sheet mana yang punya netlist (sudah "done") —
  // urutannya mengikuti urutan nomor sheet di sheets.json, dipakai untuk
  // link navigasi "sheet sebelumnya/berikutnya" di tiap halaman simulator.
  const doneEntries = sheetsData.sheets.filter(function (entry) {
    return entry.slug && fs.existsSync(path.join(NETLIST_DIR, entry.slug + '.json'));
  });

  // pass 1b: baca & validasi semua netlist sekaligus (registry tag lintas sheet)
  const netlistsBySlug = {}, sheetNoBySlug = {};
  doneEntries.forEach(function (entry) {
    netlistsBySlug[entry.slug] = JSON.parse(read(path.join(NETLIST_DIR, entry.slug + '.json')));
    sheetNoBySlug[entry.slug] = entry.sheet;
  });
  applyTagRegistry(netlistsBySlug, sheetNoBySlug);

  let builtCount = 0;
  sheetsData.sheets.forEach(function (entry) {
    if (!entry.slug) return;
    const netlistPath = path.join(NETLIST_DIR, entry.slug + '.json');
    if (!fs.existsSync(netlistPath)) {
      entry.status = 'pending';
      entry.url = null;
      entry.ceUrl = null;
      return;
    }
    const netlist = netlistsBySlug[entry.slug]; // sudah diperkaya registry tag
    netlist.slug = entry.slug;
    const netlistJson = JSON.stringify(netlist);

    const doneIdx = doneEntries.indexOf(entry);
    const prevEntry = doneEntries[doneIdx - 1] || null;
    const nextEntry = doneEntries[doneIdx + 1] || null;
    const ceSlug = entry.slug + '-ce';
    // nav utk halaman logic detail: portal + prev/next (versi detail) +
    // link ke versi Cause & Effect sheet yang sama
    const sheetIndex = {};
    doneEntries.forEach(function (e) {
      sheetIndex[e.slug] = { no: e.sheet, tag: e.tag, url: e.slug + '.html', ceUrl: e.slug + '-ce.html' };
    });
    const navDetail = {
      portalUrl: '../index.html',
      prev: prevEntry ? { sheet: prevEntry.sheet, tag: prevEntry.tag, url: prevEntry.slug + '.html' } : null,
      next: nextEntry ? { sheet: nextEntry.sheet, tag: nextEntry.tag, url: nextEntry.slug + '.html' } : null,
      ceUrl: ceSlug + '.html',
      sheetIndex: sheetIndex
    };
    // nav utk halaman Cause & Effect: portal + prev/next (versi CE) +
    // link balik ke versi logic detail sheet yang sama
    const navCE = {
      portalUrl: '../index.html',
      prev: prevEntry ? { sheet: prevEntry.sheet, tag: prevEntry.tag, url: prevEntry.slug + '-ce.html' } : null,
      next: nextEntry ? { sheet: nextEntry.sheet, tag: nextEntry.tag, url: nextEntry.slug + '-ce.html' } : null,
      detailUrl: entry.slug + '.html',
      sheetIndex: sheetIndex
    };

    let html = sheetTpl;
    html = html.replace('<!--TITLE_BLOCK-->', '<meta charset="utf-8">\n<title>Simulator ' + (netlist.title || netlist.id || entry.slug) + '</title>');
    html = html.replace('<!--TITLE_TAG-->', '');
    html = html.replace('<!--ENGINE_JS-->', engineJs);
    html = html.replace('<!--NETLIST_JSON-->', netlistJson);
    html = html.replace('<!--NAV_JSON-->', JSON.stringify(navDetail));
    writeFile(path.join(OUT_SHEETS_DIR, entry.slug + '.html'), html);

    let ceHtml = ceTpl;
    ceHtml = ceHtml.replace('<!--TITLE_BLOCK-->', '<meta charset="utf-8">\n<title>Cause & Effect ' + (netlist.title || netlist.id || entry.slug) + '</title>');
    ceHtml = ceHtml.replace('<!--TITLE_TAG-->', '');
    ceHtml = ceHtml.replace('<!--ENGINE_JS-->', engineJs);
    ceHtml = ceHtml.replace('<!--NETLIST_JSON-->', netlistJson);
    ceHtml = ceHtml.replace('<!--NAV_JSON-->', JSON.stringify(navCE));
    writeFile(path.join(OUT_SHEETS_DIR, ceSlug + '.html'), ceHtml);

    entry.status = 'done';
    entry.url = 'sheets/' + entry.slug + '.html';
    entry.ceUrl = 'sheets/' + ceSlug + '.html';
    builtCount++;
    console.log('  + sheet ' + String(entry.sheet).padStart(3, '0') + ' (' + entry.tag + ') -> docs/sheets/' + entry.slug + '.html (+ CE)');
  });

  // portal: butuh engine + netlist RINGKAS (hanya id/slug/nodes — tanpa
  // summary/notes yang jadi bagian terbesar file) supaya bisa menghitung
  // sendiri status normal/trip tiap sheet dari state tersimpan
  const portalNetlists = {};
  doneEntries.forEach(function (e) {
    const nl = netlistsBySlug[e.slug];
    portalNetlists[e.slug] = { id: nl.id, slug: e.slug, nodes: nl.nodes };
  });
  let portalHtml = portalTpl;
  portalHtml = portalHtml.replace('<!--ENGINE_JS-->', engineJs);
  portalHtml = portalHtml.replace('<!--CROSSLINK_JS-->', crossLinkJs);
  portalHtml = portalHtml.replace('<!--NETLISTS_JSON-->', JSON.stringify(portalNetlists));
  portalHtml = portalHtml.replace('<!--TITLE_BLOCK-->', '<meta charset="utf-8">\n<title>Portal Simulator SIS — 105-UC (34 Sheet)</title>');
  portalHtml = portalHtml.replace('<!--TITLE_TAG-->', '');
  portalHtml = portalHtml.replace('<!--SHEETS_JSON-->', JSON.stringify(sheetsData, null, 2));
  writeFile(path.join(OUT_DIR, 'index.html'), portalHtml);

  // library layout ELK (vendored, tanpa npm install) -> docs/vendor/, dipakai
  // halaman Logic Detail lewat <script src="../vendor/elk.bundled.js">
  const VENDOR_DIR = path.join(ROOT, 'vendor');
  ['elk.bundled.js', 'ELK-LICENSE.md'].forEach(function (f) {
    writeFile(path.join(OUT_DIR, 'vendor', f), read(path.join(VENDOR_DIR, f)));
  });

  // .nojekyll supaya GitHub Pages tidak memproses folder docs/ lewat Jekyll
  writeFile(path.join(OUT_DIR, '.nojekyll'), '');

  // simpan balik sheets.json dengan status/url yang sudah disinkronkan
  writeFile(SHEETS_JSON_PATH, JSON.stringify(sheetsData, null, 2) + '\n');

  console.log('Build selesai: ' + builtCount + ' sheet + 1 portal -> docs/');
}

main();
