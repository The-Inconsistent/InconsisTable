import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { CreateGame, Rename, refusalBody } from "@inconsistable/core-schema";
import { logAdminKey } from "../admin/admin.service.ts";
import { COOKIE, readCookie, resolveCtx, resolveGuest, deviceUser, renameUser } from "../auth/auth.service.ts";
import { acceptInvite, previewInvite } from "../auth/invite.service.ts";
import { db } from "../core/db.ts";
import { cookieSecure } from "../core/env.ts";
import { ActionError } from "../core/errors.ts";
import { TableGateway } from "../table/table.gateway.ts";
import { createCampaign, isAdminKey, lobby } from "./campaign.service.ts";
import { DEFAULT_RULES_PAGE, MAX_RULES_PAGE, readRules } from "./rules.read.ts";

const Join = z.object({ token: z.string().min(1).max(200) });
// Scripts (admin key) name the device user who will own the new room.
const AdminCreate = CreateGame.extend({ ownerUserId: z.string().min(1).max(100).optional() });
const CampaignId = z.uuid();
const InviteCode = z.string().min(1).max(200);
const RulesQuery = z.object({
  type: z.string().min(1).max(64).optional(),
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_RULES_PAGE).default(DEFAULT_RULES_PAGE),
  offset: z.coerce.number().int().min(0).default(0),
});

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(refusalBody("badRequest", { detail: z.prettifyError(r.error) }));
  return r.data;
};

// Client-facing refusals from the services become 400s with their message.
async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    return result;
  } catch (e) {
    if (e instanceof ActionError) throw new BadRequestException(e.body());
    throw e;
  }
}

const headersOf = (req: Request) => ({ cookie: req.headers.cookie });

// A year-long httpOnly cookie holding a guest's player token.
function setGuestCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(process.env.NODE_ENV),
    maxAge: 365 * 24 * 3600 * 1000,
    path: "/",
  });
}

@Controller()
export class CampaignController {
  constructor(@Inject(TableGateway) private readonly table: TableGateway) {}

  // Creators (app_user.role) start rooms in the lobby, and own them; scripts use the admin key.
  @Post("campaigns")
  async create(@Headers("x-admin-key") key: string | undefined, @Req() req: Request, @Body() body: unknown) {
    if (isAdminKey(key)) {
      const { ownerUserId, ...rest } = parse(AdminCreate, body);
      const created = await refusing(() =>
        createCampaign({ ...rest, owner: ownerUserId ? { userId: ownerUserId, name: "GM" } : null }),
      );
      await logAdminKey({ action: "campaign.create", campaignId: created.campaignId, detail: rest.name });
      return created;
    }
    const user = await deviceUser(headersOf(req));
    if (!user) throw new UnauthorizedException(refusalBody("unauthorized"));
    if (!user.creator) throw new ForbiddenException(refusalBody("creatorsOnly"));
    return refusing(() => createCampaign({ ...parse(CreateGame, body), owner: user }));
  }

  @Get("lobby")
  async lobby(@Req() req: Request) {
    const user = await deviceUser(headersOf(req));
    if (!user) throw new UnauthorizedException(refusalBody("unauthorized"));
    return lobby(user);
  }

  // The name this device's user goes by at every table.
  @Patch("me")
  async rename(@Req() req: Request, @Body() body: unknown) {
    const user = await deviceUser(headersOf(req));
    if (!user) throw new UnauthorizedException(refusalBody("unauthorized"));
    const { name } = parse(Rename, body);
    await renameUser(user.userId, name);
    return { name };
  }

  // Who the caller is at this table: their seat, or an admin who opened it without one.
  @Get("campaigns/:id/me")
  async me(@Param("id") id: string, @Req() req: Request) {
    const r = await resolveCtx({ campaignId: parse(CampaignId, id), headers: headersOf(req) });
    if (!r) throw new UnauthorizedException(refusalBody("unauthorized"));
    return r.ctx;
  }

  // The room's pinned ruleset and attached pack entries, filtered for the caller's seat. No seat, no rules.
  @Get("campaigns/:id/rules")
  async rules(@Param("id") id: string, @Req() req: Request, @Query() query: unknown) {
    const r = await resolveCtx({ campaignId: parse(CampaignId, id), headers: headersOf(req) });
    if (!r) throw new UnauthorizedException(refusalBody("unauthorized"));
    return readRules({ ctx: r.ctx, query: parse(RulesQuery, query) });
  }

  // A guest's QR: the token becomes the guest cookie.
  @Post("join")
  @HttpCode(200)
  async join(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { token } = parse(Join, body);
    const ctx = await resolveGuest(token);
    if (!ctx) throw new UnauthorizedException(refusalBody("linkInvalid"));
    setGuestCookie(res, token);
    return ctx;
  }

  // The guest cookie's table, so a returning guest lands back at it.
  @Get("guest")
  async guest(@Req() req: Request) {
    const ctx = await resolveGuest(readCookie({ header: req.headers.cookie }));
    if (!ctx) throw new UnauthorizedException(refusalBody("unauthorized"));
    return ctx;
  }

  @Get("invites/:code")
  async invite(@Param("code") code: string, @Req() req: Request) {
    const user = await deviceUser(headersOf(req));
    return refusing(() => previewInvite({ code: parse(InviteCode, code), user }));
  }

  // Accepting changes who's at the table, so it runs in that table's action queue and rebroadcasts like an action.
  @Post("invites/:code/accept")
  @HttpCode(200)
  async accept(
    @Param("code") code: string,
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await deviceUser(headersOf(req));
    const c = parse(InviteCode, code);
    const preview = await refusing(() => previewInvite({ code: c, user }));
    const result = await refusing(() =>
      this.table.mutate({
        campaignId: preview.campaignId,
        fn: () => db.transaction((tx) => acceptInvite(tx, { code: c, user, body })),
      }),
    );
    if (result.guestToken) setGuestCookie(res, result.guestToken);
    return { campaignId: result.campaignId };
  }
}
