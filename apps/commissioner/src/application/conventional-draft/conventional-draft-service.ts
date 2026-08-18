import type { CommandMetadata } from "../ports/season-repository.js";
import type { ConventionalDraftRepository, DraftPickInput } from "./conventional-draft-repository.js";
import type { CheckpointPort } from "../backups/checkpoint-service.js";

export class ConventionalDraftService {
  constructor(private readonly repository: ConventionalDraftRepository, private readonly checkpoints?: CheckpointPort) {}
  async pick(metadata: CommandMetadata, input: DraftPickInput) { const summary=await this.repository.draftSummary(metadata.actor,metadata.seasonId);if(summary.nextOverallPick===1)await this.checkpoints?.before(metadata,"PRE_CONVENTIONAL_DRAFT_START");return this.repository.makePick(metadata,input); }
  summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { return this.repository.draftSummary(metadata.actor, metadata.seasonId); }
}
