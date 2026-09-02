import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrateDatabaseInPlace } from "../../src/infrastructure/sqlite/migrations.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

it("migrates populated schema 10 floors without losing values and permits one active lineage row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "u10-schema-11-")); directories.push(directory);
  const path = join(directory, "commissioner.db"); migrateDatabaseInPlace(path);
  let database = new Database(path);
  database.exec(`
    INSERT INTO League(id,name) VALUES('league','League');
    INSERT INTO Season(id,leagueId,year,name,state,teamCount,rowVersion,active,createdAt,updatedAt) VALUES('season','league',2026,'Season','SETUP',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    DROP INDEX PositionPriceFloor_active_position;
    CREATE TABLE PositionPriceFloor_schema10 (id TEXT NOT NULL PRIMARY KEY, seasonId TEXT NOT NULL, position TEXT NOT NULL, minimumBid INTEGER NOT NULL CHECK(minimumBid > 0), FOREIGN KEY (seasonId) REFERENCES Season(id));
    INSERT INTO PositionPriceFloor_schema10(id,seasonId,position,minimumBid) VALUES('qb-floor','season','QB',7),('rb-floor','season','RB',4);
    DROP TABLE PositionPriceFloor;
    ALTER TABLE PositionPriceFloor_schema10 RENAME TO PositionPriceFloor;
    UPDATE SchemaMetadata SET version=10 WHERE singleton=1;
  `);
  database.close();

  migrateDatabaseInPlace(path);
  database = new Database(path);
  expect(database.prepare("SELECT version FROM SchemaMetadata WHERE singleton=1").pluck().get()).toBe(11);
  expect(database.prepare("SELECT id,position,minimumBid,supersededAt FROM PositionPriceFloor ORDER BY position").all()).toEqual([
    { id: "qb-floor", position: "QB", minimumBid: 7, supersededAt: null },
    { id: "rb-floor", position: "RB", minimumBid: 4, supersededAt: null },
  ]);
  expect(() => database.prepare("INSERT INTO PositionPriceFloor(id,seasonId,position,minimumBid) VALUES('duplicate','season','QB',9)").run()).toThrow(/unique/i);
  database.prepare("UPDATE PositionPriceFloor SET supersededAt=CURRENT_TIMESTAMP WHERE id='qb-floor'").run();
  database.prepare("INSERT INTO PositionPriceFloor(id,seasonId,position,minimumBid) VALUES('replacement','season','QB',9)").run();
  expect(database.prepare("SELECT id,minimumBid FROM PositionPriceFloor WHERE seasonId='season' AND position='QB' AND supersededAt IS NULL").get()).toEqual({ id: "replacement", minimumBid: 9 });
  expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(database.pragma("foreign_key_check")).toEqual([]);
  database.close();
});
