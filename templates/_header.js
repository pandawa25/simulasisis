/* ikon tema (bulan/matahari) mengikuti tema efektif */
(function(){
  var root = document.documentElement, mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function paint(){ var t = root.getAttribute('data-theme'); root.setAttribute('data-eff', t || (mq && mq.matches ? 'dark' : 'light')); }
  paint();
  new MutationObserver(paint).observe(root, { attributes:true, attributeFilter:['data-theme'] });
  if(mq && mq.addEventListener) mq.addEventListener('change', paint);
})();
