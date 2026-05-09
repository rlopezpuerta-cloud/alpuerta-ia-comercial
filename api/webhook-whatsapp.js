// Webhook Multicanal - Alpuerta IA Comercial
// v3.0 — WhatsApp + Messenger + Instagram + Responses API + memoria + switch
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

const supabaseUrl = 'https://rwujdgfgvbolrugrsjib.supabase.co';

// ========== FUNCIÓN: OBTENER MEMORIA DE CONVERSACIÓN ==========
async function obtenerMemoria(userId) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/conversaciones?telefono=eq.${userId}&order=created_at.desc&limit=1&select=openai_response_id`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        }
      }
    );
    const data = await res.json();
    if (data.length > 0 && data[0].openai_response_id) {
      return data[0].openai_response_id;
    }
    return null;
  } catch (e) {
    console.error('Error obteniendo memoria:', e);
    return null;
  }
}

// ========== FUNCIÓN: LLAMAR A OPENAI ==========
async function llamarOpenAI(messageBody, previousResponseId) {
  const payload = {
    model: 'gpt-4o',
    instructions: SYSTEM_PROMPT,
    input: messageBody,
    store: true,
    max_output_tokens: 500,
    temperature: 0.7
  };

  if (previousResponseId) {
    payload.previous_response_id = previousResponseId;
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  return {
    text: data.output?.[0]?.content?.[0]?.text || 'Disculpa, no pude procesar tu mensaje. ¿Podrías repetirlo?',
    responseId: data.id
  };
}

// ========== FUNCIÓN: GUARDAR EN SUPABASE ==========
async function guardarConversacion(userId, canal, mensajeCliente, respuestaIA, responseId) {
  await fetch(`${supabaseUrl}/rest/v1/conversaciones`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({
      telefono: userId,
      canal: canal,
      mensaje_cliente: mensajeCliente,
      respuesta_ia: respuestaIA,
      openai_response_id: responseId
    })
  });
}

// ========== FUNCIÓN: ENVIAR MENSAJE A WHATSAPP ==========
async function enviarWhatsApp(to, text) {
  await fetch(`https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      text: { body: text }
    })
  });
}

// ========== FUNCIÓN: ENVIAR MENSAJE A MESSENGER ==========
async function enviarMessenger(recipientId, text) {
  await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: text }
    })
  });
}

// ========== FUNCIÓN: ENVIAR MENSAJE A INSTAGRAM ==========
async function enviarInstagram(recipientId, text) {
  await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: text }
    })
  });
}

// ========== FUNCIÓN: PROCESAR MENSAJE ==========
async function procesarMensaje(userId, canal, mensajeCliente) {
  console.log(`📩 [${canal}] Mensaje de ${userId}: ${mensajeCliente}`);

  const previousResponseId = await obtenerMemoria(userId);
  if (previousResponseId) {
    console.log(`🧠 Memoria activa: ${previousResponseId}`);
  }

  const { text: respuestaIA, responseId } = await llamarOpenAI(mensajeCliente, previousResponseId);
  console.log(`🤖 Respuesta IA: ${respuestaIA}`);

  await guardarConversacion(userId, canal, mensajeCliente, respuestaIA, responseId);
  console.log('💾 Conversación guardada');

  if (canal === 'whatsapp') {
    await enviarWhatsApp(userId, respuestaIA);
  } else if (canal === 'messenger') {
    await enviarMessenger(userId, respuestaIA);
  } else if (canal === 'instagram') {
    await enviarInstagram(userId, respuestaIA);
  }

  console.log(`✅ Respuesta enviada por ${canal} a ${userId}`);
}

// ========== HANDLER PRINCIPAL ==========
export default async function handler(req, res) {
  // VERIFICACIÓN DEL WEBHOOK (GET)
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

  // RECEPCIÓN DE MENSAJES (POST)
  if (req.method === 'POST') {
    const body = req.body;

    try {
      // SWITCH GLOBAL ENCENDIDO/APAGADO
      const agenteActivo = process.env.AGENTE_ACTIVO !== 'false';
      if (!agenteActivo) {
        console.log('⏸️ Agente desactivado.');
        return res.status(200).send('EVENT_RECEIVED');
      }

      // ===== WHATSAPP =====
      if (body.object === 'whatsapp_business_account') {
        const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
        if (messages && messages.length > 0) {
          const message = messages[0];
          const from = message.from;
          const messageBody = message.text?.body || '';
          if (messageBody) {
            await procesarMensaje(from, 'whatsapp', messageBody);
          }
        }
      }

      // ===== MESSENGER (Página de Facebook) =====
      else if (body.object === 'page') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const messaging = entry.messaging || [];
          for (const event of messaging) {
            if (event.message && event.message.text && !event.message.is_echo) {
              const senderId = event.sender.id;
              const text = event.message.text;
              await procesarMensaje(senderId, 'messenger', text);
            }
          }
        }
      }

      // ===== INSTAGRAM =====
      else if (body.object === 'instagram') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const messaging = entry.messaging || [];
          for (const event of messaging) {
            if (event.message && event.message.text && !event.message.is_echo) {
              const senderId = event.sender.id;
              const text = event.message.text;
              await procesarMensaje(senderId, 'instagram', text);
            }
          }
        }
      }

      return res.status(200).send('EVENT_RECEIVED');

    } catch (error) {
      console.error('❌ Error procesando mensaje:', error);
      return res.status(500).send('Internal Server Error');
    }
  }

  return res.status(404).send('Not Found');
}
