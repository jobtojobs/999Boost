// 999BOOST Admin - aba Marketing: Analytics, Remarketing e Influenciadores.
// Usa as funcoes do admin.html: api, toast, esc, brl, data, dia, abrir, fechar, NOMES.
(function () {
  var SITE = 'www.999boost.com.br';
  var PDF = '/parceiros/Proposta-Parceria-999BOOST.pdf';
  var SAIR = '\n\nSe não quiser mais receber mensagens, é só responder SAIR.';
  var mk = { sub: 'analytics', dias: 7, seg: 'renovar', filtroPlano: '', rm: null, pr: [], filtroPr: '' };
  window.MK = mk;

  // ---------- utilidades ----------
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function meuNome() { return ls('mkt_nome') || 'Reuber'; }
  function primeiro(n) { n = String(n || '').trim().split(/\s+/)[0] || ''; return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : ''; }
  function sugestaoCupom(nome) {
    var base = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    return (base || 'PARCEIRO') + '10';
  }
  function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }
  function foneBR(t) { var d = soDigitos(t); if (!d) return ''; if (d.length <= 11) d = '55' + d; return d; }
  function preencher(tpl, v) { return tpl.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null && v[k] !== '' ? v[k] : m; }); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function copiar(t, msg) {
    function ok() { toast(msg || 'Copiado!'); }
    function velho() {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { prompt('Copie:', t); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, velho); else velho();
  }
  window.copiarTexto = function (t) { copiar(t); };
  function baixar(nome, conteudo, tipo) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo || 'text/csv;charset=utf-8' }));
    a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function linkPlano(p) { return SITE + '/contratar.html?plano=' + p; }

  // ---------- sub-abas ----------
  window.mkSub = function (s) {
    mk.sub = s;
    document.querySelectorAll('#mkSubs button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === s); });
    ['analytics', 'remarketing', 'influ'].forEach(function (k) { document.getElementById('mk-' + k).classList.toggle('hide', k !== s); });
    if (s === 'analytics') mkAnalytics();
    if (s === 'remarketing') mkRemarketing();
    if (s === 'influ') mkInflu();
  };
  window.carregarMarketing = function () { mkSub(mk.sub); };

  // =====================================================================
  // ANALYTICS
  // =====================================================================
  function barrasH(lista, rot, val, fmt) {
    if (!lista.length) return '<div class="sub">Sem dados no período.</div>';
    var max = Math.max.apply(null, lista.map(function (x) { return Number(x[val]) || 0; })) || 1;
    return '<div class="hb">' + lista.map(function (x) {
      var v = Number(x[val]) || 0;
      return '<div class="hb-l" title="' + esc(rot(x)) + ': ' + (fmt ? fmt(v) : v) + '"><span class="hb-n">' + esc(rot(x)) + '</span>' +
        '<span class="hb-t"><i style="width:' + Math.max(2, v / max * 100) + '%"></i></span><b>' + (fmt ? fmt(v) : v) + '</b></div>';
    }).join('') + '</div>';
  }
  function colunas(porDia, dias) {
    // completa os dias sem visita com zero
    var mapa = {}; porDia.forEach(function (d) { mapa[d.dia] = d; });
    var lista = [], hoje = new Date(Date.now() - 3 * 3600000);
    var n = dias === 1 ? 1 : dias;
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(hoje.getTime() - i * 86400000).toISOString().slice(0, 10);
      lista.push(mapa[d] || { dia: d, visitantes: 0, views: 0 });
    }
    var max = Math.max.apply(null, lista.map(function (x) { return x.visitantes; })) || 1;
    var passo = Math.ceil(lista.length / 10);
    return '<div class="cols">' + lista.map(function (x, i) {
      var dd = x.dia.slice(8, 10) + '/' + x.dia.slice(5, 7);
      return '<div class="col" tabindex="0" data-tip="' + dd + ': ' + x.visitantes + ' visitante(s), ' + x.views + ' visualização(ões)">' +
        '<i style="height:' + (x.visitantes ? Math.max(3, x.visitantes / max * 100) : 0) + '%"></i>' +
        '<span>' + ((i % passo === 0 || i === lista.length - 1) ? dd : '') + '</span></div>';
    }).join('') + '</div>';
  }
  var NOME_PAG = { '/': 'Início', '/planos': 'Planos', '/como-funciona': 'Como funciona', '/seguranca': 'Segurança', '/descubra': 'Descubra seu plano',
    '/faq': 'Dúvidas', '/contratar': 'Checkout', '/indique': 'Indique e Ganhe', '/guia': 'Baixar o Guia', '/termos': 'Termos', '/privacidade': 'Privacidade', '/formulario': 'Atendimento com técnico' };
  function nomeOrigem(o) { return o === 'direto' ? 'Direto / digitou o site' : o; }

  window.mkAnalytics = function () {
    var box = document.getElementById('mkAnaBody');
    document.querySelectorAll('#mkDias button').forEach(function (b) { b.classList.toggle('on', +b.dataset.d === mk.dias); });
    var nc = document.getElementById('mkNaoConta'); nc.checked = ls('naoconta999') === '1';
    box.innerHTML = '<div class="sub">Carregando...</div>';
    api('analytics', { dias: mk.dias }).then(function (r) {
      var f = r.funil || {}, vp = r.vendas_plano || [];
      var fat = vp.reduce(function (t, x) { return t + Number(x.faturamento || 0); }, 0);
      if (!r.views && !f.gerou_pix) {
        box.innerHTML = '<div class="box vazio">📊 Ainda não há visitas registradas neste período.<div class="sub" style="margin-top:6px;">Os dados começam a aparecer assim que o site novo estiver no ar. Dica: use links com <b class="mono">?utm_source=instagram</b> na bio para saber de onde vêm as vendas.</div></div>';
        return;
      }
      var h = '<div class="cards">' +
        card('Visitantes', r.visitantes, r.views + ' visualizações') +
        card('Abriram o checkout', f.abriu_checkout, pct(f.abriu_checkout, f.visitantes) + '% dos visitantes') +
        card('PIX gerados', f.gerou_pix, '') +
        card('Vendas', f.pagou, pct(f.pagou, f.visitantes) + '% de conversão') +
        card('Faturamento', brl(fat), f.pagou ? 'ticket médio ' + brl(fat / f.pagou) : '') + '</div>';
      h += '<div class="box" style="margin-bottom:12px;"><div class="bx-t">Visitantes por dia <span class="sub">passe o mouse nas barras</span></div>' + colunas(r.por_dia || [], mk.dias) + '</div>';
      var passos = [['Visitaram o site', f.visitantes], ['Viram os planos', f.viu_planos], ['Abriram o checkout', f.abriu_checkout], ['Geraram o PIX', f.gerou_pix], ['Pagaram', f.pagou]];
      var funil = '<div class="funil">' + passos.map(function (p, i) {
        var taxa = i ? '<em>' + pct(p[1], passos[i - 1][1]) + '% da etapa anterior</em>' : '';
        return '<div class="fn"><div class="fn-r"><span>' + p[0] + '</span><b>' + (p[1] || 0) + '</b></div><div class="fn-t"><i style="width:' + Math.max(2, pct(p[1], passos[0][1] || 1)) + '%"></i></div>' + taxa + '</div>';
      }).join('') + '</div>';
      h += '<div class="g2">';
      h += '<div class="box"><div class="bx-t">Funil de vendas</div>' + funil + '</div>';
      h += '<div class="box"><div class="bx-t">De onde vêm os visitantes</div>' + barrasH(r.origens || [], function (x) { return nomeOrigem(x.origem); }, 'visitantes') +
        dispositivos(r.dispositivos || []) + '</div>';
      h += '</div><div class="g2">';
      h += '<div class="box"><div class="bx-t">Páginas mais vistas</div>' + barrasH(r.paginas || [], function (x) { return NOME_PAG[x.pagina] || x.pagina; }, 'views') + '</div>';
      var vo = (r.vendas_origem || []).filter(function (x) { return x.pagos > 0; });
      h += '<div class="box"><div class="bx-t">Vendas por origem</div>' + (vo.length ? barrasH(vo, function (x) { return nomeOrigem(x.origem) + ' (' + x.pagos + ')'; }, 'faturamento', brl) : '<div class="sub">Nenhuma venda no período.</div>') + '</div>';
      h += '</div>';
      // por plano
      var cp = {}; (r.checkout_plano || []).forEach(function (x) { cp[x.plano] = x.visitantes; });
      var vpm = {}; vp.forEach(function (x) { vpm[x.plano] = x; });
      var linhas = ['basic', 'streamer', 'turbo', 'vitalicio', 'ebook'].map(function (p) {
        var v = vpm[p] || { pix: 0, pagos: 0, faturamento: 0 }, ck = cp[p] || 0;
        return '<tr><td><b class="pl-' + p + '">' + NOMES[p] + '</b></td><td>' + ck + '</td><td>' + v.pix + '</td><td><b>' + v.pagos + '</b></td><td>' + (ck ? pct(v.pagos, ck) + '%' : '—') + '</td><td>' + brl(v.faturamento) + '</td>' +
          '<td><button class="btn" onclick="mkRemarketingPlano(\'' + p + '\')">Remarketing</button></td></tr>';
      }).join('');
      h += '<div class="box scroll" style="margin-top:12px;"><div class="bx-t">Desempenho por plano</div><table class="tbl"><tr><th>Plano</th><th>Abriram checkout</th><th>PIX gerados</th><th>Vendas</th><th>Conversão</th><th>Faturamento</th><th></th></tr>' + linhas + '</table></div>';
      var cl = r.cliques || [];
      if (cl.length) h += '<div class="box" style="margin-top:12px;"><div class="bx-t">Botões mais clicados</div>' + barrasH(cl.slice(0, 8), function (x) { return x.alvo.replace(/_/g, ' ') + (x.plano ? ' · ' + (NOMES[x.plano] || x.plano) : ''); }, 'total') + '</div>';
      box.innerHTML = h;
    }).catch(function (e) { box.innerHTML = '<div class="box">' + esc(e.message) + '<div class="sub">Rodou o arquivo marketing-setup.sql no Supabase?</div></div>'; });
  };
  function card(l, v, s) { return '<div class="card"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function dispositivos(d) {
    var tot = d.reduce(function (t, x) { return t + x.visitantes; }, 0); if (!tot) return '';
    return '<div class="sub" style="margin-top:12px;">' + d.map(function (x) { return (x.disp === 'celular' ? '📱 ' : '💻 ') + pct(x.visitantes, tot) + '% ' + x.disp; }).join(' &nbsp;·&nbsp; ') + '</div>';
  }
  window.mkDias = function (d) { mk.dias = d; mkAnalytics(); };
  window.mkNaoContar = function (el) { ls('naoconta999', el.checked ? '1' : '0'); toast(el.checked ? 'Suas visitas neste navegador não serão contadas' : 'Suas visitas voltam a ser contadas'); };

  // =====================================================================
  // REMARKETING
  // =====================================================================
  var SEG = {
    renovar: { ic: '⏰', t: 'Vencem em até 3 dias', d: 'Lembrete para renovar antes de vencer.',
      msg: 'Oi {nome}! Seu plano {plano} do 999BOOST vence em {data}. Pra continuar com o PC otimizado, é só renovar por aqui (os dias que faltam são somados): {link}' },
    vencidos: { ic: '💤', t: 'Venceram (até 30 dias)', d: 'Não renovaram. Oferta de volta com cupom.', cupom: 'VOLTA10', desc: 10,
      msg: 'Oi {nome}! Seu {plano} do 999BOOST venceu em {data}. O PC voltou a pesar? Separei 10% de desconto pra você voltar: cupom VOLTA10. É só usar este link: {link}&cupom=VOLTA10' },
    carrinho: { ic: '🛒', t: 'PIX gerado e não pago', d: 'Carrinho abandonado nos últimos 7 dias.',
      msg: 'Oi {nome}! Vi que você gerou um PIX do {plano} no 999BOOST e ele não chegou a ser pago. Ficou alguma dúvida? Se quiser finalizar, é só gerar um novo aqui: {link} A licença aparece na tela assim que o PIX cai.' },
    upgrade: { ic: '⬆️', t: 'Upgrade para o Turbo', d: 'Clientes Basic e Low Streamer ativos.',
      msg: 'Oi {nome}! Curtindo o {plano}? No Turbo Pro Player são 105 otimizações, incluindo GPU, latência e input lag. Na próxima renovação, experimenta o Turbo: {link_turbo}' },
    vitalicio: { ic: '♾️', t: 'Oferta Vitalício', d: 'Já renovaram 2 vezes ou mais.',
      msg: 'Oi {nome}! Você já renovou o 999BOOST {vezes} vezes ({gasto}). Com o Vitalício você paga R$ 99,90 uma vez só, formata quando quiser, recebe as atualizações e ainda ganha o Guia de BIOS e Jogos: {link_vit}' },
    ebook: { ic: '📘', t: 'Compraram só o e-book', d: 'Ainda não têm o painel.',
      msg: 'Oi {nome}! Espero que o Guia de BIOS e Jogos esteja ajudando. O que o guia não faz, o painel faz: otimiza o Windows em menos de 1 minuto, sem compartilhar tela. Planos a partir de R$ 19,90: ' + SITE + '/planos.html' },
    indicar: { ic: '🎁', t: 'Vitalícios: convidar a indicar', d: 'Ganham 20% em PIX por amigo.',
      msg: 'Oi {nome}! Sabia que, como cliente Vitalício do 999BOOST, você ganha 20% em PIX por cada amigo que comprar pelo seu link? Pega o seu aqui: ' + SITE + '/indique.html' }
  };
  function itensSeg(k) {
    var l = (mk.rm && mk.rm.segmentos[k]) || [];
    return mk.filtroPlano ? l.filter(function (x) { return x.plano === mk.filtroPlano; }) : l;
  }
  function msgPara(k, x) {
    var tpl = (document.getElementById('mkMsg') && mk.seg === k) ? document.getElementById('mkMsg').value : SEG[k].msg;
    return preencher(tpl, { nome: primeiro(x.nome) || 'tudo bem', plano: NOMES[x.plano] || x.plano, data: dia(x.data),
      link: linkPlano(x.plano === 'ebook' ? 'streamer' : x.plano), link_turbo: linkPlano('turbo'), link_vit: linkPlano('vitalicio'),
      vezes: x.vezes || '', gasto: x.gasto ? brl(x.gasto) : '' });
  }
  window.mkRemarketingPlano = function (p) { mk.filtroPlano = p; mkSub('remarketing'); };
  window.mkRemarketing = function (recarregar) {
    var sel = document.getElementById('mkPlano'); sel.value = mk.filtroPlano;
    if (mk.rm && !recarregar) return desenhaRm();
    document.getElementById('mkSegs').innerHTML = '<div class="sub">Carregando...</div>';
    api('remarketing').then(function (r) { mk.rm = r; desenhaRm(); })
      .catch(function (e) { document.getElementById('mkSegs').innerHTML = '<div class="box">' + esc(e.message) + '<div class="sub">Rodou o arquivo marketing-setup.sql no Supabase?</div></div>'; });
  };
  window.mkFiltroPlano = function (v) { mk.filtroPlano = v; desenhaRm(); };
  window.mkSeg = function (k) { mk.seg = k; desenhaRm(); };
  function desenhaRm() {
    document.getElementById('mkSegs').innerHTML = Object.keys(SEG).map(function (k) {
      var n = itensSeg(k).length;
      return '<button class="seg' + (mk.seg === k ? ' on' : '') + (n ? '' : ' zero') + '" onclick="mkSeg(\'' + k + '\')"><span class="ic">' + SEG[k].ic + '</span><b>' + n + '</b><span class="st">' + SEG[k].t + '</span></button>';
    }).join('');
    var s = SEG[mk.seg], lista = itensSeg(mk.seg);
    var h = '<div class="box"><div class="row" style="justify-content:space-between;margin-bottom:8px;"><div><b style="font-size:15px;">' + s.ic + ' ' + s.t + '</b><div class="sub">' + s.d + (mk.filtroPlano ? ' · filtrado: ' + NOMES[mk.filtroPlano] : '') + '</div></div>' +
      '<div class="acts">' + (s.cupom ? cupomBtn(s) : '') +
      '<button class="btn" onclick="mkCopiarEmails()"' + (lista.length ? '' : ' disabled') + '>Copiar e-mails</button>' +
      '<button class="btn" onclick="mkCsv()"' + (lista.length ? '' : ' disabled') + ' title="Lista para público personalizado do Meta Ads ou Google Ads">Baixar CSV (anúncios)</button></div></div>' +
      '<div class="sub" style="margin-bottom:4px;">Mensagem (edite se quiser). Variáveis: {nome} {plano} {data} {link}</div>' +
      '<textarea id="mkMsg" rows="3">' + esc(s.msg) + '</textarea>';
    if (!lista.length) h += '<div class="vazio sub">Ninguém neste grupo agora. 🎉</div>';
    else {
      h += '<div class="scroll"><table class="tbl" style="margin-top:10px;"><tr><th>Cliente</th><th>Plano</th><th>' + (mk.seg === 'carrinho' ? 'Gerou PIX' : mk.seg === 'ebook' ? 'Comprou' : mk.seg === 'indicar' ? 'Cliente desde' : 'Vence / venceu') + '</th><th>Ações</th></tr>';
      lista.forEach(function (x, i) {
        h += '<tr><td>' + (esc(x.nome) || '<span class="sub">sem nome</span>') + '<div class="sub">' + esc(x.email) + (x.telefone ? ' · ' + esc(x.telefone) : '') + '</div></td>' +
          '<td><span class="pl-' + x.plano + '">' + (NOMES[x.plano] || esc(x.plano)) + '</span>' + (x.vezes ? '<div class="sub">' + x.vezes + ' compras · ' + brl(x.gasto) + '</div>' : '') + '</td>' +
          '<td>' + dia(x.data) + '</td><td><div class="acts">' +
          (x.telefone ? '<button class="btn green" onclick="mkWhats(' + i + ')">WhatsApp</button>' : '') +
          '<button class="btn" onclick="mkEmail(' + i + ')">E-mail</button>' +
          '<button class="btn" onclick="mkCopiarMsg(' + i + ')">Copiar msg</button>' +
          '<button class="btn red" title="Pediu para não receber mais" onclick="mkOptout(' + i + ')">SAIR</button></div></td></tr>';
      });
      h += '</table></div>';
    }
    h += '<div class="sub" style="margin-top:10px;">Toda mensagem vai com "responda SAIR para não receber mais". Quem pedir, clique em SAIR: a pessoa some de todas as listas. ' + (mk.rm.optout ? mk.rm.optout + ' pessoa(s) já pediram para sair.' : '') + '</div></div>';
    document.getElementById('mkSegBody').innerHTML = h;
  }
  function cupomBtn(s) {
    var c = mk.rm.cupons && mk.rm.cupons[s.cupom];
    if (c && c.ativo) return '<span class="pill p-ativo" style="align-self:center;">cupom ' + s.cupom + ' ativo</span>';
    return '<button class="btn pri" onclick="mkCupomRapido(\'' + s.cupom + '\',' + s.desc + ')">Criar cupom ' + s.cupom + ' (' + s.desc + '%)</button>';
  }
  window.mkCupomRapido = function (c, d) {
    api('cupom_rapido', { codigo: c, desconto: d, obs: 'Remarketing (clientes que venceram)' }).then(function () { toast('Cupom ' + c + ' ativo'); mkRemarketing(true); }).catch(function (e) { toast(e.message); });
  };
  function atual(i) { return itensSeg(mk.seg)[i]; }
  window.mkWhats = function (i) { var x = atual(i); window.open('https://wa.me/' + foneBR(x.telefone) + '?text=' + encodeURIComponent(msgPara(mk.seg, x) + SAIR), '_blank'); };
  window.mkEmail = function (i) {
    var x = atual(i), assunto = { renovar: 'Seu plano 999BOOST vence em breve', vencidos: '10% para voltar ao 999BOOST', carrinho: 'Seu PIX do 999BOOST', upgrade: 'Conheça o Turbo Pro Player', vitalicio: 'Pare de renovar: 999BOOST Vitalício', ebook: 'O painel 999BOOST', indicar: 'Ganhe 20% por indicação' }[mk.seg];
    location.href = 'mailto:' + x.email + '?subject=' + encodeURIComponent(assunto) + '&body=' + encodeURIComponent(msgPara(mk.seg, x) + SAIR);
  };
  window.mkCopiarMsg = function (i) { copiar(msgPara(mk.seg, atual(i)) + SAIR, 'Mensagem copiada'); };
  window.mkOptout = function (i) {
    var x = atual(i);
    if (!confirm(x.email + ' pediu para não receber mais mensagens?')) return;
    api('optout', { email: x.email }).then(function () { toast('Removido das listas'); mkRemarketing(true); }).catch(function (e) { toast(e.message); });
  };
  window.mkCopiarEmails = function () { copiar(itensSeg(mk.seg).map(function (x) { return x.email; }).join(', '), 'E-mails copiados'); };
  window.mkCsv = function () {
    // Formato aceito pelo publico personalizado do Meta Ads (email, phone, fn)
    var linhas = ['email,phone,fn,country'].concat(itensSeg(mk.seg).map(function (x) {
      var f = foneBR(x.telefone);
      return [x.email, f ? '+' + f : '', primeiro(x.nome), 'BR'].map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }));
    baixar('999boost-' + mk.seg + (mk.filtroPlano ? '-' + mk.filtroPlano : '') + '.csv', linhas.join('\n'));
  };

  // =====================================================================
  // INFLUENCIADORES
  // =====================================================================
  var ETAPAS = { a_contatar: 'A contatar', contatado: 'Contatado', proposta: 'Proposta enviada', parceiro: 'Parceiro', sem_interesse: 'Sem interesse' };
  var MSG = {
    dm1: 'Fala, {nome}! Tudo certo? Aqui é o {meu_nome}, do 999BOOST 🚀 Curto muito o seu conteúdo. A gente tem um painel que otimiza o Windows em menos de 1 minuto, sem compartilhar tela, e eu queria te dar o plano Turbo de presente pra testar no seu PC. Se curtir, rola uma parceria com cupom pra sua galera e comissão pra você. Posso te mandar os detalhes?',
    follow1: 'Oi {nome}, passando só pra não deixar perdido 🙂 O convite pro teste do 999BOOST (plano Turbo de presente, 15 dias) continua de pé. Posso te mandar a proposta?',
    proposta: 'Show, {nome}! Segue a proposta em PDF 👇\n\nResumindo:\n• Plano Turbo (R$ 49,90) de presente por 15 dias\n• Cupom {cupom} com 10% OFF pra sua galera\n• 20% de comissão em PIX em cada venda, inclusive nas renovações\n\nSem exclusividade e sem meta. Se topar, me manda: seu e-mail, o código de cupom que você quer e sua chave PIX. Em até 24h tá tudo liberado!',
    follow2: 'E aí, {nome}, conseguiu dar uma olhada na proposta? Se quiser, já libero o seu Turbo hoje pra você testar antes de decidir qualquer coisa.',
    boasvindas: 'Bem-vindo ao time, {nome}! 🎉\n\nSeu plano Turbo já está ativo:\n• E-mail: {email}\n• Código: {codigo}\n• Baixe o painel: ' + SITE + '/download/999Boost.zip\n\nSeu cupom: {cupom} (10% OFF pra galera, 20% de comissão pra você)\nLink pronto: ' + SITE + '/contratar.html?cupom={cupom}\n\nDica: uma live de antes e depois com o contador de FPS na tela funciona muito bem. Qualquer coisa, me chama aqui!'
  };
  function varsPr(p, extra) {
    var v = { nome: primeiro(p.nome), meu_nome: meuNome(), cupom: p.cupom || sugestaoCupom(p.nome), email: p.email || '', codigo: 'no seu e-mail' };
    for (var k in (extra || {})) v[k] = extra[k];
    return v;
  }
  function diasDesde(d) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }
  window.mkInflu = function () {
    document.getElementById('mkMeuNome').value = meuNome();
    document.getElementById('mkPrLista').innerHTML = '<div class="sub">Carregando...</div>';
    api('prospects').then(function (l) { mk.pr = l; desenhaPr(); })
      .catch(function (e) { document.getElementById('mkPrLista').innerHTML = '<div class="box">' + esc(e.message) + '<div class="sub">Rodou o arquivo marketing-setup.sql no Supabase?</div></div>'; });
  };
  window.mkMeuNome = function (v) { ls('mkt_nome', v.trim() || 'Reuber'); };
  window.mkFiltroPr = function (s) { mk.filtroPr = mk.filtroPr === s ? '' : s; desenhaPr(); };
  function desenhaPr() {
    var cont = {}; Object.keys(ETAPAS).forEach(function (k) { cont[k] = 0; });
    mk.pr.forEach(function (p) { cont[p.status] = (cont[p.status] || 0) + 1; });
    document.getElementById('mkEtapas').innerHTML = Object.keys(ETAPAS).map(function (k) {
      return '<button class="etapa et-' + k + (mk.filtroPr === k ? ' on' : '') + '" onclick="mkFiltroPr(\'' + k + '\')">' + ETAPAS[k] + ' <b>' + cont[k] + '</b></button>';
    }).join('<span class="seta-et">›</span>');
    var lista = mk.pr.filter(function (p) { return !mk.filtroPr || p.status === mk.filtroPr; });
    if (!lista.length) {
      document.getElementById('mkPrLista').innerHTML = '<div class="box vazio">' + (mk.pr.length ? 'Ninguém nesta etapa.' : '🎯 Adicione os streamers e criadores que você quer convidar. O painel mostra o próximo passo e a mensagem pronta de cada um.') + '</div>';
      return;
    }
    document.getElementById('mkPrLista').innerHTML = lista.map(function (p) {
      var i = mk.pr.indexOf(p), d = diasDesde(p.atualizado_em), acoes = '', dica = '';
      var dm = p.arroba ? '<button class="btn" onclick="mkDM(' + i + ')">Abrir DM</button>' : '';
      if (p.status === 'a_contatar') {
        dica = 'Próximo passo: mandar a 1ª mensagem.';
        acoes = '<button class="btn pri" onclick="mkMsgPr(' + i + ',\'dm1\',\'contatado\')">1ª mensagem</button>' + dm;
      } else if (p.status === 'contatado') {
        dica = d >= 3 ? '⚠️ Sem resposta há ' + d + ' dias: hora do follow-up.' : 'Aguardando resposta (' + (d ? 'há ' + d + ' dia(s)' : 'hoje') + ').';
        acoes = '<button class="btn pri" onclick="mkMsgPr(' + i + ',\'proposta\',\'proposta\')">Respondeu: enviar proposta</button>' +
          '<button class="btn' + (d >= 3 ? ' pri' : '') + '" onclick="mkMsgPr(' + i + ',\'follow1\')">Follow-up</button>' + dm;
      } else if (p.status === 'proposta') {
        dica = d >= 2 ? '⚠️ Proposta enviada há ' + d + ' dias: vale um follow-up.' : 'Proposta enviada. Quando topar, clique em Ativar parceiro.';
        acoes = '<button class="btn green" onclick="mkAtivarForm(' + i + ')">Ativar parceiro</button>' +
          '<button class="btn' + (d >= 2 ? ' pri' : '') + '" onclick="mkMsgPr(' + i + ',\'follow2\')">Follow-up</button>' +
          '<a class="btn" href="' + PDF + '" download>PDF</a>' + dm;
      } else if (p.status === 'parceiro') {
        dica = 'Parceiro ativo' + (p.cupom ? ' · cupom <b class="mono">' + esc(p.cupom) + '</b>' : '') + '.';
        acoes = '<button class="btn" onclick="mkMsgPr(' + i + ',\'boasvindas\')">Boas-vindas</button>' +
          (p.cupom ? '<button class="btn" onclick="copiarTexto(\'' + SITE + '/contratar.html?cupom=' + esc(p.cupom) + '\')">Link do cupom</button>' : '') + dm;
      } else {
        dica = 'Sem interesse por enquanto.';
        acoes = '<button class="btn" onclick="mkStatus(' + i + ',\'a_contatar\')">Reabrir</button>';
      }
      var sel = '<select onchange="mkStatus(' + i + ',this.value)" title="Mudar etapa">' + Object.keys(ETAPAS).map(function (k) { return '<option value="' + k + '"' + (k === p.status ? ' selected' : '') + '>' + ETAPAS[k] + '</option>'; }).join('') + '</select>';
      return '<div class="pr"><div class="pr-a"><b>' + esc(p.nome) + '</b>' + (p.arroba ? ' <a class="sub" href="https://instagram.com/' + encodeURIComponent(p.arroba) + '" target="_blank" rel="noopener">@' + esc(p.arroba) + '</a>' : '') +
        '<div class="sub">' + [p.plataforma, p.seguidores ? p.seguidores + ' seguidores' : '', p.obs].filter(Boolean).map(esc).join(' · ') + '</div>' +
        '<div class="pr-dica">' + dica + '</div></div>' +
        '<div class="pr-b"><div class="acts">' + acoes + '</div><div class="acts" style="margin-top:6px;">' + sel +
        '<button class="btn" onclick="mkFormPr(' + i + ')">Editar</button><button class="btn red" onclick="mkExcluirPr(' + i + ')">Excluir</button></div></div></div>';
    }).join('');
  }
  window.mkDM = function (i) { window.open('https://ig.me/m/' + encodeURIComponent(mk.pr[i].arroba), '_blank'); };
  window.mkMsgPr = function (i, tipo, proximo, extra) {
    var p = mk.pr[i], txt = preencher(MSG[tipo], varsPr(p, extra));
    mk.prAtual = p;
    var titulos = { dm1: '1ª mensagem', follow1: 'Follow-up (sem resposta)', proposta: 'Mensagem com a proposta', follow2: 'Follow-up da proposta', boasvindas: 'Boas-vindas ao parceiro' };
    var h = '<h3 style="margin-top:0;">' + titulos[tipo] + ' · ' + esc(p.nome) + '</h3><textarea id="mkTxt" rows="9">' + esc(txt) + '</textarea>' +
      (tipo === 'proposta' ? '<div class="sub" style="margin:6px 0;">Mande junto o PDF da proposta: <a href="' + PDF + '" download style="color:var(--orange);">baixar PDF</a>.</div>' : '') +
      '<div class="row" style="margin-top:12px;">' +
      '<button class="btn pri" onclick="mkCopiarAbrir(' + i + ',' + (proximo ? '\'' + proximo + '\'' : 'null') + ')">' + (p.arroba ? 'Copiar e abrir a DM' : 'Copiar') + '</button>' +
      '<button class="btn" onclick="copiarTexto(document.getElementById(\'mkTxt\').value)">Só copiar</button>' +
      '<button class="btn" onclick="fechar()">Fechar</button></div>' +
      (proximo ? '<div class="sub">Ao copiar, a etapa muda para <b>' + ETAPAS[proximo] + '</b>.</div>' : '');
    abrir(h);
  };
  window.mkCopiarAbrir = function (i, proximo) {
    var p = mk.prAtual || mk.pr[i];
    copiar(document.getElementById('mkTxt').value, 'Mensagem copiada. Cole na DM.');
    if (p.arroba) window.open('https://ig.me/m/' + encodeURIComponent(p.arroba), '_blank');
    fechar();
    if (proximo && p.status !== proximo) statusId(p.id, proximo);
  };
  window.mkStatus = function (i, s) { statusId(mk.pr[i].id, s); };
  function statusId(id, s) {
    api('prospect_status', { id: id, status: s }).then(function () { toast('Etapa: ' + ETAPAS[s]); mkInflu(); }).catch(function (e) { toast(e.message); });
  }
  window.mkFormPr = function (i) {
    var p = i === undefined ? {} : mk.pr[i], v = function (x) { return x == null ? '' : esc(x); };
    abrir('<h3 style="margin-top:0;">' + (p.id ? 'Editar' : 'Adicionar') + ' influenciador</h3>' +
      '<div class="row"><div style="flex:1;min-width:180px;"><div class="sub">Nome</div><input id="pNome" style="width:100%;" value="' + v(p.nome) + '" placeholder="Nome do streamer"></div>' +
      '<div style="flex:1;min-width:180px;"><div class="sub">@ do Instagram (ou link do perfil)</div><input id="pArroba" style="width:100%;" value="' + v(p.arroba) + '" placeholder="@usuario"></div></div>' +
      '<div class="row"><div style="flex:1;min-width:140px;"><div class="sub">Onde faz live / posta</div><select id="pPlat" style="width:100%;">' +
      ['', 'Twitch', 'YouTube', 'TikTok', 'Kick', 'Instagram'].map(function (o) { return '<option' + (o === (p.plataforma || '') ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></div>' +
      '<div style="width:140px;"><div class="sub">Seguidores</div><input id="pSeg" style="width:100%;" value="' + v(p.seguidores) + '" placeholder="ex.: 12 mil"></div></div>' +
      '<div class="row"><div style="flex:1;"><div class="sub">Observação (jogo, horário das lives...)</div><input id="pObs" style="width:100%;" value="' + v(p.obs) + '"></div></div>' +
      '<div class="row" style="margin-top:12px;"><button class="btn pri" onclick="mkSalvarPr(\'' + (p.id || '') + '\')">Salvar</button><button class="btn" onclick="fechar()">Cancelar</button></div>');
    setTimeout(function () { document.getElementById('pNome').focus(); }, 50);
  };
  window.mkSalvarPr = function (id) {
    api('prospect_salvar', { id: id, nome: document.getElementById('pNome').value, arroba: document.getElementById('pArroba').value,
      plataforma: document.getElementById('pPlat').value, seguidores: document.getElementById('pSeg').value, obs: document.getElementById('pObs').value })
      .then(function () { fechar(); toast('Salvo'); mkInflu(); }).catch(function (e) { toast(e.message); });
  };
  window.mkExcluirPr = function (i) {
    if (!confirm('Excluir ' + mk.pr[i].nome + ' da lista?')) return;
    api('prospect_excluir', { id: mk.pr[i].id }).then(function () { toast('Excluído'); mkInflu(); }).catch(function (e) { toast(e.message); });
  };
  window.mkAtivarForm = function (i) {
    var p = mk.pr[i];
    abrir('<h3 style="margin-top:0;">Ativar parceiro · ' + esc(p.nome) + '</h3>' +
      '<div class="sub" style="margin-bottom:10px;">Um clique cria o cupom (10% para a galera, 20% de comissão) e libera o plano Turbo de 15 dias no e-mail dele.</div>' +
      '<div class="row"><div style="flex:1;min-width:200px;"><div class="sub">E-mail do parceiro</div><input id="aEmail" type="email" style="width:100%;" value="' + esc(p.email || '') + '"></div>' +
      '<div style="width:170px;"><div class="sub">Código do cupom</div><input id="aCupom" style="width:100%;text-transform:uppercase;" value="' + esc(p.cupom || sugestaoCupom(p.nome)) + '"></div></div>' +
      '<div class="row"><div style="flex:1;"><div class="sub">Chave PIX (para a comissão) — opcional</div><input id="aPix" style="width:100%;"></div></div>' +
      '<div class="row" style="margin-top:12px;"><button class="btn pri" id="aBtn" onclick="mkAtivar(' + i + ')">Ativar agora</button><button class="btn" onclick="fechar()">Cancelar</button></div>');
  };
  window.mkAtivar = function (i) {
    var b = document.getElementById('aBtn'); b.disabled = true; b.textContent = 'Ativando...';
    var p = mk.pr[i];
    api('prospect_ativar', { id: p.id, email: document.getElementById('aEmail').value, cupom: document.getElementById('aCupom').value, pix: document.getElementById('aPix').value })
      .then(function (r) {
        toast('Parceiro ativado!');
        p.email = r.email; p.cupom = r.cupom; p.status = 'parceiro';
        mkMsgPr(i, 'boasvindas', null, { codigo: r.codigo, email: r.email, cupom: r.cupom });
        api('prospects').then(function (l) { mk.pr = l; desenhaPr(); });
      })
      .catch(function (e) { toast(e.message); b.disabled = false; b.textContent = 'Ativar agora'; });
  };
})();
