import type { FastifyInstance } from "fastify";

export interface ErrorEnvelope { statusCode:number; code:string; message:string }

function errorCode(error: Error, statusCode: number): string {
  if (/Idempotency-Key|Expected-Season-Version/i.test(error.message)) return "INVALID_COMMAND_ENVELOPE";
  if (/stale|version/i.test(error.message)) return "STALE_VERSION";
  if (/unavailable/i.test(error.message)) return "PLAYER_UNAVAILABLE";
  return statusCode >= 500 ? "INTERNAL_ERROR" : "COMMAND_REJECTED";
}

function errorStatus(error: Error & { statusCode?: number }): number {
  if (error.statusCode !== undefined) return error.statusCode;
  if (/Idempotency-Key|Expected-Season-Version/i.test(error.message)) return 400;
  if (/stale|version|unavailable/i.test(error.message)) return 409;
  return 500;
}

export function errorEnvelope(error:Error&{statusCode?:number}):ErrorEnvelope{
  const statusCode=errorStatus(error);
  const message=statusCode>=500?"The commissioner application could not complete that request.":error.message;
  const code=errorCode(error,statusCode);
  return{statusCode,code,message};
}
export function registerErrorEnvelope(server:FastifyInstance){server.setErrorHandler((error,_request,reply)=>{const normalized=error instanceof Error?error:new Error("Unexpected failure");const envelope=errorEnvelope(normalized);return reply.code(envelope.statusCode).send(envelope);});}
