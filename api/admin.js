// 999BOOST - API do painel administrativo (/admin.html)
// Protegida pela variavel de ambiente ADMIN_SENHA (Vercel). Sem ela, a API fica desligada.
// Toda chamada: POST { senha, acao, ...dados }

import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SENHA = process.env.ADMIN_SENHA;
const PLANOS = ['basic', 'streamer', 'turbo', 'vitalicio'];
const DIAS = 15;

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json',
      'Prefer': 'return=representation', ...(opts.headers || {})
    }
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

function senhaOk(s) {
  if (!SENHA || typeof s !== 'string') return false;
  const a = crypto.createHash('sha256').update(s).digest();
  const b = crypto.createHash('sha256').update(SENHA).digest();
  return crypto.timingSafeEqual(a, b);
}

function gerarCodigo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) { s += alfabeto[bytes[i] % alfabeto.length]; if (i === 3 || i === 7) s += '-'; }
  return s;
}

const enc = encodeURIComponent;

// ---------- Recuperacao de carrinho ----------
const SITE = 'https://www.999boost.com.br';
const PRECOS = { basic: 19.90, streamer: 29.90, turbo: 49.90, vitalicio: 99.90, ebook: 27.00 };
const NOMES_PLANO = { basic: 'Basic Gamer', streamer: 'Low Streamer', turbo: 'Turbo Pro Player', vitalicio: 'Vitalicio', ebook: 'Guia de BIOS e Jogos' };
const escH = t => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function codigoVolta() {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(5);
  let s = 'VOLTA-';
  for (let i = 0; i < 5; i++) s += alfa[b[i] % alfa.length];
  return s;
}
function linkRecuperacao(c) {
  const q = new URLSearchParams({ plano: c.plano === 'ebook' ? 'ebook' : c.plano, cupom: c.cupom, email: c.email });
  if (c.nome) q.set('nome', c.nome);
  if (c.telefone) q.set('tel', c.telefone);
  return `${SITE}/contratar.html?${q.toString()}`;
}
async function emailRecuperacao(c) {
  if (!process.env.RESEND_API_KEY) throw new Error('E-mail automatico desligado: configure o RESEND_API_KEY na Vercel');
  const primeiro = String(c.nome || '').split(' ')[0];
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#0a0a0c;color:#fff;padding:28px;">
    <h2 style="color:#ff7a1a;margin:0 0 8px 0;">Seu PC ainda pode ficar mais rapido</h2>
    <p style="color:#ccc;">Oi${primeiro ? ' ' + escH(primeiro) : ''}! Voce comecou a contratar o <b>${escH(NOMES_PLANO[c.plano] || c.plano)}</b> no 999BOOST, mas o PIX nao foi concluido.</p>
    <p style="color:#ccc;">Separamos <b style="color:#fff;">${c.desconto}% de desconto</b> so para voce finalizar. Valido por ${c.horas} horas.</p>
    <div style="background:#141213;border:1px dashed #ff7a1a;border-radius:10px;padding:14px;margin:18px 0;text-align:center;">
      <div style="color:#a8a8a8;font-size:13px;">Seu cupom</div>
      <div style="font-size:24px;font-weight:bold;color:#ff7a1a;letter-spacing:2px;">${escH(c.cupom)}</div>
    </div>
    <p><a href="${linkRecuperacao(c)}" style="background:#ff7a1a;color:#000;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Finalizar com desconto</a></p>
    <p style="color:#888;font-size:12px;">O cupom ja vem aplicado no link. Otimizacao em menos de 1 minuto, sem compartilhar tela.<br>Nao quer receber mais mensagens? Responda este e-mail com SAIR.</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || '999BOOST <licenca@999boost.com.br>', reply_to: process.env.EMAIL_SUPORTE || 'suporte999boost@gmail.com', to: [c.email], subject: `${c.desconto}% de desconto para finalizar seu 999BOOST`, html })
  });
  if (!r.ok) throw new Error('Falha no envio do e-mail (' + r.status + ')');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });
  if (!SB_URL || !SB_KEY || !SENHA) return res.status(500).json({ erro: 'Admin desligado: configure ADMIN_SENHA na Vercel' });

  const b = req.body || {};
  if (!senhaOk(b.senha)) {
    await new Promise(r => setTimeout(r, 1500));   // freia tentativa de adivinhar senha
    return res.status(401).json({ erro: 'Senha incorreta' });
  }

  try {
    const agora = new Date();
    switch (b.acao) {

      case 'resumo': {
        const lic = await sb('licencas?select=plano,status,data_expiracao');
        const ped = await sb(`pedidos?status=eq.pago&select=valor,plano,pago_em`);
        const ativos = lic.filter(l => l.status === 'ativo' && (l.plano === 'vitalicio' || !l.data_expiracao || new Date(l.data_expiracao) > agora));
        const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
        const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
        const soma = arr => Math.round(arr.reduce((t, p) => t + Number(p.valor || 0), 0) * 100) / 100;
        const porPlano = {};
        for (const p of PLANOS) porPlano[p] = ativos.filter(l => l.plano === p).length;
        const vence3 = ativos.filter(l => l.plano !== 'vitalicio' && l.data_expiracao && (new Date(l.data_expiracao) - agora) < 3 * 86400000).length;
        return res.json({
          licencas_total: lic.length, ativos: ativos.length, por_plano: porPlano, vencendo_3_dias: vence3,
          reembolsados: lic.filter(l => l.status === 'reembolsado').length,
          vendas_total: ped.length, fat_total: soma(ped),
          vendas_mes: ped.filter(p => new Date(p.pago_em) >= inicioMes).length, fat_mes: soma(ped.filter(p => new Date(p.pago_em) >= inicioMes)),
          vendas_hoje: ped.filter(p => new Date(p.pago_em) >= hoje).length, fat_hoje: soma(ped.filter(p => new Date(p.pago_em) >= hoje))
        });
      }

      case 'licencas': {
        const busca = String(b.busca || '').trim().toLowerCase();
        let q = 'licencas?select=id,email,codigo,plano,status,data_expiracao,device_id,ultima_troca,ultimo_acesso,acessos,criado_em&order=criado_em.desc&limit=300';
        if (busca) q += `&or=(email.ilike.*${enc(busca)}*,codigo.ilike.*${enc(busca.toUpperCase())}*)`;
        let lista = await sb(q);
        const exp = l => l.data_expiracao ? new Date(l.data_expiracao) : null;
        const f = b.filtro;
        if (f === 'ativos') lista = lista.filter(l => l.status === 'ativo' && (l.plano === 'vitalicio' || !exp(l) || exp(l) > agora));
        if (f === 'expirados') lista = lista.filter(l => l.status === 'ativo' && l.plano !== 'vitalicio' && exp(l) && exp(l) <= agora);
        if (f === 'vencendo') lista = lista.filter(l => l.status === 'ativo' && l.plano !== 'vitalicio' && exp(l) && exp(l) > agora && (exp(l) - agora) < 3 * 86400000);
        if (f === 'vitalicio') lista = lista.filter(l => l.plano === 'vitalicio');
        if (f === 'bloqueados') lista = lista.filter(l => l.status === 'reembolsado' || l.status === 'cancelado');
        return res.json(lista);
      }

      case 'sistema': {
        // Status do sistema + arquivo de download publicado
        const site = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.999boost.com.br');
        let download = { ok: false };
        try {
          const r = await fetch(site + '/download/999Boost.zip', { method: 'HEAD' });
          download = { ok: r.ok, tamanho: Number(r.headers.get('content-length') || 0), etag: (r.headers.get('etag') || '').replace(/"/g, '').slice(0, 12) };
        } catch {}
        const conteudo = await sb('conteudo?select=tier,versao,atualizado_em&order=tier');
        return res.json({
          download,
          deploy: {
            commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7),
            mensagem: process.env.VERCEL_GIT_COMMIT_MESSAGE || '',
            autor: process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || ''
          },
          conteudo,
          config: {
            mercado_pago: !!process.env.MP_ACCESS_TOKEN,
            resend: !!process.env.RESEND_API_KEY,
            supabase: !!(SB_URL && SB_KEY)
          }
        });
      }

      case 'limpar_pendentes': {
        const limite = new Date(agora.getTime() - 7 * 86400000).toISOString();
        const r = await sb(`pedidos?status=in.(pendente,expirado)&criado_em=lt.${limite}`, { method: 'DELETE' });
        await sb(`site_eventos?criado_em=lt.${new Date(agora.getTime() - 365 * 86400000).toISOString()}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
        return res.json({ ok: true, removidos: Array.isArray(r) ? r.length : 0 });
      }

      case 'pedidos': {
        return res.json(await sb('pedidos?select=criado_em,plano,valor,nome,email,telefone,cupom,status,pago_em&order=criado_em.desc&limit=100'));
      }

      case 'uso': {
        const email = String(b.email || '').trim().toLowerCase();
        return res.json(await sb(`uso_eventos?email=eq.${enc(email)}&select=criado_em,tipo,dados,device_id&order=criado_em.desc&limit=200`));
      }

      case 'criar': {
        const email = String(b.email || '').trim().toLowerCase();
        const plano = b.plano;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'E-mail invalido' });
        if (!PLANOS.includes(plano)) return res.status(400).json({ erro: 'Plano invalido' });
        const existe = await sb(`licencas?email=eq.${enc(email)}&select=id`);
        if (existe.length) return res.status(400).json({ erro: 'Ja existe licenca para esse e-mail (use Renovar)' });
        const codigo = gerarCodigo();
        const expira = plano === 'vitalicio' ? null : new Date(agora.getTime() + DIAS * 86400000).toISOString();
        await sb('licencas', { method: 'POST', body: JSON.stringify({ email, codigo, plano, status: 'ativo', data_expiracao: expira }) });
        return res.json({ ok: true, email, codigo });
      }

      // Acoes sobre uma licenca existente (por id)
      case 'renovar': case 'plano': case 'liberar_pc': case 'zerar_troca': case 'reembolsar': case 'reativar': case 'cancelar': case 'excluir': case 'validade': {
        const id = String(b.id || '');
        if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Licenca invalida' });
        const achado = await sb(`licencas?id=eq.${id}&select=*`);
        const lic = achado[0];
        if (!lic) return res.status(404).json({ erro: 'Licenca nao encontrada' });
        let campos = null;

        if (b.acao === 'renovar') {
          if (lic.plano === 'vitalicio') return res.status(400).json({ erro: 'Vitalicio nao precisa renovar' });
          const dias = Math.max(1, Math.min(365, parseInt(b.dias || DIAS, 10) || DIAS));
          const base = lic.data_expiracao && new Date(lic.data_expiracao) > agora ? new Date(lic.data_expiracao) : agora;
          campos = { data_expiracao: new Date(base.getTime() + dias * 86400000).toISOString(), status: 'ativo' };
        }
        if (b.acao === 'plano') {
          if (!PLANOS.includes(b.plano)) return res.status(400).json({ erro: 'Plano invalido' });
          campos = { plano: b.plano };
          if (b.plano === 'vitalicio') campos.data_expiracao = null;
          else if (!lic.data_expiracao) campos.data_expiracao = new Date(agora.getTime() + DIAS * 86400000).toISOString();
        }
        if (b.acao === 'validade') {
          // Define a data de validade exata (planos de 15 dias)
          if (lic.plano === 'vitalicio') return res.status(400).json({ erro: 'Vitalicio nao tem validade' });
          const d = new Date(String(b.data || '') + 'T23:59:59-03:00');
          if (isNaN(d.getTime())) return res.status(400).json({ erro: 'Data invalida' });
          campos = { data_expiracao: d.toISOString() };
        }
        if (b.acao === 'liberar_pc') campos = { device_id: null };
        if (b.acao === 'zerar_troca') campos = { ultima_troca: null };
        if (b.acao === 'reembolsar') {
          campos = { status: 'reembolsado' };
          // Tira a ultima compra paga desse e-mail do faturamento e da comissao do parceiro
          const ult = await sb(`pedidos?email=eq.${enc(lic.email)}&status=eq.pago&select=id&order=pago_em.desc&limit=1`);
          if (ult[0]) await sb(`pedidos?id=eq.${ult[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'reembolsado' }) });
        }      // mantem device_id -> PC bloqueado p/ nova ativacao automatica
        if (b.acao === 'cancelar') campos = { status: 'cancelado' };
        if (b.acao === 'reativar') campos = { status: 'ativo' };

        if (b.acao === 'excluir') {
          await sb(`licencas?id=eq.${id}`, { method: 'DELETE' });
          return res.json({ ok: true });
        }
        const r = await sb(`licencas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(campos) });
        return res.json({ ok: true, licenca: r[0] });
      }

      // ---------- Cupons de parceiros ----------
      case 'cupons': {
        const cupons = await sb('cupons?select=*&order=criado_em.desc');
        const pedidos = await sb('pedidos?status=eq.pago&cupom=not.is.null&select=cupom,valor,comissao_pct,comissao_paga,pago_em');
        const corte = Date.now() - 7 * 86400000;   // comissao so libera apos o prazo de arrependimento
        const r2 = v => Math.round(v * 100) / 100;
        return res.json(cupons.map(c => {
          const ps = pedidos.filter(p => p.cupom === c.codigo);
          const com = p => Number(p.valor || 0) * Number(p.comissao_pct || 0) / 100;
          return {
            ...c,
            vendas: ps.length,
            faturamento: r2(ps.reduce((t, p) => t + Number(p.valor || 0), 0)),
            comissao_pendente: r2(ps.filter(p => !p.comissao_paga && new Date(p.pago_em).getTime() <= corte).reduce((t, p) => t + com(p), 0)),
            comissao_analise: r2(ps.filter(p => !p.comissao_paga && new Date(p.pago_em).getTime() > corte).reduce((t, p) => t + com(p), 0)),
            comissao_paga_total: r2(ps.filter(p => p.comissao_paga).reduce((t, p) => t + com(p), 0))
          };
        }));
      }

      case 'cupom_salvar': {
        const codigo = String(b.codigo || '').trim().toUpperCase();
        if (!/^[A-Z0-9_-]{2,30}$/.test(codigo)) return res.status(400).json({ erro: 'Codigo invalido: use letras, numeros, - ou _ (2 a 30 caracteres)' });
        const desconto = parseInt(b.desconto, 10);
        const comissao = parseInt(b.comissao || 0, 10);
        if (!(desconto >= 0 && desconto <= 90)) return res.status(400).json({ erro: 'Desconto deve ser de 0 a 90%' });
        if (!(comissao >= 0 && comissao <= 90)) return res.status(400).json({ erro: 'Comissao deve ser de 0 a 90%' });
        const limite = b.limite_usos ? parseInt(b.limite_usos, 10) : null;
        const validade = b.validade ? new Date(String(b.validade) + 'T23:59:59-03:00').toISOString() : null;
        const dados = {
          codigo, desconto, comissao,
          parceiro: String(b.parceiro || '').trim().slice(0, 80) || null,
          pix: String(b.pix || '').trim().slice(0, 120) || null,
          observacao: String(b.observacao || '').trim().slice(0, 300) || null,
          limite_usos: limite && limite > 0 ? limite : null,
          validade, ativo: b.ativo !== false
        };
        const existe = await sb(`cupons?codigo=eq.${enc(codigo)}&select=codigo`);
        if (existe.length) {
          if (b.novo) return res.status(400).json({ erro: 'Ja existe um cupom com esse codigo' });
          await sb(`cupons?codigo=eq.${enc(codigo)}`, { method: 'PATCH', body: JSON.stringify(dados) });
        } else {
          await sb('cupons', { method: 'POST', body: JSON.stringify(dados) });
        }
        return res.json({ ok: true });
      }

      case 'cupom_ativo': {
        const codigo = String(b.codigo || '').trim().toUpperCase();
        await sb(`cupons?codigo=eq.${enc(codigo)}`, { method: 'PATCH', body: JSON.stringify({ ativo: !!b.ativo }) });
        return res.json({ ok: true });
      }

      case 'cupom_excluir': {
        const codigo = String(b.codigo || '').trim().toUpperCase();
        await sb(`cupons?codigo=eq.${enc(codigo)}`, { method: 'DELETE' });
        return res.json({ ok: true });
      }

      case 'cupom_pagar': {
        // Marca como paga a comissao de todas as vendas desse cupom ate agora
        const codigo = String(b.codigo || '').trim().toUpperCase();
        const corte = new Date(Date.now() - 7 * 86400000).toISOString();
        await sb(`pedidos?cupom=eq.${enc(codigo)}&status=eq.pago&comissao_paga=eq.false&pago_em=lt.${enc(corte)}`, { method: 'PATCH', body: JSON.stringify({ comissao_paga: true }) });
        return res.json({ ok: true });
      }

      case 'cupom_usos': {
        // Quem usou o cupom (vendas pagas e reembolsadas)
        const codigo = String(b.codigo || '').trim().toUpperCase();
        const ps = await sb(`pedidos?cupom=eq.${enc(codigo)}&status=in.(pago,reembolsado)&select=nome,email,telefone,plano,valor,status,pago_em,comissao_pct,comissao_paga&order=pago_em.desc`);
        return res.json(ps);
      }

      // ---------- Programa de indicacao ----------
      case 'afiliados': {
        const afs = await sb('afiliados?select=*&order=criado_em.desc');
        const ps = await sb('pedidos?indicado_por=not.is.null&status=in.(pago,reembolsado)&select=id,email,indicado_por,status,pago_em,valor,ref_comissao_pct,ref_comissao_paga&order=pago_em.asc');
        const prs = await sb('indicacoes_premios?select=afiliado,status,pedidos');
        const limite = Date.now() - 7 * 86400000;
        const lista = afs.map(a => {
          const usados = new Set();
          const meus = prs.filter(p => p.afiliado === a.codigo);
          meus.forEach(p => (p.pedidos || []).forEach(id => usados.add(id)));
          const vistos = new Set(); let total = 0, livres = 0, analise = 0, cancel = 0, aPagar = 0, pago = 0;
          ps.filter(p => p.indicado_por === a.codigo).forEach(p => {
            if (vistos.has(p.email)) return; vistos.add(p.email); total++;
            const com = Number(p.valor || 0) * Number(p.ref_comissao_pct || 0) / 100;
            if (p.status === 'reembolsado') { cancel++; return; }
            if (com > 0) {
              if (p.ref_comissao_paga) pago += com;
              else if (new Date(p.pago_em).getTime() > limite) analise++;
              else aPagar += com;
              return;
            }
            if (p.status === 'reembolsado') cancel++;
            else if (usados.has(p.id)) return;
            else if (new Date(p.pago_em).getTime() > limite) analise++;
            else livres++;
          });
          const r2 = v => Math.round(v * 100) / 100;
          return { codigo: a.codigo, email: a.email, pix: a.pix || null, criado_em: a.criado_em, indicados: total, confirmadas_livres: livres,
            comissao_a_pagar: r2(aPagar), comissao_paga: r2(pago),
            em_analise: analise, canceladas: cancel, premios: meus.length,
            presentes_pendentes: meus.filter(p => p.status === 'presente_pendente').length };
        });
        return res.json(lista.sort((x, y) => y.indicados - x.indicados));
      }

      case 'afiliado_detalhe': {
        const codigo = String(b.codigo || '').trim().toUpperCase();
        const ps = await sb(`pedidos?indicado_por=eq.${enc(codigo)}&status=in.(pago,reembolsado)&select=id,nome,email,telefone,plano,valor,status,pago_em,ref_comissao_pct,ref_comissao_paga&order=pago_em.asc`);
        const prs = await sb(`indicacoes_premios?afiliado=eq.${enc(codigo)}&select=*&order=criado_em.asc`);
        return res.json({ indicados: ps, premios: prs });
      }

      case 'indicacao_pagar': {
        // Marca como paga a comissao (Vitalicio) das indicacoes ja confirmadas (mais de 7 dias, sem reembolso)
        const codigo = String(b.codigo || '').trim().toUpperCase();
        const corte = new Date(Date.now() - 7 * 86400000).toISOString();
        await sb(`pedidos?indicado_por=eq.${enc(codigo)}&status=eq.pago&ref_comissao_pct=gt.0&ref_comissao_paga=eq.false&pago_em=lt.${enc(corte)}`,
          { method: 'PATCH', body: JSON.stringify({ ref_comissao_paga: true }) });
        return res.json({ ok: true });
      }

      case 'premio_entregue': {
        // Indicador Vitalicio: o premio vira licenca de presente. Crie em "Criar licenca" e marque aqui.
        const id = String(b.id || '');
        await sb(`indicacoes_premios?id=eq.${enc(id)}&status=eq.presente_pendente`, { method: 'PATCH', body: JSON.stringify({ status: 'presente_entregue' }) });
        return res.json({ ok: true });
      }

      // ---------- Marketing: analytics ----------
      case 'analytics': {
        const dias = Math.min(Math.max(parseInt(b.dias, 10) || 7, 1), 365);
        const desde = new Date(agora.getTime() - dias * 86400000);
        if (dias === 1) {   // "hoje" = desde a meia-noite de Fortaleza (UTC-3, sem horario de verao)
          const tz = 3 * 3600000;
          desde.setTime(Math.floor((agora.getTime() - tz) / 86400000) * 86400000 + tz);
        }
        const r = await sb('rpc/analytics_resumo', { method: 'POST', body: JSON.stringify({ desde: desde.toISOString() }) });
        return res.json({ dias, desde: desde.toISOString(), ...r });
      }

      // ---------- Marketing: remarketing por segmento ----------
      case 'remarketing': {
        const lic = await sb('licencas?select=email,plano,status,data_expiracao,criado_em&limit=5000');
        const ped = await sb('pedidos?select=email,nome,telefone,plano,valor,status,criado_em,pago_em&order=criado_em.desc&limit=5000');
        const opt = new Set((await sb('marketing_optout?select=email')).map(o => o.email));
        const contato = {};
        for (const p of ped) {   // o pedido mais recente com nome/telefone de cada e-mail
          const c = contato[p.email] || (contato[p.email] = { nome: p.nome || '', telefone: p.telefone || '' });
          if (!c.nome && p.nome) c.nome = p.nome;
          if (!c.telefone && p.telefone) c.telefone = p.telefone;
        }
        const pagos = ped.filter(p => p.status === 'pago');
        const Q = ['basic', 'streamer', 'turbo'];
        const exp = l => l.data_expiracao ? new Date(l.data_expiracao) : null;
        const pessoa = (email, plano, data, extra = {}) => ({ email, plano, data, ...(contato[email] || { nome: '', telefone: '' }), ...extra });
        const livre = x => !opt.has(x.email);
        const dia = 86400000;
        const seg = {};
        seg.renovar = lic.filter(l => l.status === 'ativo' && Q.includes(l.plano) && exp(l) && exp(l) > agora && exp(l) - agora < 3 * dia)
          .map(l => pessoa(l.email, l.plano, l.data_expiracao));
        seg.vencidos = lic.filter(l => l.status === 'ativo' && Q.includes(l.plano) && exp(l) && exp(l) <= agora && agora - exp(l) < 30 * dia)
          .map(l => pessoa(l.email, l.plano, l.data_expiracao));
        const vistos = new Set();
        seg.carrinho = ped.filter(p => ['pendente', 'expirado'].includes(p.status) && agora - new Date(p.criado_em) < 7 * dia)
          .filter(p => !pagos.some(q => q.email === p.email && new Date(q.criado_em) >= new Date(p.criado_em)))
          .filter(p => (vistos.has(p.email) ? false : vistos.add(p.email)))
          .map(p => pessoa(p.email, p.plano, p.criado_em, { valor: Number(p.valor) }));
        seg.upgrade = lic.filter(l => l.status === 'ativo' && ['basic', 'streamer'].includes(l.plano) && exp(l) && exp(l) > agora)
          .map(l => pessoa(l.email, l.plano, l.data_expiracao));
        const gastos = {};
        pagos.filter(p => Q.includes(p.plano)).forEach(p => { const g = gastos[p.email] || (gastos[p.email] = { n: 0, total: 0 }); g.n++; g.total += Number(p.valor || 0); });
        seg.vitalicio = lic.filter(l => l.status === 'ativo' && Q.includes(l.plano) && gastos[l.email] && gastos[l.email].n >= 2)
          .map(l => pessoa(l.email, l.plano, l.data_expiracao, { vezes: gastos[l.email].n, gasto: Math.round(gastos[l.email].total * 100) / 100 }));
        const comLicenca = new Set(lic.map(l => l.email));
        const vistosE = new Set();
        seg.ebook = pagos.filter(p => p.plano === 'ebook' && !comLicenca.has(p.email)).filter(p => (vistosE.has(p.email) ? false : vistosE.add(p.email)))
          .map(p => pessoa(p.email, 'ebook', p.pago_em));
        seg.indicar = lic.filter(l => l.status === 'ativo' && l.plano === 'vitalicio').map(l => pessoa(l.email, 'vitalicio', l.criado_em));
        // Baixaram o e-book gratis e ainda nao compraram nada
        let leads = [];
        try { leads = await sb('leads?aceite=eq.true&select=email,nome,telefone,material,criado_em&order=criado_em.desc&limit=5000'); } catch (e) { leads = []; }
        const compraram = new Set(pagos.map(p => p.email));
        seg.leads = leads.filter(l => !comLicenca.has(l.email) && !compraram.has(l.email))
          .map(l => ({ email: l.email, nome: l.nome || '', telefone: l.telefone || '', plano: 'lead', data: l.criado_em }));
        for (const k of Object.keys(seg)) seg[k] = seg[k].filter(livre);
        const cupons = (await sb('cupons?select=codigo,ativo,desconto')).reduce((o, c) => (o[c.codigo] = c, o), {});
        return res.json({ segmentos: seg, optout: opt.size, cupons });
      }

      case 'optout': {
        const email = String(b.email || '').trim().toLowerCase();
        if (!email.includes('@')) return res.status(400).json({ erro: 'E-mail invalido' });
        await sb('marketing_optout', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ email }) });
        return res.json({ ok: true });
      }

      case 'cupom_rapido': {
        // Cria um cupom promocional pronto (ex.: VOLTA10) se ainda nao existir
        const codigo = String(b.codigo || '').trim().toUpperCase();
        const desconto = parseInt(b.desconto, 10);
        if (!/^[A-Z0-9_-]{2,30}$/.test(codigo) || !(desconto > 0 && desconto <= 90)) return res.status(400).json({ erro: 'Cupom invalido' });
        const existe = await sb(`cupons?codigo=eq.${enc(codigo)}&select=codigo`);
        if (existe.length) await sb(`cupons?codigo=eq.${enc(codigo)}`, { method: 'PATCH', body: JSON.stringify({ ativo: true }) });
        else await sb('cupons', { method: 'POST', body: JSON.stringify({ codigo, desconto, comissao: 0, observacao: String(b.obs || 'Remarketing').slice(0, 300), ativo: true }) });
        return res.json({ ok: true, codigo });
      }

      // ---------- Marketing: influenciadores ----------
      case 'prospects': {
        return res.json(await sb('prospects?select=*&order=atualizado_em.desc&limit=500'));
      }

      case 'prospect_salvar': {
        const nome = String(b.nome || '').trim().slice(0, 80);
        if (!nome) return res.status(400).json({ erro: 'Informe o nome' });
        const dados = {
          nome,
          arroba: String(b.arroba || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?].*$/, '').slice(0, 60) || null,
          plataforma: String(b.plataforma || '').trim().slice(0, 40) || null,
          seguidores: String(b.seguidores || '').trim().slice(0, 20) || null,
          obs: String(b.obs || '').trim().slice(0, 500) || null,
          atualizado_em: agora.toISOString()
        };
        const id = String(b.id || '');
        if (id) {
          if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Id invalido' });
          await sb(`prospects?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(dados) });
        } else {
          await sb('prospects', { method: 'POST', body: JSON.stringify(dados) });
        }
        return res.json({ ok: true });
      }

      case 'prospect_status': {
        const id = String(b.id || '');
        const status = String(b.status || '');
        if (!/^[0-9a-f-]{36}$/i.test(id) || !['a_contatar', 'contatado', 'proposta', 'parceiro', 'sem_interesse'].includes(status)) return res.status(400).json({ erro: 'Dados invalidos' });
        await sb(`prospects?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status, atualizado_em: agora.toISOString() }) });
        return res.json({ ok: true });
      }

      case 'prospect_excluir': {
        const id = String(b.id || '');
        if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Id invalido' });
        await sb(`prospects?id=eq.${id}`, { method: 'DELETE' });
        return res.json({ ok: true });
      }

      case 'prospect_ativar': {
        // Um clique: cria o cupom do parceiro (10% / 20%) e a licenca Turbo de 15 dias de presente
        const id = String(b.id || '');
        const email = String(b.email || '').trim().toLowerCase();
        const cupom = String(b.cupom || '').trim().toUpperCase();
        if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Id invalido' });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'E-mail invalido' });
        if (!/^[A-Z0-9_-]{2,30}$/.test(cupom)) return res.status(400).json({ erro: 'Cupom invalido: use letras e numeros' });
        const pr = (await sb(`prospects?id=eq.${id}&select=*`))[0];
        if (!pr) return res.status(404).json({ erro: 'Influenciador nao encontrado' });
        const jaCupom = await sb(`cupons?codigo=eq.${enc(cupom)}&select=codigo`);
        if (jaCupom.length) return res.status(400).json({ erro: 'Esse cupom ja existe. Escolha outro codigo.' });
        await sb('cupons', { method: 'POST', body: JSON.stringify({ codigo: cupom, desconto: 10, comissao: 20, parceiro: pr.nome,
          pix: String(b.pix || '').trim().slice(0, 120) || null, observacao: 'Influenciador' + (pr.arroba ? ' @' + pr.arroba : ''), ativo: true }) });
        let codigo, renovada = false;
        const lic = (await sb(`licencas?email=eq.${enc(email)}&select=*`))[0];
        if (lic) {
          renovada = true; codigo = lic.codigo;
          if (lic.plano !== 'vitalicio') {
            const base = lic.data_expiracao && new Date(lic.data_expiracao) > agora ? new Date(lic.data_expiracao) : agora;
            await sb(`licencas?id=eq.${lic.id}`, { method: 'PATCH', body: JSON.stringify({ plano: 'turbo', status: 'ativo', data_expiracao: new Date(base.getTime() + DIAS * 86400000).toISOString() }) });
          }
        } else {
          codigo = gerarCodigo();
          await sb('licencas', { method: 'POST', body: JSON.stringify({ email, codigo, plano: 'turbo', status: 'ativo', data_expiracao: new Date(agora.getTime() + DIAS * 86400000).toISOString() }) });
        }
        await sb(`prospects?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'parceiro', email, cupom, atualizado_em: agora.toISOString() }) });
        return res.json({ ok: true, email, codigo, cupom, renovada });
      }

      // ---------- Recuperacao de carrinho ----------
      case 'carrinhos': {
        const dias = Math.min(Math.max(parseInt(b.dias, 10) || 7, 1), 60);
        const desde = new Date(agora.getTime() - dias * 86400000).toISOString();
        const ped = await sb(`pedidos?criado_em=gte.${enc(desde)}&select=id,email,nome,telefone,plano,valor,status,cupom,criado_em,pago_em&order=criado_em.desc&limit=5000`);
        const tent = await sb(`recuperacao_carrinho?enviado_em=gte.${enc(new Date(agora.getTime() - (dias + 7) * 86400000).toISOString())}&select=*&order=enviado_em.desc&limit=5000`);
        const opt = new Set((await sb('marketing_optout?select=email')).map(o => o.email));
        const pagos = ped.filter(p => p.status === 'pago');
        const vistos = new Set();
        const lista = [];
        for (const p of ped) {
          if (!['pendente', 'expirado'].includes(p.status) || vistos.has(p.email)) continue;
          vistos.add(p.email);
          const t = tent.filter(x => x.email === p.email);
          const ult = t[0] || null;
          const pagoDepois = pagos.find(q => q.email === p.email && new Date(q.criado_em) >= new Date(p.criado_em));
          const recuperado = !!(pagoDepois && t.some(x => new Date(pagoDepois.criado_em) >= new Date(x.enviado_em)));
          if (pagoDepois && !recuperado) continue;   // comprou sozinho depois: nao e carrinho abandonado
          lista.push({ email: p.email, nome: p.nome, telefone: p.telefone, plano: p.plano, valor: Number(p.valor), criado_em: p.criado_em,
            tentativas: t.length, ultima: ult ? { cupom: ult.cupom, desconto: ult.desconto, canal: ult.canal, enviado_em: ult.enviado_em, validade: ult.validade } : null,
            recuperado, valor_pago: recuperado ? Number(pagoDepois.valor) : 0, pago_em: recuperado ? pagoDepois.pago_em : null, optout: opt.has(p.email) });
        }
        const abertos = lista.filter(c => !c.recuperado);
        const rec = lista.filter(c => c.recuperado);
        return res.json({
          dias, carrinhos: lista, resend: !!process.env.RESEND_API_KEY,
          resumo: {
            abandonados: lista.length, contatados: lista.filter(c => c.tentativas > 0).length, recuperados: rec.length,
            valor_recuperado: Math.round(rec.reduce((t, c) => t + c.valor_pago, 0) * 100) / 100,
            em_aberto: Math.round(abertos.reduce((t, c) => t + c.valor, 0) * 100) / 100
          }
        });
      }

      case 'carrinho_enviar': {
        // Gera um cupom pessoal (uso unico, so para este e-mail, com validade) e registra a tentativa.
        const email = String(b.email || '').trim().toLowerCase();
        const desconto = parseInt(b.desconto, 10);
        const horas = Math.min(Math.max(parseInt(b.horas, 10) || 48, 1), 720);
        const canal = ['whatsapp', 'email', 'copiar'].includes(b.canal) ? b.canal : 'copiar';
        if (!email.includes('@')) return res.status(400).json({ erro: 'E-mail invalido' });
        if (!(desconto > 0 && desconto <= 50)) return res.status(400).json({ erro: 'Desconto deve ser de 1 a 50%' });
        if (canal === 'email' && !process.env.RESEND_API_KEY) return res.status(400).json({ erro: 'E-mail automatico desligado: configure o RESEND_API_KEY na Vercel' });
        const optado = await sb(`marketing_optout?email=eq.${enc(email)}&select=email`);
        if (optado.length) return res.status(400).json({ erro: 'Este cliente pediu para nao receber mensagens' });
        const ped = (await sb(`pedidos?email=eq.${enc(email)}&status=in.(pendente,expirado)&select=nome,telefone,plano,valor&order=criado_em.desc&limit=1`))[0];
        if (!ped) return res.status(404).json({ erro: 'Carrinho nao encontrado' });
        // Reaproveita o cupom pessoal ainda valido (mesmo desconto) para nao gerar varios
        const ant = (await sb(`recuperacao_carrinho?email=eq.${enc(email)}&desconto=eq.${desconto}&validade=gt.${enc(agora.toISOString())}&select=cupom,validade&order=enviado_em.desc&limit=1`))[0];
        let cupom, validade;
        if (ant) { cupom = ant.cupom; validade = ant.validade; }
        else {
          validade = new Date(agora.getTime() + horas * 3600000).toISOString();
          for (let i = 0; i < 5 && !cupom; i++) {
            const c = codigoVolta();
            try {
              await sb('cupons', { method: 'POST', body: JSON.stringify({ codigo: c, desconto, comissao: 0, limite_usos: 1, validade, email, ativo: true, observacao: 'Recuperacao de carrinho: ' + email }) });
              cupom = c;
            } catch (e) { if (!String(e.message).includes('409')) throw e; }
          }
        }
        const c = { email, nome: ped.nome, telefone: ped.telefone, plano: ped.plano, cupom, desconto, horas: Math.max(1, Math.round((new Date(validade) - agora) / 3600000)) };
        if (canal === 'email') await emailRecuperacao(c);
        await sb('recuperacao_carrinho', { method: 'POST', body: JSON.stringify({ email, cupom, desconto, canal, validade, plano: ped.plano, valor: ped.valor }) });
        return res.json({ ok: true, cupom, validade, horas: c.horas, link: linkRecuperacao(c), valor_com_desconto: Math.round((PRECOS[ped.plano] || Number(ped.valor)) * (100 - desconto)) / 100 });
      }

      default:
        return res.status(400).json({ erro: 'Acao invalida' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro no servidor' });
  }
}
