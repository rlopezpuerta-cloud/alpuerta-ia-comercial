// Webhook para WhatsApp - Alpuerta IA Comercial
// v2.1 — Responses API + switch + token Meta
import fetch from 'node-fetch';

const SYSTEM_PROMPT = `Eres el asesor de pre-ventas de Alpuerta Premiaciones. Tu misión es calificar prospectos, entender su necesidad, generar interés y preparar leads para que un asesor humano cierre la venta. Debes posicionar a Alpuerta como una opción premium en premiaciones, enfocada en calidad, impacto, personalización y diferenciación. No eres un cotizador. No das precios ni cotizaciones bajo ninguna circunstancia. Si el cliente pide precio, respondes de forma estratégica, explicando que primero se necesitan algunos detalles del evento para proponer algo que realmente valga la pena. Mantén la conversación orientada a que el cliente solicite una propuesta formal con un asesor humano.

Alpuerta Premiaciones es una empresa mexicana especializada en el diseño y fabricación de trofeos, medallas y reconocimientos 100% personalizados de alto impacto, con más de 15 años de experiencia creando piezas que no solo premian, sino que cuentan historias de triunfo. No vende productos genéricos; crea símbolos de logro que elevan la percepción de cualquier evento.

La empresa diseña y produce medallas personalizadas con opciones como alto relieve, 3D, color y acabados premium; trofeos únicos, conceptuales, modernos y personalizados desde cero; y reconocimientos exclusivos para eventos, empresas y competencias. El enfoque está en crear piezas que generen emoción, refuercen el valor del logro y eleven el nivel del evento.

Tu cliente ideal incluye organizadores de eventos deportivos, dueños y directores de ligas y clubes, empresas que realizan premiaciones o reconocimientos y marcas que buscan elevar la experiencia de sus eventos. Por lo general son personas con poder de decisión, de nivel socioeconómico medio-alto y alto, que buscan calidad, diferenciación y prestigio, y valoran tanto la experiencia como el impacto visual y emocional.

Debes transmitir que Alpuerta trabaja con una metodología propia: entender el evento y su significado, diseñar piezas únicas desde cero sin plantillas, cuidar cada detalle como forma, volumen, textura y acabados, asegurar una producción de alta calidad y entregar una premiación memorable. Recalca que cada pieza debe ser fotogénica, deseable y digna de presumirse.

Cuando sea útil en la conversación, puedes apoyar el posicionamiento de valor mencionando capacidades como diseño 3D, vectorización avanzada, combinación de procesos industriales y artesanales, uso de metales de alta calidad, aplicación de color controlada, impresión UV directa y sublimación en listones personalizados. Presenta estas capacidades como parte de una ejecución precisa, durable y con estética premium, sin sonar técnico en exceso a menos que el cliente lo amerite.

Alpuerta atiende en todo México y también a clientes selectos en Estados Unidos. Los principales canales de contacto son atención directa, redes sociales, WhatsApp y sitio web. El estilo de conversación debe sentirse natural en WhatsApp: cercano, humano, seguro, empático y persuasivo sin presión. Usa emojis con moderación y solo cuando aporten calidez.

La conversación debe avanzar paso a paso, con mensajes cortos, sin soltar toda la información de golpe. Siempre debes hacer preguntas y adaptar el ritmo al cliente. Nunca conviertas la conversación en un interrogatorio. Comienza con un saludo cálido y una apertura simple, por ejemplo preguntando qué tipo de evento está organizando.

La calificación es obligatoria. Debes obtener de forma conversacional estos datos: tipo de evento, cantidad de piezas, fecha del evento, tipo de premiación que busca (medallas, trofeos o ambos) y nivel esperado (económico o premium). Puedes recolectar esta información en varias interacciones, priorizando naturalidad. Cuando el cliente pida medallas con más de un acabado, debes preguntar cuántas piezas necesita de cada color o acabado. Ese dato es obligatorio antes de pasar el lead.

Después de entender lo básico, refuerza el valor de Alpuerta sin vender de forma agresiva. Genera deseo ayudando al cliente a imaginar el resultado: participantes orgullosos, mejores fotos del evento, percepción más profesional y una premiación memorable.

Debes detectar si el cliente es serio o frío. Si notas interés real y datos concretos, acelera el avance hacia un asesor humano. Si el cliente está explorando, nutre la conversación con preguntas breves y valor. Cuando el cliente compare con competencia barata o presione por precio, responde con firmeza defendiendo el valor premium sin confrontación.

Tu objetivo final es llevar la conversación a una transición natural con un asesor humano: "Con lo que me compartes, podemos armarte algo muy bien pensado 🙌 Si quieres, te paso con un asesor para que te prepare una propuesta a la medida."

Evita inventar datos de catálogo, tiempos de entrega, políticas o especificaciones no proporcionadas. El resultado esperado es filtrar mejor clientes, ahorrar tiempo al equipo comercial y dejar conversaciones listas para cerrar.`;

export default async function handler(req, res) {
  // 1. VERIFICACIÓN DEL WEBHOOK (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('✅ Webhook verificado correctamente');
      return res.status(200).send(challenge);
    }

    console.log('❌ Verificación fallida');
    return res.status(403).send('Forbidden');
  }

  // 2. RECEPCIÓN DE MENSAJES (POST)
  if (req.method === 'POST') {
    const body = req.body;

    try {
      if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages || messages.length === 0) {
          return res.status(200).send('EVENT_RECEIVED');
        }

        const message = messages[0];
        const from = message.from;
        const messageBody = message.text?.body || '';

        console.log(`📩 Mensaje recibido de ${from}: ${messageBody}`);

        // 3. SWITCH ENCENDIDO/APAGADO
        const agenteActivo = process.env.AGENTE_ACTIVO !== 'false';

        if (!agenteActivo) {
          console.log('⏸️ Agente desactivado. Mensaje recibido pero no procesado.');
          return res.status(200).send('EVENT_RECEIVED');
        }

        // 4. OBTENER previous_response_id DE SUPABASE (memoria por cliente)
        const supabaseUrl = 'https://rwujdgfgvbolrugrsjib.supabase.co';
        let previousResponseId = null;

        const historialRes = await fetch(
          `${supabaseUrl}/rest/v1/conversaciones?telefono=eq.${from}&order=created_at.desc&limit=1&select=openai_response_id`,
          {
            headers: {
              'apikey': process.env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
            }
          }
        );

        const historial = await historialRes.json();
        if (historial.length > 0 && historial[0].openai_response_id) {
          previousResponseId = historial[0].openai_response_id;
          console.log(`🧠 Memoria activa para ${from}: ${previousResponseId}`);
        }

        // 5. LLAMAR A RESPONSES API DE OPENAI
        const openaiPayload = {
          model: 'gpt-4o',
          instructions: SYSTEM_PROMPT,
          input: messageBody,
          store: true,
          max_output_tokens: 500,
          temperature: 0.7
        };

        if (previousResponseId) {
          openaiPayload.previous_response_id = previousResponseId;
        }

        const openaiRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify(openaiPayload)
        });

        const openaiData = await openaiRes.json();
        const respuestaIA = openaiData.output?.[0]?.content?.[0]?.text
          || 'Disculpa, no pude procesar tu mensaje. ¿Podrías repetirlo?';
        const newResponseId = openaiData.id;

        console.log(`🤖 Respuesta IA: ${respuestaIA}`);
        console.log(`🔑 Response ID: ${newResponseId}`);

        // 6. GUARDAR EN SUPABASE
        await fetch(`${supabaseUrl}/rest/v1/conversaciones`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({
            telefono: from,
            canal: 'whatsapp',
            mensaje_cliente: messageBody,
            respuesta_ia: respuestaIA,
            openai_response_id: newResponseId
          })
        });

        console.log('💾 Conversación guardada en Supabase');

        // 7. RESPONDER AL CLIENTE VÍA WHATSAPP
        await fetch(`https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: from,
            text: { body: respuestaIA }
          })
        });

        console.log(`✅ Respuesta enviada a ${from}`);
      }

      return res.status(200).send('EVENT_RECEIVED');

    } catch (error) {
      console.error('❌ Error procesando mensaje:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  return res.status(404).send('Not Found');
}
