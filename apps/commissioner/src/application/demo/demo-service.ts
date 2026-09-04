import { randomUUID } from "node:crypto";
import type { SetupService } from "../setup/setup-service.js";
import type { CommandMetadata } from "../ports/season-repository.js";

export type DemoPreset = "EMPTY" | "SETUP" | "PREPARED" | "AUCTION_READY";
const actor = { type: "SYSTEM", label: "Deterministic demo profile" } as const;

export class DemoService {
  constructor(private readonly setup: SetupService) {}

  async create(input: { seasonId?: string; preset?: DemoPreset }) {
    const seasonId = input.seasonId ?? `demo-${randomUUID()}`;
    const preset = input.preset ?? "PREPARED";
    if (!["EMPTY", "SETUP", "PREPARED", "AUCTION_READY"].includes(preset)) throw Object.assign(new Error("Unknown demo preset"), { statusCode: 400 });
    const existing = await this.setup.summary({ actor, seasonId }).catch(error => {
      if (error instanceof Error && error.message === `Season not found: ${seasonId}`) return undefined;
      throw error;
    });
    if (existing && !(await this.setup.hasExecutedCommand({ actor, seasonId, idempotencyKey: `demo:${seasonId}:CREATE_SEASON` }))) throw Object.assign(new Error("Demo setup never overwrites an existing season"), { statusCode: 409 });
    if (existing && existing.season.leagueId !== `demo-league-${seasonId}`) throw Object.assign(new Error("Demo setup never overwrites an existing season"), { statusCode: 409 });
    const metadata = (commandType: string, expectedVersion?: number): CommandMetadata => ({ actor, seasonId, commandType, idempotencyKey: `demo:${seasonId}:${commandType}`, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
    if (!existing) await this.setup.createSeason(metadata("CREATE_SEASON"), { seasonId, leagueId: `demo-league-${seasonId}`, year: 2026, name: "Deterministic demo", teamCount: 2 });
    if (preset === "EMPTY") return this.setup.summary({ actor, seasonId });
    let summary = await this.setup.summary({ actor, seasonId });
    const expectedTeams = [{ id: "alpha", displayName: "Alpha", seedOrder: 1 }, { id: "beta", displayName: "Beta", seedOrder: 2 }];
    if (summary.teams.length === 0) await this.setup.configureTeams(metadata("CONFIGURE_TEAMS", summary.season.rowVersion), expectedTeams);
    else if (JSON.stringify(summary.teams.map(({ id, displayName, seedOrder }) => ({ id, displayName, seedOrder }))) !== JSON.stringify(expectedTeams)) throw Object.assign(new Error("Existing demo setup does not match the deterministic team fixture"), { statusCode: 409 });
    summary = await this.setup.summary({ actor, seasonId });
    const customId = `eddie-gallagher-${seasonId}`; const custom = summary.players.find(player => player.id === customId);
    if (!custom) await this.setup.addCustomPlayer(metadata("ADD_CUSTOM_PLAYER", summary.season.rowVersion), { id: customId, name: "Eddie Gallagher", position: "K", sourceType: "LEAGUE_CUSTOM" });
    else if (custom.name !== "Eddie Gallagher" || custom.position !== "K" || custom.sourceType !== "LEAGUE_CUSTOM") throw Object.assign(new Error("Existing demo setup does not match the deterministic custom player fixture"), { statusCode: 409 });
    if (preset === "SETUP") return this.setup.summary({ actor, seasonId });
    summary = await this.setup.summary({ actor, seasonId });
    const catalogPlayer = summary.players.find(player => player.sourceNamespace === "demo-nfl" && player.externalId === "jj-18");
    if (!catalogPlayer) { const preview = await this.setup.previewImport(metadata("PREVIEW_IMPORT"), "demo-nfl", JSON.stringify([{ externalId: "jj-18", name: "Justin Jefferson", position: "WR" }]), "json"); await this.setup.commitImport(metadata("COMMIT_IMPORT", summary.season.rowVersion), "demo-nfl", "json", preview); }
    else if (catalogPlayer.name !== "Justin Jefferson" || catalogPlayer.position !== "WR") throw Object.assign(new Error("Existing demo setup does not match the deterministic catalog fixture"), { statusCode: 409 });
    summary = await this.setup.summary({ actor, seasonId });
    const expectedFloors = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 };
    if (Object.keys(summary.floors).length === 0) await this.setup.setPriceFloors(metadata("SET_PRICE_FLOORS", summary.season.rowVersion), expectedFloors);
    else if (Object.keys(summary.floors).length !== Object.keys(expectedFloors).length || Object.entries(expectedFloors).some(([position, floor]) => summary.floors[position] !== floor)) throw Object.assign(new Error("Existing demo setup does not match the deterministic price fixture"), { statusCode: 409 });
    if (preset === "PREPARED") return this.setup.summary({ actor, seasonId });
    summary = await this.setup.summary({ actor, seasonId });
    if (summary.season.state === "SETUP") await this.setup.lockKeepers(metadata("LOCK_KEEPERS", summary.season.rowVersion), 14);
    return this.setup.summary({ actor, seasonId });
  }
}
