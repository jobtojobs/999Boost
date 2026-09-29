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

    if (lic.codigo !== codigo) {
      return res.status(200).json({ valido: false, motivo: 'Codigo de licenca incorreto' });
    }

    if (lic.status !== 'ativo') {
      return res.status(200).json({ valido: false, motivo: 'Assinatura inativa ou cancelada' });
    }

    if (lic.plano === 'mensal' && lic.data_expiracao && new Date(lic.data_expiracao) < new Date()) {
      return res.status(200).json({ valido: false, motivo: 'Assinatura expirada' });
    }

    // Trava por computador
    if (!lic.device_id) {
      // Primeira ativacao - registra este computador como o unico autorizado
      await fetch(`${SUPABASE_URL}/rest/v1/licencas?id=eq.${lic.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ device_id })
      });
    } else if (lic.device_id !== device_id) {
      return res.status(200).json({ valido: false, motivo: 'Licenca ja ativada em outro computador' });
    }

    return res.status(200).json({
      valido: true,
      plano: lic.plano,
      expira: lic.data_expiracao
    });

  } catch (erro) {
    return res.status(500).json({ valido: false, motivo: 'Erro ao validar licenca' });
  }
}
