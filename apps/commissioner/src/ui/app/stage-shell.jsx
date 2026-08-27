import React, { useEffect, useState } from "react";
import { requestedStageFromHash, stageAccess, stageViewPolicy, stages } from "./stage-model.js";

export function StageShell({ bootstrap, children }) {
  const [requested, setRequested] = useState(() => requestedStageFromHash(location.hash, bootstrap.legalStage));
  useEffect(() => {
    const readRoute = () => setRequested(requestedStageFromHash(location.hash, bootstrap.legalStage));
    readRoute();
    addEventListener("hashchange", readRoute);
    return () => removeEventListener("hashchange", readRoute);
  }, [bootstrap.season.id, bootstrap.legalStage]);
  const access = stageAccess(bootstrap.legalStage, requested);
  const policy = stageViewPolicy(access);
  return <>
    <nav aria-label="Draft lifecycle">{stages.map(([id, label]) => {
      return <a key={id} href={`#stage/${id}`} aria-current={id === access.stage ? "page" : undefined}>{label}</a>;
    })}</nav>
    {access.explanation && <p role="note">{access.explanation}</p>}
    {access.mode === "READ_ONLY" && <a href="#operations">Preview a correction in Operations</a>}
    <section aria-label={`${stages.find(([id]) => id === access.stage)?.[1]} stage`} data-stage={access.stage} data-mode={access.mode}>{children(access, policy)}</section>
  </>;
}
