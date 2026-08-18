import { spawn } from "node:child_process";
import { startCommissionerServer } from "./startup.js";

const configuredPort=Number.parseInt(process.env.LEAGUE_DRAFT_PORT??"4173",10);
if(!Number.isSafeInteger(configuredPort)||configuredPort<0||configuredPort>65535)throw new Error("LEAGUE_DRAFT_PORT must be an integer from 0 through 65535");
let application;
try{application=await startCommissionerServer({port:configuredPort});}catch(error){if(configuredPort!==0&&(error as NodeJS.ErrnoException).code==="EADDRINUSE"){console.warn(`Port ${configuredPort} is busy; selecting a safe loopback port.`);application=await startCommissionerServer({port:0});}else throw error;}
const url=`http://${application.address.host}:${application.address.port}`;console.log(`League Draft Commissioner listening at ${url}`);console.log(`Data directory: ${application.dataDirectory}`);
if(process.env.LEAGUE_DRAFT_NO_BROWSER!=="1")spawn("cmd.exe",["/c","start","",url],{detached:true,stdio:"ignore",windowsHide:true}).unref();
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await application.stop();};process.once("SIGINT",()=>{void stop().then(()=>process.exit(0));});process.once("SIGTERM",()=>{void stop().then(()=>process.exit(0));});
