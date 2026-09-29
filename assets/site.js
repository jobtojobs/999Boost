// 999BOOST - menu, botao voltar, FAQ, animacoes e links antigos (#planos -> /planos.html)
(function () {
  // Links antigos com ancora na pagina inicial
  var antigos = { '#planos': '/planos.html', '#como-funciona': '/como-funciona.html', '#trabalho': '/como-funciona.html#trabalho',
    '#seguranca': '/seguranca.html', '#faq': '/faq.html', '#ganho': '/descubra.html', '#diagnostico': '/descubra.html' };
  var p = location.pathname;
  if ((p === '/' || p === '/index.html' || p === '/index') && antigos[location.hash]) { location.replace(antigos[location.hash]); return; }

  // Menu (celular)
  var btn = document.querySelector('.menu-btn'), links = document.querySelector('.navlinks');
  if (btn && links) {
    btn.addEventListener('click', function () {
      var aberto = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      btn.textContent = aberto ? '✕' : '☰';
      document.querySelector('nav').classList.toggle('aberto', aberto);
    });
  }
  // Link da pagina atual em destaque
  var atual = p.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  document.querySelectorAll('.navlinks a').forEach(function (a) {
    var h = (a.getAttribute('href') || '').replace(/\.html$/, '');
    if (h === atual) { a.classList.add('on'); a.setAttribute('aria-current', 'page'); }
  });

  // Botao voltar: volta para a pagina anterior do site; se veio de fora, vai para o inicio
  document.querySelectorAll('[data-voltar]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var veioDoSite = document.referrer && document.referrer.indexOf(location.origin) === 0;
      if (veioDoSite && history.length > 1) history.back();
      else location.href = b.getAttribute('href') || '/';
    });
  });

  // FAQ
  window.toggleFaq = function (el) {
    var item = el.parentElement, aberto = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function (i) { i.classList.remove('open'); });
    if (!aberto) item.classList.add('open');
  };

  // Aparecer ao rolar
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('show'); }); }, { threshold: 0.12 });
    document.querySelectorAll('main section:not(.page-head):not(.hero)').forEach(function (s) { s.classList.add('reveal'); obs.observe(s); });
  }

  // Cronometro da home
  var crono = document.getElementById('crono');
  if (crono) {
    var passos = crono.querySelectorAll('li'), tempo = document.getElementById('cronoTempo'), barra = document.getElementById('cronoBarra');
    var marcas = [].map.call(passos, function (li) { return parseInt(li.getAttribute('data-s'), 10); });
    var FIM = marcas[marcas.length - 1];
    var parado = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function desenha(s) {
      tempo.textContent = '00:' + String(Math.min(s, 59)).padStart(2, '0');
      tempo.classList.toggle('fim', s >= FIM);
      barra.style.width = Math.min(100, s / FIM * 100) + '%';
      passos.forEach(function (li, i) {
        var fimPasso = i < passos.length - 1 ? marcas[i + 1] : FIM;
        var feito = s >= fimPasso;
        li.classList.toggle('feito', feito);
        li.classList.toggle('agora', !feito && s >= marcas[i]);
      });
    }
    if (parado) desenha(FIM);
    else {
      var s = 0;
      desenha(0);
      setInterval(function () { s = s >= FIM + 4 ? 0 : s + 1; desenha(Math.min(s, FIM)); }, 170);
    }
  }
})();
