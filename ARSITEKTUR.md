# Arsitektur Simulator Logic SIS/Unit-Control (34 sheet)

Lihat `README.md` untuk cara build & struktur folder. Dokumen ini fokus ke konvensi logic & rendering yang WAJIB konsisten di semua sheet.

## Konsep
Satu **engine generik** (`engine/sim-engine.js`) + satu **netlist JSON per sheet** (`data/netlists/<slug>.json`, format sama untuk semua 34 sheet) + satu **template UI per-sheet** (`templates/sheet.template.html`) + satu **portal/index** (`templates/portal.template.html` + `data/sheets.json`) yang mendaftar ke-34 sheet dan link ke simulator yang sudah jadi. `scripts/build.js` merakit semuanya jadi HTML statis di `docs/`. Menambah sheet baru = bikin netlist JSON baru di `data/netlists/`, tidak perlu tulis ulang engine/UI — build script otomatis mendeteksi & merender.

## Schema netlist (ringkas)
```json
{
  "id": "105-UC-009",
  "title": "...",
  "sheetRef": "Sheet X of 34 — ...",
  "causeGroups": ["nama grup cause 1", "nama grup cause 2", ...],
  "effectGroups": ["Output Proses (ke lapangan)", "Internal HMI (monitor saja)"],
  "nodes": {
    "<nodeId>": {
      "type": "INPUT|AND|OR|NOT|BUFFER|RS|VOTING|OUTPUT",
      "label": "tag name asli", "desc": "deskripsi singkat", "gateId": "ID gray-box di gambar asli",
      "group": "harus cocok salah satu nilai causeGroups (utk INPUT) atau effectGroups (utk OUTPUT)",
      "inputs": ["<nodeId>", ...],      // AND/OR/VOTING
      "k": 2,                            // VOTING saja — threshold JUMLAH INPUT FALSE sebelum output ikut jatuh FALSE (BUKAN "k dari n TRUE", lihat penjelasan di bawah)
      "s": "<nodeId>", "r": "<nodeId>",  // RS
      "input": "<nodeId>",               // NOT/BUFFER
      "source": "<nodeId>"               // OUTPUT (tap/monitor tag)
    }
  },
  "notes": ["asumsi/konfirmasi penting ..."]
}
```

### RS latch = pulse-to-set (BUKAN set-dominant klasik)
Dikonfirmasi langsung oleh user — versi awal implementasi set-dominant SR latch itu **salah/terbalik**.
- `S` = pin enable sekaligus clear-langsung. **S FALSE → Q langsung FALSE dan terkunci di situ**, apapun nilai R.
- `R` ("Reset" di gambar asli) = pin **pulsa-untuk-set**, bukan pelepas latch. Selama S TRUE, Q mengikuti nilai sebelumnya (hold) **kecuali** R baru saja naik dari 0→1 (pulsa sesaat) pada step itu — barulah Q terkunci TRUE.
- Urutan untuk mengunci Q=TRUE: pastikan S TRUE dulu, baru pulsa R 0→1→0.
- Implementasi butuh dua memory per node RS: `rsPrev` (nilai Q step sebelumnya, untuk hold) dan `rPrev` (nilai R step sebelumnya, untuk deteksi rising-edge). Lihat `engine/sim-engine.js` case `"RS"`.
- **Koreksi (2026-10-24, #4)**: lingkaran kecil di pin R1 **memang indikasi inversi (NOT) sungguhan**, bukan simbol dekoratif — catatan sebelumnya yang bilang "bukan inversi" salah, dikoreksi user. Sudah di-re-trace pixel-by-pixel ulang utk SEMUA blok RS di sheet 002 & 006 (rs_003, RST_F/002, RST_C/015, RST_D/010, RST_E/019 — 5 blok independen) dan polanya **konsisten**: pin `S` selalu disambung ke output logic kondisi-trip (OR/AND), pin `R1` (dgn lingkaran) selalu disambung ke tag reset manual / Q1 dari RS hulu. Lingkaran itu artinya block internal membaca R1 secara active-low (invert dulu sebelum dipakai) — tapi ini level implementasi hardware si block FBD, bukan level fungsional. Secara **fungsional**, efek nyata yang sudah divalidasi & dikonfirmasi user tetap: tombol reset ditekan (tag reset naik 0→1 sesaat) = trigger "pulsa-untuk-set", BUKAN turun 0 saat ditekan — karena itulah netlist tetap memetakan `r` = tag reset mentah (bukan di-NOT dulu) dan engine mendeteksi rising-edge dari situ, supaya hasil sim match perilaku nyata (tekan reset saat sehat → output ON). Jadi: **field `s`/`r` di netlist TIDAK berubah** untuk kedua sheet yang sudah ada — lingkaran R1 sudah "terserap" di semantik pulsa-untuk-set engine, bukan sesuatu yang perlu di-NOT eksplisit lagi di netlist.

### VOTING = "sehat jika kompak" (BUKAN k-of-n TRUE klasik)
Dikonfirmasi user — versi awal (k-of-n TRUE) juga **salah/terbalik**.
- Input dianggap normal/sehat = TRUE. Output voting langsung jatuh **FALSE** begitu jumlah input yang FALSE mencapai `k`.
- Contoh 2oo9 (`k=2`, 9 input): output tetap TRUE selama maksimal 1 input FALSE; begitu 2 atau lebih input FALSE, output FALSE (trip).
- Formula: `output = (jumlah input FALSE) < k`. Lihat `engine/sim-engine.js` case `"VOTING"`.

### Konvensi warna CAUSE & EFFECT berbeda dengan warna Logic Detail
**Koreksi (2026-10-24, #5)**, dikonfirmasi user — ini bukan bug, dua halaman memang sengaja pakai 2 konvensi indikator berbeda untuk konsep fail-safe yang sama:
- **Logic Detail** (`sheet.template.html`): warna ngikut **nilai mentah sinyal apa adanya** — TRUE=merah, FALSE=hijau, titik. Dipakai buat nelusurin wire/gate, jadi harus representasi nilai literal tanpa interpretasi.
- **Cause & Effect** (`causeeffect.template.html`): warna ngikut **kondisi NORMAL vs TRIP**, hijau=normal, merah=trip — ini konvensi standar cause & effect diagram di industri (STAT hijau = kondisi 1/normal, merah = kondisi 0/trip), KEBALIKAN dari halaman Logic Detail untuk sinyal yang sama. Aturan per tipe node (lihat `isNormal()` di template):
  - `OUTPUT` (kolom EFFECT): TRUE = energized/jalan normal = **hijau**, FALSE = mati/terkunci trip = **merah** (kebalikan dari CAUSE!).
  - `INPUT` (kolom CAUSE/MOS/Reset): defaultnya FALSE = normal/belum aktif = **hijau**, TRUE = alarm/tombol aktif = **merah** — KECUALI node ditandai `"healthyWhenTrue": true` di netlist (tag transmitter fail-safe yang sudah di-NOT duluan, mis. `f105LAHH003` "sehat=TRUE"), untuk node itu TRUE = sehat = **hijau**.
- Efek samping yang BENAR (bukan bug): karena semua RS latch default `FALSE` sebelum pernah direset, halaman CE akan tampil **semua EFFECT merah (trip)** saat pertama dibuka/reset — ini representasi akurat kondisi "belum pernah direset operator", bukan kesalahan tampilan.
- Saat bikin netlist sheet baru: cek per tag INPUT apakah butuh flag `healthyWhenTrue` (biasanya ditandai di desc aslinya dengan kata "sehat=TRUE" / "fail-safe").

### Lain-lain
- Sinyal yang direferensikan ulang di tempat lain pada sheet yang sama (contoh: `AND_105UC009_FEED1`) dimodel sebagai node biasa yang di-reference oleh id — selama tidak membentuk loop aljabar, engine jalan satu pass topological per step.

## Layout & rendering (di `templates/sheet.template.html`)

- **Layout 3 zona** (di renderer, bukan di engine): semua node `OUTPUT` dipaksa ke satu kolom paling kanan (EFFECT) terlepas dari kedalaman topological aslinya; `INPUT` selalu di kolom 0 (CAUSE); sisanya (AND/OR/NOT/BUFFER/RS/VOTING) di kolom tengah (LOGIC & PERMISSIVE). Kolom CAUSE & EFFECT diurutkan & diberi label sesuai `causeGroups`/`effectGroups`, dengan gap ekstra antar grup. Lebar kolom (`COL_W`) dan lebar box tag (`boxSize`) dijaga longgar (gap antar kolom ≥ ~100px) supaya ada ruang untuk lane kabel — kalau makin banyak node per kolom pada sheet baru, pertimbangkan naikkan `COL_W` lagi.
- **Tinggi box dinamis & pin per-input (PENTING, jangan di-regresi)**: `boxSize()` untuk AND/OR/VOTING menghitung tinggi box berdasar JUMLAH INPUT (`16 + n*13`, minimum tinggi default), bukan tinggi tetap — supaya tiap pin input dapat slot vertikal sendiri. `centerOf(id, 'in', counterpartId)` menyebar titik sambung kabel sepanjang sisi kiri box sesuai urutan `deps(n)` (index dari node sumber), **BUKAN satu titik tengah untuk semua input**. Kalau titik 'in' balik jadi satu titik tengah, gate multi-input (AND014 5-input, VOT 9-input, dst) akan terlihat numpuk lagi — ini pernah jadi bug dan sudah diperbaiki, jangan diulang di template baru.
- **Kabel (wire) di canvas**: rute siku/orthogonal (bukan kurva), warna live ikut nilai sinyal (hijau=FALSE, merah=TRUE, yang TRUE ditebalkan & dipindah ke depan). Lane belokan vertikal dihitung sebagai **posisi piksel absolut** (bukan fraksi jarak ke tujuan) di dalam gap setelah node asal, dikelompokkan per kolom-asal & diurutkan berdasar posisi Y tujuan (pin tujuan, bukan titik tengah box) — supaya setiap kabel di satu kolom dapat lane unik yang tersebar rata di gap yang tersedia. Plus tanda pin kecil (`pin-tick`) di sisi kiri tiap gate multi-input menandai persis posisi tiap pin. Klik node manapun (selain INPUT) = highlight jalur hulu/cause-nya (independen dari warna live) untuk tracing manual; klik lagi atau tombol "Bersihkan Jejak" untuk lepas.
- **Kontrol kanvas**: toolbar zoom in/out/Fit/Reset di atas kanvas, plus Ctrl/Cmd+scroll untuk zoom dan klik-seret untuk pan — penting untuk sheet dengan banyak node (kolom CAUSE besar).
- **Panel status**: hanya **Output/Effect** yang jadi panel mengambang (floating dock) di bawah viewport, selalu terlihat walau kanvas discroll/zoom. Status Latch (RS) ditampilkan sebagai kartu biasa di bawah kanvas (non-floating), bersama catatan & netlist JSON.

## Cara menambah sheet baru
1. Siapkan gambar logic diagram sheet tsb, lalu re-trace jadi netlist JSON dengan schema di atas (termasuk verifikasi junction kalau ada wiring ambigu), plus isi `causeGroups`/`effectGroups`/`group` per node biar layout 3 zona otomatis kebentuk.
2. Simpan sebagai `data/netlists/<slug>.json` — `<slug>` harus sama dengan field `slug` entry sheet itu di `data/sheets.json` (pola: `sheet-0XX`).
3. Pakai `engine/sim-engine.js` + `templates/sheet.template.html` apa adanya (RS pulse-to-set, VOTING sehat-jika-kompak, pin per-input — semua sudah dikonfirmasi user) — tidak perlu re-derive logic kecuali user bilang beda untuk sheet tsb.
4. `node scripts/build.js` — otomatis merender `docs/sheets/<slug>.html` dan menandai entry itu `"status": "done"` di `data/sheets.json` + `docs/index.html` (portal) ikut ter-update.
5. Commit & push.

## Status sheet (34 total)
Sumber-of-truth status & URL ada di `data/sheets.json` (field `status`/`url`, otomatis disinkronkan oleh `scripts/build.js` berdasar ada/tidaknya file netlist). Tabel di bawah untuk referensi cepat per 2026-10-24 — **selalu cek `data/sheets.json` untuk status terkini**.

| Sheet | Tag | Keterangan | Status |
|---|---|---|---|
| 001 | P02 | Cover/index sheet | Belum |
| 002 | 105-UC-001/002/024 | | Belum |
| 003 | 105-UC-005/025 | | Belum |
| 004 | 105-UC-007 | | Belum |
| 005 | 105-UC-032/011/012/027 | | Belum |
| 006 | 105-UC-009 | | **Selesai** |
| 007 | 105-UC-010 a | | Belum |
| 008 | 105-UC-010 b | | Belum |
| 009 | 105-UC-010 c | | Belum |
| 010 | 105-UC-010 d | | Belum |
| 011 | 105-UC-010 e | | Belum |
| 012 | 105-UC-010 f | | Belum |
| 013 | 105-UC-003 | | Belum |
| 014 | 105-UC-004 a | | Belum |
| 015 | 105-UC-004 b | | Belum |
| 016 | 105-UC-006 | | Belum |
| 017 | 105-UC-008 | +026 | Belum |
| 018 | 105-UC-013 | | Belum |
| 019 | 105-UC-014 | +016 | Belum |
| 020 | 105-UC-015 | +018, 028 | Belum |
| 021 | 105-UC-021 | +022, 023 | Belum |
| 022 | 105-UC-019 | +029 | Belum |
| 023 | 105-UC-020 | | Belum |
| 024 | 105-UC-030 bag.1 | | Belum |
| 025 | 105-UC-017-030 bag.2a | | Belum |
| 026 | 105-UC-017-030 bag.2b | | Belum |
| 027 | 105-UC-017-030 bag.2c | | Belum |
| 028 | 105-UC-030 bag.3a | | Belum |
| 029 | 105-UC-030 bag.3b | | Belum |
| 030 | 105-UC-031 bag.1 | | Belum |
| 031 | 105-UC-031 bag.2 | | Belum |
| 032 | CPRS | | Belum |
| 033 | XA003 | | Belum |
| 034 | XA009 | | Belum |

## Catatan verifikasi dari sheet 006 / 105-UC-009 (dicek via crop/zoom junction, bukan tebak posisi)
- RST_105UC009_E.S = RST_105UC009_F.Q1 (bukan dari AND018 seperti dugaan awal) — dikonfirmasi lewat T-junction eksplisit.
- AND009 = AND 3-input (RS_A.Q1, OR004, OR006) — bukan 2-input.
- AND014 = AND 5-input, AND018 = AND 4-input.
- VOT_009_105UC009 = voting 2oo9.
- AND018 (gabungan RST_D, RS_B, RST_C, Voting) adalah pin **R** (pulsa-set) untuk RST_E, bukan S — jadi RST_E baru bisa "diset ulang" kalau keempat initiator itu kompak TRUE bersamaan DAN RST_F.Q1 (S-nya) juga TRUE.
- **Koreksi (2026-10-24, #1)**: logic RS awalnya diimplementasikan sebagai set-dominant SR latch standar — terbalik/salah. Yang benar pulse-to-set seperti dijelaskan di atas.
- **Koreksi (2026-10-24, #2)**: logic VOTING awalnya diimplementasikan sebagai k-of-n TRUE klasik — terbalik/salah. Yang benar "sehat jika kompak".
- **Koreksi (2026-10-24, #3)**: kabel di zona LOGIC & PERMISSIVE sempat masih terlihat numpuk walau lane sudah per-piksel — root cause-nya titik sambung 'in' semua gate cuma SATU titik tengah box, jadi semua kabel masuk ke gate multi-input (AND014 5-input, VOT 9-input, dst) numpuk persis di satu pixel yang sama. Diperbaiki: titik 'in' disebar per-index input di sepanjang sisi kiri box + box jadi lebih tinggi otomatis kalau pin-nya banyak.

## Riwayat
Proyek ini dikembangkan secara iteratif bersama Claude (reverse-engineering gambar logic diagram → netlist JSON → simulator interaktif). Repo ini adalah hasil final yang di-push supaya bisa di-build & dijalankan mandiri tanpa perlu membuka Claude lagi. Progres selanjutnya (sheet 2–34) bisa dikerjakan lewat Claude lagi lalu di-push ke sini, atau dikerjakan manual mengikuti schema di atas.
