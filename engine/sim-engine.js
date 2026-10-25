/*
  SIS Logic Sim Engine — generic, reusable untuk semua halaman (105-UC-009, dst).
  Tidak ada dependency eksternal. Dipakai di browser maupun Node.

  Netlist schema:
  {
    id, title, sheetRef,
    nodes: {
      "<nodeId>": {
        type: "INPUT" | "AND" | "OR" | "NOT" | "BUFFER" | "MOVE" | "RS" | "VOTING"
              | "TOF" | "FEEDBACK" | "NUMBITS" | "GT" | "R_TRIG" | "OUTPUT",
        label, desc, gateId,
        // AND/OR/VOTING:
        inputs: ["<nodeId>", ...],
        invertInputs: [true, false, ...]  // opsional, HANYA AND/OR: lingkaran
                      // inversi yang digambar MELEKAT di pin input tertentu
                      // (lihat Koreksi #24). Indeks sejajar `inputs`; pin yang
                      // tidak disebut dianggap tidak di-invert.
        k: <number>  // hanya VOTING, threshold jumlah input FALSE sebelum
                      // output ikut jatuh ke FALSE (lihat case "VOTING" di
                      // step() — bukan threshold "k dari n TRUE")
        // RS:
        s: "<nodeId>", r: "<nodeId>"
        // NOT/BUFFER/MOVE ("MOVE" dipakai saat gambar asli literal memberi
        // nama block itu "MOVE", bukan "BUFFER" — behaviornya identik
        // (passthrough nilai apa adanya), bedanya cuma label yang tampil
        // di kanvas supaya cocok dengan gambar sumber):
        input: "<nodeId>"
        // TOF (block vendor "T_OFF_SP") — off-delay timer waktu NYATA:
        input: "<nodeId>", setpointSec: <number>
        // FEEDBACK — nilai node lain dari SCAN SEBELUMNYA, dipakai memutus
        // loop umpan-balik yang di PLC asli sah krn semantik scan cycle:
        input: "<nodeId>"
        // OUTPUT:
        source: "<nodeId>"
      }
    },
    notes: [...]
  }
*/
(function (global) {
  function topoOrder(nodes) {
    const deps = {};
    for (const id in nodes) {
      const n = nodes[id];
      let refs = [];
      switch (n.type) {
        case "AND": case "OR": refs = n.inputs || []; break;
        case "NUMBITS": refs = n.inputs || []; break;
        /* VOTING: pin FLT hanya penanda tampilan (Koreksi #25), tapi tetap
           dihitung sbg dependensi supaya urutan evaluasi konsisten */
        case "VOTING": refs = (n.inputs || []).concat(n.fltInputs || []); break;
        case "RS": refs = [n.s, n.r]; break;
        case "NOT": case "BUFFER": case "MOVE": case "TOF": case "GT": case "R_TRIG": refs = [n.input]; break;
        case "OUTPUT": refs = [n.source]; break;
        /* FEEDBACK sengaja TIDAK punya dependensi: dia membaca nilai scan
           SEBELUMNYA, jadi justru dialah yang memutus loop umpan-balik
           supaya urutan topological tetap bisa dihitung. */
        case "FEEDBACK": refs = []; break;
        case "INPUT": refs = []; break;
      }
      deps[id] = refs;
    }
    const visited = {}, temp = {}, order = [];
    function visit(id) {
      if (visited[id]) return;
      if (temp[id]) throw new Error("Algebraic loop terdeteksi melibatkan node: " + id);
      temp[id] = true;
      (deps[id] || []).forEach(visit);
      temp[id] = false;
      visited[id] = true;
      order.push(id);
    }
    Object.keys(nodes).forEach(visit);
    return order;
  }

  function createSim(netlist) {
    const nodes = netlist.nodes;
    const order = topoOrder(nodes);
    // state: nilai boolean saat ini per node, plus memory khusus utk RS
    // (Q_prev, satu-satunya memory yg dibutuhkan formula IEC 61131-3 RS.ST)
    /* tofSince[id] = timestamp (ms) saat input TOF mulai FALSE, null kalau
       input masih TRUE. prevValues = snapshot nilai scan sebelumnya, dibaca
       node FEEDBACK. */
    const state = { values: {}, rsPrev: {}, tofSince: {}, tofArmed: {}, prevValues: {}, rtPrev: {}, rtUntil: {}, rtSeen: {} };
    for (const id in nodes) {
      state.values[id] = false;
      state.prevValues[id] = false;
      if (nodes[id].type === "RS") { state.rsPrev[id] = false; }
      /* tofArmed = timer pernah aktif (input pernah TRUE) -> hanya setelah itu
         dia menahan output saat input jatuh. Tanpa penanda ini, timer akan
         seolah menahan sejak halaman dibuka padahal inputnya belum pernah
         TRUE (bug yang sempat terjadi saat TOF pertama dipasang). */
      if (nodes[id].type === "TOF") { state.tofSince[id] = null; state.tofArmed[id] = false; }
      if (nodes[id].type === "R_TRIG") { state.rtPrev[id] = false; state.rtUntil[id] = 0; state.rtSeen[id] = false; }
    }

    /* sisa hitung mundur tiap TOF (detik, 0 kalau tidak sedang menghitung) —
       dipakai halaman utk menampilkan angka & memutuskan perlu tick lagi */
    function tofRemaining(id, now) {
      const n = nodes[id];
      if (!n || n.type !== "TOF") return 0;
      if (!state.tofArmed[id]) return 0;
      const since = state.tofSince[id];
      if (since == null) return 0;
      const left = (n.setpointSec || 0) - (now - since) / 1000;
      return left > 0 ? left : 0;
    }
    function anyTimerRunning(now) {
      const t = now == null ? Date.now() : now;
      return Object.keys(state.tofSince).some(function (id) { return tofRemaining(id, t) > 0; }) ||
             Object.keys(state.rtUntil).some(function (id) { return state.rtUntil[id] > t; });
    }
    /* Percepat timer (alat uji): semua TOF yang sedang menghitung dianggap
       sudah habis. Dipakai tombol "Lewati timer" utk setelan panjang (30 mnt). */
    function skipTimers(now) {
      const t = now == null ? Date.now() : now;
      Object.keys(state.tofSince).forEach(function (id) {
        if (state.tofSince[id] != null) state.tofSince[id] = t - ((nodes[id].setpointSec || 0) * 1000) - 1;
      });
    }

    function step(inputOverrides, nowMs) {
      const now = nowMs == null ? Date.now() : nowMs;
      // inputOverrides: { nodeId: boolean, ... } untuk semua node bertipe INPUT
      const v = state.values;
      const prev = state.prevValues;
      for (const id of order) {
        const n = nodes[id];
        switch (n.type) {
          case "INPUT":
            v[id] = !!inputOverrides[id];
            break;
          /* `invertInputs` = lingkaran inversi yang MELEKAT di pin input
             tertentu pada gambar vendor (Koreksi #24). Dibaca inline di sini,
             BUKAN lewat node NOT perantara, supaya struktur netlist & render
             cocok persis dgn gambar — pola yang sama dipakai utk bulatan di
             pin R1 block RS. */
          case "AND":
            v[id] = n.inputs.every((i, k) => (n.invertInputs && n.invertInputs[k]) ? !v[i] : !!v[i]);
            break;
          case "OR":
            v[id] = n.inputs.some((i, k) => (n.invertInputs && n.invertInputs[k]) ? !v[i] : !!v[i]);
            break;
          case "NOT":
            v[id] = !v[n.input];
            break;
          case "BUFFER": case "MOVE":
            v[id] = v[n.input];
            break;
          case "NUMBITS":
            /* NUMBITS: jumlah input yang TRUE (nilai numerik, truthy kalau >0) */
            v[id] = n.inputs.reduce((acc, i) => acc + (v[i] ? 1 : 0), 0);
            break;
          case "GT":
            /* GT: IN1 > IN2, IN2 = konstanta yang digambar di pin bawah */
            v[id] = (Number(v[n.input]) || 0) > (n.constant || 0);
            break;
          case "R_TRIG": {
            /* Deteksi tepi naik. IEC: Q TRUE hanya satu scan. Atas pilihan user
               (Koreksi #25) pulsa ditahan `pulseMs` (default 1000 ms) waktu
               nyata supaya terlihat. Scan pertama hanya merekam nilai awal
               (tidak ada pulsa palsu saat halaman dibuka dgn CLK sudah TRUE). */
            const clk = !!v[n.input];
            if (!state.rtSeen[id]) { state.rtSeen[id] = true; }
            else if (clk && !state.rtPrev[id]) { state.rtUntil[id] = now + (n.pulseMs || 1000); }
            state.rtPrev[id] = clk;
            v[id] = now < state.rtUntil[id];
            break;
          }
          case "VOTING": {
            // Voting k-of-n bertipe "sehat jika kompak" (dikonfirmasi user,
            // BUKAN "trip jika k dari n TRUE" seperti versi awal):
            // input normal/sehat = TRUE; output jadi FALSE begitu jumlah
            // input yang FALSE mencapai k (mis. 2oo9 -> output FALSE kalau
            // >=2 dari 9 input FALSE). Jadi output = (jumlah FALSE < k).
            const countFalse = n.inputs.reduce((acc, i) => acc + (v[i] ? 0 : 1), 0);
            v[id] = countFalse < n.k;
            break;
          }
          case "RS": {
            // Bistable Reset Dominant, PERSIS formula resmi IEC 61131-3
            // "RS.ST" (dikonfirmasi user lewat source function block asli):
            //   Q1 := (Q1 OR S) AND NOT R1
            // Murni kombinasional per step dgn feedback Q1 sebelumnya — TIDAK
            // ada deteksi rising-edge/pulsa khusus (versi lama keliru menambah
            // ini, lihat ARSITEKTUR.md Koreksi #9).
            // Pemetaan field netlist (lihat Koreksi #6): 's' = sinyal
            // sehat/health (dominant-clear) SETELAH inversi; 'r' = S_vendor
            // mentah (tag reset manual, vendor menyebutnya "Set" krn
            // menyetel Q1 TRUE, meski secara SIS itu tombol reset).
            // Koreksi (2026-10-24, #10): inversi R1 SEKARANG dibaca inline
            // lewat flag `sInvert` (bukan node NOT eksplisit terpisah lagi)
            // supaya netlist & render cocok dgn gambar sumber — di gambar,
            // lingkaran inversi itu MELEKAT di pin R1 block RS itu sendiri,
            // bukan gerbang NOT berdiri sendiri sebelum RS. Kalau gerbang
            // kondisi yg masuk `s` sudah "pre-corrected" jadi polaritas
            // sehat=TRUE (kasus and009_corrected/and018_corrected, lihat
            // Koreksi #6 bagian (b)), `sInvert` dibiarkan false/absen.
            const sRaw = v[n.s];
            const s = n.sInvert ? !sRaw : sRaw;
            const r = v[n.r];
            const qPrev = state.rsPrev[id];
            const next = s && (qPrev || r);
            v[id] = next;
            state.rsPrev[id] = next;
            break;
          }
          case "TOF": {
            /* Off-delay timer waktu NYATA (block vendor "T_OFF_SP"):
               input TRUE  -> output langsung TRUE & hitungan direset;
               input FALSE -> output TETAP TRUE selama `setpointSec` detik,
               baru kemudian jatuh FALSE. Karena berbasis jam dinding, halaman
               harus memanggil step() lagi secara berkala selama hitungan
               berjalan (lihat anyTimerRunning / tofRemaining). */
            const inVal = !!v[n.input];
            if (inVal) {
              state.tofSince[id] = null;
              state.tofArmed[id] = true;
              v[id] = true;
            } else if (!state.tofArmed[id]) {
              v[id] = false; // input belum pernah TRUE -> tidak ada yang ditahan
            } else {
              if (state.tofSince[id] == null) state.tofSince[id] = now;
              v[id] = ((now - state.tofSince[id]) / 1000) < (n.setpointSec || 0);
              if (!v[id]) state.tofArmed[id] = false; // hitungan habis
            }
            break;
          }
          case "FEEDBACK":
            v[id] = !!prev[n.input];
            break;
          case "OUTPUT":
            v[id] = v[n.source];
            break;
          default:
            throw new Error("Tipe node tidak dikenal: " + n.type + " (" + id + ")");
        }
      }
      /* snapshot utk node FEEDBACK di scan berikutnya (semantik scan cycle
         PLC: umpan-balik selalu memakai nilai scan sebelumnya) */
      for (const id in v) prev[id] = v[id];
      return v;
    }

    function reset() {
      for (const id in nodes) {
        state.values[id] = false;
        state.prevValues[id] = false;
        if (nodes[id].type === "RS") { state.rsPrev[id] = false; }
        if (nodes[id].type === "TOF") { state.tofSince[id] = null; state.tofArmed[id] = false; }
        if (nodes[id].type === "R_TRIG") { state.rtPrev[id] = false; state.rtUntil[id] = 0; state.rtSeen[id] = false; }
      }
    }

    return { nodes, order, state, step, reset, tofRemaining, anyTimerRunning, skipTimers };
  }

  global.SimEngine = { createSim, topoOrder };
})(typeof window !== "undefined" ? window : globalThis);
