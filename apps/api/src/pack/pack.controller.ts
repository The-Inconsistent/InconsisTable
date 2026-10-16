import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import { refusalBody } from "@inconsistable/core-schema";
import { z } from "zod";
import { signedInUser } from "../auth/auth.service.ts";
import { ImportRefused } from "../core/errors.ts";
import { importRuleset, listRulesets } from "../ruleset/ruleset.import.ts";
import { exportPack, hidePack, importPack, listMyPacks } from "./pack.import.ts";

const PackId = z.uuid();

// The owner's library, outside any table (docs/design.md §5.3): what they import is theirs alone until sharing exists.
// Every route is for a signed-in user and touches only that user's rows. The body limit (5 MB) is set in main.ts.
@Controller()
export class PackController {
  private async caller(req: Request) {
    const user = await signedInUser({ authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (!user) throw new UnauthorizedException(refusalBody("unauthorized"));
    return user;
  }

  // A refused import answers 422 with its problems by path, so the importer can show them next to the field.
  private async refusing<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      return result;
    } catch (e) {
      if (e instanceof ImportRefused)
        throw new UnprocessableEntityException({
          ok: false,
          ...refusalBody("importRefused"),
          problems: e.problems,
          warnings: e.warnings,
        });
      throw e;
    }
  }

  private packId(id: string) {
    const parsed = PackId.safeParse(id);
    if (!parsed.success) throw new BadRequestException(refusalBody("notAPackId"));
    return parsed.data;
  }

  @Post("rulesets")
  async importRuleset(@Req() req: Request, @Body() body: unknown) {
    const user = await this.caller(req);
    return this.refusing(() => importRuleset({ userId: user.userId, input: body }));
  }

  @Get("rulesets")
  async rulesets(@Req() req: Request) {
    const user = await this.caller(req);
    return listRulesets(user.userId);
  }

  @Post("packs")
  async importPack(@Req() req: Request, @Body() body: unknown) {
    const user = await this.caller(req);
    return this.refusing(() => importPack({ userId: user.userId, input: body }));
  }

  @Get("packs")
  async packs(@Req() req: Request) {
    const user = await this.caller(req);
    return listMyPacks(user.userId);
  }

  // The owner's own JSON back, as importPack takes it. Anyone else's pack answers like a missing one.
  @Get("packs/:id/export")
  async export(@Param("id") id: string, @Req() req: Request) {
    const user = await this.caller(req);
    const out = await exportPack({ userId: user.userId, packId: this.packId(id) });
    if (out === null) throw new NotFoundException(refusalBody("packNotFound"));
    if (out === "disabled") throw new ForbiddenException(refusalBody("packTakenDown"));
    return out;
  }

  @Post("packs/:id/hide")
  @HttpCode(200)
  async hide(@Param("id") id: string, @Req() req: Request) {
    const user = await this.caller(req);
    const out = await hidePack({ userId: user.userId, packId: this.packId(id) });
    if (!out) throw new NotFoundException(refusalBody("packNotFound"));
    return out;
  }
}
