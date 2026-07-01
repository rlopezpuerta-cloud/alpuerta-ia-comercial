// api/sync-leads.js
// Sincronizador de LEADS (Kommo → Supabase.atribucion)
// -------------------------------------------------------------------
// PARA QUÉ SIRVE:
//   Hoy el dashboard saca el número de "Leads" de la tabla `atribucion`,
//   que está casi vacía (2 filas). Por eso muestra Leads=2, Costo/Lead=$28k
//   y Tasa de cierre=1800% (absurdos). Este endpoint jala TODOS los leads
//   del pipeline creados en los últimos N meses y los inserta en `atribucion`
//   (uno por teléfono), para que el conteo de leads sea real.
//
//   OJO SOBRE CANAL: los leads de Kommo NO traen datos de tracking
//   (custom_fields_values viene null), así que el CANAL se guarda como null
//   / origen 'desconocido'. Esto arregla los KPIs globales (leads, costo/lead,
//   tasa de cierre) pero NO el desglose por canal — para eso hace falta el
//   proyecto de captura de origen (click-to-WhatsApp / UTM). Ver README.
//
//   Usa 'ignore-duplicates' para NO pisar la atribución real que ya exista.
//   Corre vía Vercel Cron (o disparado por Make, igual que extraer-gasto).

const KOMMO_DOMAIN = 'https://ventastrofeosonlinecommx.kommo.com';
const PIPELINE_ID = 13854004;
const SUPABASE_URL = 'https://rwujdgfgvbolrugrsjib.supabase.co';
const MESES_ATRAS = 3; // cuántos meses hacia atrás sincronizar (evita timeout)

function normalizarTel(tel) {
  if (!tel) return null;
  return String(tel).replace(/\D/g, '');
}

async function kommoGet(path, token) {
  const res = await fetch(`${KOMMO_DOMAIN}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Kommo ${res.status}: ${await res.text()}`);
  return res.json();
}

// Deriva canal a partir de los campos de tracking del lead (hoy vienen vacíos,
// pero queda listo para cuando la captura de origen esté funcionando).
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
  if (fbclid || utmSource.includes('ig') || utmSource.includes('insta'))
    return { canal: utmSource.includes('ig') || utmSource.includes('insta') ? 'ig_ads' : 'fb_ads', origen: 'ad' };
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

    // Fecha de corte: inicio del mes hace MESES_ATRAS meses (epoch segundos)
    const hoy = new Date();
    const corte = new Date(hoy.getFullYear(), hoy.getMonth() - MESES_ATRAS, 1);
    const corteEpoch = Math.floor(corte.getTime() / 1000);

    let leads = [];
    let page = 1;
    let hayMas = true;

    while (hayMas && page <= 40) {
      const path = `/api/v4/leads?filter[pipeline_id]=${PIPELINE_ID}` +
                   `&filter[created_at][from]=${corteEpoch}` +
                   `&with=contacts&limit=250&page=${page}`;
      const data = await kommoGet(path, kommoToken);
      if (!data?._embedded?.leads?.length) { hayMas = false; break; }
      leads = leads.concat(data._embedded.leads);
      hayMas = data._embedded.leads.length === 250;
      page++;
    }

    if (leads.length === 0) {
      return res.status(200).json({ ok: true, mensaje: 'Sin leads en el rango', leads: 0 });
    }

    // Cache de teléfonos de contacto para no repetir GETs
    const cacheContacto = {};
    const filas = [];

    for (const lead of leads) {
      let telefono = null;
      const contactos = lead._embedded?.contacts || [];
      const principal = contactos.find(c => c.is_main) || contactos[0];

      if (principal) {
        if (cacheContacto[principal.id] === undefined) {
          const cdata = await kommoGet(`/api/v4/contacts/${principal.id}`, kommoToken);
          const cfs = cdata?.custom_fields_values || [];
          const phoneField = cfs.find(f => f.field_code === 'PHONE');
          cacheContacto[principal.id] = phoneField?.values?.length
            ? normalizarTel(phoneField.values[0].value) : null;
        }
        telefono = cacheContacto[principal.id];
      }

      if (!telefono) continue; // sin teléfono no podemos deduplicar; lo saltamos

      const { canal, origen } = derivarCanal(lead);
      const created = new Date((lead.created_at || 0) * 1000).toISOString();

      filas.push({ telefono, canal, origen, created_at: created });
    }

    if (filas.length === 0) {
      return res.status(200).json({ ok: true, leads_kommo: leads.length, insertados: 0, nota: 'Ningún lead con teléfono' });
    }

    // ignore-duplicates: NO pisa filas ya existentes (respeta atribución real previa)
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/atribucion?on_conflict=telefono`,
      {
        method: 'POST',
        headers: {
          'apikey': supaKey,
          'Authorization': `Bearer ${supaKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal'
        },
        body: JSON.stringify(filas)
      }
    );

    if (!supaRes.ok) {
      return res.status(500).json({ error: 'Supabase', detail: await supaRes.text() });
    }

    const conCanal = filas.filter(f => f.canal).length;
    console.log(`✅ Leads sincronizados: ${filas.length} (con canal: ${conCanal})`);
    return res.status(200).json({
      ok: true,
      leads_kommo: leads.length,
      leads_con_telefono: filas.length,
      con_canal: conCanal
    });

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
