// api/sync-leads.js
// Sincroniza el CONTEO de leads del pipeline (Kommo -> Supabase.leads_kommo).
// -------------------------------------------------------------------
// PARA QUÉ SIRVE:
//   El dashboard sacaba "Leads" de la tabla `atribucion` (casi vacía), dando
//   Leads=2, Costo/Lead=$28k y Tasa de cierre=1800% (absurdos). Este endpoint
//   lista TODOS los leads del pipeline creados en los últimos N meses y hace
//   upsert (por kommo_lead_id) en la tabla `leads_kommo`, para que el conteo
//   de leads por periodo sea real.
//
//   IMPORTANTE — solo LISTA leads (no hace una llamada por cada lead para el
//   teléfono), así que corre en <1s con cualquier volumen y no revienta el
//   límite de tiempo de Vercel Hobby.
//
//   CANAL: los leads de Kommo hoy no traen tracking (custom_fields_values=null),
//   así que canal queda null. El código ya deriva el canal si algún día se
//   captura el origen (fbclid/utm/ttad). El desglose POR CANAL necesita ese
//   proyecto de captura aparte.

const KOMMO_DOMAIN = 'https://ventastrofeosonlinecommx.kommo.com';
const PIPELINE_ID = 13854004;
const SUPABASE_URL = 'https://rwujdgfgvbolrugrsjib.supabase.co';
const MESES_ATRAS = 3; // rango hacia atrás a sincronizar

async function kommoGet(path, token) {
  const res = await fetch(`${KOMMO_DOMAIN}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Kommo ${res.status}: ${await res.text()}`);
  return res.json();
}

// Deriva canal desde los campos de tracking del lead (hoy vienen vacíos,
// queda listo para cuando exista captura de origen).
function derivarCanal(lead) {
  const cfs = lead.custom_fields_values || [];
  const val = (code) => {
    const f = cfs.find(x => (x.field_code || '').toUpperCase() === code);
    return f?.values?.[0]?.value || null;
  };
  const fbclid = val('FBCLID');
  const ttad = val('TIKTOK_AD_ID_TD');
  const gclid = val('GCLID');
  const utmSource = (val('UTM_SOURCE') || '').toLowerCase();

  if (ttad) return { canal: 'tiktok_ads', origen: 'ad' };
  if (gclid) return { canal: 'google_ads', origen: 'ad' };
  if (utmSource.includes('ig') || utmSource.includes('insta')) return { canal: 'ig_ads', origen: 'ad' };
  if (fbclid) return { canal: 'fb_ads', origen: 'ad' };
  if (utmSource.includes('whats')) return { canal: 'whatsapp_ads', origen: 'ad' };
  return { canal: null, origen: 'desconocido' };
}

export default async function handler(req, res) {
  try {
    const kommoToken = process.env.KOMMO_TOKEN;
    const supaKey = process.env.SUPABASE_SERVICE_KEY;
    if (!kommoToken || !supaKey) {
      return res.status(500).json({ error: 'Faltan env vars (KOMMO_TOKEN o SUPABASE_SERVICE_KEY)' });
    }

    const hoy = new Date();
    const corte = new Date(hoy.getFullYear(), hoy.getMonth() - MESES_ATRAS, 1);
    const corteEpoch = Math.floor(corte.getTime() / 1000);

    let leads = [];
    let page = 1;
    let hayMas = true;

    while (hayMas && page <= 60) {
      const path = `/api/v4/leads?filter[pipeline_id]=${PIPELINE_ID}` +
                   `&filter[created_at][from]=${corteEpoch}` +
                   `&limit=250&page=${page}`;
      const data = await kommoGet(path, kommoToken);
      if (!data?._embedded?.leads?.length) { hayMas = false; break; }
      leads = leads.concat(data._embedded.leads);
      hayMas = data._embedded.leads.length === 250;
      page++;
    }

    if (leads.length === 0) {
      return res.status(200).json({ ok: true, mensaje: 'Sin leads en el rango', leads: 0 });
    }

    const filas = leads.map(lead => {
      const created = new Date((lead.created_at || 0) * 1000);
      const periodo = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      const { canal, origen } = derivarCanal(lead);
      return {
        kommo_lead_id: lead.id,
        periodo,
        canal,
        origen,
        created_at: created.toISOString()
      };
    });

    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads_kommo?on_conflict=kommo_lead_id`,
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
      return res.status(500).json({ error: 'Supabase', detail: await supaRes.text() });
    }

    const conCanal = filas.filter(f => f.canal).length;
    console.log(`✅ Leads sincronizados: ${filas.length} (con canal: ${conCanal}, páginas: ${page - 1})`);
    return res.status(200).json({
      ok: true,
      leads: filas.length,
      con_canal: conCanal,
      paginas: page - 1
    });

  } catch (e) {
    console.error('Error sync-leads:', e);
    return res.status(500).json({ error: e.message });
  }
}
