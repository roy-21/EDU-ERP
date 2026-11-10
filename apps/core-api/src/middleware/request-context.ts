import { AsyncLocalStorage } from "node:async_hooks";
import { NextFunction, Request, Response } from "express";

// Where the current request came from, so every audit entry can record it without
// each module passing it along. A MAC address never reaches a web server, so it is not here.
export type RequestInfo = { ip: string; userAgent: string };

const storage = new AsyncLocalStorage<RequestInfo>();

export const currentRequest = (): RequestInfo | null => storage.getStore() || null;

// Express gives the socket's address unless TRUST_PROXY says which proxies may set X-Forwarded-For.
const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 64);

export const requestContext = (req: Request, _res: Response, next: NextFunction) => {
  storage.run({ ip: clientIp(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 500) }, () => next());
};
