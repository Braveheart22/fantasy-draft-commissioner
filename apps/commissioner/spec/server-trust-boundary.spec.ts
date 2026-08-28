import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerLocalTrustBoundary } from "../src/server/local-trust-boundary.js";

describe("local HTTP trust boundary", () => {
  it("accepts matching loopback requests and rejects hostile Host and Origin headers", async () => {
    const server = Fastify(); registerLocalTrustBoundary(server); server.post("/command", async () => ({ ok: true }));
    expect((await server.inject({ method: "POST", url: "/command", headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/command", headers: { host: "attacker.example:4173" } })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: "/command", headers: { host: "127.0.0.1:4173", origin: "https://attacker.example" } })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: "/command", headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:9999" } })).statusCode).toBe(403);
    await server.close();
  });
});
