// 999BOOST - Servidor de licencas (Vercel Serverless Function)
// acao "validar": confere e-mail + codigo + PC (trava no primeiro PC que ativar)
// acao "conteudo": valida (igual "validar") e devolve o pacote assinado de otimizacoes do plano
// acao "evento":  registra uso do painel (diagnostico antes/depois, otimizacoes aplicadas) - prova de uso
// acao "trocar":  transfere a licenca para o PC atual (cliente formatou ou trocou de PC)
//   - planos de 15 dias (basic/streamer/turbo): 1 transferencia por periodo de 15 dias
//   - vitalicio: transferencias ilimitadas, com intervalo minimo de 24h (evita compartilhamento)

const PERIODO_DIAS = 15;
const INTERVALO_VITALICIO_HORAS = 24;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ valido: false, motivo: 'Metodo nao permitido' });
  }

  const { acao, email, codigo, device_id } = req.body || {};

  if (!email || !codigo || !device_id) {
    return res.status(400).json({ valido: false, motivo: 'Dados incompletos' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ valido: false, motivo: 'Servidor nao configurado' });
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  const atualizar = (id, campos) => fetch(`${SUPABASE_URL}/rest/v1/licencas?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(campos)
  });

  try {
    const buscar = await fetch(
      `${SUPABASE_URL}/rest/v1/licencas?email=eq.${encodeURIComponent(email)}&select=*`,
      { headers }
    );
    const licencas = await buscar.json();

    if (!Array.isArray(licencas) || licencas.length === 0) {
      return res.status(200).json({ valido: false, motivo: 'E-mail ou codigo de licenca incorreto' });
    }

    const lic = licencas[0];
    const agora = new Date();
    const vitalicio = lic.plano === 'vitalicio';

    if (lic.codigo !== codigo) {
      return res.status(200).json({ valido: false, motivo: 'E-mail ou codigo de licenca incorreto' });
    }

    if (lic.status === 'reembolsado') {
      return res.status(200).json({ valido: false, motivo: 'Licenca cancelada por reembolso' });
    }
    if (lic.status !== 'ativo') {
      return res.status(200).json({ valido: false, motivo: 'Assinatura inativa ou cancelada' });
    }

    // Planos de 15 dias expiram; vitalicio nao expira
    if (!vitalicio && lic.data_expiracao && new Date(lic.data_expiracao) < agora) {
      return res.status(200).json({ valido: false, motivo: 'Assinatura expirada' });
    }

    const ok = () => res.status(200).json({ valido: true, plano: lic.plano, expira: lic.data_expiracao });

    // PC que ja teve licenca reembolsada nao ativa outra licenca automaticamente (anti-abuso)
    const pcReembolsado = async () => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/licencas?device_id=eq.${encodeURIComponent(device_id)}&status=eq.reembolsado&select=id`, { headers });
      const lista = await r.json();
      return Array.isArray(lista) && lista.length > 0;
    };
    const MSG_PC_BLOQUEADO = 'Este computador tem um reembolso anterior. Para ativar, fale com o suporte 999BOOST.';

    // ---------- Registro de uso (prova de que o servico foi usado) ----------
    if (acao === 'evento') {
      if (lic.device_id !== device_id) return res.status(200).json({ ok: false });
      const tipo = String(req.body.tipo || '').slice(0, 30);
      if (!['diagnostico', 'aplicado', 'revertido', 'aplicado_plano', 'consentimento'].includes(tipo)) return res.status(200).json({ ok: false });
      let dados = req.body.dados || {};
      if (JSON.stringify(dados).length > 8000) dados = { truncado: true };
      await fetch(`${SUPABASE_URL}/rest/v1/uso_eventos`, {
        method: 'POST', headers,
        body: JSON.stringify({ licenca_id: lic.id, email: lic.email, device_id, tipo, dados })
      });
      return res.status(200).json({ ok: true });
    }

    // ---------- Transferencia de PC (formatou / trocou de PC) ----------
    if (acao === 'trocar') {
      if (lic.device_id === device_id) return ok();
      if (await pcReembolsado()) return res.status(200).json({ valido: false, motivo: MSG_PC_BLOQUEADO });
      if (!lic.device_id) { await atualizar(lic.id, { device_id }); return ok(); }
      const ultima = lic.ultima_troca ? new Date(lic.ultima_troca) : null;

      if (vitalicio) {
        if (ultima && (agora - ultima) < INTERVALO_VITALICIO_HORAS * 3600 * 1000) {
          return res.status(200).json({ valido: false, motivo: `Voce ja transferiu a licenca nas ultimas ${INTERVALO_VITALICIO_HORAS}h. Tente de novo mais tarde.` });
        }
      } else {
        // Inicio do periodo atual = expiracao - 15 dias. So 1 transferencia dentro desse periodo.
        const inicioPeriodo = lic.data_expiracao
          ? new Date(new Date(lic.data_expiracao).getTime() - PERIODO_DIAS * 86400 * 1000)
          : null;
        if (ultima && (!inicioPeriodo || ultima >= inicioPeriodo)) {
          return res.status(200).json({ valido: false, motivo: 'Voce ja usou a transferencia deste periodo. Ela libera de novo quando renovar o plano (ou no plano Vitalicio).' });
        }
      }

      await atualizar(lic.id, { device_id, ultima_troca: agora.toISOString() });
      return ok();
    }

    // ---------- Validacao normal: trava por computador ----------
    if (!lic.device_id) {
      // Primeira ativacao - registra este computador como o unico autorizado
      if (await pcReembolsado()) return res.status(200).json({ valido: false, motivo: MSG_PC_BLOQUEADO });
      await atualizar(lic.id, { device_id });
    } else if (lic.device_id !== device_id) {
      return res.status(200).json({ valido: false, motivo: 'Licenca ja ativada em outro computador' });
    }

    // ---------- Entrega do conteudo (otimizacoes do plano, assinadas) ----------
    if (acao === 'conteudo') {
      const tier = lic.plano === 'basic' ? 1 : lic.plano === 'streamer' ? 2 : 3;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/conteudo?tier=eq.${tier}&select=payload_b64,assinatura,versao`, { headers });
      const pacotes = await r.json();
      if (!Array.isArray(pacotes) || !pacotes[0]) {
        return res.status(500).json({ valido: false, motivo: 'Conteudo indisponivel no servidor' });
      }
      await atualizar(lic.id, { ultimo_acesso: agora.toISOString(), acessos: (lic.acessos || 0) + 1 });
      return res.status(200).json({
        valido: true, plano: lic.plano, expira: lic.data_expiracao,
        payload_b64: pacotes[0].payload_b64, assinatura: pacotes[0].assinatura, versao: pacotes[0].versao
      });
    }

    return ok();

  } catch (erro) {
    return res.status(500).json({ valido: false, motivo: 'Erro ao validar licenca' });
  }
}
