// 999BOOST - Checkout automatico (PIX Mercado Pago -> licenca na hora)
// Um unico endpoint: /api/checkout
//   POST { acao:"cupom",  cupom }                              -> { ok, desconto }
//   POST { acao:"criar",  plano, nome, email, telefone, cupom } -> { pedido_id, valor, qr_code, qr_code_base64, ticket_url }
//   POST { acao:"status", pedido_id }                           -> { status, plano, email, codigo? }
//   POST (webhook do Mercado Pago, topico "Order")              -> 200
//
// Variaveis de ambiente (Vercel):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (ja existem)
//   MP_ACCESS_TOKEN                     (Mercado Pago > Suas integracoes > Credenciais de producao > Access Token)
//   RESEND_API_KEY                      (opcional - envio do e-mail com a licenca)
//   EMAIL_FROM                          (opcional - padrao: 999BOOST <licenca@999boost.com.br>)

import crypto from 'crypto';

// Precos e cupons ficam AQUI no servidor (o navegador nao consegue alterar)
const PLANOS = {
  basic:     { nome: 'Basic Gamer',      preco: 19.90, dias: 15 },
  streamer:  { nome: 'Low Streamer',     preco: 29.90, dias: 15 },
  turbo:     { nome: 'Turbo Pro Player', preco: 49.90, dias: 15 },
  vitalicio: { nome: 'Vitalicio',        preco: 99.90, dias: null },
  ebook:     { nome: 'Guia 999BOOST de BIOS e Jogos', preco: 27.00, dias: null, tipo: 'ebook' }
};
// E-book: arquivo PRIVADO no Supabase Storage (bucket "privado"). O link de download e temporario (10 min).
const GUIA_ARQUIVO = 'Guia-999BOOST-BIOS-e-Jogos.pdf';
const GUIA_PAGINA = 'https://www.999boost.com.br/guia.html';
// Cupons ficam na tabela "cupons" do Supabase (cadastro pelo painel admin > Cupons)

const SITE = 'https://www.999boost.com.br';
const DOWNLOAD_URL = SITE + '/download/999Boost.zip';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

const sbHeaders = () => ({
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json'
});

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders(), ...(opts.headers || {}) } });
  const txt = await r.text();
  let dados = null;
  try { dados = txt ? JSON.parse(txt) : null; } catch { dados = txt; }
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${txt}`);
  return dados;
}

async function mp(path, opts = {}) {
  const r = await fetch(`https://api.mercadopago.com${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', 'accept': 'application/json', ...(opts.headers || {}) }
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`MercadoPago ${r.status}: ${JSON.stringify(dados)}`);
  return dados;
}

function valorComDesconto(preco, pct) {
  return Math.round(preco * (100 - (pct || 0))) / 100;
}

// Busca um cupom valido (ativo, dentro da validade e do limite de usos). Retorna null se nao valer.
async function buscarCupom(codigo) {
  const c = String(codigo || '').trim().toUpperCase();
  if (!c || !/^[A-Z0-9_-]{2,30}$/.test(c)) return null;
  const achados = await sb(`cupons?codigo=eq.${encodeURIComponent(c)}&ativo=eq.true&select=*`);
  const cup = Array.isArray(achados) ? achados[0] : null;
  if (!cup) return null;
  if (cup.validade && new Date(cup.validade) < new Date()) return null;
  if (cup.limite_usos) {
    const usados = await sb(`pedidos?cupom=eq.${encodeURIComponent(c)}&status=eq.pago&select=id`);
    if (Array.isArray(usados) && usados.length >= cup.limite_usos) return null;
  }
  return cup;
}

// ================= PROGRAMA DE INDICACAO =================
// A cada 3 novos clientes confirmados (7 dias sem reembolso) indicados pelo link, o indicador ganha
// 1 plano igual ao MENOR plano comprado entre esses 3. Ex.: Turbo+Turbo+Basic = ganha Basic.
const NIVEL = { basic: 1, streamer: 2, turbo: 3, vitalicio: 4 };
const CARENCIA_DIAS = 7;   // prazo de arrependimento (CDC art. 49) antes de a indicacao contar
const POR_PREMIO = 3;
const COMISSAO_VITALICIO = 20;   // indicador Vitalicio ganha 20% do valor pago em PIX (em vez de plano)

function mascararEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '***';
  return (u.length <= 2 ? u[0] : u.slice(0, 2)) + '***@' + d;
}

function gerarCodigoIndicacao() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += alfabeto[b[i] % alfabeto.length];
  return s;
}

// No checkout: so vale para plano de assinatura, cliente NOVO (sem licenca) e que nao seja o proprio indicador
async function validarIndicacao(ref, email, planoSlug) {
  const r = String(ref || '').trim().toUpperCase();
  if (!r || !/^[A-Z0-9]{6}$/.test(r) || !NIVEL[planoSlug]) return null;
  const af = await sb(`afiliados?codigo=eq.${r}&select=codigo,email`);
  if (!Array.isArray(af) || !af[0] || af[0].email === email) return null;
  const jaCliente = await sb(`licencas?email=eq.${encodeURIComponent(email)}&select=id`);
  if (Array.isArray(jaCliente) && jaCliente.length > 0) return null;
  const licRef = await sb(`licencas?email=eq.${encodeURIComponent(af[0].email)}&select=plano,status`);
  const vitalicio = Array.isArray(licRef) && licRef[0] && licRef[0].plano === 'vitalicio' && licRef[0].status === 'ativo';
  return { codigo: r, pct: vitalicio ? COMISSAO_VITALICIO : 0 };
}

async function obterAfiliado(email) {
  const e = encodeURIComponent(email);
  let af = await sb(`afiliados?email=eq.${e}&select=*`);
  if (Array.isArray(af) && af[0]) return af[0];
  for (let i = 0; i < 5; i++) {
    try {
      const novo = await sb('afiliados', { method: 'POST', headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ codigo: gerarCodigoIndicacao(), email }) });
      return novo[0];
    } catch (err) {
      af = await sb(`afiliados?email=eq.${e}&select=*`);
      if (Array.isArray(af) && af[0]) return af[0];
    }
  }
  throw new Error('Nao foi possivel gerar o codigo de indicacao');
}

// Monta a situacao do indicador: quem veio pelo link, o que ja conta e os premios
async function situacaoIndicacoes(codigo) {
  const pedidos = await sb(`pedidos?indicado_por=eq.${codigo}&status=in.(pago,reembolsado)&select=id,email,nome,plano,valor,pago_em,status,ref_comissao_pct,ref_comissao_paga&order=pago_em.asc`);
  const premios = await sb(`indicacoes_premios?afiliado=eq.${codigo}&select=*&order=criado_em.asc`);
  const usados = new Set();
  (premios || []).forEach(p => (p.pedidos || []).forEach(id => usados.add(id)));
  const limite = Date.now() - CARENCIA_DIAS * 86400000;
  const vistos = new Set();
  const indicados = [];
  for (const p of (pedidos || [])) {
    if (vistos.has(p.email)) continue;   // cada cliente novo conta 1 vez
    vistos.add(p.email);
    const comissao = Number(p.ref_comissao_pct || 0) > 0
      ? Math.round(Number(p.valor || 0) * Number(p.ref_comissao_pct)) / 100 : 0;
    let situacao;
    if (p.status === 'reembolsado') situacao = 'cancelada';
    else if (comissao && p.ref_comissao_paga) situacao = 'paga';
    else if (usados.has(p.id)) situacao = 'premiada';
    else if (new Date(p.pago_em).getTime() > limite) situacao = 'em_analise';
    else situacao = comissao ? 'a_receber' : 'confirmada';
    indicados.push({ id: p.id, email: p.email, nome: p.nome, plano: p.plano, pago_em: p.pago_em, situacao, comissao,
      conta_em: situacao === 'em_analise' ? new Date(new Date(p.pago_em).getTime() + CARENCIA_DIAS * 86400000).toISOString() : null });
  }
  const livres = indicados.filter(i => i.situacao === 'confirmada');
  const disponiveis = Math.floor(livres.length / POR_PREMIO);
  let proximo = null;
  if (disponiveis > 0) {
    const grupo = livres.slice(0, POR_PREMIO);
    proximo = grupo.reduce((m, i) => (NIVEL[i.plano] < NIVEL[m] ? i.plano : m), grupo[0].plano);
  }
  const soma = f => Math.round(indicados.filter(f).reduce((t, i) => t + i.comissao, 0) * 100) / 100;
  const dinheiro = {
    a_receber: soma(i => i.comissao && i.situacao === 'a_receber'),
    em_analise: soma(i => i.comissao && i.situacao === 'em_analise'),
    recebido: soma(i => i.comissao && i.situacao === 'paga')
  };
  return { indicados, premios: premios || [], livres, disponiveis, proximo, dinheiro,
    progresso: livres.length % POR_PREMIO,
    em_analise: indicados.filter(i => i.situacao === 'em_analise').length };
}

// Entrega 1 premio (grupo de 3 confirmados mais antigos)
async function resgatarPremio(af) {
  const sit = await situacaoIndicacoes(af.codigo);
  if (sit.disponiveis < 1) return { erro: 'Ainda nao ha premio disponivel.' };
  const grupo = sit.livres.slice(0, POR_PREMIO);
  const plano = sit.proximo;
  const lics = await sb(`licencas?email=eq.${encodeURIComponent(af.email)}&select=*`);
  const lic = Array.isArray(lics) ? lics[0] : null;
  if (!lic || lic.status !== 'ativo') return { erro: 'Sua licenca precisa estar ativa para resgatar. Fale com o suporte.' };
  const presente = lic.plano === 'vitalicio';
  const ids = grupo.map(g => g.id).sort();
  try {
    await sb('indicacoes_premios', { method: 'POST', body: JSON.stringify({
      id: af.codigo + ':' + ids.join(','), afiliado: af.codigo, email: af.email, plano, pedidos: ids,
      status: presente ? 'presente_pendente' : 'entregue' }) });
  } catch (e) {
    return { erro: 'Este premio ja foi resgatado.' };   // clique duplo / duas abas
  }
  if (presente) return { ok: true, plano, presente: true };
  let campos;
  if (plano === 'vitalicio') campos = { plano: 'vitalicio', data_expiracao: null };
  else {
    const agora = new Date();
    const base = lic.data_expiracao && new Date(lic.data_expiracao) > agora ? new Date(lic.data_expiracao) : agora;
    campos = { data_expiracao: new Date(base.getTime() + 15 * 86400000).toISOString(),
      plano: (NIVEL[plano] > (NIVEL[lic.plano] || 0)) ? plano : lic.plano };
  }
  await sb(`licencas?id=eq.${lic.id}`, { method: 'PATCH', body: JSON.stringify(campos) });
  return { ok: true, plano, presente: false, plano_final: campos.plano, expira: campos.data_expiracao };
}

async function autenticarIndicador(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const codigo = String(body.codigo || '').trim().toUpperCase();
  if (!email || !codigo) return null;
  const lics = await sb(`licencas?email=eq.${encodeURIComponent(email)}&codigo=eq.${encodeURIComponent(codigo)}&select=status`);
  if (!Array.isArray(lics) || !lics[0] || ['cancelado', 'reembolsado'].includes(lics[0].status)) {
    await new Promise(r => setTimeout(r, 1200));
    return null;
  }
  return obterAfiliado(email);
}

function esc(t) {
  return String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function gerarCodigo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sem 0/O/1/I (evita confusao)
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += alfabeto[bytes[i] % alfabeto.length];
    if (i === 3 || i === 7) s += '-';
  }
  return s;
}

// Cria ou renova a licenca do e-mail e devolve o codigo
async function entregarLicenca(email, planoSlug) {
  const plano = PLANOS[planoSlug];
  const agora = new Date();
  const existentes = await sb(`licencas?email=eq.${encodeURIComponent(email)}&select=*`);

  if (Array.isArray(existentes) && existentes.length > 0) {
    const lic = existentes[0];
    let campos;
    if (planoSlug === 'vitalicio') {
      campos = { plano: 'vitalicio', data_expiracao: null, status: 'ativo' };
    } else if (lic.plano === 'vitalicio' && lic.status === 'ativo') {
      campos = {};   // ja tem vitalicio - nada a mudar
    } else {
      const base = lic.data_expiracao && new Date(lic.data_expiracao) > agora ? new Date(lic.data_expiracao) : agora;
      const nova = new Date(base.getTime() + plano.dias * 86400 * 1000);
      campos = { plano: planoSlug, data_expiracao: nova.toISOString(), status: 'ativo' };
    }
    if (Object.keys(campos).length) {
      await sb(`licencas?id=eq.${lic.id}`, { method: 'PATCH', body: JSON.stringify(campos) });
    }
    return { codigo: lic.codigo, renovacao: true };
  }

  const codigo = gerarCodigo();
  const expira = plano.dias ? new Date(agora.getTime() + plano.dias * 86400 * 1000).toISOString() : null;
  await sb('licencas', {
    method: 'POST',
    body: JSON.stringify({ email, codigo, status: 'ativo', plano: planoSlug, data_expiracao: expira })
  });
  return { codigo, renovacao: false };
}

async function linkGuia() {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/privado/${GUIA_ARQUIVO}`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: 600 })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Storage: ' + JSON.stringify(j));
  return `${SB_URL}/storage/v1${j.signedURL}&download=${GUIA_ARQUIVO}`;
}

async function enviarEmailGuia(pedido, codigo) {
  if (!process.env.RESEND_API_KEY) return;
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#0a0a0c;color:#fff;padding:28px;">
    <h2 style="color:#ff7a1a;margin:0 0 6px 0;">999BOOST - Seu Guia de BIOS e Jogos</h2>
    <p style="color:#ccc;">Oi ${esc(pedido.nome)}! Pagamento confirmado. Para baixar o guia (e baixar de novo quando quiser):</p>
    <div style="background:#141213;border:1px solid #2a2626;border-radius:10px;padding:16px;margin:18px 0;">
      <div style="color:#a8a8a8;font-size:13px;">E-mail</div>
      <div style="font-size:16px;font-weight:bold;margin-bottom:10px;">${esc(pedido.email)}</div>
      <div style="color:#a8a8a8;font-size:13px;">Codigo de acesso</div>
      <div style="font-size:24px;font-weight:bold;color:#ff7a1a;letter-spacing:2px;">${codigo}</div>
    </div>
    <p><a href="${GUIA_PAGINA}" style="background:#ff7a1a;color:#000;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Baixar o Guia</a></p>
    <p style="color:#888;font-size:12px;">Uso pessoal. Proibida a revenda e a distribuicao.</p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || '999BOOST <licenca@999boost.com.br>', to: [pedido.email], subject: 'Seu Guia 999BOOST de BIOS e Jogos', html })
  }).catch(() => {});
}

async function enviarEmail(pedido, codigo) {
  if (!process.env.RESEND_API_KEY) return;
  const plano = PLANOS[pedido.plano];
  const validade = plano.dias ? `${plano.dias} dias a partir de hoje` : 'vitalicio (nao expira)';
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#0a0a0c;color:#fff;padding:28px;">
    <h2 style="color:#ff7a1a;margin:0 0 6px 0;">999BOOST - Pagamento confirmado</h2>
    <p style="color:#ccc;">Oi ${esc(pedido.nome)}! Seu plano <b>${plano.nome}</b> esta ativo (${validade}).</p>
    <div style="background:#141213;border:1px solid #2a2626;border-radius:10px;padding:16px;margin:18px 0;">
      <div style="color:#a8a8a8;font-size:13px;">E-mail (login)</div>
      <div style="font-size:16px;font-weight:bold;margin-bottom:10px;">${esc(pedido.email)}</div>
      <div style="color:#a8a8a8;font-size:13px;">Codigo de licenca</div>
      <div style="font-size:24px;font-weight:bold;color:#ff7a1a;letter-spacing:2px;">${codigo}</div>
    </div>
    <p><a href="${DOWNLOAD_URL}" style="background:#ff7a1a;color:#000;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Baixar o painel 999BOOST</a></p>
    <ol style="color:#ccc;font-size:14px;line-height:1.7;">
      <li>Extraia o arquivo baixado numa pasta.</li>
      <li>De dois cliques em <b>Abrir 999Boost Assinante.bat</b> e aceite rodar como administrador.</li>
      <li>Entre com o e-mail e o codigo acima.</li>
      <li>Crie um ponto de restauracao, rode o Diagnostico e aplique as otimizacoes.</li>
    </ol>
    ${pedido.plano === 'vitalicio' ? `<p style="color:#ccc;">Brinde do Vitalicio: o <b>Guia 999BOOST de BIOS e Jogos</b> (PDF). Baixe em <a href="${GUIA_PAGINA}" style="color:#ff7a1a;">${GUIA_PAGINA}</a> com o seu e-mail e o codigo de licenca acima.</p>` : ''}
    <div style="border:1px dashed #ff7a1a;border-radius:10px;padding:14px;margin:18px 0;color:#ddd;font-size:14px;">
      <b style="color:#ff7a1a;">Indique e ganhe:</b> ${pedido.plano === 'vitalicio'
        ? 'ganhe 20% em PIX por cada amigo que comprar pelo seu link.'
        : 'a cada 3 amigos que comprarem pelo seu link, voce ganha um plano gratis.'}
      <a href="${SITE}/indique.html?email=${encodeURIComponent(pedido.email)}" style="color:#ff7a1a;">Pegar meu link</a>
    </div>
    <p style="color:#888;font-size:12px;">Formatou ou trocou de PC? Use o botao "Formatei ou troquei de PC" na tela de login do painel.</p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || '999BOOST <licenca@999boost.com.br>',
      to: [pedido.email],
      subject: `Sua licenca 999BOOST - ${plano.nome}`,
      html
    })
  }).catch(() => {});
}

// Confere no Mercado Pago se o pedido foi pago e, se sim, entrega (uma unica vez)
async function processarPedido(pedido) {
  if (!pedido || pedido.status === 'pago' || !pedido.mp_order_id) return pedido;

  const ordem = await mp(`/v1/orders/${pedido.mp_order_id}`);
  // Confere se o valor pago e o mesmo do pedido (defesa extra)
  if (ordem.status === 'processed' && Math.abs(parseFloat(ordem.total_amount) - parseFloat(pedido.valor)) > 0.009) {
    console.error('Valor divergente no pedido', pedido.id, ordem.total_amount, pedido.valor);
    return pedido;
  }
  if (ordem.status !== 'processed') {
    if (['expired', 'canceled', 'cancelled', 'failed'].includes(ordem.status) && pedido.status === 'pendente') {
      await sb(`pedidos?id=eq.${pedido.id}&status=eq.pendente`, { method: 'PATCH', body: JSON.stringify({ status: 'expirado' }) });
      return { ...pedido, status: 'expirado' };
    }
    return pedido;
  }

  // "Trava" o pedido para so uma execucao entregar a licenca (webhook e tela podem chegar juntos)
  const travado = await sb(`pedidos?id=eq.${pedido.id}&status=in.(pendente,expirado)`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({ status: 'processando' })
  });
  if (!Array.isArray(travado) || travado.length === 0) {
    const atual = await sb(`pedidos?id=eq.${pedido.id}&select=*`);
    return atual[0];
  }

  try {
    if (PLANOS[pedido.plano] && PLANOS[pedido.plano].tipo === 'ebook') {
      const codigoGuia = gerarCodigo();
      await sb(`pedidos?id=eq.${pedido.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'pago', codigo_entregue: codigoGuia, pago_em: new Date().toISOString() })
      });
      await enviarEmailGuia(pedido, codigoGuia);
      return { ...pedido, status: 'pago', codigo_entregue: codigoGuia };
    }
    const { codigo, renovacao } = await entregarLicenca(pedido.email, pedido.plano);
    // SEGURANCA: em renovacao o codigo NAO volta para a tela (quem pagou pode nao ser o dono do e-mail);
    // o codigo vai so para o e-mail do dono.
    const entregue = renovacao ? 'RENOVACAO' : codigo;
    await sb(`pedidos?id=eq.${pedido.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pago', codigo_entregue: entregue, pago_em: new Date().toISOString() })
    });
    await enviarEmail(pedido, codigo);
    return { ...pedido, status: 'pago', codigo_entregue: entregue };
  } catch (e) {
    await sb(`pedidos?id=eq.${pedido.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pendente' }) }).catch(() => {});
    throw e;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });
  if (!SB_URL || !SB_KEY || !MP_TOKEN) return res.status(500).json({ erro: 'Servidor de pagamento nao configurado' });

  const body = req.body || {};

  try {
    // ---------- Webhook do Mercado Pago ----------
    if ((body.action && String(body.action).startsWith('order')) || body.type === 'order' || (req.query && req.query.topic === 'order')) {
      const ordemId = (body.data && body.data.id) || (req.query && (req.query['data.id'] || req.query.id));
      if (ordemId) {
        const achados = await sb(`pedidos?mp_order_id=eq.${encodeURIComponent(ordemId)}&select=*`);
        if (Array.isArray(achados) && achados[0]) await processarPedido(achados[0]);
      }
      return res.status(200).json({ ok: true });
    }

    const acao = body.acao;

    // ---------- Cupom ----------
    if (acao === 'cupom') {
      const cup = await buscarCupom(body.cupom);
      return res.status(200).json({ ok: !!cup, desconto: cup ? cup.desconto : 0 });
    }

    // ---------- Criar PIX ----------
    if (acao === 'criar') {
      const planoSlug = body.plano;
      const plano = PLANOS[planoSlug];
      const email = String(body.email || '').trim().toLowerCase();
      const nome = String(body.nome || '').trim().slice(0, 120);
      const telefone = String(body.telefone || '').trim().slice(0, 40);
      const cupom = String(body.cupom || '').trim().toUpperCase();
      if (!plano) return res.status(400).json({ erro: 'Plano invalido' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'E-mail invalido' });
      if (!nome) return res.status(400).json({ erro: 'Informe seu nome' });

      // Anti-abuso: e-mail com reembolso anterior nao compra automaticamente (analise manual pelo suporte)
      const anteriores = await sb(`licencas?email=eq.${encodeURIComponent(email)}&status=eq.reembolsado&select=id`);
      if (Array.isArray(anteriores) && anteriores.length > 0) {
        return res.status(400).json({ erro: 'Este e-mail tem um reembolso anterior. Para comprar novamente, fale com o suporte no WhatsApp (85) 99195-4902.' });
      }

      const cup = await buscarCupom(cupom);
      const valor = valorComDesconto(plano.preco, cup ? cup.desconto : 0);
      const indicadoPor = await validarIndicacao(body.ref, email, planoSlug);
      const criado = await sb('pedidos', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ plano: planoSlug, valor, nome, email, telefone, cupom: cup ? cup.codigo : null,
          desconto_pct: cup ? cup.desconto : 0, comissao_pct: cup ? (cup.comissao || 0) : 0, parceiro: cup ? cup.parceiro : null, indicado_por: indicadoPor ? indicadoPor.codigo : null, origem: String(body.origem || 'direto').toLowerCase().replace(/[^a-z0-9._:\/-]/g, '').slice(0, 60) || 'direto', ref_comissao_pct: indicadoPor ? indicadoPor.pct : 0, status: 'pendente' })
      });
      const pedido = criado[0];

      const ordem = await mp('/v1/orders', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': pedido.id },
        body: JSON.stringify({
          type: 'online',
          total_amount: valor.toFixed(2),
          external_reference: pedido.id,
          processing_mode: 'automatic',
          transactions: {
            payments: [{
              amount: valor.toFixed(2),
              payment_method: { id: 'pix', type: 'bank_transfer' },
              expiration_time: 'PT30M'
            }]
          },
          payer: { email, first_name: nome.split(' ')[0] }
        })
      });

      const pm = ordem?.transactions?.payments?.[0]?.payment_method || {};
      await sb(`pedidos?id=eq.${pedido.id}`, { method: 'PATCH', body: JSON.stringify({ mp_order_id: ordem.id }) });

      return res.status(200).json({
        pedido_id: pedido.id,
        valor,
        qr_code: pm.qr_code,
        qr_code_base64: pm.qr_code_base64,
        ticket_url: pm.ticket_url
      });
    }

    // ---------- Consultar status (a tela pergunta a cada poucos segundos) ----------
    if (acao === 'status') {
      const id = String(body.pedido_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Pedido invalido' });
      const achados = await sb(`pedidos?id=eq.${id}&select=*`);
      if (!Array.isArray(achados) || !achados[0]) return res.status(404).json({ erro: 'Pedido nao encontrado' });
      const p = await processarPedido(achados[0]);
      const resp = { status: p.status, plano: p.plano, email: p.email };
      if (p.status === 'pago') {
        resp.download = DOWNLOAD_URL;
        resp.guia = (p.plano === 'ebook' || p.plano === 'vitalicio');
        if (p.codigo_entregue === 'RENOVACAO') resp.renovacao = true;
        else resp.codigo = p.codigo_entregue;
      }
      return res.status(200).json(resp);
    }

    // ---------- Download do Guia (comprado ou brinde do Vitalicio) ----------
    if (acao === 'guia') {
      let liberado = false;
      const id = String(body.pedido_id || '');
      if (id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Pedido invalido' });
        const achados = await sb(`pedidos?id=eq.${id}&status=eq.pago&select=plano`);
        liberado = Array.isArray(achados) && achados[0] && ['ebook', 'vitalicio'].includes(achados[0].plano);
      } else {
        const email = String(body.email || '').trim().toLowerCase();
        const codigo = String(body.codigo || '').trim().toUpperCase();
        if (!email || !codigo) return res.status(400).json({ erro: 'Informe o e-mail e o codigo' });
        const e = encodeURIComponent(email), c = encodeURIComponent(codigo);
        const compras = await sb(`pedidos?email=eq.${e}&codigo_entregue=eq.${c}&plano=eq.ebook&status=eq.pago&select=id`);
        const vitalicio = await sb(`licencas?email=eq.${e}&codigo=eq.${c}&plano=eq.vitalicio&status=eq.ativo&select=id`);
        liberado = (Array.isArray(compras) && compras.length > 0) || (Array.isArray(vitalicio) && vitalicio.length > 0);
        if (!liberado) await new Promise(r => setTimeout(r, 1200));
      }
      if (!liberado) return res.status(403).json({ erro: 'E-mail ou codigo sem acesso ao guia' });
      return res.status(200).json({ url: await linkGuia() });
    }

    // ---------- Programa de indicacao (pagina /indique.html) ----------
    if (acao === 'indique' || acao === 'indique_resgatar' || acao === 'indique_pix') {
      const af = await autenticarIndicador(body);
      if (!af) return res.status(403).json({ erro: 'E-mail ou codigo de licenca invalido' });
      let resgate = null;
      if (acao === 'indique_pix') {
        const pix = String(body.pix || '').trim().slice(0, 120);
        if (pix.length < 5) return res.status(400).json({ erro: 'Informe uma chave PIX valida' });
        await sb(`afiliados?codigo=eq.${af.codigo}`, { method: 'PATCH', body: JSON.stringify({ pix }) });
        af.pix = pix;
      }
      if (acao === 'indique_resgatar') {
        resgate = await resgatarPremio(af);
        if (resgate.erro) return res.status(400).json(resgate);
      }
      const sit = await situacaoIndicacoes(af.codigo);
      const licAf = await sb(`licencas?email=eq.${encodeURIComponent(af.email)}&select=plano`);
      return res.status(200).json({
        codigo: af.codigo,
        vitalicio: Array.isArray(licAf) && licAf[0] && licAf[0].plano === 'vitalicio',
        comissao_pct: COMISSAO_VITALICIO, pix: af.pix || '', dinheiro: sit.dinheiro,
        link: `${SITE}/contratar.html?ref=${af.codigo}`,
        confirmadas: sit.livres.length, progresso: sit.progresso, por_premio: POR_PREMIO,
        em_analise: sit.em_analise, disponiveis: sit.disponiveis, proximo: sit.proximo,
        premios: sit.premios.map(p => ({ plano: p.plano, status: p.status, criado_em: p.criado_em })),
        indicados: sit.indicados.map(i => ({ quem: (i.nome || '').split(' ')[0] + ' (' + mascararEmail(i.email) + ')',
          plano: i.plano, pago_em: i.pago_em, situacao: i.situacao, conta_em: i.conta_em, comissao: i.comissao })),
        resgate
      });
    }

    return res.status(400).json({ erro: 'Acao invalida' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro no servidor de pagamento. Tente de novo em instantes.' });
  }
}
