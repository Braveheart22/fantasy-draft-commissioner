import type { CommandMetadata } from "../ports/season-repository.js";
import type { ConventionalDraftRepository, DraftPickInput } from "./conventional-draft-repository.js";

export class ConventionalDraftService {
  constructor(private readonly repository: ConventionalDraftRepository) {}
  pick(metadata: CommandMetadata, input: DraftPickInput) { return this.repository.makePick(metadata, input); }
  summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { return this.repository.draftSummary(metadata.actor, metadata.seasonId); }
}
