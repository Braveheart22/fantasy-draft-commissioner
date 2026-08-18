import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const digest=(content:string)=>createHash("sha256").update(content).digest("hex");
export async function writeExportBundle(directory:string,json:string,csv:string){
  await mkdir(directory,{recursive:true});
  const jsonPath=join(directory,"final-rosters.json");const csvPath=join(directory,"final-rosters.csv");const jsonTemp=`${jsonPath}.tmp`;const csvTemp=`${csvPath}.tmp`;
  try{await writeFile(jsonTemp,json,{flag:"wx"});await writeFile(csvTemp,csv,{flag:"wx"});await rename(jsonTemp,jsonPath);try{await rename(csvTemp,csvPath);}catch(error){await rm(jsonPath,{force:true});throw error;}return{jsonPath,jsonSha256:digest(json),csvPath,csvSha256:digest(csv)};}
  finally{await rm(jsonTemp,{force:true});await rm(csvTemp,{force:true});}
}
