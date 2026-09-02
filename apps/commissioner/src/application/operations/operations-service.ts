import type { ActorDescriptor } from "../ports/season-repository.js";
import type { OperationsQuery, OperationsRepository } from "./operations-repository.js";

export class OperationsService {
  constructor(private readonly repository: OperationsRepository) {}
  read(actor: ActorDescriptor, seasonId: string, query: OperationsQuery) {
    return this.repository.operations(actor, seasonId, query);
  }
}
