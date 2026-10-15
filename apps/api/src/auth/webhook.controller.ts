import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { readUserWebhook } from "@inconsistable/auth/api";
import { db } from "../core/db.ts";
import { TableGateway } from "../table/table.gateway.ts";
import { appUser } from "./auth.schema.ts";
import { applyUserWebhook } from "./webhook.service.ts";

const SVIX_HEADERS = ["svix-id", "svix-timestamp", "svix-signature"];

// Clerk's webhooks (Dashboard, Webhooks: user.updated and user.deleted), signed with CLERK_WEBHOOK_SECRET. main.ts
// rate-limits the route and hands it the body as the raw text the signature covers.
@Controller("webhooks")
export class WebhookController {
  constructor(@Inject(TableGateway) private readonly table: TableGateway) {}

  @Post("clerk")
  @HttpCode(200)
  async clerk(@Req() req: Request) {
    const signingSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!signingSecret) throw new ServiceUnavailableException("Webhooks are not configured");
    const headers = new Headers();
    for (const h of SVIX_HEADERS) {
      const v = req.headers[h];
      if (typeof v === "string") headers.set(h, v);
    }
    const body = typeof req.body === "string" ? req.body : "";
    const change = await readUserWebhook({
      request: new Request("http://localhost/", { method: "POST", headers, body }),
      signingSecret,
    }).catch(() => {
      throw new BadRequestException("Invalid webhook");
    });
    if (!change) return { ok: true };
    await applyUserWebhook(change, {
      table: this.table,
      storedRole: async (userId) =>
        (await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, userId)))[0]?.role,
    });
    return { ok: true };
  }
}
