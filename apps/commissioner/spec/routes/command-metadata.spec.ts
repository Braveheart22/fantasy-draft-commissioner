import { describe, expect, it } from "vitest";
import { LOCAL_COMMISSIONER_SUBJECT_ID } from "../../src/application/ports/actor.js";
import { commandMetadata, localCommissioner } from "../../src/routes/command-metadata.js";

describe("command actor metadata", () => {
  it("uses a stable local subject and keeps the existing audit type and label", () => {
    expect(localCommissioner).toEqual({
      subjectId: LOCAL_COMMISSIONER_SUBJECT_ID,
      type: "LOCAL_COMMISSIONER",
      label: "Commissioner",
      effectiveRole: "COMMISSIONER",
      context: {},
    });

    const metadata = commandMetadata({ headers: { "idempotency-key": "key", "x-expected-season-version": "3" } } as never, "season", "TEST");
    expect(metadata).toMatchObject({ actor: localCommissioner, seasonId: "season", idempotencyKey: "key", commandType: "TEST", expectedVersion: 3 });
  });
});
