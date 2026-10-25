/* ======================= hubungan antar sheet (effect <-> cause) =======================
   Tag yang sama memayungi beberapa sheet (lihat _tagsync.js & data/tags.json).
   Build (`scripts/build.js`, applyTagRegistry) menandai tiap node dengan:
     - INPUT  .linkedFrom : sheet yang MENGHASILKAN tag ini (di sana dia effect)
     - INPUT  .alsoIn     : sheet lain yang memakai tag ini sbg cause juga
     - OUTPUT .linkedTo   : sheet yang MEMAKAI tag ini sbg cause/initiator
   Modul ini mengubah penanda itu jadi daftar keterangan + link navigasi,
   dipakai halaman Logic Detail (dirender sbg <a> di dalam SVG) maupun
   Cause & Effect (dirender sbg <a> di sel tabel). `useCe` menentukan link
   menuju versi Cause & Effect atau versi Logic Detail sheet tujuan —
   supaya operator tetap berada di mode tampilan yang sama saat berpindah. */
var CrossLink = (function(){
  function resolve(slugs, idx, useCe){
    return (slugs || []).map(function(s){
      var m = idx && idx[s];
      if(!m) return null;
      return {
        label: 'Sheet ' + String(m.no).padStart(3, '0'),
        tag: m.tag,
        href: useCe ? m.ceUrl : m.url
      };
    }).filter(Boolean);
  }
  return {
    /* -> [{ kind, prefix, label, title, href }] (kosong kalau tag ini tidak
       punya hubungan lintas sheet) */
    linksFor: function(node, nav, useCe){
      if(!node) return [];
      var idx = nav && nav.sheetIndex;
      var out = [];
      resolve(node.linkedFrom, idx, useCe).forEach(function(x){
        out.push({ kind: 'from', prefix: '← Sumber ', label: x.label, href: x.href,
                   title: 'Nilai tag ini dihasilkan di ' + x.label + ' (' + x.tag + ') — klik untuk membukanya' });
      });
      resolve(node.linkedTo, idx, useCe).forEach(function(x){
        out.push({ kind: 'to', prefix: '→ Menuju ', label: x.label, href: x.href,
                   title: 'Tag ini jadi cause/initiator di ' + x.label + ' (' + x.tag + ') — klik untuk membukanya' });
      });
      resolve(node.alsoIn, idx, useCe).forEach(function(x){
        out.push({ kind: 'also', prefix: '↔ Juga di ', label: x.label, href: x.href,
                   title: 'Tag yang sama juga dipakai sbg cause di ' + x.label + ' (' + x.tag + ') — status keduanya selalu sama' });
      });
      return out;
    }
  };
})();

/* ======================= status normal/trip satu sheet =======================
   Dipakai halaman portal (warna kartu tiap sheet) & halaman Cause & Effect
   (warna shape blok logic di kolom tengah). Konvensi SAMA dgn kolom EFFECT
   halaman CE (Koreksi #7): nilai TRUE = normal = hijau, FALSE = trip = merah,
   seragam utk semua OUTPUT tanpa pengecualian per tipe node.
   Satu sheet disebut NORMAL kalau SEMUA output-nya TRUE; kalau ada satu saja
   yang FALSE -> TRIP (fail-safe: tampilkan kondisi terburuk). */
var SheetStatus = (function(){
  return {
    /* values = hasil sim.step(); nodes = netlist.nodes */
    of: function(nodes, values){
      var total = 0, tripped = 0;
      Object.keys(nodes).forEach(function(id){
        if(nodes[id].type !== 'OUTPUT') return;
        total++;
        if(!values[id]) tripped++;
      });
      if(!total) return { state: 'none', total: 0, tripped: 0 };
      return { state: tripped ? 'trip' : 'normal', total: total, tripped: tripped };
    }
  };
})();
