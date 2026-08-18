import {spawn} from "node:child_process";
import {once} from "node:events";
import {existsSync} from "node:fs";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach,describe,expect,it} from "vitest";
import {CURRENT_SCHEMA_VERSION,migrateDatabaseInPlace} from "../../src/infrastructure/sqlite/migrations.js";
import {BackupCoordinator} from "../../src/infrastructure/files/backup-coordinator.js";
import {RecoveryService} from "../../src/application/recovery/recovery-service.js";
import {CheckpointService} from "../../src/application/backups/checkpoint-service.js";

const dirs:string[]=[];
async function fixture(){const dir=await mkdtemp(join(tmpdir(),"u6-recovery-"));dirs.push(dir);const path=join(dir,"commissioner.db");migrateDatabaseInPlace(path);return{dir,path};}
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});

describe("verified backup and staged restore",()=>{
  it("uses an integrity-checked online snapshot with checksum manifest and retains rollback copy",async()=>{const {dir,path}=await fixture();const db=new Database(path);db.prepare("INSERT INTO League(id,name) VALUES('l','League')").run();db.close();const coordinator=new BackupCoordinator(path);const receipt=await coordinator.create(join(dir,"backups"),{trigger:"MANUAL"});expect((await coordinator.verify(receipt.manifestPath)).sha256).toBe(receipt.sha256);const mutate=new Database(path);mutate.prepare("UPDATE League SET name='Changed'").run();mutate.close();const restored=await coordinator.restore(receipt.manifestPath);expect(restored.rollbackPath).toContain(".rollback");const active=new Database(path,{readonly:true});expect((active.prepare("SELECT name FROM League").get() as {name:string}).name).toBe("League");active.close();});
  it("rejects corrupted payloads and preserves the canonical database on activation failure",async()=>{const {dir,path}=await fixture();const coordinator=new BackupCoordinator(path);const receipt=await coordinator.create(join(dir,"backups"),{trigger:"MANUAL"});await writeFile(receipt.path,Buffer.concat([await readFile(receipt.path),Buffer.from("corrupt")]));await expect(coordinator.verify(receipt.manifestPath)).rejects.toThrow(/checksum|integrity/i);const clean=await coordinator.create(join(dir,"backups"),{trigger:"MANUAL"});await expect(coordinator.restore(clean.manifestPath,{afterActivate(){throw new Error("activation failed");}})).rejects.toThrow("activation failed");expect(new RecoveryService(path).summary().integrity).toBe("ok");expect(existsSync(path)).toBe(true);expect(existsSync(clean.path)).toBe(true);});
  it("rejects newer schemas before staging and leaves the active database untouched",async()=>{const {dir,path}=await fixture();const coordinator=new BackupCoordinator(path);const receipt=await coordinator.create(join(dir,"backups"),{trigger:"MANUAL"});const manifest=JSON.parse(await readFile(receipt.manifestPath,"utf8")) as {schemaVersion:number};manifest.schemaVersion=CURRENT_SCHEMA_VERSION+1;await writeFile(receipt.manifestPath,JSON.stringify(manifest));await expect(coordinator.restore(receipt.manifestPath)).rejects.toThrow(/newer than supported/i);expect(new RecoveryService(path).summary()).toMatchObject({integrity:"ok",schemaVersion:CURRENT_SCHEMA_VERSION,compatible:true});expect(existsSync(path)).toBe(true);});
  it("reports abandoned backup and restore stages without disturbing canonical copies",async()=>{const {dir,path}=await fixture();const backupDir=join(dir,"backups");const coordinator=new BackupCoordinator(path);const receipt=await coordinator.create(backupDir,{trigger:"MANUAL"});const abandonedBackup=join(backupDir,"interrupted.db.tmp");const abandonedManifest=join(backupDir,"interrupted.db.manifest.json.tmp");const abandonedRestore=`${path}.interrupted.restore`;await writeFile(abandonedBackup,"partial");await writeFile(abandonedManifest,"partial");await writeFile(abandonedRestore,"partial");const summary=new RecoveryService(path).summary();expect(existsSync(path)).toBe(true);expect(existsSync(receipt.path)).toBe(true);expect(summary.interruptedOperations).toEqual(expect.arrayContaining([abandonedBackup,abandonedManifest,abandonedRestore]));});
});

describe("restart recovery",()=>{
  it("recovers the last acknowledged command after forced child-process termination",async()=>{const {path}=await fixture();const script=`const Database=require('better-sqlite3');const db=new Database(${JSON.stringify(path)});db.pragma('journal_mode=WAL');db.prepare(\"INSERT INTO League(id,name) VALUES('child','Acknowledged')\").run();process.stdout.write('ACK\\n');setInterval(()=>{},1000);`;const child=spawn(process.execPath,["-e",script],{stdio:["ignore","pipe","inherit"]});await once(child.stdout!,"data");child.kill("SIGKILL");await once(child,"exit");const reopened=new Database(path,{readonly:true});expect((reopened.prepare("SELECT name FROM League WHERE id='child'").get() as {name:string}).name).toBe("Acknowledged");reopened.close();expect(new RecoveryService(path).summary().integrity).toBe("ok");});
});

describe("automatic checkpoints",()=>{
  it("creates a verified, version-bound backup record before a risky transition",async()=>{const {dir,path}=await fixture();const db=new Database(path);db.exec("INSERT INTO League(id,name) VALUES('l','L'); INSERT INTO Season(id,leagueId,year,name,state,teamCount,rowVersion,active,createdAt,updatedAt) VALUES('s','l',2026,'S','SETUP',1,3,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");db.close();await new CheckpointService(path,join(dir,"backups")).before({actor:{type:"LOCAL_COMMISSIONER",label:"Test"},seasonId:"s",commandType:"LOCK",idempotencyKey:"lock",expectedVersion:3},"PRE_KEEPER_LOCK");const check=new Database(path,{readonly:true});const record=check.prepare("SELECT trigger,seasonVersion,path,manifestPath FROM BackupRecord").get() as Record<string,unknown>;check.close();expect(record).toMatchObject({trigger:"PRE_KEEPER_LOCK",seasonVersion:3});expect(existsSync(String(record.path))).toBe(true);expect(existsSync(String(record.manifestPath))).toBe(true);});
});
