export const LOCAL_COMMISSIONER_SUBJECT_ID = "local:commissioner";

export interface ActorContext {
  readonly leagueId?: string;
  readonly seasonId?: string;
  readonly seasonTeamId?: string;
}

export interface ActorDescriptor {
  readonly subjectId: string;
  readonly type: string;
  readonly label: string;
  readonly effectiveRole: string;
  readonly context: ActorContext;
}

export const LOCAL_COMMISSIONER_ACTOR = Object.freeze({
  subjectId: LOCAL_COMMISSIONER_SUBJECT_ID,
  type: "LOCAL_COMMISSIONER",
  label: "Commissioner",
  effectiveRole: "COMMISSIONER",
  context: Object.freeze({}),
} satisfies ActorDescriptor);
