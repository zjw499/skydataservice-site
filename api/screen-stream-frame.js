const {
  authenticate,
  methodNotAllowed,
  noStore,
  readPrivateBinary,
  requireBlobConfig,
  sendJson,
} = require("./_screen-stream");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    methodNotAllowed(res, "GET");
    return;
  }

  const auth = authenticate(req, "x-screen-stream-view-key", "SCREEN_STREAM_VIEW_KEY");
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  const blobError = requireBlobConfig();
  if (blobError) {
    sendJson(res, 500, { ok: false, error: blobError });
    return;
  }

  const pathname = String((req.query && req.query.pathname) || "");
  if (!pathname.startsWith("screen-stream/frames/")) {
    sendJson(res, 400, { ok: false, error: "Invalid pathname" });
    return;
  }

  try {
    const result = await readPrivateBinary(pathname);
    if (!result) {
      sendJson(res, 404, { ok: false, error: "Frame not found" });
      return;
    }

    noStore(res);
    res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(result.bytes.length));
    res.status(200).end(result.bytes);
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to read frame",
    });
  }
};
