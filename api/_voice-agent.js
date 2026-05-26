const { get, put } = require("@vercel/blob");

const DATASET_PREFIX = "voice-agent/datasets";
const DEFAULT_ALLOWED_ORIGINS =
  "https://skydataservice.com,https://www.skydataservice.com,http://localhost:3000,http://127.0.0.1:5500";
const DEFAULT_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "marin";

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return {};
  }
}

function parseAllowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function setCorsHeaders(req, res, allowMethods) {
  const origin = req.headers.origin;
  const allowedOrigins = parseAllowedOrigins();

  if (isAllowedOrigin(origin, allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", allowMethods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-voice-agent-admin-key");
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function sendJson(res, status, body) {
  noStore(res);
  res.status(status).json(body);
}

function methodNotAllowed(res, allow) {
  res.setHeader("Allow", allow);
  sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

function getHeader(req, name) {
  const value = req.headers[name] || req.headers[String(name).toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}

function authenticate(req, headerName, envName) {
  const expected = String(process.env[envName] || "").trim();
  if (!expected) {
    return { ok: false, status: 500, error: `Server missing ${envName}` };
  }

  const provided = getHeader(req, headerName).trim();
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return parseJson(req.body);
  if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString("utf8"));
  if (typeof req.body === "object") return req.body;
  return {};
}

function requireBlobConfig() {
  return String(process.env.BLOB_READ_WRITE_TOKEN || "").trim()
    ? null
    : "Server missing BLOB_READ_WRITE_TOKEN";
}

function requireOpenAiConfig() {
  return String(process.env.OPENAI_API_KEY || "").trim()
    ? null
    : "Server missing OPENAI_API_KEY";
}

function sanitizeDatasetId(value) {
  const cleaned = String(value || "dataset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "dataset";
}

function datasetPath(datasetId) {
  return `${DATASET_PREFIX}/${sanitizeDatasetId(datasetId)}.json`;
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeList(input, { maxItems, maxLength }) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => normalizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeQa(input) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      const source = item && typeof item === "object" ? item : {};
      return {
        question: normalizeText(source.question || source.q, 240),
        answer: normalizeText(source.answer || source.a, 700),
      };
    })
    .filter((item) => item.question && item.answer)
    .slice(0, 20);
}

function buildDatasetRecord(body) {
  const source = body && typeof body === "object" ? body : {};
  const datasetId = sanitizeDatasetId(source.datasetId || source.id || source.slug || source.title || "dataset");

  return {
    datasetId,
    title: normalizeText(source.title || datasetId, 120),
    summary: normalizeText(source.summary || source.description, 3200),
    facts: normalizeList(source.facts || source.keyFacts || source.bullets, {
      maxItems: 40,
      maxLength: 260,
    }),
    qa: normalizeQa(source.qa || source.questions || source.examples),
    notes: normalizeList(source.notes || source.caveats || source.disclaimers, {
      maxItems: 20,
      maxLength: 260,
    }),
    agentInstructions: normalizeText(source.agentInstructions || source.instructions, 2000),
    updatedAt: new Date().toISOString(),
  };
}

function validateDatasetRecord(record) {
  if (!record.title) {
    return "A title is required";
  }

  if (!record.summary && !record.facts.length && !record.qa.length) {
    return "Provide at least one of summary, facts, or qa";
  }

  return null;
}

async function saveDataset(record) {
  return put(datasetPath(record.datasetId), JSON.stringify(record, null, 2), {
    access: "private",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

async function loadDataset(datasetId) {
  const result = await get(datasetPath(datasetId), { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const text = await new Response(result.stream).text();
  const data = parseJson(text);
  return data && data.datasetId ? data : null;
}

function buildVoiceInstructions(dataset) {
  const sections = [
    "You are Sky Data Voice, a focused voice agent for a single dataset knowledge pack.",
    "Answer conversationally and briefly first. Expand only when the user asks for depth.",
    "Stay grounded in the supplied dataset. If something is not supported by the dataset, say that clearly instead of guessing.",
  ];

  if (dataset.agentInstructions) {
    sections.push(`Additional guidance:\n${dataset.agentInstructions}`);
  }

  sections.push(`Dataset title: ${dataset.title || dataset.datasetId}`);

  if (dataset.summary) {
    sections.push(`Dataset summary:\n${dataset.summary}`);
  }

  if (Array.isArray(dataset.facts) && dataset.facts.length) {
    sections.push(`Key facts:\n- ${dataset.facts.join("\n- ")}`);
  }

  if (Array.isArray(dataset.qa) && dataset.qa.length) {
    const qaLines = dataset.qa.map((item) => `Q: ${item.question}\nA: ${item.answer}`);
    sections.push(`Known Q&A examples:\n${qaLines.join("\n\n")}`);
  }

  if (Array.isArray(dataset.notes) && dataset.notes.length) {
    sections.push(`Caveats:\n- ${dataset.notes.join("\n- ")}`);
  }

  return sections.join("\n\n").slice(0, 12000);
}

async function createRealtimeClientSecret({ instructions }) {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: String(process.env.VOICE_AGENT_MODEL || DEFAULT_MODEL),
        instructions,
        audio: {
          output: {
            voice: String(process.env.VOICE_AGENT_VOICE || DEFAULT_VOICE),
          },
        },
      },
    }),
  });

  const text = await response.text();
  const data = text ? parseJson(text) : {};

  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : response.statusText || "OpenAI request failed";
    throw new Error(`OpenAI realtime session failed (${response.status}): ${message}`);
  }

  return data;
}

module.exports = {
  authenticate,
  buildDatasetRecord,
  buildVoiceInstructions,
  createRealtimeClientSecret,
  loadDataset,
  methodNotAllowed,
  readBody,
  requireBlobConfig,
  requireOpenAiConfig,
  sanitizeDatasetId,
  saveDataset,
  sendJson,
  setCorsHeaders,
  validateDatasetRecord,
};
