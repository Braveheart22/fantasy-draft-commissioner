import type { FastifyInstance } from "fastify";
import type { ResultsService } from "../../application/results/results-service.js";
import { localCommissioner } from "../command-metadata.js";

export async function registerResultsRoutes(server: FastifyInstance, results: ResultsService) {
  server.get<{ Params: { seasonId: string } }>("/api/results/:seasonId", request => results.read(localCommissioner, request.params.seasonId));
}
