import { createHash } from "node:crypto";
import type { CanonicalCatalogFormat } from "./catalog-source.js";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const FREE_AGENT_TEAMS = new Set(["", "FA", "FREE AGENT", "FREE_AGENT", "NONE", "NULL"]);
export interface CanonicalAlias { sourceNamespace: string; sourceId: string }
export interface CanonicalCatalogRow {
  externalId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "DST";
  nflTeam?: string;
  providerStatus: string;
  providerActive: boolean;
  leagueSelectable: boolean;
  sourceUpdatedAt?: string;
  aliases: CanonicalAlias[];
}
export interface CatalogNormalizationLimits { maxBytes: number; maxRows: number; maxColumns: number; maxDepth: number; maxFieldLength: number }
export interface CatalogNormalizationResult { sourceHash: string; normalizedHash: string; rows: CanonicalCatalogRow[]; errors: string[] }

const DEFAULT_LIMITS: CatalogNormalizationLimits = { maxBytes: 10 * 1024 * 1024, maxRows: 20_000, maxColumns: 32, maxDepth: 5, maxFieldLength: 1024 };
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function csvRows(text: string): Record<string, unknown>[] {
  const records: string[][] = [];
  let record: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { record.push(field); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      record.push(field); field = "";
      if (record.some(value => value.length)) records.push(record);
      record = [];
    } else field += character;
  }
  record.push(field); if (record.some(value => value.length)) records.push(record);
  const headers = (records.shift() ?? []).map(value => value.replace(/^\uFEFF/, "").trim());
  return records.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

function depth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return 1 + Math.max(0, ...children.map(depth));
}
function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || String(value).toLowerCase() === "true" || value === 1 || value === "1") return true;
  if (value === false || String(value).toLowerCase() === "false" || value === 0 || value === "0") return false;
  throw new Error(`invalid Boolean ${String(value)}`);
}
function text(value: unknown): string { return String(value ?? "").trim(); }
function aliases(value: unknown): CanonicalAlias[] {
  if (value === undefined || value === null || value === "") return [];
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error("aliases must be an array");
  return parsed.map(alias => {
    if (!alias || typeof alias !== "object") throw new Error("alias must be an object");
    const sourceNamespace = text((alias as Record<string, unknown>).sourceNamespace);
    const sourceId = text((alias as Record<string, unknown>).sourceId);
    if (!sourceNamespace || !sourceId) throw new Error("alias namespace and ID are required");
    return { sourceNamespace, sourceId };
  });
}

export function normalizeCanonicalCatalog(input: { bytes: Buffer; format: CanonicalCatalogFormat; sourceNamespace: string; limits?: Partial<CatalogNormalizationLimits> }): CatalogNormalizationResult {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  if (input.bytes.byteLength > limits.maxBytes) throw new Error(`Catalog size limit exceeded (${limits.maxBytes} bytes)`);
  if (!input.sourceNamespace.trim()) throw new Error("Source namespace is required");
  const raw: unknown = input.format === "json" ? JSON.parse(input.bytes.toString("utf8")) : csvRows(input.bytes.toString("utf8"));
  if (!Array.isArray(raw)) throw new Error("Canonical catalog must be an array of rows");
  if (raw.length > limits.maxRows) throw new Error(`Catalog row limit exceeded (${limits.maxRows})`);
  if (depth(raw) > limits.maxDepth) throw new Error(`Catalog depth limit exceeded (${limits.maxDepth})`);
  const rows: CanonicalCatalogRow[] = [], errors: string[] = [], seen = new Set<string>();
  raw.forEach((value, index) => {
    const number = index + 1;
    if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`Row ${number}: object required`); return; }
    const source = value as Record<string, unknown>;
    if (Object.keys(source).length > limits.maxColumns) throw new Error(`Catalog column limit exceeded (${limits.maxColumns})`);
    for (const field of Object.values(source)) if (typeof field === "string" && field.length > limits.maxFieldLength) throw new Error(`Catalog field length limit exceeded (${limits.maxFieldLength})`);
    const externalId = text(source.externalId), name = text(source.name);
    const rawPosition = text(source.position).toUpperCase();
    const position = rawPosition === "DEF" || rawPosition === "D/ST" ? "DST" : rawPosition;
    if (!externalId || !name || !POSITIONS.has(position)) { errors.push(`Row ${number}: externalId, name, and known position are required`); return; }
    if (seen.has(externalId)) { errors.push(`Row ${number}: duplicate externalId ${externalId}`); return; }
    seen.add(externalId);
    try {
      const explicitAliases = aliases(source.aliases);
      const allAliases = [...explicitAliases, { sourceNamespace: input.sourceNamespace.trim(), sourceId: externalId }]
        .sort((left, right) => left.sourceNamespace.localeCompare(right.sourceNamespace) || left.sourceId.localeCompare(right.sourceId));
      const duplicateAliases = new Set(allAliases.map(alias => `${alias.sourceNamespace}\u0000${alias.sourceId}`));
      const nflTeamValue = text(source.nflTeam).toUpperCase();
      const sourceUpdatedAt = text(source.sourceUpdatedAt);
      if (sourceUpdatedAt && Number.isNaN(Date.parse(sourceUpdatedAt))) throw new Error("sourceUpdatedAt must be an ISO date");
      rows.push({
        externalId, name, position: position as CanonicalCatalogRow["position"],
        ...(FREE_AGENT_TEAMS.has(nflTeamValue) ? {} : { nflTeam: nflTeamValue }),
        providerStatus: text(source.providerStatus).toUpperCase() || "ACTIVE",
        providerActive: boolean(source.providerActive, true),
        leagueSelectable: boolean(source.leagueSelectable, true),
        ...(sourceUpdatedAt ? { sourceUpdatedAt: new Date(sourceUpdatedAt).toISOString() } : {}),
        aliases: [...duplicateAliases].map(key => { const [sourceNamespace, sourceId] = key.split("\u0000"); return { sourceNamespace: sourceNamespace!, sourceId: sourceId! }; }),
      });
    } catch (error) { errors.push(`Row ${number}: ${(error as Error).message}`); }
  });
  const stableRows = rows.sort((left, right) => left.externalId.localeCompare(right.externalId));
  return { sourceHash: hash(input.bytes), normalizedHash: hash(JSON.stringify(stableRows)), rows: stableRows, errors };
}
