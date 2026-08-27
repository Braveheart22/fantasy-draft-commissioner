import type { FastifyInstance } from "fastify";
import type { BootstrapService } from "../../application/bootstrap/bootstrap-service.js";

const commissioner = { type: "COMMISSIONER", label: "Local commissioner" };

export async function registerBootstrapRoutes(server: FastifyInstance, bootstrap: BootstrapService) {
  server.get<{ Params: { seasonId: string } }>("/api/bootstrap/:seasonId", async request => bootstrap.load(commissioner, request.params.seasonId));
}
