import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commissioner=resolve(dirname(fileURLToPath(import.meta.url)),"..");const root=resolve(commissioner,"../..");const argument=process.argv[2];const destination=argument?(isAbsolute(argument)?resolve(argument):resolve(root,argument)):join(root,"artifacts","league-draft-win-x64");
if(!isAbsolute(destination)||destination===root||root.startsWith(destination+"\\")||root.startsWith(destination+"/")||destination.startsWith(join(commissioner,"dist")+"\\")||destination.startsWith(join(commissioner,"dist")+"/"))throw new Error("Package destination must be a dedicated directory outside the workspace inputs");
try{await stat(destination);throw new Error(`Package destination already exists: ${destination}`);}catch(error){if(error instanceof Error&&!('code'in error&&error.code==="ENOENT"))throw error;}
await mkdir(destination,{recursive:true});
await cp(process.execPath,join(destination,"node.exe"));
const workspaceLink=resolve(root,"node_modules","@league-draft","commissioner");
await cp(join(root,"node_modules"),join(destination,"node_modules"),{recursive:true,dereference:true,filter:source=>resolve(source)!==workspaceLink});
await cp(join(root,"src"),join(destination,"src"),{recursive:true});
await cp(join(commissioner,"dist"),join(destination,"apps","commissioner","dist"),{recursive:true});
await writeFile(join(destination,"Start League Draft.cmd"),'@echo off\r\nsetlocal\r\nif not defined LEAGUE_DRAFT_DATA_DIR set "LEAGUE_DRAFT_DATA_DIR=%LOCALAPPDATA%\\LeagueDraft"\r\n"%~dp0node.exe" "%~dp0apps\\commissioner\\dist\\src\\server\\package-main.js"\r\nif errorlevel 1 pause\r\n');
await writeFile(join(destination,"README.txt"),"League Draft Commissioner (Windows 11 x64)\r\n\r\nRun Start League Draft.cmd. Draft data is stored under %LOCALAPPDATA%\\LeagueDraft unless LEAGUE_DRAFT_DATA_DIR is set. The package performs no downloads and can run without a system Node.js installation. Keep the backups folder with your draft-day files.\r\n");
console.log(destination);
