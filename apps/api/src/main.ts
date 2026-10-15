import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, type NextFunction, type Request, type Response } from "express";
import { MAX_PACK_BYTES } from "@inconsistable/rules-engine";
import { AppModule } from "./app.module.ts";
import { runMigrations } from "./core/db.ts";
import { assertAdminKey } from "./core/env.ts";
import { clientIp, limiter } from "./core/rate-limit.ts";

assertAdminKey(process.env.ADMIN_KEY);
await runMigrations();
// Body parsing is ours (not Nest's default 100 KB) so the importer routes can take a pack file.
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.setGlobalPrefix("api");
app.enableShutdownHooks();

// The unauthenticated door: guest QR joins, the guest lookup and invites. 60/min leaves room for a whole table of
// phones behind one NAT.
const allowDoor = limiter({ max: 60, windowMs: 60_000 });
app.use(["/api/join", "/api/guest", "/api/invites"], (req: Request, res: Response, next: NextFunction) => {
  if (allowDoor(clientIp(req.headers, req.socket.remoteAddress))) return next();
  res.status(429).json({ message: "Too many requests. Wait a minute." });
});

// Signed-in routes outside a table, per IP for now.
// ponytail: per-IP window; key it by the Clerk user id (as Auspex's library does) once imports and the library land
const allowSignedIn = limiter({ max: 120, windowMs: 60_000 });
app.use(
  ["/api/lobby", "/api/admin", "/api/rulesets", "/api/packs", /^\/api\/campaigns\/[^/]+\/rules/],
  (req: Request, res: Response, next: NextFunction) => {
    if (allowSignedIn(clientIp(req.headers, req.socket.remoteAddress))) return next();
    res.status(429).json({ message: "Too many requests. Wait a minute." });
  },
);

// Admin-key REST calls (scripts), right or wrong key alike, so the key can't be guessed at speed.
const allowAdminKey = limiter({ max: 20, windowMs: 60_000 });
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!req.headers["x-admin-key"] || allowAdminKey(clientIp(req.headers, req.socket.remoteAddress))) return next();
  res.status(429).json({ message: "Too many requests. Wait a minute." });
});

// The importer: a 5 MB file is parsed, validated and written row by row, so a POST gets a tighter window than a read.
// ponytail: per-IP like the rest; per user once the limiter is keyed by Clerk id
const allowImport = limiter({ max: 20, windowMs: 60_000 });
const IMPORT_ROUTES = ["/api/rulesets", "/api/packs"];
app.use(IMPORT_ROUTES, (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "POST" || allowImport(clientIp(req.headers, req.socket.remoteAddress))) return next();
  res.status(429).json({ message: "Too many imports. Wait a minute." });
});

// The JSON parsers, after the limiters so a flood is refused before its body is read. Only the importer takes a big
// body (MAX_PACK_BYTES); everything else keeps express' 100 KB.
app.use(IMPORT_ROUTES, json({ limit: MAX_PACK_BYTES }));
app.use(json());

await app.listen(Number(process.env.PORT ?? 4000));
