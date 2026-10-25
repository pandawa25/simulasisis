/* ======================= sinkronisasi status tag LINTAS SHEET =======================
   Tag dengan label yang sama di beberapa sheet adalah satu tag fisik yang
   sama (mis. tombol ESD f105HS007A dipakai di sheet 3 & sheet 6), jadi
   statusnya harus sama di semua sheet: diubah di satu sheet = ikut berubah
   di sheet lain. Disimpan di localStorage global (KEY di bawah, per label
   tag -- BUKAN per sheet), dipakai halaman Logic Detail & Cause & Effect.
   - INPUT: nilai dari store dipakai saat halaman dibuka; tiap kali
     operator mengubah INPUT, nilainya ditulis ke store.
   - OUTPUT: nilai hasil hitung ditulis ke store, supaya sheet lain yang
     memakai tag itu sebagai INPUT (ditandai `linkedFrom` oleh build) ikut.
   - Tab lain yang sedang terbuka menerima event 'storage' -> terapkan
     nilai baru -> simulasi ulang. Penulisan hanya dilakukan kalau nilai
     benar-benar berubah, jadi tidak ada loop antar tab.
   Memori latch RS tetap per sheet (blok RS milik sheet masing-masing).
   Disuntikkan ke kedua template oleh scripts/build.js (<!--TAGSYNC_JS-->). */
var TagSync = (function(){
  var KEY = 'sis-sim-tags';
  var netlist = null, inputs = null, sheetId = '';
  function readStore(){
    try{ return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){ return {}; }
  }
  function writeStore(store){
    try{ localStorage.setItem(KEY, JSON.stringify(store)); }catch(e){}
  }
  function applyStore(store){
    var changed = false;
    Object.keys(netlist.nodes).forEach(function(id){
      var n = netlist.nodes[id];
      if(n.type !== 'INPUT' || !n.label) return;
      var entry = store[n.label];
      if(entry && typeof entry.v === 'boolean' && inputs[id] !== entry.v){
        inputs[id] = entry.v;
        changed = true;
      }
    });
    return changed;
  }
  return {
    KEY: KEY,
    /* panggil sekali setelah state per-sheet dimuat: nilai global menang */
    init: function(nl, inputState){
      netlist = nl; inputs = inputState; sheetId = nl.slug || nl.id || '';
      applyStore(readStore());
    },
    /* panggil di akhir tiap simulate(values) */
    publish: function(values){
      if(!netlist) return;
      var store = readStore(), dirty = false;
      Object.keys(netlist.nodes).forEach(function(id){
        var n = netlist.nodes[id];
        if(!n.label) return;
        var v;
        if(n.type === 'INPUT') v = !!inputs[id];
        else if(n.type === 'OUTPUT') v = !!values[id];
        else return;
        var cur = store[n.label];
        if(!cur || cur.v !== v){
          store[n.label] = { v: v, src: n.type === 'INPUT' ? 'input' : sheetId };
          dirty = true;
        }
      });
      if(dirty) writeStore(store);
    },
    /* cb dipanggil kalau tab lain mengubah tag yang dipakai sheet ini */
    onChange: function(cb){
      window.addEventListener('storage', function(e){
        if(e.key !== KEY || !netlist) return;
        if(applyStore(readStore())) cb();
      });
    }
  };
})();
