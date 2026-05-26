const {
  authenticate,
  buildDatasetRecord,
  methodNotAllowed,
  readBody,
  requireBlobConfig,
  saveDataset,
  sendJson,
  setCorsHeaders,
  validateDatasetRecord,
} = require("./_voice-agent");

module.exports = async (req, res) => {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    methodNotAllowed(res, "POST, OPTIONS");
    return;
  }

  const auth = authenticate(req, "x-voice-agent-admin-key", "VOICE_AGENT_ADMIN_KEY");
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  const blobError = requireBlobConfig();
  if (blobError) {
    sendJson(res, 500, { ok: false, error: blobError });
    return;
  }

  const dataset = buildDatasetRecord(readBody(req));
  const validationError = validateDatasetRecord(dataset);
  if (validationError) {
    sendJson(res, 400, { ok: false, error: validationError });
    return;
  }

  try {
    const blob = await saveDataset(dataset);
    sendJson(res, 201, {
      ok: true,
      datasetId: dataset.datasetId,
      title: dataset.title,
      pathname: blob.pathname,
      updatedAt: dataset.updatedAt,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to save dataset",
    });
  }
};
