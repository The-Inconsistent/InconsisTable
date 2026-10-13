import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ADMIN_ACTIONS, Action } from "@inconsistable/core-schema";
import { signedInUser } from "../auth/auth.service.ts";
import { TableGateway } from "../table/table.gateway.ts";
import { adminAction, listCampaigns, listEvents, listPacks, setLock, setPackDisabled } from "./admin.service.ts";

const Id = z.uuid();
const UserId = z.string().min(1).max(100);
const Lock = z.object({ locked: z.boolean() });
const Takedown = z.object({ disabled: z.boolean() });

// The admin console's reads and housekeeping. Platform roles come from the verified Clerk token only; the app never
// changes them (they are edited in the Clerk Dashboard).
@Controller("admin")
export class AdminController {
  constructor(@Inject(TableGateway) private readonly table: TableGateway) {}

  private async caller(req: Request, { moderatorOk = false } = {}) {
    const user = await signedInUser({ authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (!user) throw new UnauthorizedException();
    if (!user.admin && !(moderatorOk && user.moderator)) throw new ForbiddenException("Admins only");
    return user;
  }

  @Get("campaigns")
  async campaigns(@Req() req: Request) {
    await this.caller(req);
    return listCampaigns();
  }

  // One housekeeping action at one room, OPEN AS ADMIN. Refusals come back as the ActionResult, like a socket ack.
  @Post("campaigns/:id/action")
  @HttpCode(200)
  async action(@Param("id") id: string, @Req() req: Request, @Body() body: unknown) {
    const admin = await this.caller(req);
    const campaignId = Id.safeParse(id);
    if (!campaignId.success) throw new BadRequestException("Not a campaign id");
    const parsed = Action.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    if (!ADMIN_ACTIONS.has(parsed.data.type)) throw new BadRequestException("Not an admin action");
    const result = await adminAction(this.table, {
      adminId: admin.userId,
      campaignId: campaignId.data,
      action: parsed.data,
    });
    if (!result) throw new NotFoundException("Game not found");
    return result;
  }

  // Moderators lock and unlock ordinary accounts (docs/design.md §3.6).
  @Post("users/:id/lock")
  @HttpCode(200)
  async lock(@Param("id") id: string, @Req() req: Request, @Body() body: unknown) {
    const actor = await this.caller(req, { moderatorOk: true });
    const userId = UserId.safeParse(id);
    const lock = Lock.safeParse(body);
    if (!userId.success || !lock.success) throw new BadRequestException("Not a lock request");
    if (userId.data === actor.userId) throw new BadRequestException("You can't lock yourself");
    const r = await setLock(this.table, { actorUserId: actor.userId, userId: userId.data, locked: lock.data.locked });
    if (r === "not-found") throw new NotFoundException("User not found");
    if (r === "protected") throw new ForbiddenException("Admins and moderators are managed in Clerk");
    return { ok: true };
  }

  @Get("packs")
  async packs(@Req() req: Request) {
    await this.caller(req);
    return listPacks();
  }

  // Takes a pack down at once (notice-and-takedown), or puts it back. Admins only: moderators handle accounts.
  @Post("packs/:id/disable")
  @HttpCode(200)
  async disablePack(@Param("id") id: string, @Req() req: Request, @Body() body: unknown) {
    const admin = await this.caller(req);
    const packId = Id.safeParse(id);
    const takedown = Takedown.safeParse(body);
    if (!packId.success || !takedown.success) throw new BadRequestException("Not a takedown request");
    if (!(await setPackDisabled({ actorUserId: admin.userId, packId: packId.data, disabled: takedown.data.disabled })))
      throw new NotFoundException("Pack not found");
    return { ok: true };
  }

  @Get("events")
  async events(@Req() req: Request) {
    await this.caller(req);
    return listEvents();
  }
}
