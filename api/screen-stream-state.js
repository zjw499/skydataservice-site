const {
  SESSION_STALE_MS,
  authenticate,
  getLatestFrames,
  getLatestSessionRecord,
  methodNotAllowed,
  requireBlobConfig,
  sendJson,
  sessionHasStopMarker,
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

  try {
    const latestSession = await getLatestSessionRecord();
    if (!latestSession) {
      sendJson(res, 200, {
        ok: true,
        active: false,
        staleAfterMs: SESSION_STALE_MS,
        displays: [],
      });
      return;
    }

    const { manifest } = latestSession;
    const displays = await getLatestFrames(manifest.sessionId, manifest.displays);
    const lastSeenAt = displays.reduce((latest, display) => {
      const current = new Date(display.uploadedAt).getTime();
      return current > latest ? current : latest;
    }, 0);

    const stopped = await sessionHasStopMarker(manifest.sessionId);
    const active = Boolean(lastSeenAt) && !stopped && Date.now() - lastSeenAt <= SESSION_STALE_MS;

    sendJson(res, 200, {
      ok: true,
      active,
      staleAfterMs: SESSION_STALE_MS,
      sessionId: manifest.sessionId,
      machineName: manifest.machineName,
      startedAt: manifest.startedAt,
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
      intervalMs: manifest.intervalMs || 1250,
      displays: active ? displays : [],
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Failed to read stream state",
    });
  }
};
