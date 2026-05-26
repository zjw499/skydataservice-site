const {
  authenticate,
  manifestPath,
  methodNotAllowed,
  normalizeDisplays,
  normalizeIso,
  put,
  readBody,
  requireBlobConfig,
  sanitizeId,
  sendJson,
  trimSessions,
} = require("./_screen-stream");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    return;
  }

  const auth = authenticate(req, "x-screen-stream-upload-key", "SCREEN_STREAM_UPLOAD_KEY");
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  const blobError = requireBlobConfig();
  if (blobError) {
    sendJson(res, 500, { ok: false, error: blobError });
    return;
  }

  const body = readBody(req);
  const sessionId = sanitizeId(body.sessionId, "session");
  const displays = normalizeDisplays(body.displays);

  if (!displays.length) {
    sendJson(res, 400, { ok: false, error: "At least one display is required" });
    return;
  }

  const startedAt = normalizeIso(body.startedAt);
  const machineName = String(body.machineName || "unknown-machine").slice(0, 120);
  const manifest = {
    sessionId,
    startedAt,
    machineName,
    intervalMs: Math.max(250, Number(body.intervalMs || 1250)),
    maxWidth: Math.max(640, Number(body.maxWidth || 1280)),
    jpegQuality: Math.min(90, Math.max(35, Number(body.jpegQuality || 55))),
    displays,
  };

  try {
    const blob = await put(manifestPath(sessionId), JSON.stringify(manifest), {
      access: "private",
      contentType: "application/json; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });

    await trimSessions();

    sendJson(res, 201, {
      ok: true,
      sessionId,
      startedAt,
      pathname: blob.pathname,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to register session",
    });
  }
};
