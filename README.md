# Simulasi SIS — P02_UNIT_105

Simulator logic diagram SIS / Unit Control (105-UC-xxx) interaktif berbasis web, direverse-engineering dari dokumen `P02_UNIT_105` (34 sheet). Dibangun agar bisa di-build & dibuka sebagai aplikasi statis tanpa perlu Claude atau koneksi apapun — murni HTML/JS, tanpa dependency eksternal.

## Jalankan / lihat hasilnya

**Paling cepat — langsung buka file statis yang sudah di-build:**
```
docs/index.html        # portal / menu semua sheet
docs/sheets/*.html      # simulator tiap sheet
```
Buka `docs/index.html` di browser mana pun (double-click / `file://`, atau serve pakai web server statis apa saja). Tidak perlu `npm install`, tidak perlu server khusus.

**Hosting via GitHub Pages (opsional, supaya ada link publik gratis):**
1. Settings → Pages → Source: `Deploy from a branch` → Branch `main`, folder `/docs`.
2. Tunggu beberapa menit, portal akan live di `https://<username>.github.io/simulasisis/`.

**Deploy ke Railway:**
1. Railway → New Project → Deploy from GitHub repo → pilih `simulasisis`.
2. Railway otomatis mendeteksi `package.json` → jalankan build command dari `railway.json` (`node scripts/build.js`, merender ulang `docs/` dari source terbaru) lalu start command (`node server.js`, static file server bawaan yang serve folder `docs/`).
3. Tidak perlu env var khusus — `server.js` sudah otomatis pakai `PORT` yang di-inject Railway.
4. Settings → Networking → Generate Domain untuk dapat URL publik (`*.up.railway.app`), atau pasang custom domain.
5. Setiap push ke `main` otomatis re-deploy (build ulang `docs/` + restart server) — jadi sheet baru yang di-commit langsung live tanpa langkah manual tambahan.

## Struktur repo

```
engine/sim-engine.js           # engine simulasi generik (RS latch, VOTING, AND/OR/NOT/BUFFER) — dipakai sama di semua sheet
templates/sheet.template.html  # template UI simulator per-sheet (canvas, zoom/pan, status dock, dst)
templates/portal.template.html # template UI portal/menu 34 sheet
data/sheets.json               # daftar master 34 sheet: nomor, tag UC, status, slug
data/netlists/<slug>.json      # netlist per sheet (hasil reverse-engineering dari gambar) — hanya ada utk sheet yg sudah digarap
scripts/build.js                # build script (Node.js core only, tanpa dependency) — rakit template+engine+netlist -> docs/
docs/                            # OUTPUT HASIL BUILD — siap di-serve langsung, via GitHub Pages, atau Railway
server.js                        # static file server (Node core only, tanpa dependency) — serve docs/, dipakai saat deploy ke Railway
package.json                     # scripts.build (rebuild docs/) & scripts.start (jalankan server.js) — dipakai Railway
railway.json                     # config eksplisit build/start command untuk Railway
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

## Troubleshooting deploy Railway

- **"Railpack failed to prepare the build"** — biasanya karena belum ada `package.json`/`railway.json` sama sekali (repo keliatan sebagai folder statis biasa, bukan project yang jelas cara build/run-nya). Sudah diatasi dengan menambahkan `package.json`, `server.js`, dan `railway.json` di root repo.
- **Build jalan tapi "Service offline" / app crash setelah start** — cek tab `Console`/`View logs` di Railway. Penyebab umum: app listen di port hardcode (mis. `3000`) padahal Railway inject port dinamis lewat env var `PORT` — `server.js` di repo ini sudah menangani ini (`process.env.PORT`), jadi seharusnya tidak kena masalah ini.
- **Portal/sheet baru tidak muncul walau sudah di-commit** — pastikan `node scripts/build.js` sempat dijalankan (baik manual sebelum commit, atau otomatis lewat `buildCommand` di `railway.json` saat Railway deploy) sebelum `docs/` dibaca oleh `server.js`.

## Catatan teknis penting

Lihat `ARSITEKTUR.md` untuk detail konvensi logic yang WAJIB konsisten di semua sheet:
- RS latch = **pulse-to-set** (bukan set-dominant SR latch klasik).
- VOTING = **"sehat jika kompak"** (output FALSE begitu ≥k input FALSE — bukan k-of-n TRUE klasik).
- Layout 3 zona (CAUSE/LOGIC/EFFECT), lane kabel berbasis piksel per-pin (bukan satu titik tengah box) untuk menghindari kabel numpuk di gate multi-input.
