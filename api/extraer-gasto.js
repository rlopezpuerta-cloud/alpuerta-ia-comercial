// Extractor de Gasto Meta Ads → Supabase
// Corre vía Vercel Cron (diario). Jala el gasto del mes en curso por campaña
// y hace upsert en la tabla gasto_ads. Clasifica el canal por el nombre.

const AD_ACCOUNT = 'act_2799647630357239';
const SUPABASE_URL = 'https://rwujdgfgvbolrugrsjib.supabase.co';
const GRAPH = 'https://graph.facebook.com/v22.0';

function clasificarCanal(nombre) {
  const n = (nombre || '').toLowerCase();
  if (n.includes('whatsapp')) return 'whatsapp_ads';
  if (n.includes('instagram')) return 'ig_ads';
  if (n.includes('messenger')) return 'msn_ads';
  return 'fb_ads';
}

export default async function handler(req, res) {
  try {
    const token = process.env.META_ADS_TOKEN;
    const supaKey = process.env.SUPABASE_SERVICE_KEY;

    if (!token || !supaKey) {
      return res.status(500).json({ error: 'Faltan variables de entorno (META_ADS_TOKEN o SUPABASE_SERVICE_KEY)' });
    }

    // Fechas: del día 1 del mes en curso hasta hoy (hora MX)
    const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const periodo = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const desde = `${periodo}-01`;
    const hasta = `${periodo}-${String(ahora.getDate()).padStart(2, '0')}`;

    // 1. Traer gasto por campaña de Meta
    const timeRange = encodeURIComponent(JSON.stringify({ since: desde, until: hasta }));
    const url = `${GRAPH}/${AD_ACCOUNT}/insights?level=campaign&fields=campaign_name,campaign_id,spend,impressions,clicks&time_range=${timeRange}&limit=200&access_token=${token}`;

    const metaRes = await fetch(url);
    const metaData = await metaRes.json();

    if (metaData.error) {
      console.error('Error Meta API:', JSON.stringify(metaData.error));
      return res.status(500).json({ error: 'Meta API', detail: metaData.error });
    }

    const campañas = metaData.data || [];
    if (campañas.length === 0) {
      return res.status(200).json({ ok: true, periodo, mensaje: 'Sin campañas con gasto en el periodo', filas: 0 });
    }

    // 2. Construir filas para upsert
    const filas = campañas.map(c => ({
      periodo,
      canal: clasificarCanal(c.campaign_name),
      'campaña': c.campaign_name,
      'campaña_id': c.campaign_id,
      gasto_mxn: parseFloat(c.spend || 0),
      impresiones: parseInt(c.impressions || 0),
      clicks: parseInt(c.clicks || 0)
    }));

    // 3. Upsert masivo a Supabase (on_conflict periodo + campaña_id)
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gasto_ads?on_conflict=periodo,campa%C3%B1a_id`,
      {
        method: 'POST',
        headers: {
          'apikey': supaKey,
          'Authorization': `Bearer ${supaKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(filas)
      }
    );

    if (!supaRes.ok) {
      const errTxt = await supaRes.text();
      console.error('Error Supabase:', errTxt);
      return res.status(500).json({ error: 'Supabase', detail: errTxt });
    }

    const totalGasto = filas.reduce((s, f) => s + f.gasto_mxn, 0);
    console.log(`✅ Gasto actualizado: ${filas.length} campañas, $${totalGasto.toFixed(2)} MXN, periodo ${periodo}`);

    return res.status(200).json({
      ok: true,
      periodo,
      rango: `${desde} a ${hasta}`,
      campañas: filas.length,
      gasto_total_mxn: totalGasto.toFixed(2),
      detalle: filas.map(f => ({ canal: f.canal, campaña: f['campaña'], gasto: f.gasto_mxn }))
    });

  } catch (e) {
    console.error('Error general:', e);
    return res.status(500).json({ error: e.message });
  }
}
