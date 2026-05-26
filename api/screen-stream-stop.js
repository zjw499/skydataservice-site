const {
  authenticate,
  methodNotAllowed,
  normalizeIso,
  put,
  readBody,
  requireBlobConfig,
  sanitizeId,
  sendJson,
  stopPath,
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
  const stoppedAt = normalizeIso(body.stoppedAt);

  try {
    await put(
      stopPath(sessionId, stoppedAt),
      JSON.stringify({
        sessionId,
        stoppedAt,
      }),
      {
        access: "private",
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      }
    );

    sendJson(res, 200, { ok: true, sessionId, stoppedAt });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to stop session",
    });
  }
};
