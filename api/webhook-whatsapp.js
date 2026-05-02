// Webhook para recibir mensajes de WhatsApp
// Aquí se procesarán los mensajes entrantes

export default async function handler(req, res) {
  // Verificación del webhook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('Webhook verificado');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  
  // Recepción de mensajes (POST)
  if (req.method === 'POST') {
    const body = req.body;
    
    // TODO: Procesar mensaje
    // TODO: Consultar OpenAI
    // TODO: Guardar en Supabase
    // TODO: Responder al cliente
    
    return res.status(200).send('EVENT_RECEIVED');
  }
  
  return res.status(404).send('Not Found');
}
