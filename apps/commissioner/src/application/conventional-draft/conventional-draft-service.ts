import type { CommandMetadata } from "../ports/season-repository.js";
import type { ConventionalDraftRepository, DraftPickInput } from "./conventional-draft-repository.js";
import type { CheckpointPort } from "../backups/checkpoint-service.js";

export class ConventionalDraftService {
  constructor(private readonly repository: ConventionalDraftRepository, private readonly checkpoints?: CheckpointPort) {}
  async pick(metadata: CommandMetadata, input: DraftPickInput) { const summary=await this.repository.draftSummary(metadata.actor,metadata.seasonId);if(summary.nextOverallPick===1)await this.checkpoints?.before(metadata,"PRE_CONVENTIONAL_DRAFT_START");const result=await this.repository.makePick(metadata,input);return{...result,rowVersion:await this.repository.seasonVersion(metadata.seasonId)}; }
  async summary(metadata: Pick<CommandMetadata, "actor" | "seasonId">) { const result=await this.repository.draftSummary(metadata.actor, metadata.seasonId);return{...result,rowVersion:await this.repository.seasonVersion(metadata.seasonId)}; }
}
