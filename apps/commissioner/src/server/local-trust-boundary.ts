import type { FastifyInstance } from "fastify";

const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function registerLocalTrustBoundary(server: FastifyInstance) {
  server.addHook("onRequest", async request => {
    const rawHost = request.headers.host;
    if (!rawHost) throw Object.assign(new Error("Trusted loopback Host header is required"), { statusCode: 403 });
    let host: URL;
    try { host = new URL(`http://${rawHost}`); } catch { throw Object.assign(new Error("Invalid Host header"), { statusCode: 403 }); }
    if (!LOOPBACK_NAMES.has(host.hostname)) throw Object.assign(new Error("Host is not trusted for the local commissioner server"), { statusCode: 403 });
    const rawOrigin = request.headers.origin;
    if (rawOrigin) {
      let origin: URL;
      try { origin = new URL(rawOrigin); } catch { throw Object.assign(new Error("Invalid Origin header"), { statusCode: 403 }); }
      if (!LOOPBACK_NAMES.has(origin.hostname) || origin.port !== host.port) throw Object.assign(new Error("Origin does not match the local commissioner server"), { statusCode: 403 });
    }
  });
}
