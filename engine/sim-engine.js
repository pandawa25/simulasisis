/*
  SIS Logic Sim Engine — generic, reusable untuk semua halaman (105-UC-009, dst).
  Tidak ada dependency eksternal. Dipakai di browser maupun Node.

  Netlist schema:
  {
    id, title, sheetRef,
    nodes: {
      "<nodeId>": {
        type: "INPUT" | "AND" | "OR" | "NOT" | "BUFFER" | "MOVE" | "RS" | "VOTING" | "OUTPUT",
        label, desc, gateId,
        // AND/OR/VOTING:
        inputs: ["<nodeId>", ...],
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
        case "AND": case "OR": case "VOTING": refs = n.inputs || []; break;
        case "RS": refs = [n.s, n.r]; break;
        case "NOT": case "BUFFER": case "MOVE": refs = [n.input]; break;
        case "OUTPUT": refs = [n.source]; break;
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
    const state = { values: {}, rsPrev: {} };
    for (const id in nodes) {
      state.values[id] = false;
      if (nodes[id].type === "RS") { state.rsPrev[id] = false; }
    }

    function step(inputOverrides) {
      // inputOverrides: { nodeId: boolean, ... } untuk semua node bertipe INPUT
      const v = state.values;
      for (const id of order) {
        const n = nodes[id];
        switch (n.type) {
          case "INPUT":
            v[id] = !!inputOverrides[id];
            break;
          case "AND":
            v[id] = n.inputs.every((i) => v[i]);
            break;
          case "OR":
            v[id] = n.inputs.some((i) => v[i]);
            break;
          case "NOT":
            v[id] = !v[n.input];
            break;
          case "BUFFER": case "MOVE":
            v[id] = v[n.input];
            break;
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
          case "OUTPUT":
            v[id] = v[n.source];
            break;
          default:
            throw new Error("Tipe node tidak dikenal: " + n.type + " (" + id + ")");
        }
      }
      return v;
    }

    function reset() {
      for (const id in nodes) {
        state.values[id] = false;
        if (nodes[id].type === "RS") { state.rsPrev[id] = false; }
      }
    }

    return { nodes, order, state, step, reset };
  }

  global.SimEngine = { createSim, topoOrder };
})(typeof window !== "undefined" ? window : globalThis);
