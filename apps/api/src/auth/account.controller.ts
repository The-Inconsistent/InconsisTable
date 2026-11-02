import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Logger,
  NotFoundException,
  Patch,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { IdpError } from "@the-inconsistent/client";
import { RenameAccount, refusalBody } from "@inconsistable/core-schema";
import { readAccount, renameAccount, type AccountIdp, type AccountView } from "./account.service.ts";
import { deviceUser } from "./auth.service.ts";
import { signIn } from "./sign-in.controller.ts";
import { accountRefusal, idpAccountUrl } from "./sign-in.rules.ts";

const IDP: AccountIdp | null = signIn && {
  issuer: signIn.config.issuer,
  manageUrl: idpAccountUrl(signIn.config),
  client: signIn.warm,
};

// The signed-in account's own page (house decision #35: a user's own sign-in methods are owner-scoped REST). Off
// without sign-in, like the sign-in routes; an anonymous device user has no account to show.
@Controller("account")
export class AccountController {
  private readonly log = new Logger(AccountController.name);

  @Get()
  @Header("Cache-Control", "no-store")
  async read(@Req() req: Request) {
    const { idp, userId } = await this.caller(req);
    return this.answer(() => readAccount(idp, userId));
  }

  @Patch()
  @Header("Cache-Control", "no-store")
  async rename(@Req() req: Request, @Body() body: unknown) {
    const { idp, userId } = await this.caller(req);
    const parsed = RenameAccount.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody("badRequest", { detail: z.prettifyError(parsed.error) }));
    }
    return this.answer(() => renameAccount(idp, { userId, displayName: parsed.data.displayName }));
  }

  private async caller(req: Request) {
    if (!IDP) throw new NotFoundException();
    const user = await deviceUser({ cookie: req.headers.cookie });
    if (!user?.account) throw new UnauthorizedException(refusalBody("unauthorized"));
    return { idp: IDP, userId: user.userId };
  }

  // The provider's refusals become a status and a code; the SDK's code goes to the log only.
  private async answer(fn: () => Promise<AccountView | null>) {
    try {
      const view = await fn();
      if (!view) throw new NotFoundException(refusalBody("accountNotFound"));
      return view;
    } catch (error) {
      if (!(error instanceof IdpError)) throw error;
      this.log.warn(`account API refused: ${error.code}`);
      const { status, key, params } = accountRefusal(error.code);
      throw new HttpException(refusalBody(key, params), status);
    }
  }
}
