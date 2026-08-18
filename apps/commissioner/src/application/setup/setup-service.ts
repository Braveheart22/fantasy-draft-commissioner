import { randomUUID } from "node:crypto";
import type { CommandMetadata, SeasonRepository } from "../ports/season-repository.js";
import type { ImportPreview, PlayerInput, SetupRepository, TeamInput } from "./setup-repository.js";

export class SetupService {
  constructor(private readonly seasons: SeasonRepository, private readonly setup: SetupRepository) {}

  createSeason(metadata: CommandMetadata, input: { leagueId: string; year: number; name: string; teamCount: number; seasonId?: string }) {
    if (!Number.isInteger(input.teamCount) || input.teamCount < 1) throw new Error("Team count must be a positive integer");
    if (!Number.isInteger(input.year) || input.year < 1) throw new Error("Season year must be positive");
    const id = input.seasonId ?? randomUUID();
    return this.seasons.execute({ ...metadata, seasonId: id }, tx => tx.createSeason({ id, leagueId: input.leagueId, year: input.year, name: input.name, teamCount: input.teamCount }));
  }
  configureTeams(metadata: CommandMetadata, teams: TeamInput[]) { return this.setup.configureTeams(metadata, teams); }
  addCustomPlayer(metadata: CommandMetadata, player: PlayerInput) { return this.setup.addCustomPlayer(metadata, player); }
  previewImport(metadata: CommandMetadata, namespace: string, content: string, format: "csv" | "json") { return this.setup.previewImport(metadata.actor, metadata.seasonId, namespace, content, format); }
  commitImport(metadata: CommandMetadata, namespace: string, format: "csv" | "json", preview: ImportPreview) { return this.setup.commitImport(metadata, namespace, format, preview); }
  setPriceFloors(metadata: CommandMetadata, floors: Record<string, number>) { return this.setup.setPriceFloors(metadata, floors); }
  setKeeperEligibility(metadata: CommandMetadata, playerIds: string[]) { return this.setup.setKeeperEligibility(metadata, playerIds); }
  selectKeeper(metadata: CommandMetadata, seasonTeamId: string, playerId?: string) { return this.setup.selectKeeper(metadata, seasonTeamId, playerId); }
  lockKeepers(metadata: CommandMetadata, rosterCapacity: number) { return this.setup.lockKeepers(metadata, rosterCapacity); }
  summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { return this.setup.setupSummary(metadata.actor, metadata.seasonId); }
}
