import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCommissionerServer } from "../src/server/startup.js";
import { DemoService } from "../src/application/demo/demo-service.js";
import type { SetupService } from "../src/application/setup/setup-service.js";

const servers: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.stop(); });

async function startDemo() {
  const [{ DemoService }, { registerDemoRoutes }] = await Promise.all([
    import("../src/application/demo/demo-service.js"),
    import("../src/routes/demo/demo-routes.js"),
  ]);
  const server = await startCommissionerServer({
    port: 0,
    dataDirectory: await mkdtemp(join(tmpdir(), "u12-demo-")),
    registerProfileRoutes: async (app, services) => registerDemoRoutes(app, new DemoService(services.setup)),
  });
  servers.push(server);
  return `http://${server.address.host}:${server.address.port}`;
}

async function sourceDependencies(entry: URL) {
  const seen = new Set<string>();
  async function visit(path: string) {
    path = resolve(path);
    if (seen.has(path)) return;
    seen.add(path);
    const source = await readFile(path, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const candidate = resolve(dirname(path), match[1]!.replace(/\.js$/, extname(path)));
      await visit(candidate);
    }
  }
  await visit(entry.pathname.replace(/^\/(.:\/)/, "$1"));
  return [...seen].map(path => path.replaceAll("\\", "/"));
}

describe("production and demo isolation", () => {
  it("keeps production source and UI free of demo dependencies and sample actions", async () => {
    const [startup, main] = await Promise.all([
      readFile(new URL("../src/server/startup.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/ui/setup/main.jsx", import.meta.url), "utf8"),
    ]);
    expect(startup).not.toMatch(/application\/demo|routes\/demo|ui\/demo/);
    expect(await sourceDependencies(new URL("../src/server/main.ts", import.meta.url))).not.toEqual(expect.arrayContaining([expect.stringMatching(/\/demo\//)]));
    for (const text of ["Create two-team season", "Add teams", "Add Eddie Gallagher", "Import sample NFL players", "Set $1 floors", "/api/demo/"]) expect(main).not.toContain(text);
  });

  it("does not expose demo routes from production startup", async () => {
    const server = await startCommissionerServer({ port: 0, dataDirectory: await mkdtemp(join(tmpdir(), "u12-production-")) }); servers.push(server);
    const response = await fetch(`http://${server.address.host}:${server.address.port}/api/demo/seasons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset: "PREPARED" }) });
    expect(response.status).toBe(404);
    expect((await fetch(`http://${server.address.host}:${server.address.port}/demo`)).status).toBe(404);
  });

  it("uses a separate entry that dynamically imports demo-only registration", async () => {
    const source = await readFile(new URL("../src/server/demo-main.ts", import.meta.url), "utf8");
    expect(source).toContain('await import("../routes/demo/demo-routes.js")');
    expect(source).toContain("startCommissionerServer");
  });

  it("creates deterministic audited demo data through normal commands and reruns idempotently", async () => {
    const base = await startDemo();
    const create = () => fetch(`${base}/api/demo/seasons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seasonId: "repeatable", preset: "AUCTION_READY" }) });
    const partial = await fetch(`${base}/api/demo/seasons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seasonId: "repeatable", preset: "EMPTY" }) });
    expect((await partial.json()).teams).toEqual([]);
    const firstResponse = await create();
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.season).toMatchObject({ id: "repeatable", leagueId: "demo-league-repeatable", state: "KEEPERS_LOCKED" });
    expect(first.teams.map((team: { displayName: string }) => team.displayName)).toEqual(["Alpha", "Beta"]);
    expect(first.players.map((player: { name: string }) => player.name).sort()).toEqual(["Eddie Gallagher", "Justin Jefferson"]);
    const operations = await (await fetch(`${base}/api/operations/repeatable?pageSize=100`)).json();
    expect(operations.timeline.items.map((item: { commandType: string }) => item.commandType)).toEqual(expect.arrayContaining(["CREATE_SEASON", "CONFIGURE_TEAMS", "ADD_CUSTOM_PLAYER", "COMMIT_IMPORT", "SET_PRICE_FLOORS", "LOCK_KEEPERS"]));
    const secondResponse = await create();
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual(first);
  });

  it("refuses to overwrite production data and rejects unknown presets", async () => {
    const base = await startDemo();
    const production = await fetch(`${base}/api/setup/seasons`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "production-create" }, body: JSON.stringify({ seasonId: "owned", leagueId: "demo-league-owned", year: 2026, name: "Real", teamCount: 2 }) });
    expect(production.status).toBe(200);
    const conflict = await fetch(`${base}/api/demo/seasons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seasonId: "owned", preset: "EMPTY" }) });
    expect(conflict.status).toBe(409);
    const invalid = await fetch(`${base}/api/demo/seasons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset: "SURPRISE" }) });
    expect(invalid.status).toBe(400);
    const summary = await fetch(`${base}/api/setup/owned`);
    expect((await summary.json()).season).toMatchObject({ leagueId: "demo-league-owned", rowVersion: 0 });
  });

  it("serves demo UI only from the explicit profile", async () => {
    const base = await startDemo();
    const response = await fetch(`${base}/demo`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Create prepared demo season");
  });

  it("fails closed when the existing-season read fails", async () => {
    const createSeason = vi.fn();
    const setup = { summary: vi.fn().mockRejectedValue(new Error("database unavailable")), createSeason } as unknown as SetupService;
    await expect(new DemoService(setup).create({ seasonId: "unsafe" })).rejects.toThrow("database unavailable");
    expect(createSeason).not.toHaveBeenCalled();
  });
});
