import type { ActorDescriptor } from "../ports/season-repository.js";
import type { ResultsRepository } from "./results-repository.js";

export class ResultsService {
  constructor(private readonly repository: ResultsRepository) {}
  async read(actor: ActorDescriptor, seasonId: string) {
    const result = await this.repository.results(actor, seasonId);
    if (result.season.state !== "COMPLETED") throw Object.assign(new Error("Results are available after the season is complete"), { statusCode: 409 });
    return result;
  }
}
