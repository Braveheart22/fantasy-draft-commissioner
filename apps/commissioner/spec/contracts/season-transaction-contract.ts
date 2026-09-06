import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CommandMetadata, SeasonRecord, SeasonTransaction } from "../../src/application/ports/season-repository.js";
import type { TransactionPort } from "../../src/application/ports/transaction.js";

interface ContractAdapter extends TransactionPort<CommandMetadata, SeasonTransaction> {
  hasExecutedCommand(actor: CommandMetadata["actor"], seasonId: string, idempotencyKey: string): Promise<boolean>;
  auditForSeason(actor: CommandMetadata["actor"], seasonId: string): Promise<Array<Record<string, unknown>>>;
  close?(): Promise<void>;
}

export function seasonTransactionAdapterContract(name: string, open: () => Promise<ContractAdapter>): void {
  describe(`${name} season transaction adapter contract`, () => {
    it("preserves application IDs, actor attribution, and idempotent results", async () => {
      const adapter = await open();
      const seasonId = randomUUID();
      const actor = { subjectId: "contract:commissioner", type: "LOCAL_COMMISSIONER", label: "Contract Commissioner", effectiveRole: "COMMISSIONER", context: { seasonId } } as const;
      const metadata = { actor, seasonId, commandType: "CREATE_SEASON", idempotencyKey: randomUUID(), correlationId: randomUUID() };
      let executions = 0;
      try {
        const create = () => adapter.execute(metadata, transaction => {
          executions += 1;
          return transaction.createSeason({ id: seasonId, leagueId: randomUUID(), year: 2030, name: "Contract", teamCount: 8 });
        });
        const first = await create();
        const duplicate = await create();
        expect(first.id).toBe(seasonId);
        expect(duplicate).toEqual(first);
        expect(executions).toBe(1);
        await expect(adapter.hasExecutedCommand(actor, seasonId, metadata.idempotencyKey)).resolves.toBe(true);
        await expect(adapter.auditForSeason(actor, seasonId)).resolves.toEqual([
          expect.objectContaining({ actorType: actor.type, actorLabel: actor.label, commandType: metadata.commandType }),
        ]);
      } finally {
        await adapter.close?.();
      }
    });

    it("rolls state and audit back together when an operation fails", async () => {
      const adapter = await open();
      const seasonId = randomUUID();
      const actor = { subjectId: "contract:commissioner", type: "LOCAL_COMMISSIONER", label: "Contract Commissioner", effectiveRole: "COMMISSIONER", context: { seasonId } } as const;
      const metadata = { actor, seasonId, commandType: "CREATE_SEASON", idempotencyKey: randomUUID() };
      try {
        await expect(adapter.execute<SeasonRecord>(metadata, async transaction => {
          await transaction.createSeason({ id: seasonId, leagueId: randomUUID(), year: 2031, name: "Rollback", teamCount: 8 });
          throw new Error("contract rollback");
        })).rejects.toThrow("contract rollback");
        await expect(adapter.hasExecutedCommand(actor, seasonId, metadata.idempotencyKey)).resolves.toBe(false);
        await expect(adapter.auditForSeason(actor, seasonId)).resolves.toEqual([]);
      } finally {
        await adapter.close?.();
      }
    });
  });
}
