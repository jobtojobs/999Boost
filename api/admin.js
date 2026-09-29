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
        let q = 'licencas?select=id,email,codigo,plano,status,data_expiracao,device_id,ultima_troca,ultimo_acesso,acessos,criado_em&order=criado_em.desc&limit=200';
        if (busca) q += `&or=(email.ilike.*${enc(busca)}*,codigo.ilike.*${enc(busca.toUpperCase())}*)`;
        return res.json(await sb(q));
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
      case 'renovar': case 'plano': case 'liberar_pc': case 'reembolsar': case 'reativar': case 'cancelar': case 'excluir': {
        const id = String(b.id || '');
        if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ erro: 'Licenca invalida' });
        const achado = await sb(`licencas?id=eq.${id}&select=*`);
        const lic = achado[0];
        if (!lic) return res.status(404).json({ erro: 'Licenca nao encontrada' });
        let campos = null;

        if (b.acao === 'renovar') {
          if (lic.plano === 'vitalicio') return res.status(400).json({ erro: 'Vitalicio nao precisa renovar' });
          const dias = Math.max(1, Math.min(365, parseInt(b.dias || DIAS, 10)));
          const base = lic.data_expiracao && new Date(lic.data_expiracao) > agora ? new Date(lic.data_expiracao) : agora;
          campos = { data_expiracao: new Date(base.getTime() + dias * 86400000).toISOString(), status: 'ativo' };
        }
        if (b.acao === 'plano') {
          if (!PLANOS.includes(b.plano)) return res.status(400).json({ erro: 'Plano invalido' });
          campos = { plano: b.plano };
          if (b.plano === 'vitalicio') campos.data_expiracao = null;
          else if (!lic.data_expiracao) campos.data_expiracao = new Date(agora.getTime() + DIAS * 86400000).toISOString();
        }
        if (b.acao === 'liberar_pc') campos = { device_id: null };
        if (b.acao === 'reembolsar') campos = { status: 'reembolsado' };      // mantem device_id -> PC bloqueado p/ nova ativacao automatica
        if (b.acao === 'cancelar') campos = { status: 'cancelado' };
        if (b.acao === 'reativar') campos = { status: 'ativo' };

        if (b.acao === 'excluir') {
          await sb(`licencas?id=eq.${id}`, { method: 'DELETE' });
          return res.json({ ok: true });
        }
        const r = await sb(`licencas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(campos) });
        return res.json({ ok: true, licenca: r[0] });
      }

      default:
        return res.status(400).json({ erro: 'Acao invalida' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro no servidor' });
  }
}
