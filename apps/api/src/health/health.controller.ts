import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { db } from "../core/db.ts";
import { assertDbUp } from "./health.service.ts";

// For the platform's restart check. Unauthenticated; answers 200 or 503 and nothing else.
@Controller("health")
export class HealthController {
  @Get()
  async check() {
    await assertDbUp(() => db.execute(sql`select 1`));
  }
}
