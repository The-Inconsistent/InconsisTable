import { Module } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.ts";
import { CampaignController } from "./campaign/campaign.controller.ts";
import { HealthController } from "./health/health.controller.ts";
import { PackController } from "./pack/pack.controller.ts";
import { TableGateway } from "./table/table.gateway.ts";

@Module({
  controllers: [AdminController, CampaignController, HealthController, PackController],
  providers: [TableGateway],
})
export class AppModule {}
