// 999BOOST - Servidor de licencas (Vercel Serverless Function)
// acao "validar": confere e-mail + codigo + PC (trava no primeiro PC que ativar)
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
      return res.status(200).json({ valido: false, motivo: 'E-mail nao encontrado' });
    }

    const lic = licencas[0];
    const agora = new Date();
    const vitalicio = lic.plano === 'vitalicio';

    if (lic.codigo !== codigo) {
      return res.status(200).json({ valido: false, motivo: 'Codigo de licenca incorreto' });
    }

    if (lic.status !== 'ativo') {
      return res.status(200).json({ valido: false, motivo: 'Assinatura inativa ou cancelada' });
    }

    // Planos de 15 dias expiram; vitalicio nao expira
    if (!vitalicio && lic.data_expiracao && new Date(lic.data_expiracao) < agora) {
      return res.status(200).json({ valido: false, motivo: 'Assinatura expirada' });
    }

    const ok = () => res.status(200).json({ valido: true, plano: lic.plano, expira: lic.data_expiracao });

    // ---------- Transferencia de PC (formatou / trocou de PC) ----------
    if (acao === 'trocar') {
      if (!lic.device_id || lic.device_id === device_id) {
        if (!lic.device_id) await atualizar(lic.id, { device_id });
        return ok();
      }
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
      await atualizar(lic.id, { device_id });
    } else if (lic.device_id !== device_id) {
      return res.status(200).json({ valido: false, motivo: 'Licenca ja ativada em outro computador' });
    }

    return ok();

  } catch (erro) {
    return res.status(500).json({ valido: false, motivo: 'Erro ao validar licenca' });
  }
}
