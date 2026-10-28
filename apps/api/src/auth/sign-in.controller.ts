import { Body, Controller, Get, Inject, Logger, NotFoundException, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { OIDC_TX_COOKIE, SESSION_COOKIE, type AuthUser } from "@inconsistable/auth/api";
import { TableGateway } from "../table/table.gateway.ts";
import { deviceUser, readCookie } from "./auth.service.ts";
import { SESSION_MAX_MS } from "./session.schema.ts";
import { loadSignInConfig, safeReturnTo } from "./sign-in.rules.ts";
import { endSessionByToken, signInFlows } from "./sign-in.service.ts";

// Read once at boot (main.ts imports this through AppModule): a bad config refuses to boot; no config means sign-in
// is off and every route below but /me and /logout answers 404.
const SIGN_IN = loadSignInConfig(process.env);
export const signIn = SIGN_IN && signInFlows(SIGN_IN);

// `__Host-` cookies (§7.1, §7.4). Secure even on http://localhost, which Chromium treats as a secure context.
const COOKIE: CookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
const TX_MAX_AGE_MS = 600_000;

const LoginBody = z.object({ returnTo: z.string().max(200).optional() }).catch({});
const LogoutBody = z.object({ logout_token: z.string().min(1).max(8000) });

// What /api/auth/me answers: whether this deployment signs in at all, the caller's name (null before the device has
// an identity), and the signed-in account's roles (null for an anonymous device user).
const meOf = (user: AuthUser | null) => ({
  signInEnabled: signIn !== null,
  name: user?.name ?? null,
  account: user?.account ?? null,
});

const signInFailed = (res: Response) => res.redirect(303, "/?signin=failed");

// Sign in, sign out and the back-channel logout (house decision #35: REST writes outside the single mutation path).
// The CSRF middleware (main.ts) already holds every write but the back-channel to the web's origin.
@Controller("auth")
export class SignInController {
  private readonly log = new Logger(SignInController.name);
  constructor(@Inject(TableGateway) private readonly table: TableGateway) {}

  @Get("me")
  async me(@Req() req: Request) {
    return meOf(await deviceUser({ cookie: req.headers.cookie }));
  }

  // A form POST from the lobby, never a link (§7.1). Its cookies are set for the callback's origin, so it must come
  // from there: a LAN address over http would lose them.
  @Post("login")
  async login(@Req() req: Request, @Body() body: unknown, @Res() res: Response) {
    if (!signIn) throw new NotFoundException();
    if (req.headers.origin !== signIn.config.webOrigin) return signInFailed(res);
    const user = await deviceUser({ cookie: req.headers.cookie });
    const { handle, url } = await signIn.start({
      deviceUserId: user && !user.account ? user.userId : null,
      returnTo: safeReturnTo(LoginBody.parse(body).returnTo),
    });
    res.cookie(OIDC_TX_COOKIE, handle, { ...COOKIE, maxAge: TX_MAX_AGE_MS });
    res.redirect(303, url.href);
  }

  // The provider's redirect back. Any refusal is one generic page; the reason goes to the log only.
  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    if (!signIn) throw new NotFoundException();
    const cookie = req.headers.cookie;
    res.clearCookie(OIDC_TX_COOKIE, COOKIE);
    const result = await signIn.finish({
      handle: readCookie({ header: cookie, name: OIDC_TX_COOKIE }),
      callbackUrl: req.originalUrl,
      previousSession: readCookie({ header: cookie, name: SESSION_COOKIE }),
    });
    if (!result.ok) {
      this.log.warn(`sign-in refused: ${result.reason}`);
      return signInFailed(res);
    }
    this.table.endSessions(result.ended);
    this.log.log(`signed in: user ${result.userId}`);
    res.cookie(SESSION_COOKIE, result.token, { ...COOKIE, maxAge: SESSION_MAX_MS });
    res.redirect(303, result.returnTo);
  }

  // Ends the api session and its sockets, then hands over to the provider, which asks before ending its own.
  @Post("logout")
  async logout(@Req() req: Request, @Res() res: Response) {
    const token = readCookie({ header: req.headers.cookie, name: SESSION_COOKIE });
    const { ended, redirect } = signIn
      ? await signIn.logout(token)
      : { ended: await endSessionByToken(token), redirect: "/" };
    this.table.endSessions(ended);
    this.log.log(`signed out: ${ended.length} session(s) ended`);
    res.clearCookie(SESSION_COOKIE, COOKIE);
    res.redirect(303, redirect);
  }

  // The provider, server to server (§7.6): reads no cookie, answers 200 or 400 and is never cached.
  @Post("backchannel-logout")
  async backchannelLogout(@Body() body: unknown, @Res() res: Response) {
    if (!signIn) throw new NotFoundException();
    res.set("Cache-Control", "no-store");
    const parsed = LogoutBody.safeParse(body);
    const result = parsed.success ? await signIn.receiveLogout(parsed.data.logout_token) : null;
    if (!result?.ok) {
      this.log.warn(`back-channel logout refused: ${result?.reason ?? "no logout_token"}`);
      return res.sendStatus(400);
    }
    this.table.endSessions(result.ended);
    this.log.log(`back-channel logout: ${result.ended.length} session(s) ended`);
    res.sendStatus(200);
  }
}
