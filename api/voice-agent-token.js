const {
  buildVoiceInstructions,
  createRealtimeClientSecret,
  loadDataset,
  methodNotAllowed,
  readBody,
  requireBlobConfig,
  requireOpenAiConfig,
  sanitizeDatasetId,
  sendJson,
  setCorsHeaders,
} = require("./_voice-agent");

function getRequestedDatasetId(req) {
  const queryValue =
    req.query && typeof req.query === "object"
      ? req.query.dataset || req.query.datasetId || req.query.id
      : "";

  const body = readBody(req);
  return sanitizeDatasetId(queryValue || body.dataset || body.datasetId || body.id || "");
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res, "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    methodNotAllowed(res, "GET, POST, OPTIONS");
    return;
  }

  const blobError = requireBlobConfig();
  if (blobError) {
    sendJson(res, 500, { ok: false, error: blobError });
    return;
  }

  const openAiError = requireOpenAiConfig();
  if (openAiError) {
    sendJson(res, 500, { ok: false, error: openAiError });
    return;
  }

  const datasetId = getRequestedDatasetId(req);
  if (!datasetId || datasetId === "dataset") {
    sendJson(res, 400, { ok: false, error: "Provide dataset or datasetId" });
    return;
  }

  try {
    const dataset = await loadDataset(datasetId);
    if (!dataset) {
      sendJson(res, 404, { ok: false, error: `Dataset not found: ${datasetId}` });
      return;
    }

    const instructions = buildVoiceInstructions(dataset);
    const session = await createRealtimeClientSecret({ instructions });
    const clientSecret =
      session.value ||
      (session.client_secret && session.client_secret.value) ||
      (session.session && session.session.client_secret && session.session.client_secret.value) ||
      "";

    sendJson(res, 200, {
      ok: true,
      dataset: {
        datasetId: dataset.datasetId,
        title: dataset.title,
        summary: dataset.summary,
        updatedAt: dataset.updatedAt,
      },
      clientSecret,
      session,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to create voice session",
    });
  }
};
