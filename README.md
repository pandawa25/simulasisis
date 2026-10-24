# Simulasi SIS — P02_UNIT_105

Simulator logic diagram SIS / Unit Control (105-UC-xxx) interaktif berbasis web, direverse-engineering dari dokumen `P02_UNIT_105` (34 sheet). Dibangun agar bisa di-build & dibuka sebagai aplikasi statis tanpa perlu Claude atau koneksi apapun — murni HTML/JS, tanpa dependency eksternal.

## Jalankan / lihat hasilnya

**Paling cepat — langsung buka file statis yang sudah di-build:**
```
docs/index.html        # portal / menu semua sheet
docs/sheets/*.html      # simulator tiap sheet
```
Buka `docs/index.html` di browser mana pun (double-click / `file://`, atau serve pakai web server statis apa saja). Tidak perlu `npm install`, tidak perlu server khusus.

**Hosting via GitHub Pages (opsional, supaya ada link publik):**
1. Settings → Pages → Source: `Deploy from a branch` → Branch `main`, folder `/docs`.
2. Tunggu beberapa menit, portal akan live di `https://<username>.github.io/simulasisis/`.

## Struktur repo

```
engine/sim-engine.js           # engine simulasi generik (RS latch, VOTING, AND/OR/NOT/BUFFER) — dipakai sama di semua sheet
templates/sheet.template.html  # template UI simulator per-sheet (canvas, zoom/pan, status dock, dst)
templates/portal.template.html # template UI portal/menu 34 sheet
data/sheets.json               # daftar master 34 sheet: nomor, tag UC, status, slug
data/netlists/<slug>.json      # netlist per sheet (hasil reverse-engineering dari gambar) — hanya ada utk sheet yg sudah digarap
scripts/build.js                # build script (Node.js core only, tanpa dependency) — rakit template+engine+netlist -> docs/
docs/                            # OUTPUT HASIL BUILD — siap di-serve langsung atau via GitHub Pages
ARSITEKTUR.md                    # catatan arsitektur & konvensi logic detail (RS, VOTING, dst)
```

## Cara build ulang

Setelah mengubah template, engine, atau menambah netlist baru:
```bash
node scripts/build.js
```
Tidak butuh `npm install` — script ini pure Node.js core modules (`fs`, `path`), jalan di Node versi berapa pun yang wajar (14+).

Build script otomatis:
- Merender `docs/index.html` (portal) dari `templates/portal.template.html` + `data/sheets.json`.
- Untuk setiap entry di `data/sheets.json` yang punya `data/netlists/<slug>.json`, merender `docs/sheets/<slug>.html` dan menandai entry itu `"status": "done"` + mengisi `url`-nya.
- Entry yang netlist-nya belum ada otomatis tetap `"status": "pending"`.
- Menulis balik `data/sheets.json` dengan status yang sudah disinkronkan.

## Cara menambah sheet baru

1. Siapkan netlist JSON untuk sheet tsb (schema di `ARSITEKTUR.md`), simpan sebagai `data/netlists/sheet-0XX.json` (nama file harus sama dengan `slug` sheet itu di `data/sheets.json`).
2. Jalankan `node scripts/build.js`.
3. Commit & push — `docs/index.html` dan `docs/sheets/sheet-0XX.html` otomatis ter-update, statusnya langsung jadi "Selesai" di portal.

## Status

34 sheet total dari dokumen `P02_UNIT_105 v1.175`. Progress terkini ada di portal (`docs/index.html`, progress bar + filter Selesai/Belum) dan di `data/sheets.json`. Dikerjakan bertahap, satu sheet per reverse-engineering gambar logic diagram aslinya.

## Catatan teknis penting

Lihat `ARSITEKTUR.md` untuk detail konvensi logic yang WAJIB konsisten di semua sheet:
- RS latch = **pulse-to-set** (bukan set-dominant SR latch klasik).
- VOTING = **"sehat jika kompak"** (output FALSE begitu ≥k input FALSE — bukan k-of-n TRUE klasik).
- Layout 3 zona (CAUSE/LOGIC/EFFECT), lane kabel berbasis piksel per-pin (bukan satu titik tengah box) untuk menghindari kabel numpuk di gate multi-input.
