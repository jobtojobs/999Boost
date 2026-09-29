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
        const pedidos = await sb('pedidos?status=eq.pago&cupom=not.is.null&select=cupom,valor,comissao_pct,comissao_paga');
        const r2 = v => Math.round(v * 100) / 100;
        return res.json(cupons.map(c => {
          const ps = pedidos.filter(p => p.cupom === c.codigo);
          const com = p => Number(p.valor || 0) * Number(p.comissao_pct || 0) / 100;
          return {
            ...c,
            vendas: ps.length,
            faturamento: r2(ps.reduce((t, p) => t + Number(p.valor || 0), 0)),
            comissao_pendente: r2(ps.filter(p => !p.comissao_paga).reduce((t, p) => t + com(p), 0)),
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
        await sb(`pedidos?cupom=eq.${enc(codigo)}&status=eq.pago&comissao_paga=eq.false`, { method: 'PATCH', body: JSON.stringify({ comissao_paga: true }) });
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

      default:
        return res.status(400).json({ erro: 'Acao invalida' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro no servidor' });
  }
}
