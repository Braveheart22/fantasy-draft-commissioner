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
    const body = JSON.stringify({ teams: [{ id: "t", displayName: "Team", seedOrder: 1 }] });
    const noVersion = await fetch(`${base}/api/setup/s/teams`, { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": "teams-no-version" }, body });
    expect(noVersion.status).toBe(400);
    const tabOne = await fetch(`${base}/api/setup/s/teams`, { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": "teams-tab-one", "x-expected-season-version": "0" }, body });
    expect(tabOne.status).toBe(200);
    const staleTab = await fetch(`${base}/api/setup/s/teams`, { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": "teams-tab-two", "x-expected-season-version": "0" }, body });
    expect(staleTab.status).toBe(500);
    expect(await staleTab.text()).toContain("Stale season version");
    const backupHeaders = { "content-type": "application/json", "idempotency-key": "manual-backup", "x-expected-season-version": "1" };
    const backup = await fetch(`${base}/api/operations/backups`, { method: "POST", headers: backupHeaders, body: JSON.stringify({ seasonId: "s" }) });
    expect(backup.status).toBe(200); const receipt = await backup.json(); expect(receipt.backupId).toBeTruthy();
    const retry = await fetch(`${base}/api/operations/backups`, { method: "POST", headers: backupHeaders, body: JSON.stringify({ seasonId: "s" }) });
    expect(await retry.json()).toMatchObject({ backupId: receipt.backupId, sha256: receipt.sha256 });
    const staleBackup = await fetch(`${base}/api/operations/backups`, { method: "POST", headers: { ...backupHeaders, "idempotency-key": "stale-backup", "x-expected-season-version": "0" }, body: JSON.stringify({ seasonId: "s" }) });
    expect(staleBackup.status).toBe(500);
  });
});
