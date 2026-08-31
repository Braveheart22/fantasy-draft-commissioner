import { describe, expect, it } from "vitest";
import { errorEnvelope } from "../../src/routes/error-envelope.js";
import Fastify from "fastify";
import { registerErrorEnvelope } from "../../src/routes/error-envelope.js";

describe("route error envelope",()=>{
  it.each([
    ["Stale season version",409,"STALE_VERSION"],
    ["Player is unavailable",409,"PLAYER_UNAVAILABLE"],
    ["X-Expected-Season-Version header is required",400,"INVALID_COMMAND_ENVELOPE"],
    ["Unexpected failure",500,"INTERNAL_ERROR"],
  ])("maps %s to a stable commissioner reason",(message,statusCode,code)=>expect(errorEnvelope(Object.assign(new Error(message),{statusCode}))).toEqual({statusCode,code,message:statusCode>=500?"The commissioner application could not complete that request.":message}));

  it.each([
    ["Player is unavailable",409,"PLAYER_UNAVAILABLE"],
    ["Stale season version",409,"STALE_VERSION"],
    ["Only the team currently on the clock may pick",409,"WRONG_TEAM"],
    ["Illegal partial roster: ROSTER_CAPACITY_EXCEEDED",409,"ROSTER_CAPACITY_EXCEEDED"],
    ["Illegal partial roster: UNKNOWN_POSITION",409,"UNKNOWN_POSITION"],
    ["Unknown player",409,"UNKNOWN_PLAYER"],
    ["Expected-Season-Version header is required",400,"INVALID_COMMAND_ENVELOPE"],
  ])("infers a safe HTTP status for plain domain error %s",(message,statusCode,code)=>expect(errorEnvelope(new Error(message))).toEqual({statusCode,code,message}));
});

it("delivers the stable envelope over HTTP",async()=>{const server=Fastify();registerErrorEnvelope(server);server.get("/stale",async()=>{throw Object.assign(new Error("Stale season version"),{statusCode:409});});const response=await server.inject({method:"GET",url:"/stale"});expect(response.json()).toEqual({statusCode:409,code:"STALE_VERSION",message:"Stale season version"});await server.close();});
