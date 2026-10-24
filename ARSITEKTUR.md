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
- `S` = pin enable sekaligus clear-langsung (field `s` di netlist). **`s` FALSE → Q langsung FALSE dan terkunci di situ**, apapun nilai `r`.
- `r` di netlist = pin **pulsa-untuk-set**, bukan pelepas latch. Selama `s` TRUE, Q mengikuti nilai sebelumnya (hold) **kecuali** `r` baru saja naik dari 0→1 (pulsa sesaat) pada step itu — barulah Q terkunci TRUE.
- Urutan untuk mengunci Q=TRUE: pastikan `s` TRUE dulu, baru pulsa `r` 0→1→0.
- Implementasi butuh dua memory per node RS: `rsPrev` (nilai Q step sebelumnya, untuk hold) dan `rPrev` (nilai `r` step sebelumnya, untuk deteksi rising-edge). Lihat `engine/sim-engine.js` case `"RS"` — **engine ini TIDAK berubah** dari awal, yang berubah (lihat Koreksi #6) adalah PEMETAAN sinyal mana yang masuk field `s` vs `r` di netlist.
- **PENTING — field netlist `s`/`r` BUKAN nama literal pin gambar `S`/`R1`.** Dari gambar (pin `S` di atas box, pin `R1` dgn lingkaran kecil di bawah box): **pin gambar `S` = tag RESET manual (pulsa)**, **pin gambar `R1` (lingkaran = inversi/NOT sungguhan) = gerbang KONDISI (OR/AND dari alarm/ESD/MOS, atau Q1 dari RS hulu)**. Supaya cocok dengan semantik engine di atas (yang butuh `s`=level-dominant-clear, `r`=pulsa-set): **`s` di netlist = NOT(gerbang kondisi yang masuk ke pin R1)**, **`r` di netlist = tag reset mentah yang masuk ke pin S (tanpa NOT)**.
- **Koreksi (2026-10-24, #6) — MEMBATALKAN koreksi #4 di bawah, yang ternyata SALAH.** User sudah 3x mengingatkan bahwa pin S = reset & pin R1 = kondisi+NOT, sebelumnya 2x saya re-trace dan keliru menyimpulkan sebaliknya. Akhirnya ditelusuri tuntas dari screenshot live DCS beresolusi tinggi (bukan gambar statis) dan terbukti user benar. Bug fungsional yang mengonfirmasi: dengan wiring lama (field `s` = kondisi mentah tanpa NOT), saat plant benar-benar sehat (semua alarm FALSE) field `s` selalu FALSE → Q terkunci FALSE permanen → **reset tidak pernah bisa berhasil**, kebalikan total dari perilaku SIS yang benar. Fix yang diterapkan di `data/netlists/sheet-002.json` & `sheet-006.json`: tambah node `NOT` eksplisit yang membalik gerbang kondisi sebelum masuk field `s` (`r` tidak berubah). Untuk RS yang gerbang kondisinya CAMPURAN — mengombinasikan Q1 dari RS lain (polaritas "sehat=TRUE") dengan gerbang OR/AND mentah (polaritas "alarm=TRUE") dalam satu AND, misalnya `g009_AND`/`g018_AND` di sheet-006 — NOT di LUAR AND saja tidak cukup (secara De Morgan hasilnya salah): harus NOT spesifik pada term yang berpolaritas alarm SEBELUM masuk AND, baru AND hasil koreksi itu (semua term sudah berpolaritas "sehat=TRUE") dipakai langsung sebagai `s` tanpa NOT tambahan di luar. Temuan tambahan dari re-trace ini: `rstE_019` (sheet-006) pin S-nya ternyata BUKAN ke `rstF_002.Q1` seperti dikira sebelumnya, melainkan ke tag reset `f105HS009UCR` yang SAMA dengan `rstF_002` (satu tombol reset, dua latch sekaligus) — jadi field `r`-nya diperbaiki juga. Detail lengkap tiap gate ada di `notes` masing-masing netlist JSON. Tervalidasi lewat >10 skenario Node mencakup semua 8 latch (2 di sheet-002, 6 di sheet-006): sehat+reset→TRUE, trip (tiap jenis kondisi)+reset-attempt→tetap FALSE (gagal), trip-lepas+reset→TRUE, cascade antar-latch, dan urutan reset yang benar untuk latch bertingkat.
- **(SALAH, dibatalkan #6 — disimpan sbg riwayat) Koreksi (2026-10-24, #4)**: sebelumnya disimpulkan lingkaran R1 "sudah terserap" di semantik pulsa-untuk-set engine dan `s`/`r` netlist tidak perlu diubah. Kesimpulan ini keliru — lihat #6.

### VOTING = "sehat jika kompak" (BUKAN k-of-n TRUE klasik)
Dikonfirmasi user — versi awal (k-of-n TRUE) juga **salah/terbalik**.
- Input dianggap normal/sehat = TRUE. Output voting langsung jatuh **FALSE** begitu jumlah input yang FALSE mencapai `k`.
- Contoh 2oo9 (`k=2`, 9 input): output tetap TRUE selama maksimal 1 input FALSE; begitu 2 atau lebih input FALSE, output FALSE (trip).
- Formula: `output = (jumlah input FALSE) < k`. Lihat `engine/sim-engine.js` case `"VOTING"`.

### Konvensi warna CAUSE & EFFECT berbeda dengan warna Logic Detail
**Koreksi (2026-10-24, #5)**, dikonfirmasi user — ini bukan bug, dua halaman memang sengaja pakai 2 konvensi indikator berbeda untuk konsep fail-safe yang sama:
- **Logic Detail** (`sheet.template.html`): warna ngikut **nilai mentah sinyal apa adanya** — TRUE=merah, FALSE=hijau, titik. Dipakai buat nelusurin wire/gate, jadi harus representasi nilai literal tanpa interpretasi.
- **Cause & Effect** (`causeeffect.template.html`): warna **SELALU KEBALIKAN** dari Logic Detail, berlaku **SERAGAM ke semua indikator di halaman ini** (CAUSE, EFFECT, status MOS, status Reset) — **TRUE = hijau, FALSE = merah**, titik, tanpa pengecualian per tipe node. Lihat fungsi `isNormal(id, val)` di template (sekarang cuma `return val;`).
- **Koreksi (2026-10-24, #7) — MEMBATALKAN sebagian isi #5 di bawah ini, yang ternyata salah.** Versi sebelumnya keliru menambahkan pengecualian PER TIPE NODE (OUTPUT pakai `normal=val` tapi INPUT malah dibalik jadi `normal=!val`). Konsekuensinya: karena kelas CSS `.on`/`.off` pada `.stat-dot` langsung memetakan ke warna `--true`(merah)/`--false`(hijau) — SAMA PERSIS dgn warna di halaman Logic Detail — baris CAUSE/MOS/Reset jadi **TIDAK PERNAH benar-benar kebalikan dari Logic Detail** (TRUE tetap tampil merah di kedua halaman utk node INPUT), padahal cuma kolom EFFECT yang benar-benar beda. User menunjukkan ini lewat 2 screenshot sisi-bersisi (Logic Detail vs CE) utk tag yang sama (`f105HS007A`, TRUE, merah di kedua halaman) — baru ketahuan bug-nya. Fix: `isNormal()` disederhanakan jadi `return val` tanpa pengecualian tipe, dan chip MOS/Reset (`buildStatusGroup`) ikut dibalik (`active ? 'off' : 'on'`, bukan `active ? 'on' : 'off'`). **Flag `healthyWhenTrue` jadi tidak relevan lagi utk pewarnaan CE** (karena aturan TRUE=hijau sudah berlaku universal) — flag ini tetap ada di netlist tapi cuma historis/dokumentasi makna tag, tidak dibaca lagi oleh `isNormal()`.
- Konsekuensi dari aturan seragam ini: karena HAMPIR SEMUA tag (termasuk CAUSE/ESD/alarm) defaultnya `FALSE` sebelum operator berinteraksi, halaman CE akan tampil **HAMPIR SEMUA MERAH** (CAUSE maupun EFFECT) saat pertama dibuka/reset — ini representasi akurat filosofi "belum ada yang dikonfirmasi sehat sampai operator berinteraksi", konsisten dengan alasan yang sama yang sudah dipakai utk EFFECT sejak #5, sekarang berlaku ke CAUSE juga. Bukan kesalahan tampilan.
- **(SALAH, dibatalkan #7 — disimpan sbg riwayat) Isi asli Koreksi #5 soal aturan per-tipe**: "`OUTPUT` (kolom EFFECT): TRUE=hijau, FALSE=merah (kebalikan dari CAUSE!). `INPUT` (kolom CAUSE/MOS/Reset): defaultnya FALSE=hijau, TRUE=merah — KECUALI `healthyWhenTrue`, TRUE=hijau." — kesimpulan ini keliru, lihat #7.

### Lain-lain
- Sinyal yang direferensikan ulang di tempat lain pada sheet yang sama (contoh: `AND_105UC009_FEED1`) dimodel sebagai node biasa yang di-reference oleh id — selama tidak membentuk loop aljabar, engine jalan satu pass topological per step.

## Layout & rendering (di `templates/sheet.template.html`)

- **Layout 3 zona** (di renderer, bukan di engine): semua node `OUTPUT` dipaksa ke satu kolom paling kanan (EFFECT) terlepas dari kedalaman topological aslinya; `INPUT` selalu di kolom 0 (CAUSE); sisanya (AND/OR/NOT/BUFFER/RS/VOTING) di kolom tengah (LOGIC & PERMISSIVE). Kolom CAUSE & EFFECT diurutkan & diberi label sesuai `causeGroups`/`effectGroups`, dengan gap ekstra antar grup. Lebar kolom (`COL_W`) dan lebar box tag (`boxSize`) dijaga longgar (gap antar kolom ≥ ~100px) supaya ada ruang untuk lane kabel — kalau makin banyak node per kolom pada sheet baru, pertimbangkan naikkan `COL_W` lagi.
- **Tinggi box dinamis & pin per-input (PENTING, jangan di-regresi)**: `boxSize()` untuk AND/OR/VOTING menghitung tinggi box berdasar JUMLAH INPUT (`16 + n*13`, minimum tinggi default), bukan tinggi tetap — supaya tiap pin input dapat slot vertikal sendiri. `centerOf(id, 'in', counterpartId)` menyebar titik sambung kabel sepanjang sisi kiri box sesuai urutan `deps(n)` (index dari node sumber), **BUKAN satu titik tengah untuk semua input**. Kalau titik 'in' balik jadi satu titik tengah, gate multi-input (AND014 5-input, VOT 9-input, dst) akan terlihat numpuk lagi — ini pernah jadi bug dan sudah diperbaiki, jangan diulang di template baru.
- **Kabel (wire) di canvas**: rute siku/orthogonal (bukan kurva), warna live ikut nilai sinyal (hijau=FALSE, merah=TRUE, yang TRUE ditebalkan & dipindah ke depan). Lane belokan vertikal dihitung sebagai **posisi piksel absolut** (bukan fraksi jarak ke tujuan) di dalam gap setelah node asal, dikelompokkan per kolom-asal & diurutkan berdasar posisi Y tujuan (pin tujuan, bukan titik tengah box) — supaya setiap kabel di satu kolom dapat lane unik yang tersebar rata di gap yang tersedia. Plus tanda pin kecil (`pin-tick`) di sisi kiri tiap gate multi-input menandai persis posisi tiap pin. Klik node manapun (selain INPUT) = highlight jalur hulu/cause-nya (independen dari warna live) untuk tracing manual; klik lagi atau tombol "Bersihkan Jejak" untuk lepas.
- **Kontrol kanvas**: toolbar zoom in/out/Fit/Reset di atas kanvas, plus Ctrl/Cmd+scroll untuk zoom dan klik-seret untuk pan — penting untuk sheet dengan banyak node (kolom CAUSE besar).
- **Panel status**: hanya **Output/Effect** yang jadi panel mengambang (floating dock) di bawah viewport, selalu terlihat walau kanvas discroll/zoom. Status Latch (RS) ditampilkan sebagai kartu biasa di bawah kanvas (non-floating), bersama catatan & netlist JSON.
- **Koreksi (2026-10-24, #8)**: render pin box RS sebelumnya pakai `deps(n) = [n.s, n.r]` (field netlist apa adanya) utk urutan pin-tick/sambungan wire, dan label teks statis "S" (atas) / "R (pulsa-set)" (bawah). Setelah Koreksi #6 (field netlist `s` diisi NOT-kondisi, `r` diisi tag reset — KEBALIKAN dari label pin gambar S/R1), urutan render lama ini jadi SALAH SECARA VISUAL: box RS di kanvas menampilkan tag reset masuk ke pin bawah ("R") dan NOT-kondisi masuk ke pin atas ("S") — kebalikan dari gambar sumber (S=reset di atas), walau PERHITUNGAN logic-nya sendiri sudah benar sejak #6. User menunjukkan ini 3x (pernah terlewat 2x sebelumnya karena fokus hanya ke korektnya nilai/logic, bukan ke korektnya LABEL/posisi render). Fix: `deps()` utk case `'RS'` diubah jadi `[n.r, n.s]` (urutan render, BUKAN urutan field netlist — field s/r di JSON TIDAK diubah), sehingga pin ATAS = `n.r` (tag reset, label diganti "S (reset)") dan pin BAWAH = `n.s` (NOT-kondisi, label diganti "R1 (kondisi, NOT)"). Konvensi global: **field netlist s/r menentukan PERILAKU engine (lihat Koreksi #6), sedangkan urutan di `deps()` untuk tipe RS menentukan POSISI RENDER pin agar cocok dgn gambar sumber — dua hal ini sengaja TIDAK 1:1 lagi sejak #6/#8, jangan disamakan ulang.** Tervalidasi lewat `centerOf()` dipanggil langsung di Playwright (bukan cuma baca screenshot) utk pastikan posisi Y pin reset < posisi Y pin kondisi-NOT.

- **Koreksi (2026-10-24, #9)**: user memberikan source code resmi function block `RS.ST` (IEC 61131-3, vendor), isinya persis: `Q1 := (Q1 OR S) AND NOT R1` — bistable **reset-dominant**, murni kombinasional per scan cycle dgn feedback `Q1` sebelumnya, TIDAK ADA deteksi rising-edge/pulsa khusus di formulanya. `engine/sim-engine.js` (case `'RS'` di `step()`) SEBELUMNYA malah mengimplementasikan model "pulse-to-set": field `r` hanya men-set `Q` kalau terjadi transisi 0→1 PERSIS di step itu, dan diam (hold `Q` sebelumnya) kalau `r` sudah TRUE dari step sebelumnya. Ini DEVIASI yang tidak berdasar dari source resmi — pernah dianggap "intentional design" di sesi2 sebelumnya tapi ternyata salah. Konsekuensi bug: kalau tombol reset DITAHAN (bukan dipulsa sesaat) saat kondisi masih trip, lalu kondisi trip hilang SAAT tombol masih ditahan, formula resmi mengharuskan Q1 otomatis balik TRUE (karena `Q1 OR S` dievaluasi ulang tiap step dgn `S` yg masih TRUE) — versi lama GAGAL melakukan ini (perlu lepas-tekan-ulang tombol dulu), beda dari perilaku source asli. Fix: ganti jadi literal `v[id] = s && (qPrev || r)` (pemetaan field netlist `s`/`r` dari Koreksi #6 TIDAK berubah — hanya cara `step()` menghitung RS yg diganti), hapus state `rPrev` (tidak dibutuhkan lagi, tidak ada edge detection). **Ini satu-satunya perubahan `engine/sim-engine.js` di seluruh proyek ini** — sebelumnya semua fix selalu di level netlist/render saja; kali ini memang bug ada di engine generic-nya sendiri, jadi berlaku utk SEMUA sheet (bukan cuma sheet-002/006). Tervalidasi lewat >10 skenario Node & Playwright di kedua sheet, termasuk kasus reset ditahan-lewat-trip-clear (sheet-002) dan reset berurutan 6-latch termasuk shared tag (sheet-006).

- **Koreksi (2026-10-24, #10)**: user menegaskan representasi inversi pin R1 tidak boleh berupa gerbang NOT kotak terpisah sebelum RS — di gambar sumber, lingkaran inversi MELEKAT LANGSUNG di pin R1 block RS itu sendiri (konvensi FBD standar: bubble di pin, bukan gerbang berdiri sendiri). Node NOT eksplisit yang sebelumnya cuma jadi "wrapper lurus" sebelum field `s` (`not_s003`, `not_s002b` di sheet-002; `not_s006`, `not_s008`, `not_s002`, `not_s015` di sheet-006) dihapus. Sebagai gantinya: engine (`sim-engine.js`, case `'RS'`) sekarang baca flag opsional `sInvert` pada node RS — kalau `true`, nilai `v[n.s]` dibalik inline sebelum dipakai (`const s = n.sInvert ? !sRaw : sRaw`). Netlist RS yang kondisinya "murni" (bukan campuran polaritas, lihat Koreksi #6 bagian (a)) sekarang `s` menunjuk LANGSUNG ke gerbang OR/AND mentah + `"sInvert": true`, tanpa node NOT perantara. Untuk `rstD_010`/`rstE_019` (kondisi campuran polaritas, Koreksi #6 bagian (b)) — `s` tetap menunjuk ke `and009_corrected`/`and018_corrected` TANPA `sInvert` (inversi matematisnya sudah terserap di situ secara parsial per-term, bukan satu NOT utuh di pin), **tapi** render tetap menggambar bulatan di pin R1-nya juga, demi kesetiaan visual ke gambar sumber (lihat `templates/sheet.template.html`, elemen `.pin-invert-bubble`) — bulatan ini SELALU digambar untuk semua block RS tanpa kecuali, independen dari nilai `sInvert`, karena itu murni konvensi gambar block RS, bukan indikator jalur logic yang sebenarnya dipakai. Label pin disederhanakan jadi cuma "S" dan "R1" (teks "(reset)"/"(kondisi, NOT)" dihapus karena sekarang bulatan sendiri yang menandakan inversi, persis gambar sumber). Perilaku logic TIDAK berubah sama sekali dari Koreksi #9 (hasil `step()` identik, cuma cara menyusun netlist & menggambarnya yang berubah) — divalidasi ulang lewat skenario Node yang sama persis, hasil sama.

- **Koreksi (2026-10-24, #11 — PENTING, soal polaritas FIELD WIRING, bukan soal arah render/formula lagi)**: aturan "sInvert: true seragam di semua RS" dari Koreksi #10 ternyata SALAH untuk `rs_002b` (ST_105HS024UC, sheet-002) — dikonfirmasi langsung oleh user (instrumentasi, tahu wiring field sesungguhnya): tombol `f105HS001AE` & `f105HS001B` itu **NC (Normally Closed)**, TRUE = sirkit utuh/tombol belum ditekan = SEHAT — BUKAN tag alarm biasa (NO, TRUE=aktif) seperti diasumsikan sebelumnya. Akibatnya `and_001b` (AND dari keduanya) outputnya **sudah berpolaritas sehat=TRUE secara alami** (AND dua sinyal sehat=TRUE tetap sehat=TRUE), beda total dari `or_002` (rs_003) yang memang murni dibangun dari tag alarm=TRUE biasa. Menerapkan `sInvert: true` yang seragam ke `and_001b` MEMBALIK logic sepenuhnya — reset jadi cuma "berhasil" justru saat salah satu sirkit ESD terbuka (bahaya, kebalikan fail-safe). **Fix: `sInvert` dihapus dari `rs_002b`** (field `s` = `and_001b` dipakai apa adanya, tanpa invert, karena sudah sehat=TRUE-polarity). `rs_003` TIDAK berubah (`or_002` tetap alarm=TRUE-polarity murni, `sInvert:true` tetap benar). Konsekuensi fungsional yang ikut berubah (bukan cuma kosmetik): trip jalur `f105UY003`/`UC-024` sekarang terjadi begitu **SALAH SATU** sirkit ESD terbuka (fail-safe 1oo2 voting) — BUKAN "butuh KEDUA tombol ditekan bersamaan" seperti tercatat di `summary` versi lama (summary sudah diperbaiki juga di `data/netlists/sheet-002.json`). **Pelajaran penting untuk sheet berikutnya**: "lingkaran di pin R1 = satu inversi seragam" (Koreksi #10) itu benar untuk SISI RENDER/WIRING RS block itu sendiri, TAPI apakah hasil AKHIR sebuah gerbang kondisi butuh `sInvert:true` atau TIDAK tergantung **polaritas RIIL field device** yang masuk ke gerbang itu (NO vs NC) — ini FAKTA INSTRUMENTASI, tidak bisa ditebak dari gambar logic diagram semata, harus dikonfirmasi eksplisit (seperti flag `healthyWhenTrue` yang sudah ada polanya). **Belum dicek**: 4 pasang tombol ESD serupa di sheet-006 (`g005_AND` f105HS007A/B, `g007_AND` f105HS002AE/B, `g011_AND` f105HS006A/B, `g013_AND` f105HS019AE/B) berpotensi punya masalah polaritas yang sama — JANGAN asumsikan otomatis NC/NO tanpa konfirmasi user per tag.

## Cara menambah sheet baru
1. Siapkan gambar logic diagram sheet tsb, lalu re-trace jadi netlist JSON dengan schema di atas (termasuk verifikasi junction kalau ada wiring ambigu), plus isi `causeGroups`/`effectGroups`/`group` per node biar layout 3 zona otomatis kebentuk.
2. Simpan sebagai `data/netlists/<slug>.json` — `<slug>` harus sama dengan field `slug` entry sheet itu di `data/sheets.json` (pola: `sheet-0XX`).
3. Pakai `engine/sim-engine.js` + `templates/sheet.template.html` apa adanya (RS = bistable reset-dominant IEC 61131-3 "RS.ST", VOTING sehat-jika-kompak, pin per-input — semua sudah dikonfirmasi user) — tidak perlu re-derive logic kecuali user bilang beda untuk sheet tsb.
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
