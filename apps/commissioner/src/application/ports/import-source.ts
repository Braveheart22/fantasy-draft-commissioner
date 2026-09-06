import type { ActorDescriptor } from "./actor.js";

export interface ImportSourceArtifact {
  readonly sourceId: string;
  readonly database: AsyncIterable<Uint8Array>;
  readonly manifest: AsyncIterable<Uint8Array>;
}

export interface ImportSourcePort {
  open(actor: ActorDescriptor, sourceId: string): Promise<ImportSourceArtifact>;
}
