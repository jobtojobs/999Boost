// 999BOOST - recebe as estatisticas anonimas de visita do site (/assets/t.js)
// Nao guarda IP nem dados pessoais: so pagina, origem, tipo de aparelho e um id aleatorio do navegador.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const TIPOS = new Set(['view', 'clique']);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|telegram|curl|wget|python|monitor/i;

const txt = (v, n) => {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f<>"']/g, '').trim().slice(0, n);
  return s || null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    if (!SB_URL || !SB_KEY || BOT.test(String(req.headers['user-agent'] || ''))) return res.status(204).end();
    let b = req.body;
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') { if (b.length > 2000) return res.status(204).end(); try { b = JSON.parse(b); } catch { b = null; } }
    if (!b || !TIPOS.has(b.tipo)) return res.status(204).end();
    const linha = {
      tipo: b.tipo,
      pagina: txt(b.pagina, 60),
      vid: txt(b.vid, 40),
      de: txt(b.de, 60),
      origem: txt(b.fonte, 40),
      campanha: txt(b.camp, 40),
      disp: b.disp === 'celular' ? 'celular' : 'computador',
      plano: txt(b.plano, 20),
      alvo: txt(b.alvo, 40)
    };
    if (!linha.vid || !linha.pagina) return res.status(204).end();
    await fetch(`${SB_URL}/rest/v1/site_eventos`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(linha)
    });
  } catch (e) { /* estatistica nunca derruba nada */ }
  return res.status(204).end();
}
