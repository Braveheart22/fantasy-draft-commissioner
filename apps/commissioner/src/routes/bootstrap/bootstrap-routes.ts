import type { FastifyInstance } from "fastify";
import type { BootstrapService } from "../../application/bootstrap/bootstrap-service.js";
import { localCommissioner } from "../command-metadata.js";

export async function registerBootstrapRoutes(server: FastifyInstance, bootstrap: BootstrapService) {
  server.get<{ Params: { seasonId: string } }>("/api/bootstrap/:seasonId", async request => bootstrap.load(localCommissioner, request.params.seasonId));
}
