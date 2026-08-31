import React, { useEffect, useRef, useState } from "react";
import { requestedStageFromHash, stageAccess, stageViewPolicy, stages } from "./stage-model.js";
import { guardedStageRoute } from "../shared/stage-mutation-guard.jsx";

export function StageShell({ bootstrap, children }) {
  const [requested, setRequested] = useState(() => requestedStageFromHash(location.hash, bootstrap.legalStage));
  const currentRoute = useRef(requested);
  const hydratedStage = useRef(bootstrap.legalStage);
  useEffect(() => {
    // Publish canonical navigation only after hydration commits. Changing the
    // hash in refreshShell lets the old listener reject the new legal stage.
    if (hydratedStage.current !== bootstrap.legalStage) {
      location.hash = `stage/${bootstrap.legalStage}`;
      hydratedStage.current = bootstrap.legalStage;
    }
    const readRoute = () => {
      const next = requestedStageFromHash(location.hash, bootstrap.legalStage);
      currentRoute.current = guardedStageRoute(window, next, currentRoute.current, bootstrap.legalStage,
        stage => history.replaceState(null, "", `#stage/${stage}`));
      setRequested(currentRoute.current);
    };
    readRoute();
    addEventListener("hashchange", readRoute);
    return () => removeEventListener("hashchange", readRoute);
  }, [bootstrap.season.id, bootstrap.legalStage]);
  const access = stageAccess(bootstrap.legalStage, requested);
  const policy = stageViewPolicy(access);
  return <>
    <nav aria-label="Draft lifecycle">{stages.map(([id, label]) => {
      return <a key={id} href={`#stage/${id}`} aria-current={id === access.stage ? "page" : undefined} onClick={event => { const request = new CustomEvent("stage-navigation-request", { cancelable: true, detail: { stage: id, href: `stage/${id}` } }); if (!dispatchEvent(request)) event.preventDefault(); }}>{label}</a>;
    })}</nav>
    {access.explanation && <p role="note">{access.explanation}</p>}
    {access.mode === "READ_ONLY" && <a href="#operations">Preview a correction in Operations</a>}
    <section aria-label={`${stages.find(([id]) => id === access.stage)?.[1]} stage`} data-stage={access.stage} data-mode={access.mode}>{children(access, policy)}</section>
  </>;
}
