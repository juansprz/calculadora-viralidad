// server.js
// Backend para la Calculadora de Viralidad - LA GUARIDA
// Despliega esto en Railway. No subas tu API key al código, va en variables de entorno.

const express = require("express");
const cors = require("cors");

const app = express();

// CORS explícito: permite peticiones desde cualquier origen (incluyendo el iframe de Artifacts de Claude.ai)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-access-key"],
}));
// Responde explícitamente a las peticiones OPTIONS (preflight) para todas las rutas
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));

// ====== VARIABLES DE ENTORNO (configúralas en Railway, NO aquí) ======
// ANTHROPIC_API_KEY   -> tu API key de Anthropic
// ACCESS_KEY          -> la clave compartida que usará tu equipo
// DAILY_LIMIT         -> límite de evaluaciones por día para TODO el equipo (ej: 100)
// PORT                -> Railway la define automáticamente

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ACCESS_KEY = process.env.ACCESS_KEY;
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT || "100", 10);

if (!ANTHROPIC_API_KEY || !ACCESS_KEY) {
  console.error("FALTAN variables de entorno: ANTHROPIC_API_KEY y/o ACCESS_KEY");
  process.exit(1);
}

// ====== Contador simple de uso diario en memoria ======
// Nota: esto se reinicia si el servidor se reinicia. Para algo más robusto a futuro,
// se puede mover a una base de datos (ej. Supabase), pero para 2-5 personas esto es suficiente.
let usageCount = 0;
let usageDate = new Date().toDateString();

function checkAndIncrementUsage() {
  const today = new Date().toDateString();
  if (today !== usageDate) {
    usageDate = today;
    usageCount = 0;
  }
  if (usageCount >= DAILY_LIMIT) {
    return false;
  }
  usageCount++;
  return true;
}

// ====== Middleware de autenticación simple ======
function checkAccess(req, res, next) {
  const key = req.headers["x-access-key"];
  if (!key || key !== ACCESS_KEY) {
    return res.status(401).json({ error: "Acceso no autorizado. Clave inválida o faltante." });
  }
  next();
}

// ====== Endpoint de salud (para verificar que el servidor está vivo) ======
app.get("/health", (req, res) => {
  res.json({ status: "ok", usageToday: usageCount, limit: DAILY_LIMIT });
});

// ====== Endpoint para verificar la clave de acceso (login) ======
app.post("/verificar-acceso", checkAccess, (req, res) => {
  res.json({ ok: true, usageToday: usageCount, limit: DAILY_LIMIT });
});

// ====== Endpoint principal: evaluar idea ======
app.post("/evaluar", checkAccess, async (req, res) => {
  const { idea, formato, refViral } = req.body;

  if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
    return res.status(400).json({ error: "La idea es requerida y debe tener al menos 5 caracteres." });
  }
  if (!formato || typeof formato !== "string") {
    return res.status(400).json({ error: "El formato es requerido." });
  }
  if (typeof refViral !== "boolean") {
    return res.status(400).json({ error: "refViral debe ser true o false." });
  }

  if (!checkAndIncrementUsage()) {
    return res.status(429).json({
      error: `Se alcanzó el límite diario de ${DAILY_LIMIT} evaluaciones para el equipo. Intenta de nuevo mañana.`,
    });
  }

  const prompt = `Eres un experto en contenido viral y marketing orgánico. Evalúa la siguiente idea de contenido con criterios ESTRICTOS. La fecha actual es ${new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" })}.

IDEA: "${idea.trim()}"
FORMATO: ${formato}

Evalúa estos 5 criterios. Usa la herramienta de búsqueda web SOLO para el criterio de tendencia (verifica si el tema está siendo hablado AHORA en noticias o redes).

1. FILTRO 5 AÑOS (0 a 2.0 puntos): ¿Un niño de 5 años entendería esta idea/temática? Si es totalmente simple y universal: 2.0. Si requiere algo de contexto: 0.5-1.5. Si es técnica o de nicho: 0.
2. FILTRO 100 PERSONAS (0 a 2.0 puntos): Si le cuentas esta idea a 100 personas random (viejos, jóvenes, hombres, mujeres, de todo), ¿a cuántos les interesaría? Interés masivo: 2.0. Interés parcial: 0.5-1.5. Solo nicho: 0.
3. MERCADO VIRAL (0 o 1.5 puntos): ¿Pertenece claramente a Salud, Sexo (ligar, relaciones, comunicación), Dinero o Desarrollo personal? Si sí: 1.5. Si es tangencial: 0.5-1.0. Si no: 0.
4. TENDENCIA (0 a 1.5 puntos): BUSCA EN LA WEB si esta temática está en tendencia o en noticias AHORA. Tendencia fuerte actual: 1.5. Algo de conversación: 0.5-1.0. No es tendencia: 0.
5. CONTROVERSIA (0 a 1.5 puntos): ¿La idea genera controversia o va contra una creencia popular? Muy controversial: 1.5. Algo polémica: 0.5-1.0. Neutral/segura: 0.

Sé estricto y realista. La mayoría de ideas NO son virales. No regales puntos.

Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin backticks, sin texto antes ni después, con esta estructura exacta:
{
  "c1a": {"puntos": 0.0, "justificacion": "máx 25 palabras"},
  "c1b": {"puntos": 0.0, "justificacion": "máx 25 palabras"},
  "c3": {"puntos": 0.0, "justificacion": "máx 25 palabras"},
  "c4": {"puntos": 0.0, "justificacion": "máx 25 palabras"},
  "c5": {"puntos": 0.0, "justificacion": "máx 25 palabras"},
  "sugerencias": ["sugerencia 1 para subir puntaje", "sugerencia 2", "sugerencia 3"]
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Error de Anthropic API:", errText);
      return res.status(502).json({ error: "Error al contactar el servicio de IA." });
    }

    const data = await response.json();
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const clean = text.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "Respuesta inválida de la IA." });
    }

    const evalIA = JSON.parse(jsonMatch[0]);
    return res.json({ evaluacion: evalIA, usageToday: usageCount, limit: DAILY_LIMIT });
  } catch (e) {
    console.error("Error procesando evaluación:", e);
    return res.status(500).json({ error: "Error interno evaluando la idea." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
