import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import { ADMIN_ACTIONS, Action, refusalBody } from "@inconsistable/core-schema";
import { isAdminKey } from "../campaign/campaign.service.ts";
import { TableGateway } from "../table/table.gateway.ts";
import { adminAction, listCampaigns, listEvents, listPacks, logAdminKey, setPackDisabled } from "./admin.service.ts";

const Id = z.uuid();
const Takedown = z.object({ disabled: z.boolean() });

// The admin console's reads and housekeeping, behind the shared `x-admin-key` header.
// ponytail: one shared key, move to an admin account once a provider exists
@Controller("admin")
export class AdminController {
  constructor(@Inject(TableGateway) private readonly table: TableGateway) {}

  private guard(key: string | undefined) {
    if (!key) throw new UnauthorizedException(refusalBody("unauthorized"));
    if (!isAdminKey(key)) throw new ForbiddenException(refusalBody("adminKeyWrong"));
  }

  @Get("campaigns")
  campaigns(@Headers("x-admin-key") key: string | undefined) {
    this.guard(key);
    return listCampaigns();
  }

  // One housekeeping action at one room, OPEN AS ADMIN. Refusals come back as the ActionResult, like a socket ack.
  @Post("campaigns/:id/action")
  @HttpCode(200)
  async action(@Headers("x-admin-key") key: string | undefined, @Param("id") id: string, @Body() body: unknown) {
    this.guard(key);
    const campaignId = Id.safeParse(id);
    if (!campaignId.success) throw new BadRequestException("Not a campaign id");
    const parsed = Action.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    if (!ADMIN_ACTIONS.has(parsed.data.type)) throw new BadRequestException("Not an admin action");
    await logAdminKey({ action: "key.action", campaignId: campaignId.data, detail: parsed.data.type });
    const result = await adminAction(this.table, { campaignId: campaignId.data, action: parsed.data });
    if (!result) throw new NotFoundException("Game not found");
    return result;
  }

  @Get("packs")
  packs(@Headers("x-admin-key") key: string | undefined) {
    this.guard(key);
    return listPacks();
  }

  // Takes a pack down at once (notice-and-takedown), or puts it back.
  @Post("packs/:id/disable")
  @HttpCode(200)
  async disablePack(@Headers("x-admin-key") key: string | undefined, @Param("id") id: string, @Body() body: unknown) {
    this.guard(key);
    const packId = Id.safeParse(id);
    const takedown = Takedown.safeParse(body);
    if (!packId.success || !takedown.success) throw new BadRequestException("Not a takedown request");
    if (!(await setPackDisabled({ packId: packId.data, disabled: takedown.data.disabled })))
      throw new NotFoundException("Pack not found");
    return { ok: true };
  }

  @Get("events")
  events(@Headers("x-admin-key") key: string | undefined) {
    this.guard(key);
    return listEvents();
  }
}
