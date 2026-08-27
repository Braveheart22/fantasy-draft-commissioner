import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { deriveAvailability } from "../../src/application/catalog/catalog-service.js";
import { openSeasonStore } from "../../src/infrastructure/sqlite/season-store.js";

const actor = { type: "LOCAL_COMMISSIONER", label: "Commissioner" } as const;

describe("catalog availability", () => {
  it.each([
    [{ owned: true, leagueSelectable: false, providerActive: false }, "OWNED"],
    [{ owned: false, leagueSelectable: false, providerActive: false }, "LEAGUE_DISABLED"],
    [{ owned: false, leagueSelectable: true, providerActive: false }, "CATALOG_INACTIVE"],
    [{ owned: false, leagueSelectable: true, providerActive: true }, "AVAILABLE"],
  ] as const)("uses fixed blocking precedence for %o", (facts, reason) => {
    expect(deriveAvailability(facts)).toEqual({ available: reason === "AVAILABLE", reason });
  });

  it("persists searchable custom facts without requiring a provider alias", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "commissioner-catalog-")), "season.db");
    const store = await openSeasonStore(path);
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx =>
      tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }),
    );
    await store.addCustomPlayer({ actor, seasonId: "s", idempotencyKey: "custom", commandType: "ADD_CUSTOM_PLAYER", expectedVersion: 0 }, {
      id: "eddie", name: "Éddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM",
    });

    expect(await store.catalogPlayers(actor, "s", { search: "eddie gallagher" })).toEqual([
      expect.objectContaining({ id: "eddie", normalizedSearchText: "eddie gallagher", aliases: [], reason: "AVAILABLE", available: true }),
    ]);
    await expect(store.assertAvailabilityConsistency("s")).resolves.toBeUndefined();
    await store.close();
  });

  it("reads normalized NFL facts, free agents, DST, and immutable aliases from SQLite", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "commissioner-catalog-")), "season.db");
    const store = await openSeasonStore(path);
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx =>
      tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }),
    );
    await store.close();
    const database = new Database(path);
    database.prepare("INSERT INTO Player(id,seasonId,name,position,sourceType,nflTeam,providerStatus,providerActive,leagueSelectable,normalizedSearchText,custom,available,keeperEligible,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
      .run("dst", "s", "Seattle Seahawks", "DST", "NFL", null, "ACTIVE", 1, 1, "seattle seahawks", 0, 1, 0);
    database.prepare("INSERT INTO PlayerSourceAlias(id,seasonId,playerId,sourceNamespace,sourceId) VALUES(?,?,?,?,?)").run("alias", "s", "dst", "sleeper", "SEA");
    expect(() => database.prepare("INSERT INTO PlayerSourceAlias(id,seasonId,playerId,sourceNamespace,sourceId) VALUES(?,?,?,?,?)").run("collision", "s", "dst", "sleeper", "OTHER")).toThrow(/unique/i);
    database.prepare("INSERT INTO Player(id,seasonId,name,position,sourceType,providerStatus,providerActive,leagueSelectable,normalizedSearchText,custom,available,keeperEligible,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
      .run("other", "s", "Other Defense", "DST", "NFL", "ACTIVE", 1, 1, "other defense", 0, 1, 0);
    expect(() => database.prepare("INSERT INTO PlayerSourceAlias(id,seasonId,playerId,sourceNamespace,sourceId) VALUES(?,?,?,?,?)").run("shared", "s", "other", "sleeper", "SEA")).toThrow(/unique/i);
    database.close();

    const reopened = await openSeasonStore(path);
    expect(await reopened.catalogPlayers(actor, "s", { search: "Seattle", position: "dst" })).toEqual([
      expect.objectContaining({ id: "dst", position: "DST", aliases: [{ sourceNamespace: "sleeper", sourceId: "SEA" }] }),
    ]);
    await reopened.close();
  });

  it("detects a compatibility projection contradiction", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "commissioner-catalog-")), "season.db");
    let store = await openSeasonStore(path);
    await store.execute({ actor, seasonId: "s", idempotencyKey: "create", commandType: "CREATE_SEASON" }, tx =>
      tx.createSeason({ id: "s", leagueId: "l", year: 2026, name: "Season", teamCount: 1 }),
    );
    await store.addCustomPlayer({ actor, seasonId: "s", idempotencyKey: "custom", commandType: "ADD_CUSTOM_PLAYER", expectedVersion: 0 }, { id: "p", name: "Player", position: "K", sourceType: "LEAGUE_CUSTOM" });
    await store.close();
    const database = new Database(path); database.prepare("UPDATE Player SET available=0 WHERE id='p'").run(); database.close();
    store = await openSeasonStore(path);
    await expect(store.assertAvailabilityConsistency("s")).rejects.toThrow(/inconsistent.*p/i);
    await store.close();
  });
});
