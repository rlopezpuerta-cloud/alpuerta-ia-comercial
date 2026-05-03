// Webhook para WhatsApp - Alpuerta IA Comercial
import fetch from 'node-fetch';

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
      // Verificar que es un mensaje de WhatsApp
      if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        
        // Extraer datos del mensaje
        const messages = value?.messages;
        if (!messages || messages.length === 0) {
          return res.status(200).send('EVENT_RECEIVED');
        }
        
        const message = messages[0];
        const from = message.from; // Número del cliente
        const messageBody = message.text?.body || ''; // Texto del mensaje
        const messageId = message.id;
        
        console.log(`📩 Mensaje recibido de ${from}: ${messageBody}`);
        
        // 3. CONSULTAR OPENAI
        const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: `Eres el asesor comercial digital de Alpuerta Premiaciones.

TU FUNCIÓN: Atender prospectos por WhatsApp, identificar producto de interés, recopilar datos necesarios y calificar leads.

NO COTIZAS PRECIOS. NO PROMETES TIEMPOS. NO DAS DESCUENTOS.

TONO: Amable, profesional, directo, cálido. Mensajes cortos (máximo 3-4 líneas).

PRODUCTOS: Medallas, Trofeos 2D/3D, Copas, Pines, Placas, Reconocimientos.

DATOS A RECOPILAR:
- Nombre
- Empresa/Evento
- Producto de interés
- Cantidad
- Fecha del evento
- Descripción breve

Responde de forma natural y amigable.`
              },
              {
                role: 'user',
                content: messageBody
              }
            ],
            temperature: 0.7,
            max_tokens: 300
          })
        });
        
        const gptData = await gptResponse.json();
        const respuestaIA = gptData.choices?.[0]?.message?.content || 'Disculpa, no pude procesar tu mensaje. ¿Podrías repetirlo?';
        
        console.log(`🤖 Respuesta IA: ${respuestaIA}`);
        
        // 4. GUARDAR EN SUPABASE
     const supabaseUrl = 'https://rwujdgfgvbolrugrsijb.supabase.co'; // HARDCODED TEMPORAL
   console.log('🔍 SUPABASE URL:', supabaseUrl);
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
            respuesta_ia: respuestaIA
          })
        });
        
        console.log('💾 Conversación guardada en Supabase');
        
        // 5. RESPONDER AL CLIENTE VÍA WHATSAPP
        await fetch(`https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: from,
            text: {
              body: respuestaIA
            }
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
