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
    // (Q_prev untuk hold, R_prev untuk deteksi pulsa 0->1 pada pin R/"Reset")
    const state = { values: {}, rsPrev: {}, rPrev: {} };
    for (const id in nodes) {
      state.values[id] = false;
      if (nodes[id].type === "RS") { state.rsPrev[id] = false; state.rPrev[id] = false; }
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
            // Pulse-to-set, S sebagai enable + clear-langsung:
            //  - S=FALSE  -> Q langsung FALSE dan terkunci di situ (apapun R-nya).
            //  - S=TRUE   -> Q ikut nilai sebelumnya (hold), KECUALI R baru saja
            //               naik dari 0->1 (pulsa sesaat) pada step ini -> Q jadi TRUE.
            const s = v[n.s];
            const r = v[n.r];
            const rPrevVal = state.rPrev[id];
            const qPrev = state.rsPrev[id];
            const risingEdge = r && !rPrevVal;
            const next = !s ? false : (risingEdge ? true : qPrev);
            v[id] = next;
            state.rsPrev[id] = next;
            state.rPrev[id] = r;
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
        if (nodes[id].type === "RS") { state.rsPrev[id] = false; state.rPrev[id] = false; }
      }
    }

    return { nodes, order, state, step, reset };
  }

  global.SimEngine = { createSim, topoOrder };
})(typeof window !== "undefined" ? window : globalThis);
