import { Module } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.ts";
import { AccountController } from "./auth/account.controller.ts";
import { SignInController } from "./auth/sign-in.controller.ts";
import { CampaignController } from "./campaign/campaign.controller.ts";
import { HealthController } from "./health/health.controller.ts";
import { PackController } from "./pack/pack.controller.ts";
import { TableGateway } from "./table/table.gateway.ts";

@Module({
  controllers: [
    AccountController,
    AdminController,
    CampaignController,
    HealthController,
    PackController,
    SignInController,
  ],
  providers: [TableGateway],
})
export class AppModule {}
