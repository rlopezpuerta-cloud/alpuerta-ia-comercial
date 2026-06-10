// Sincronizador de Ventas Cerradas (Kommo GANADO) → Supabase
// Corre vía Vercel Cron (diario). Jala los leads en etapa GANADO del pipeline
// Ventas 2026, extrae monto y teléfono, los cruza con la tabla atribucion
// (por teléfono) para heredar el origen/canal, y hace upsert en la tabla ventas.

const KOMMO_DOMAIN = 'https://ventastrofeosonlinecommx.kommo.com';
const PIPELINE_ID = 13854004;
const STATUS_GANADO = 142;
const SUPABASE_URL = 'https://rwujdgfgvbolrugrsjib.supabase.co';

// Normaliza teléfono a solo dígitos para hacer match con atribucion
function normalizarTel(tel) {
  if (!tel) return null;
  return String(tel).replace(/\D/g, '');
}

async function kommoGet(path, token) {
  const res = await fetch(`${KOMMO_DOMAIN}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status === 204) return null; // sin resultados
  if (!res.ok) throw new Error(`Kommo ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  try {
    const kommoToken = process.env.KOMMO_TOKEN;
    const supaKey = process.env.SUPABASE_SERVICE_KEY;
    if (!kommoToken || !supaKey) {
      return res.status(500).json({ error: 'Faltan env vars (KOMMO_TOKEN o SUPABASE_SERVICE_KEY)' });
    }

    // 1. Traer todos los leads en GANADO (con contactos para el teléfono)
    let ventas = [];
    let page = 1;
    let hayMas = true;

    while (hayMas && page <= 10) {
      const path = `/api/v4/leads?filter[statuses][0][pipeline_id]=${PIPELINE_ID}` +
                   `&filter[statuses][0][status_id]=${STATUS_GANADO}` +
                   `&with=contacts&limit=250&page=${page}`;
      const data = await kommoGet(path, kommoToken);
      if (!data || !data._embedded || !data._embedded.leads || data._embedded.leads.length === 0) {
        hayMas = false;
        break;
      }
      ventas = ventas.concat(data._embedded.leads);
      hayMas = data._embedded.leads.length === 250;
      page++;
    }

    if (ventas.length === 0) {
      return res.status(200).json({ ok: true, mensaje: 'Sin ventas en GANADO', ventas: 0 });
    }

    // 2. Para cada venta, obtener teléfono del contacto principal
    const filas = [];
    for (const lead of ventas) {
      let telefono = null;
      const contactos = lead._embedded?.contacts || [];
      const principal = contactos.find(c => c.is_main) || contactos[0];

      if (principal) {
        // Traer el contacto para extraer su teléfono
        const cdata = await kommoGet(`/api/v4/contacts/${principal.id}`, kommoToken);
        const cfs = cdata?.custom_fields_values || [];
        const phoneField = cfs.find(f => f.field_code === 'PHONE');
        if (phoneField && phoneField.values?.length) {
          telefono = normalizarTel(phoneField.values[0].value);
        }
      }

      const fechaCierre = lead.closed_at ? new Date(lead.closed_at * 1000) : null;
      const periodo = fechaCierre
        ? `${fechaCierre.getFullYear()}-${String(fechaCierre.getMonth() + 1).padStart(2, '0')}`
        : null;

      filas.push({
        kommo_lead_id: lead.id,
        telefono: telefono,
        nombre: lead.name || null,
        monto_mxn: lead.price || 0,
        fecha_cierre: fechaCierre ? fechaCierre.toISOString() : null,
        periodo: periodo
      });
    }

    // 3. Cruzar con atribucion por teléfono para heredar origen/canal
    //    Traemos toda la atribucion y mapeamos en memoria
    const atrRes = await fetch(
      `${SUPABASE_URL}/rest/v1/atribucion?select=telefono,origen,canal,source_id`,
      { headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}` } }
    );
    const atribucion = await atrRes.json();
    const mapaAtr = {};
    for (const a of atribucion) {
      const t = normalizarTel(a.telefono);
      if (t) mapaAtr[t] = a;
    }

    for (const fila of filas) {
      const atr = fila.telefono ? mapaAtr[fila.telefono] : null;
      if (atr) {
        fila.origen = atr.origen;
        fila.canal = atr.canal;
        fila.source_id = atr.source_id;
      } else {
        fila.origen = 'desconocido';
        fila.canal = null;
        fila.source_id = null;
      }
    }

    // 4. Upsert a Supabase (on_conflict kommo_lead_id)
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ventas?on_conflict=kommo_lead_id`,
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
      return res.status(500).json({ error: 'Supabase', detail: errTxt });
    }

    const totalIngresos = filas.reduce((s, f) => s + Number(f.monto_mxn), 0);
    const conOrigen = filas.filter(f => f.origen !== 'desconocido').length;
    console.log(`✅ Ventas sincronizadas: ${filas.length}, $${totalIngresos.toFixed(2)} MXN, ${conOrigen} con origen`);

    return res.status(200).json({
      ok: true,
      ventas: filas.length,
      ingresos_total_mxn: totalIngresos.toFixed(2),
      con_origen: conOrigen,
      sin_origen: filas.length - conOrigen,
      detalle: filas.map(f => ({ nombre: f.nombre, monto: f.monto_mxn, canal: f.canal, origen: f.origen }))
    });

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
