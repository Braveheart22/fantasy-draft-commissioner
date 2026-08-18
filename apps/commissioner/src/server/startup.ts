import { access, mkdir, readFile } from "node:fs/promises";
import { homedir, platform as currentPlatform } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { SetupService } from "../application/setup/setup-service.js";
import { AuctionService } from "../application/auction/auction-service.js";
import { auctionEngineAdapter } from "../integrations/auction-engine-adapter.js";
import { openSeasonStore } from "../infrastructure/sqlite/season-store.js";
import { registerSetupRoutes } from "../routes/setup/setup-routes.js";
import { registerAuctionRoutes } from "../routes/auction/auction-routes.js";

const LOOPBACK_HOST = "127.0.0.1";

export function resolveDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform = currentPlatform(),
  localAppData = environment.LOCALAPPDATA,
): string {
  if (environment.LEAGUE_DRAFT_DATA_DIR) return environment.LEAGUE_DRAFT_DATA_DIR;
  if (platform === "win32") return join(localAppData ?? join(homedir(), "AppData", "Local"), "LeagueDraft");
  return join(environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "league-draft");
}

export interface CommissionerServerOptions {
  port?: number;
  dataDirectory?: string;
}

async function registerBuiltUi(server: FastifyInstance) {
  const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../ui");
  try { await access(join(uiRoot, "index.html")); } catch { return; }
  server.get("/", async (_request, reply) => reply.type("text/html").send(await readFile(join(uiRoot, "index.html"))));
  server.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const path = resolve(uiRoot, "assets", request.params["*"]);
    if (!path.startsWith(resolve(uiRoot, "assets") + "\\") && !path.startsWith(resolve(uiRoot, "assets") + "/")) return reply.code(404).send();
    const contentType = extname(path) === ".css" ? "text/css" : "text/javascript";
    return reply.type(contentType).send(await readFile(path));
  });
}

export async function startCommissionerServer(options: CommissionerServerOptions = {}) {
  const dataDirectory = options.dataDirectory ?? resolveDataDirectory();
  await mkdir(dataDirectory, { recursive: true });
  const server = Fastify({ logger: false });
  const store = await openSeasonStore(join(dataDirectory, "commissioner.db"));
  const setup = new SetupService(store, store);
  const auction = new AuctionService(store, auctionEngineAdapter);
  server.get("/health", async () => ({ status: "ok", dataDirectory }));
  await registerSetupRoutes(server, setup);
  await registerAuctionRoutes(server, auction);
  await registerBuiltUi(server);
  try {
    await server.listen({ host: LOOPBACK_HOST, port: options.port ?? 4173 });
  } catch (error) {
    await server.close();
    await store.close();
    throw error;
  }
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Commissioner server did not expose a TCP address");
  let stopped = false;
  return {
    address: { host: LOOPBACK_HOST, port: address.port },
    dataDirectory,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await server.close();
      await store.close();
    },
  };
}
