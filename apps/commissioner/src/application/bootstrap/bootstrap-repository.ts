import type { AuctionRoundSummary } from "../auction/auction-repository.js";
import type { DraftOrderSummary } from "../draft-order/draft-order-repository.js";
import type { ActorDescriptor, SeasonRecord } from "../ports/season-repository.js";
import type { SetupSummary } from "../setup/setup-repository.js";

export const STAGES = ["SETUP", "KEEPERS", "AUCTION_1", "AUCTION_2", "DRAFT_ORDER", "DRAFT", "RESULTS"] as const;
export type Stage = typeof STAGES[number];

export interface BootstrapSnapshot {
  season: SeasonRecord;
  legalStage: Stage;
  readiness: {
    setupReady: boolean;
    teamsReady: boolean;
    catalogReady: boolean;
    pricingReady: boolean;
    keepersLocked: boolean;
  };
  setup: SetupSummary;
  phases: {
    auctionOne: AuctionRoundSummary | null;
    auctionTwo: AuctionRoundSummary | null;
    draft: DraftOrderSummary | null;
  };
}

export interface BootstrapRepository {
  readBootstrap(actor: ActorDescriptor, seasonId: string): Promise<Omit<BootstrapSnapshot, "legalStage" | "readiness"> & { readiness: Omit<BootstrapSnapshot["readiness"], "keepersLocked"> }>;
}
