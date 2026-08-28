import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogSource, CatalogSourceArtifact } from "../application/catalog-sources/catalog-source.js";

export const SLEEPER_NFL_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const SUPPORTED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST", "DEF", "D/ST"]);
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface SleeperCatalogAdapterOptions {
  fetcher?: Fetcher;
  artifactDirectory: string;
  timeoutMs?: number;
  maxCompressedBytes?: number;
  maxDecodedBytes?: number;
}

function mappedRows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sleeper provider schema drift: expected a player map object");
  return Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).flatMap(([mapId, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Sleeper provider schema drift at player ${mapId}`);
    const player = raw as Record<string, unknown>;
    const externalId = String(player.player_id ?? mapId).trim();
    const position = String(player.position ?? (Array.isArray(player.fantasy_positions) ? player.fantasy_positions[0] : "")).toUpperCase();
    if (!externalId || !SUPPORTED_POSITIONS.has(position)) return [];
    const team = String(player.team ?? "").trim().toUpperCase();
    const fullName = String(player.full_name ?? "").trim();
    const combinedName = `${String(player.first_name ?? "").trim()} ${String(player.last_name ?? "").trim()}`.trim();
    const name = fullName || combinedName || (position === "DEF" || position === "DST" || position === "D/ST" ? `${team || externalId} Defense` : "");
    if (!name) throw new Error(`Sleeper provider schema drift: player ${externalId} has no name`);
    const providerStatus = String(player.status ?? (player.active === false ? "INACTIVE" : "ACTIVE")).trim().toUpperCase();
    const providerActive = player.active === false ? false : providerStatus !== "INACTIVE" && providerStatus !== "RETIRED";
    const aliases = [
      ...(player.gsis_id ? [{ sourceNamespace: "gsis", sourceId: String(player.gsis_id) }] : []),
      ...(player.espn_id ? [{ sourceNamespace: "espn", sourceId: String(player.espn_id) }] : []),
    ];
    const changed = Number(player.last_changed);
    const sourceUpdatedAt = Number.isFinite(changed) && changed > 0 ? new Date(changed < 10_000_000_000 ? changed * 1000 : changed).toISOString() : undefined;
    return [{ externalId, name, position, nflTeam: team || undefined, providerStatus, providerActive, leagueSelectable: providerActive, sourceUpdatedAt, aliases }];
  });
}

export class SleeperCatalogAdapter implements CatalogSource {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly maxCompressedBytes: number;
  private readonly maxDecodedBytes: number;
  constructor(private readonly options: SleeperCatalogAdapterOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxCompressedBytes = options.maxCompressedBytes ?? 20 * 1024 * 1024;
    this.maxDecodedBytes = options.maxDecodedBytes ?? 80 * 1024 * 1024;
  }

  async acquire(options: { signal?: AbortSignal } = {}): Promise<CatalogSourceArtifact> {
    await mkdir(this.options.artifactDirectory, { recursive: true });
    const artifactPath = join(this.options.artifactDirectory, `${randomUUID()}.sleeper.json`);
    const controller = new AbortController();
    let timedOut = false, cancelled = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const cancel = () => { cancelled = true; controller.abort(); };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    try {
      if (cancelled) throw new Error("Sleeper catalog request was cancelled");
      const response = await this.fetcher(SLEEPER_NFL_PLAYERS_URL, { method: "GET", redirect: "manual", headers: { accept: "application/json" }, signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new Error(`Sleeper catalog redirect rejected (status ${response.status})`);
      if (!response.ok) throw new Error(`Sleeper catalog request failed with status ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) throw new Error(`Unexpected Sleeper content type: ${contentType || "missing"}`);
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > this.maxCompressedBytes) throw new Error(`Sleeper compressed size limit exceeded (${this.maxCompressedBytes} bytes)`);
      if (!response.body) throw new Error("Sleeper response body is missing");
      const file = await open(artifactPath, "wx");
      let decodedBytes = 0;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (controller.signal.aborted) throw new Error("Sleeper catalog request was cancelled");
          decodedBytes += chunk.byteLength;
          if (decodedBytes > this.maxDecodedBytes) throw new Error(`Sleeper decoded size limit exceeded (${this.maxDecodedBytes} bytes)`);
          await file.write(chunk);
        }
      } finally { await file.close(); }
      const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
      const rows = mappedRows(parsed);
      return { bytes: Buffer.from(JSON.stringify(rows)), format: "json", sourceNamespace: "sleeper" };
    } catch (error) {
      if (timedOut) throw new Error(`Sleeper catalog request timed out after ${this.timeoutMs}ms`);
      if (cancelled || options.signal?.aborted) throw new Error("Sleeper catalog request was cancelled");
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      await rm(artifactPath, { force: true });
    }
  }
}
