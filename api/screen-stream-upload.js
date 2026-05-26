const {
  MAX_FRAME_BYTES,
  authenticate,
  framePath,
  methodNotAllowed,
  normalizeIso,
  put,
  readBody,
  requireBlobConfig,
  sanitizeId,
  sendJson,
  trimFramesForDisplay,
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
  const displayId = sanitizeId(body.displayId, "display");
  const imageBase64 = String(body.imageBase64 || "");
  const contentType = String(body.contentType || "image/jpeg").toLowerCase();

  if (!imageBase64) {
    sendJson(res, 400, { ok: false, error: "imageBase64 is required" });
    return;
  }

  if (contentType !== "image/jpeg") {
    sendJson(res, 400, { ok: false, error: "Only image/jpeg frames are supported" });
    return;
  }

  let bytes;
  try {
    bytes = Buffer.from(imageBase64, "base64");
  } catch (_err) {
    sendJson(res, 400, { ok: false, error: "imageBase64 is not valid base64" });
    return;
  }

  if (!bytes.length) {
    sendJson(res, 400, { ok: false, error: "Decoded frame was empty" });
    return;
  }

  if (bytes.length > MAX_FRAME_BYTES) {
    sendJson(res, 413, {
      ok: false,
      error: `Frame exceeds ${MAX_FRAME_BYTES} bytes. Lower MaxWidth or JpegQuality.`,
    });
    return;
  }

  const capturedAt = normalizeIso(body.capturedAt);

  try {
    const blob = await put(framePath(sessionId, displayId, capturedAt), bytes, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });

    await trimFramesForDisplay(sessionId, displayId);

    sendJson(res, 201, {
      ok: true,
      pathname: blob.pathname,
      uploadedAt: capturedAt,
      size: bytes.length,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to upload frame",
    });
  }
};
