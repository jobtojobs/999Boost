// 999BOOST - estatisticas anonimas de visita (sem cookies de terceiros, sem IP).
// Identificador aleatorio guardado so neste navegador. Para nao contar suas proprias visitas: admin > Marketing.
(function () {
  try {
    var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
    if (ls('naoconta999') === '1' || navigator.webdriver) return;
    var vid = ls('v999');
    if (!vid) { vid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); ls('v999', vid); }
    var q = new URLSearchParams(location.search), de = '';
    try { if (document.referrer) de = new URL(document.referrer).hostname.replace(/^www\./, ''); } catch (e) {}
    if (de === location.hostname.replace(/^www\./, '')) de = '';
    // Agrupa as redes (l.instagram.com, m.facebook.com...) num nome so
    var redes = { instagram: 'instagram', facebook: 'facebook', fb: 'facebook', google: 'google', youtube: 'youtube', tiktok: 'tiktok', twitch: 'twitch', 'x.com': 'twitter', 't.co': 'twitter', twitter: 'twitter', whatsapp: 'whatsapp', discord: 'discord', bing: 'bing' };
    for (var r in redes) { if (de.indexOf(r) !== -1) { de = redes[r]; break; } }
    var fonte = (q.get('utm_source') || (q.get('ref') ? 'indicacao' : '') || (q.get('cupom') ? 'cupom:' + q.get('cupom') : '') || de || '').toLowerCase().slice(0, 40);
    var camp = (q.get('utm_campaign') || '').slice(0, 40);
    // Origem do visitante (primeiro contato, vale 30 dias) - vai junto com a compra
    var o = null;
    try { o = JSON.parse(ls('o999') || 'null'); } catch (e) {}
    if (fonte && (!o || Date.now() - o.t > 30 * 864e5)) { o = { s: fonte, c: camp, t: Date.now() }; ls('o999', JSON.stringify(o)); }
    window.origem999 = function () { return o ? (o.s + (o.c ? '/' + o.c : '')).slice(0, 60) : 'direto'; };
    var pagina = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
    function envia(tipo, extra) {
      var d = { tipo: tipo, pagina: pagina, vid: vid, de: de, fonte: fonte, camp: camp, disp: innerWidth < 768 ? 'celular' : 'computador' };
      for (var k in (extra || {})) d[k] = extra[k];
      var corpo = JSON.stringify(d);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/t', corpo);
      else fetch('/api/t', { method: 'POST', body: corpo, keepalive: true });
    }
    window.track999 = envia;
    envia('view', { plano: q.get('plano') || '' });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-t]');
      if (a) envia('clique', { alvo: a.getAttribute('data-t'), plano: a.getAttribute('data-plano') || '' });
    });
  } catch (e) {}
})();
