markdown# Alpuerta IA Comercial

Backend del agente comercial con inteligencia artificial para Alpuerta Premiaciones.

## 📋 Descripción

Sistema automatizado de atención comercial 24/7 que recibe mensajes de WhatsApp, Facebook Messenger e Instagram, procesa solicitudes con IA y califica leads para el equipo comercial.

## 🏗️ Arquitectura
WhatsApp / Facebook / Instagram
↓
Meta Cloud API / Webhooks
↓
Backend (Vercel)
↓
OpenAI GPT-4 + Prompt Alpuerta
↓
Supabase (Base de datos)
↓
Respuesta al cliente + Alerta al equipo

## 🗄️ Base de Datos (Supabase)

### Tablas principales:

- **leads:** Información de contacto y estado del prospecto
- **solicitudes_cotizacion:** Detalles del producto solicitado
- **conversaciones:** Historial completo de mensajes

## 🤖 Funciones del Agente IA

✅ **SÍ hace:**
- Atender consultas 24/7
- Identificar producto de interés
- Recopilar datos necesarios para cotización
- Guardar leads en Supabase
- Notificar al equipo comercial

❌ **NO hace:**
- No cotiza precios
- No promete tiempos sin validar
- No da descuentos
- No inventa disponibilidad

## 📦 Productos que maneja

- Medallas personalizadas (mín. 100 pz)
- Trofeos 2D/3D (mín. 10 pz)
- Copas italianas (mín. 3 pz)
- Pines, placas, reconocimientos
- Monedas, esculturas, gafetes, listones

## 🔑 Variables de Entorno

Ver archivo `.env.example` para la lista completa.

Necesitas configurar:
- Credenciales de Supabase
- API Key de OpenAI
- Credenciales de Meta Business
- Token de verificación de webhooks

## 📁 Estructura del Proyecto
alpuerta-ia-comercial/
├── api/
│   └── webhook-whatsapp.js    # Webhook principal
├── prompts/
│   └── asesor-alpuerta.md     # Prompt maestro del GPT
├── .env.example               # Variables de entorno
├── .gitignore
└── README.md

## 🚀 Estado del Proyecto

**Fase actual:** Configuración base

- ✅ Supabase configurado
- ✅ Estructura de tablas creada
- ✅ Repositorio inicializado
- ✅ Prompt del asesor definido
- ⏳ Pendiente: Implementar webhook
- ⏳ Pendiente: Conectar OpenAI
- ⏳ Pendiente: Integrar Meta APIs
- ⏳ Pendiente: Desplegar en Vercel

## 📞 Contacto

**Alpuerta Premiaciones**
- Sitio: trofeosonline.com.mx
- WhatsApp: 33-4363-5939
- Email: rlopezpuerta@trofeosonline.com.mx

---

**Nota de seguridad:** Nunca commitear credenciales reales. Usar solo `.env.example` como plantilla.

