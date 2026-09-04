import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { DemoPreset, DemoService } from "../../application/demo/demo-service.js";

export async function registerDemoRoutes(server: FastifyInstance, demo: DemoService) {
  server.post<{ Body: { seasonId?: string; preset?: DemoPreset } }>("/api/demo/seasons", request => demo.create(request.body ?? {}));
  server.get("/demo", async (_request, reply) => reply.type("text/html").send(await readFile(new URL("../../ui/demo/index.html", import.meta.url), "utf8")));
}
