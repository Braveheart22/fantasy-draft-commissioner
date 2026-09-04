import { startCommissionerServer } from "./startup.js";

const port = Number.parseInt(process.env.LEAGUE_DRAFT_PORT ?? "4173", 10);
const { DemoService } = await import("../application/demo/demo-service.js");
const { registerDemoRoutes } = await import("../routes/demo/demo-routes.js");
const application = await startCommissionerServer({ port, registerProfileRoutes: async (server, services) => registerDemoRoutes(server, new DemoService(services.setup)) });
console.log(`League Draft demo profile listening at http://${application.address.host}:${application.address.port}`);
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await application.stop();};process.once("SIGINT",()=>{void stop().then(()=>process.exit(0));});process.once("SIGTERM",()=>{void stop().then(()=>process.exit(0));});
