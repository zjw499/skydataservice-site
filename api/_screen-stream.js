const { del, get, list, put } = require("@vercel/blob");

const STREAM_PREFIX = "screen-stream";
const SESSION_STALE_MS = 15 * 1000;
const MAX_FRAMES_PER_DISPLAY = 3;
const MAX_SESSIONS = 20;
const MAX_FRAME_BYTES = 3_400_000;

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

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return parseJson(req.body);
  if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString("utf8"));
  if (typeof req.body === "object") return req.body;
  return {};
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return {};
  }
}

function getHeader(req, name) {
  const value = req.headers[name] || req.headers[String(name).toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}

function authenticate(req, headerName, envName) {
  const expected = String(process.env[envName] || "");
  if (!expected) {
    return { ok: false, status: 500, error: `Server missing ${envName}` };
  }

  const provided = getHeader(req, headerName).trim();
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

function requireBlobConfig() {
  return String(process.env.BLOB_READ_WRITE_TOKEN || "")
    ? null
    : "Server missing BLOB_READ_WRITE_TOKEN";
}

function sanitizeId(value, fallback) {
  const cleaned = String(value || fallback || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || String(fallback || "item");
}

function normalizeIso(value, fallback) {
  const date = value ? new Date(value) : fallback instanceof Date ? fallback : new Date();
  if (Number.isNaN(date.getTime())) {
    return normalizeIso(fallback instanceof Date ? fallback.toISOString() : fallback || new Date().toISOString());
  }

  return date.toISOString();
}

function timestampSegment(value) {
  return normalizeIso(value).replace(/[:.]/g, "-");
}

function manifestPath(sessionId) {
  return `${STREAM_PREFIX}/sessions/${sanitizeId(sessionId, "session")}.json`;
}

function stopPath(sessionId, stoppedAt) {
  return `${STREAM_PREFIX}/stops/${sanitizeId(sessionId, "session")}/${timestampSegment(stoppedAt)}.json`;
}

function framePrefix(sessionId, displayId) {
  return `${STREAM_PREFIX}/frames/${sanitizeId(sessionId, "session")}/${sanitizeId(displayId, "display")}/`;
}

function framePath(sessionId, displayId, capturedAt) {
  return `${framePrefix(sessionId, displayId)}${timestampSegment(capturedAt)}.jpg`;
}

function compareByLatest(a, b) {
  const aTime = new Date(a.uploadedAt).getTime();
  const bTime = new Date(b.uploadedAt).getTime();
  if (bTime !== aTime) return bTime - aTime;
  return String(b.pathname || "").localeCompare(String(a.pathname || ""));
}

function pickLatestBlob(blobs) {
  if (!Array.isArray(blobs) || !blobs.length) return null;
  return blobs.slice().sort(compareByLatest)[0];
}

async function listAllBlobs(prefix, limit) {
  const blobs = [];
  let cursor;
  let hasMore = true;

  while (hasMore) {
    const result = await list({
      prefix,
      cursor,
      limit: Math.min(1000, limit || 1000),
    });

    blobs.push(...(result.blobs || []));
    hasMore = Boolean(result.hasMore);
    cursor = result.cursor;

    if (limit && blobs.length >= limit) {
      return blobs.slice(0, limit);
    }
  }

  return blobs;
}

async function readPrivateJson(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const text = await new Response(result.stream).text();
  return parseJson(text);
}

async function readPrivateBinary(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    blob: result.blob,
    headers: result.headers,
  };
}

async function trimFramesForDisplay(sessionId, displayId) {
  const blobs = await listAllBlobs(framePrefix(sessionId, displayId), MAX_FRAMES_PER_DISPLAY + 12);
  if (blobs.length <= MAX_FRAMES_PER_DISPLAY) return;

  const extras = blobs.slice().sort(compareByLatest).slice(MAX_FRAMES_PER_DISPLAY);
  if (extras.length) {
    await del(extras.map((blob) => blob.pathname));
  }
}

async function pruneSession(sessionId) {
  const frameBlobs = await listAllBlobs(`${STREAM_PREFIX}/frames/${sanitizeId(sessionId, "session")}/`);
  if (frameBlobs.length) {
    await del(frameBlobs.map((blob) => blob.pathname));
  }

  const stopBlobs = await listAllBlobs(`${STREAM_PREFIX}/stops/${sanitizeId(sessionId, "session")}/`);
  if (stopBlobs.length) {
    await del(stopBlobs.map((blob) => blob.pathname));
  }
}

async function trimSessions() {
  const manifests = await listAllBlobs(`${STREAM_PREFIX}/sessions/`, MAX_SESSIONS + 20);
  if (manifests.length <= MAX_SESSIONS) return;

  const staleManifests = manifests.slice().sort(compareByLatest).slice(MAX_SESSIONS);
  for (const blob of staleManifests) {
    const sessionId = String(blob.pathname || "")
      .split("/")
      .pop()
      .replace(/\.json$/i, "");

    await pruneSession(sessionId);
  }

  await del(staleManifests.map((blob) => blob.pathname));
}

async function getLatestSessionRecord() {
  const manifests = await listAllBlobs(`${STREAM_PREFIX}/sessions/`, MAX_SESSIONS + 20);
  if (!manifests.length) return null;

  const sorted = manifests.slice().sort(compareByLatest);
  for (const blob of sorted) {
    const manifest = await readPrivateJson(blob.pathname);
    if (manifest && manifest.sessionId) {
      return { blob, manifest };
    }
  }

  return null;
}

async function sessionHasStopMarker(sessionId) {
  const stops = await listAllBlobs(`${STREAM_PREFIX}/stops/${sanitizeId(sessionId, "session")}/`, 1);
  return stops.length > 0;
}

async function getLatestFrames(sessionId, displays) {
  const items = [];

  for (const display of displays || []) {
    const displayId = sanitizeId(display.id, "display");
    const blobs = await listAllBlobs(framePrefix(sessionId, displayId), MAX_FRAMES_PER_DISPLAY + 2);
    const latest = pickLatestBlob(blobs);
    if (!latest) continue;

    items.push({
      id: displayId,
      label: String(display.label || displayId),
      width: Number(display.width || 0),
      height: Number(display.height || 0),
      left: Number(display.left || 0),
      top: Number(display.top || 0),
      primary: Boolean(display.primary),
      pathname: latest.pathname,
      uploadedAt: new Date(latest.uploadedAt).toISOString(),
      size: Number(latest.size || 0),
    });
  }

  return items;
}

function normalizeDisplays(input) {
  if (!Array.isArray(input)) return [];

  return input
    .map((display, index) => {
      const source = display && typeof display === "object" ? display : {};
      const id = sanitizeId(source.id || `display-${index}`, `display-${index}`);

      return {
        id,
        label: String(source.label || `Display ${index + 1}`).slice(0, 120),
        width: Number(source.width || 0),
        height: Number(source.height || 0),
        left: Number(source.left || 0),
        top: Number(source.top || 0),
        primary: Boolean(source.primary),
      };
    })
    .filter((display) => display.width > 0 && display.height > 0);
}

module.exports = {
  put,
  get,
  list,
  del,
  MAX_FRAME_BYTES,
  SESSION_STALE_MS,
  STREAM_PREFIX,
  authenticate,
  framePath,
  framePrefix,
  getLatestFrames,
  getLatestSessionRecord,
  manifestPath,
  methodNotAllowed,
  normalizeDisplays,
  normalizeIso,
  noStore,
  pickLatestBlob,
  readBody,
  readPrivateBinary,
  readPrivateJson,
  requireBlobConfig,
  sanitizeId,
  sendJson,
  sessionHasStopMarker,
  stopPath,
  timestampSegment,
  trimFramesForDisplay,
  trimSessions,
};
