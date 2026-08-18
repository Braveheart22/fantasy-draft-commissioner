import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCommissionerServer } from "../../src/server/startup.js";

describe("setup HTTP delivery", () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => stop?.());
  it("reaches setup summary through delivery and rejects missing idempotency", async () => {
    const server = await startCommissionerServer({ port: 0, dataDirectory: await mkdtemp(join(tmpdir(), "commissioner-http-")) });
    stop = server.stop;
    const base = `http://${server.address.host}:${server.address.port}`;
    const missing = await fetch(`${base}/api/setup/seasons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seasonId: "s", leagueId: "l", year: 2026, name: "S", teamCount: 1 }) });
    expect(missing.status).toBe(400);
    const created = await fetch(`${base}/api/setup/seasons`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "create" }, body: JSON.stringify({ seasonId: "s", leagueId: "l", year: 2026, name: "S", teamCount: 1 }) });
    expect(created.status).toBe(200);
    const summary = await fetch(`${base}/api/setup/s`).then(response => response.json());
    expect(summary.season).toMatchObject({ id: "s", state: "SETUP", teamCount: 1 });
  });
});
