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
//   CANAL (actualizado 30-jul-2026): desde hoy los leads SÍ traen canal, en el
//   campo "Canal de origen" (id 1390045) que rellenan los escenarios de Make a
//   partir de la conversación de Kommo (/v4/talks). Se lee ese campo.
//
//   OJO CON LO QUE SIGNIFICA: es el canal por el que ENTRÓ LA CONVERSACIÓN
//   (WhatsApp, Messenger, Instagram, formulario web), NO prueba de que el lead
//   venga de un anuncio. Un lead orgánico de WhatsApp y uno que llegó por un
//   anuncio de WhatsApp se ven igual. Por eso el costo por lead que salga de
//   cruzar esto con gasto_ads es una COTA SUPERIOR OPTIMISTA: el denominador
//   incluye tráfico que no se pagó. Para atribución real por anuncio hace falta
//   capturar click ids (fbclid/gclid) o migrar a WhatsApp Cloud API.

const KOMMO_DOMAIN = 'https://ventastrofeosonlinecommx.kommo.com';
const PIPELINE_ID = 13854004;
const SUPABASE_URL = 'https://rwujdgfgvbolrugrsjib.supabase.co';
const MESES_ATRAS = 3; // rango hacia atrás a sincronizar

// Campo Kommo "Canal de origen" y sus opciones.
const CANAL_FIELD_ID = 1390045;
const CANAL_POR_ENUM = {
  937393: 'whatsapp',
  937395: 'messenger',
  937397: 'instagram',
  937399: 'web',
  937401: 'otro'
};

async function kommoGet(path, token) {
  const res = await fetch(`${KOMMO_DOMAIN}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Kommo ${res.status}: ${await res.text()}`);
  return res.json();
}

// Deriva canal del lead. Dos niveles, del más fiable al menos:
//   1) Click ids de publicidad (fbclid/gclid/ttad/utm). Si existen, son prueba
//      real de que el lead viene de un anuncio. Hoy vienen vacíos, pero se
//      conservan porque son la atribución buena si algún día se capturan.
//   2) Campo "Canal de origen" (1390045). Dice por dónde entró la conversación,
//      no si vino de un anuncio. Es lo que hay, y es mucho mejor que nada.
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

  // Nivel 1: atribución publicitaria comprobada.
  if (ttad) return { canal: 'tiktok_ads', origen: 'ad' };
  if (gclid) return { canal: 'google_ads', origen: 'ad' };
  if (utmSource.includes('ig') || utmSource.includes('insta')) return { canal: 'ig_ads', origen: 'ad' };
  if (fbclid) return { canal: 'fb_ads', origen: 'ad' };
  if (utmSource.includes('whats')) return { canal: 'whatsapp_ads', origen: 'ad' };

  // Nivel 2: canal de conversación (no implica anuncio).
  const campoCanal = cfs.find(x => x.field_id === CANAL_FIELD_ID);
  const enumId = campoCanal?.values?.[0]?.enum_id;
  const canal = enumId ? CANAL_POR_ENUM[enumId] : null;
  if (canal) {
    return { canal, origen: canal === 'web' ? 'formulario' : 'chat' };
  }

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
