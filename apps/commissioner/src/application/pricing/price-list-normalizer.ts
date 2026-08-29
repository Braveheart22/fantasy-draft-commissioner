import { createHash } from "node:crypto";

export type PriceListFormat = "csv" | "json";
export interface PriceListRow { rowNumber: number; sourceNamespace?: string; sourceId?: string; name: string; nflTeam?: string; position: "QB" | "RB" | "WR" | "TE" | "K" | "DST"; minimumBid: number }
export interface PriceListLimits { maxBytes: number; maxRows: number; maxColumns: number; maxDepth: number; maxFieldLength: number }
export interface NormalizedPriceList { sourceHash: string; normalizedHash: string; rows: PriceListRow[]; errors: string[] }
const DEFAULTS: PriceListLimits = { maxBytes: 2 * 1024 * 1024, maxRows: 20_000, maxColumns: 16, maxDepth: 4, maxFieldLength: 1024 };
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function depth(value: unknown): number { if (!value || typeof value !== "object") return 0; return 1 + Math.max(0, ...(Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)).map(depth)); }
function csv(text: string) { const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean); const headers = (lines.shift() ?? "").split(",").map(value => value.trim()); return lines.map(line => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value.trim()]))); }
export function normalizePriceList(input: { bytes: Buffer; format: PriceListFormat; limits?: Partial<PriceListLimits> }): NormalizedPriceList {
  const limits = { ...DEFAULTS, ...input.limits };
  if (input.bytes.byteLength > limits.maxBytes) throw new Error(`Price-list size limit exceeded (${limits.maxBytes})`);
  const value: unknown = input.format === "json" ? JSON.parse(input.bytes.toString("utf8")) : csv(input.bytes.toString("utf8"));
  if (!Array.isArray(value)) throw new Error("Price list must be an array");
  if (value.length > limits.maxRows) throw new Error(`Price-list row limit exceeded (${limits.maxRows})`);
  if (depth(value) > limits.maxDepth) throw new Error(`Price-list depth limit exceeded (${limits.maxDepth})`);
  const rows: PriceListRow[] = [], errors: string[] = [], identities = new Set<string>();
  value.forEach((raw, index) => {
    const number = index + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push(`Row ${number}: object required`); return; }
    const source = raw as Record<string, unknown>;
    if (Object.keys(source).length > limits.maxColumns) throw new Error(`Price-list column limit exceeded (${limits.maxColumns})`);
    if (Object.values(source).some(item => typeof item === "string" && item.length > limits.maxFieldLength)) throw new Error(`Price-list field length limit exceeded (${limits.maxFieldLength})`);
    const sourceNamespace = String(source.sourceNamespace ?? "").trim(), sourceId = String(source.sourceId ?? "").trim(), name = String(source.name ?? "").trim();
    const position = String(source.position ?? "").trim().toUpperCase();
    const minimumBid = typeof source.minimumBid === "string" ? Number(source.minimumBid) : source.minimumBid;
    const identity = sourceNamespace && sourceId ? `${sourceNamespace}\u0000${sourceId}` : `${name.toLowerCase()}\u0000${position}`;
    if (!name || !POSITIONS.has(position)) { errors.push(`Row ${number}: name and known position are required`); return; }
    if (!Number.isSafeInteger(minimumBid) || Number(minimumBid) < 1) { errors.push(`Row ${number}: minimumBid must be a positive whole-dollar amount`); return; }
    if ((sourceNamespace && !sourceId) || (!sourceNamespace && sourceId)) { errors.push(`Row ${number}: source namespace and ID must be supplied together`); return; }
    if (identities.has(identity)) { errors.push(`Row ${number}: duplicate price identity`); return; } identities.add(identity);
    const nflTeam = String(source.nflTeam ?? "").trim().toUpperCase();
    rows.push({ rowNumber: number, ...(sourceNamespace ? { sourceNamespace, sourceId } : {}), name, ...(nflTeam && nflTeam !== "FA" ? { nflTeam } : {}), position: position as PriceListRow["position"], minimumBid: Number(minimumBid) });
  });
  return { sourceHash: hash(input.bytes), normalizedHash: hash(JSON.stringify(rows)), rows, errors };
}
