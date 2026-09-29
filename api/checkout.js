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
  vitalicio: { nome: 'Vitalicio',        preco: 99.90, dias: null }
};
const CUPONS = { 'BEMVINDO10': 10, '999BOOST15': 15 };   // percentual de desconto

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

function valorComDesconto(preco, cupom) {
  const pct = CUPONS[(cupom || '').trim().toUpperCase()] || 0;
  return Math.round(preco * (100 - pct)) / 100;
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
      const pct = CUPONS[(body.cupom || '').trim().toUpperCase()] || 0;
      return res.status(200).json({ ok: pct > 0, desconto: pct });
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

      const valor = valorComDesconto(plano.preco, cupom);
      const criado = await sb('pedidos', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ plano: planoSlug, valor, nome, email, telefone, cupom: CUPONS[cupom] ? cupom : null, status: 'pendente' })
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
        if (p.codigo_entregue === 'RENOVACAO') resp.renovacao = true;
        else resp.codigo = p.codigo_entregue;
      }
      return res.status(200).json(resp);
    }

    return res.status(400).json({ erro: 'Acao invalida' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro no servidor de pagamento. Tente de novo em instantes.' });
  }
}
