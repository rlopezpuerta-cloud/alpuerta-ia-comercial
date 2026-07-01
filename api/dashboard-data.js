// Endpoint de datos para el Dashboard de CAC
// Devuelve métricas agregadas leyendo de Supabase (usa service key del lado servidor,
// nunca se expone al navegador). GET público, solo lectura de agregados.

const SUPABASE_URL = 'https://rwujdgfgvbolrugrsjib.supabase.co';

async function supaQuery(path, key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  // Anti-caché: siempre datos frescos
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const supaKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supaKey) return res.status(500).json({ error: 'Falta SUPABASE_SERVICE_KEY' });

    const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const periodoDefault = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const periodo = (req.query && req.query.periodo) || periodoDefault;

    // 1. CAC completo por canal (la vista que cruza todo)
    const cac = await supaQuery(`cac_completo?periodo=eq.${periodo}&order=inversion_mxn.desc`, supaKey);

    // 2. Gasto por campaña (detalle)
    const campañas = await supaQuery(
      `gasto_ads?periodo=eq.${periodo}&select=canal,campaña,gasto_mxn,impresiones,clicks&order=gasto_mxn.desc`,
      supaKey
    );

    // 3. TOTALES desde las tablas fuente directamente (no desde la vista por canal,
    //    para incluir ventas sin atribución de canal)
    const gastoTotal = await supaQuery(
      `gasto_ads?periodo=eq.${periodo}&select=gasto_mxn`, supaKey
    );
    const ventasTotal = await supaQuery(
      `ventas?periodo=eq.${periodo}&select=monto_mxn,origen,canal`, supaKey
    );
    const leadsTotal = await supaQuery(
      `leads_kommo?periodo=eq.${periodo}&select=kommo_lead_id`, supaKey
    );

    const totalInversion = gastoTotal.reduce((s, r) => s + Number(r.gasto_mxn || 0), 0);
    const totalVentas = ventasTotal.length;
    const totalIngresos = ventasTotal.reduce((s, r) => s + Number(r.monto_mxn || 0), 0);
    // Leads del periodo: contar leads_kommo de ese mes (conteo real desde Kommo)
    const totalLeads = leadsTotal.length;

    // Cuántas ventas tienen origen identificado
    const ventasConOrigen = ventasTotal.filter(v => v.canal).length;

    // 4. Periodos disponibles
    const periodos = await supaQuery(`gasto_ads?select=periodo`, supaKey);
    const periodosUnicos = [...new Set(periodos.map(p => p.periodo))].sort().reverse();

    return res.status(200).json({
      ok: true,
      periodo,
      periodos_disponibles: periodosUnicos,
      totales: {
        inversion: totalInversion,
        leads: totalLeads,
        ventas: totalVentas,
        ingresos: totalIngresos,
        cac: totalVentas > 0 ? totalInversion / totalVentas : null,
        costo_por_lead: totalLeads > 0 ? totalInversion / totalLeads : null,
        roas: totalInversion > 0 ? totalIngresos / totalInversion : null,
        tasa_cierre: totalLeads > 0 ? (100 * totalVentas / totalLeads) : null
      },
      ventas_con_origen: ventasConOrigen,
      ventas_sin_origen: totalVentas - ventasConOrigen,
      por_canal: cac,
      campañas: campañas
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
