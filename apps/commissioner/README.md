# League Draft Commissioner

The Commissioner is a loopback-only Windows application. Build and package it with:

```powershell
npm run commissioner:build
npm run commissioner:package -- C:\path\to\league-draft-win-x64
```

The generated folder contains its own Node runtime, application assets, Phase 1 engine, and dependencies. `Start League Draft.cmd` opens the local UI, uses `%LOCALAPPDATA%\LeagueDraft` by default, and selects a safe alternate loopback port if 4173 is occupied. It performs no draft-day downloads.

Stop the application before restoring a backup:

```powershell
npm run commissioner:restore -- C:\path\commissioner.db C:\path\backup.db.manifest.json
```

Restore verifies integrity, schema compatibility, and checksum; retains the current database as a rollback copy; and restores it if candidate activation fails.
