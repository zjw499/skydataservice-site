const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const SCHEMA_CACHE_MS = 5 * 60 * 1000;

let cachedSchema = null;
let cachedSchemaExpiresAt = 0;

function parseAllowedOrigins() {
  const raw =
    process.env.ALLOWED_ORIGINS ||
    "https://skydataservice.com,https://www.skydataservice.com,http://localhost:3000,http://127.0.0.1:5500";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function setCorsHeaders(req, res) {
  const allowedOrigins = parseAllowedOrigins();
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin, allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function richText(content) {
  return [{ type: "text", text: { content: String(content || "").slice(0, 1900) } }];
}

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(text) },
  };
}

function normalizeFormType(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value === "audit" || value === "crm integration audit") return "audit";
  return "contact";
}

function normalizeFields(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;

  Object.keys(input).forEach((key) => {
    out[key] = String(input[key] || "").trim();
  });
  return out;
}

function normalizePayload(body) {
  const payload = body && typeof body === "object" ? body : {};
  const fields = normalizeFields(payload.fields && typeof payload.fields === "object" ? payload.fields : payload);

  return {
    formType: normalizeFormType(payload.formType || payload.form_type),
    fields,
    submittedAt: String(payload.submittedAt || payload.submitted_at || new Date().toISOString()),
    pageUrl: String(payload.pageUrl || payload.page_url || ""),
  };
}

function validatePayload(payload) {
  const requiredByForm = {
    contact: ["name", "work_email", "company", "current_crm", "primary_challenge", "timeline", "message"],
    audit: ["name", "work_email", "systems", "failure_points"],
  };

  const required = requiredByForm[payload.formType] || requiredByForm.contact;
  const missing = required.filter((field) => !payload.fields[field]);

  if (missing.length) {
    return {
      ok: false,
      error: `Missing required fields: ${missing.join(", ")}`,
    };
  }

  return { ok: true };
}

async function notionRequest(token, method, apiPath, body) {
  const response = await fetch(`${NOTION_API_BASE}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message = data && data.message ? data.message : response.statusText || "Unknown Notion API error";
    throw new Error(`Notion API ${method} ${apiPath} failed (${response.status}): ${message}`);
  }

  return data;
}

async function getDatabaseSchema(token, databaseId) {
  const now = Date.now();
  if (cachedSchema && now < cachedSchemaExpiresAt) return cachedSchema;

  const schema = await notionRequest(token, "GET", `/databases/${databaseId}`);
  cachedSchema = schema;
  cachedSchemaExpiresAt = now + SCHEMA_CACHE_MS;
  return schema;
}

function getTitlePropertyName(schema) {
  const properties = (schema && schema.properties) || {};
  const name = Object.keys(properties).find((key) => properties[key] && properties[key].type === "title");
  return name || "Name";
}

function hasProperty(schema, name, type) {
  const properties = (schema && schema.properties) || {};
  return Boolean(properties[name] && properties[name].type === type);
}

function setRichTextProperty(properties, schema, propName, value) {
  if (!value) return;
  if (!hasProperty(schema, propName, "rich_text")) return;
  properties[propName] = { rich_text: richText(value) };
}

function buildProperties(schema, payload) {
  const properties = {};
  const titlePropertyName = getTitlePropertyName(schema);
  const titlePrefix = payload.formType === "audit" ? "Audit" : "Discovery";
  const name = payload.fields.name || "Website Lead";
  const title = `${titlePrefix} - ${name}`.slice(0, 180);

  properties[titlePropertyName] = {
    title: richText(title),
  };

  if (hasProperty(schema, "Form Type", "select")) {
    properties["Form Type"] = {
      select: { name: payload.formType === "audit" ? "CRM Integration Audit" : "Discovery Call" },
    };
  }

  if (hasProperty(schema, "Work Email", "email") && payload.fields.work_email) {
    properties["Work Email"] = { email: payload.fields.work_email };
  }

  setRichTextProperty(properties, schema, "Company", payload.fields.company);
  setRichTextProperty(properties, schema, "Current CRM", payload.fields.current_crm);
  setRichTextProperty(properties, schema, "Primary Challenge", payload.fields.primary_challenge);
  setRichTextProperty(properties, schema, "Timeline", payload.fields.timeline);
  setRichTextProperty(properties, schema, "Systems", payload.fields.systems);

  if (hasProperty(schema, "Submitted At", "date")) {
    properties["Submitted At"] = { date: { start: payload.submittedAt } };
  }

  if (hasProperty(schema, "Status", "select")) {
    properties["Status"] = { select: { name: "New" } };
  }

  return properties;
}

function pushIfPresent(lines, label, value) {
  if (!value) return;
  lines.push(`${label}: ${value}`);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (!forwarded) return "";
  return String(forwarded).split(",")[0].trim();
}

function buildChildren(payload, req) {
  const lines = [];

  pushIfPresent(lines, "Form", payload.formType === "audit" ? "CRM Integration Audit" : "Discovery Call");
  pushIfPresent(lines, "Name", payload.fields.name);
  pushIfPresent(lines, "Work Email", payload.fields.work_email);
  pushIfPresent(lines, "Company", payload.fields.company);
  pushIfPresent(lines, "Current CRM", payload.fields.current_crm);
  pushIfPresent(lines, "Primary Challenge", payload.fields.primary_challenge);
  pushIfPresent(lines, "Timeline", payload.fields.timeline);
  pushIfPresent(lines, "Systems", payload.fields.systems);
  pushIfPresent(lines, "Submitted At", payload.submittedAt);
  pushIfPresent(lines, "Source URL", payload.pageUrl);
  pushIfPresent(lines, "Client IP", getClientIp(req));

  const details = payload.formType === "audit" ? payload.fields.failure_points : payload.fields.message;
  const detailLabel = payload.formType === "audit" ? "Top failure points" : "Message";

  const children = lines.map((line) => paragraphBlock(line));
  if (details) {
    children.push(paragraphBlock(`${detailLabel}:`));
    children.push(paragraphBlock(details));
  }

  return children.slice(0, 100);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return {};
    }
  }
  if (typeof req.body === "object") return req.body;
  return {};
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!notionToken || !databaseId) {
    sendJson(res, 500, { ok: false, error: "Server missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    return;
  }

  const payload = normalizePayload(parseBody(req));

  // Honeypot field: if populated, accept silently without writing to Notion.
  if (payload.fields.website) {
    sendJson(res, 202, { ok: true });
    return;
  }

  const validation = validatePayload(payload);
  if (!validation.ok) {
    sendJson(res, 400, { ok: false, error: validation.error });
    return;
  }

  try {
    const schema = await getDatabaseSchema(notionToken, databaseId);
    const properties = buildProperties(schema, payload);
    const children = buildChildren(payload, req);

    const page = await notionRequest(notionToken, "POST", "/pages", {
      parent: { database_id: databaseId },
      properties,
      children,
    });

    sendJson(res, 201, {
      ok: true,
      id: page.id,
      url: page.url,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to create Notion page",
    });
  }
};
