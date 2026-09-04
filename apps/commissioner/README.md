# League Draft Commissioner

The Commissioner is a private, loopback-only Windows application for preparing and running one league's draft without a draft-night internet dependency. Canonical state lives in SQLite; every accepted command is version-checked, audited, and restart-resumable.

## Production build and startup

From the repository root, build and package the production application with:

```powershell
npm run commissioner:build
npm run commissioner:package -- C:\path\to\league-draft-win-x64
```

The generated folder contains its own Node runtime, production UI, Phase 1 engine, migrations, and dependencies. `Start League Draft.cmd` opens the local UI, uses `%LOCALAPPDATA%\LeagueDraft` by default, and selects a safe alternate loopback port if 4173 is occupied. The production entry point does not register demo mutation routes or ship demo controls.

For repository E2E work only, `npm run commissioner:e2e` starts the explicit demo profile with deterministic fixture commands. Do not use the demo profile for a real league. `npm run commissioner:e2e:production` exercises the normal production entry point and verifies demo routes remain unavailable.

## Annual preparation checklist

Complete preparation while internet access is available, then rehearse with networking disabled:

1. Create the season with its real name, year, and team count.
2. Enter the participating team names in seed order and save them.
3. Prepare the player catalog from a local canonical CSV/JSON file or the explicit Sleeper preparation action. Sleeper is a preparation-time, read-only source; follow its attribution, non-commercial-use, and cache guidance. Live provider data is never bundled with this application.
4. Review the source timestamp, normalized row count, omissions, identity collisions, and unresolved items. Approve only after every disposition is intentional. A failed refresh leaves the last approved catalog unchanged.
5. Add league-custom players separately. Custom identities are not matched or deactivated by an NFL provider refresh.
6. Set positive whole-dollar positional floors. Stage the priced-player list, reconcile stable-ID and name/team/position matches, resolve ambiguous or unmatched rows, and approve it. Manual prices override list prices; list prices override positional floors.
7. Review keeper eligibility and select zero or one keeper per team. Confirm each displayed $50 keeper cost and $350/$300 Round 1 budget, then lock reviewed keepers.
8. Open Operations, create a verified backup, and confirm the recovery summary reports database integrity `ok` and the supported schema.
9. Stop and restart the packaged application, reload the season, and confirm it resumes at Auction 1 before disconnecting the network for the draft-night rehearsal.

Catalog and price-list files are annual preparation inputs, not draft-night services. After approval, player search, keepers, auctions, drafting, corrections, backup, Results, and export use only local persisted data.

## Draft-night runbook

- **Setup and Keepers:** inspect completed setup read-only. Corrections route through Operations; never edit the database or files to change canonical state.
- **Auction 1 and Auction 2:** enter each team privately, save or explicitly finalize zero bids, finalize every team, review the masked round, then lock/reveal. Record external tie decisions exactly as witnessed before publishing. Round 2 budgets are derived from published Round 1 results.
- **Draft Order:** calculate from Round 2 balances, record external precedence for every tied group, and finalize the permanent order. The order repeats; it never snakes.
- **Draft:** keep the on-the-clock banner visible, select by player name and context, and commit one legal pick at a time. A rejection changes no canonical state and keeps the attempted selection available for correction.
- **Results:** after every team reaches its legal 14-player roster, review final rosters and history, create a verified backup, and export deterministic CSV and JSON.
- **Operations:** use the audit timeline, labeled correction targets, dependency preview, verified pre-correction backup, and typed confirmation for exceptional changes. A correction preserves superseded history and resumes at the earliest affected stage.

If the browser or computer stops after a command reports success, restart the application and load the season; it resumes from the last committed version. Do not repeat a command merely because the page disappeared. Browser retries use idempotency keys, and stale tabs are rejected without partial state.

## Backup, restore, and exports

Create and verify a backup in Operations before the draft, before any high-impact correction, and before final export. Keep the database and its matching manifest together. Copy the final backup and export folder to a second local drive after the rehearsal and after the completed draft.

Stop the application before restoring a backup:

```powershell
npm run commissioner:restore -- C:\path\commissioner.db C:\path\backup.db.manifest.json
```

Restore verifies integrity, schema compatibility, and checksum; retains the current database as a rollback copy; and restores it if candidate activation fails.

CSV exports neutralize formula-leading text for spreadsheet safety. JSON and canonical database values remain unchanged. Restore is intentionally a stopped-server command; normal draft screens never expose raw database editing.

## Offline acceptance rehearsal

Before draft day, use a clean destination and a disposable data directory:

```powershell
npm run commissioner:build
npm run commissioner:package -- C:\temp\league-draft-rehearsal
$env:LEAGUE_DRAFT_DATA_DIR = "C:\temp\league-draft-rehearsal-data"
& "C:\temp\league-draft-rehearsal\Start League Draft.cmd"
```

With outbound networking disabled, create or load a prepared synthetic season and rehearse keeper lock, both auction rounds (including a tie), fixed-order drafting, browser refresh, restart, correction preview, verified backup, Results, and CSV/JSON export. Confirm the production UI has no sample controls and `/api/demo/seasons` returns 404. Remove the disposable rehearsal directories afterward; never point a rehearsal at the real draft-day data directory.
