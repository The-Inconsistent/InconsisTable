"use client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";

import {
  BookPage,
  BookSource,
  Codex,
  LiveState,
  Notice,
  RefusalKey,
  RefusalParamsSchema,
  refused,
  type ActionInput,
  type ActionResult,
  type BookReply,
  type Refused,
} from "@inconsistable/core-schema";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ADMIN_PARAM, ADMIN_PATH, storedAdminKey } from "@/lib/admin/admin";

// What a refusal adds to `error`: the code and params to translate by (an unknown code is dropped, the text stays).
const Refusal = {
  code: RefusalKey.optional().catch(undefined),
  message: z.string().optional(),
  params: RefusalParamsSchema.optional().catch(undefined),
};
// Acks are untrusted socket payloads too; core-schema has only their types, so they're checked against those.
const ActionReply = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    id: z.string().optional(),
    token: z.string().optional(),
    notices: z.array(Notice).optional(),
    skipped: z.array(z.string()).optional(), // who a party rest left out (house decision #81)
  }),
  z.object({ ok: z.literal(false), error: z.string(), ...Refusal }),
]) satisfies z.ZodType<ActionResult>;
// The union of every serving GM's sources (each one capped by BookServing, the union not).
const BookAvailable = z.object({ sources: z.array(BookSource) });
// socket.io-client hands binary over as an ArrayBuffer.
const PageReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), image: z.instanceof(ArrayBuffer) }),
  z.object({ ok: z.literal(false), error: z.string(), ...Refusal }),
]) satisfies z.ZodType<BookReply>;

const DraftReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), error: z.string(), ...Refusal }),
]);

const ACK_TIMEOUT_MS = 5000;
const REFUSED_RETRY_MS = 3000;
const TAP_WINDOW_MS = 1000;
const SENT_MS = 600;
// The GM's tablet renders the page, then the api relays it; the api gives up after 15 s.
const PAGE_TIMEOUT_MS = 20_000;

export type Send = (a: ActionInput) => Promise<ActionResult>;
export type DraftRecap = () => Promise<{ ok: true; text: string } | Refused>;
export type RequestPage = (p: BookPage) => Promise<BookReply>;
export type RenderPage = (p: BookPage) => Promise<BookReply>;

const isAdminTab = () => new URLSearchParams(location.search).has(ADMIN_PARAM);

// One socket per tab, for one table. The browser's cookies authenticate it (the `it_device` cookie, or a guest's QR
// cookie); the server sends a full snapshot on connect and after every change, so reconnecting needs no extra logic.
export function useTable(campaignId: string) {
  const t = useTranslations("socket");
  const tr = useRefusal();
  // The refusal worded for this device: `error` is what the screen shows, the api's English when there are no words.
  const worded = useCallback(<R extends Refused>(r: R): R => ({ ...r, error: tr({ ...r, message: r.error }) }), [tr]);
  const socket = useRef<Socket | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [codex, setCodex] = useState<Codex | null>(null);
  const [online, setOnline] = useState(false);
  // How many times someone touched the X-Card (safety:xcard carries no one: it is a count, never a name).
  const [xcard, setXcard] = useState(0);
  // Sources a GM tablet is serving right now (book:available); a cite in one of them opens its page.
  const [books, setBooks] = useState<BookSource[]>([]);
  // What this seat's last accepted action was told (house decision #79): gone with the next action, or when dismissed.
  const [notices, setNotices] = useState<Notice[]>([]);
  // GM only: what this tab serves, re-announced on every reconnect (the server forgets it with the old socket).
  const serving = useRef<{ sources: BookSource[]; render: RenderPage } | null>(null);

  // External system: the Socket.IO connection to the api.
  useEffect(() => {
    // OPEN AS ADMIN (/admin sends `?admin=1`): the admin key, kept in this tab, is the seat. Everyone else: the cookies.
    const adminKey = isAdminTab() ? storedAdminKey() : null;
    const s = io({ withCredentials: true, auth: adminKey ? { campaignId, adminKey } : { campaignId } });
    socket.current = s;
    let retry: ReturnType<typeof setTimeout> | undefined;
    s.on("connect", () => {
      setOnline(true);
      if (serving.current) s.emit("book:serving", { sources: serving.current.sources });
    });
    s.on("disconnect", (reason) => {
      setOnline(false);
      setBooks([]);
      // Our own close (unmount, campaign change): stay closed.
      if (reason === "io client disconnect") return;
      // A kicked seat (removed, re-appointed, a held character gone): the page's `me` is
      // stale, so reload it from the server; a dead seat lands on the NO ACCESS screen.
      if (reason === "io server disconnect") return location.reload();
      if (!s.active) retry = setTimeout(() => s.connect(), REFUSED_RETRY_MS);
    });
    // socket.io doesn't retry a refusal from the server's auth middleware. A dead seat reloads into the NO ACCESS
    // screen; anything else (DB blip) retries.
    s.on("connect_error", (err) => {
      if (s.active) return; // transport error: socket.io is already reconnecting
      if (err.message === "unauthorized") return isAdminTab() ? location.assign(ADMIN_PATH) : location.reload();
      else retry = setTimeout(() => s.connect(), REFUSED_RETRY_MS);
    });
    // Two api nodes may deliver broadcasts out of order: never step back to an older snapshot.
    // A payload that doesn't parse is dropped: the last good snapshot stays on screen.
    s.on("state", (raw: unknown) => {
      const parsed = LiveState.safeParse(raw);
      if (!parsed.success) return;
      const next = parsed.data;
      setState((cur) => (cur && cur.stateVersion > next.stateVersion ? cur : next));
    });
    s.on("codex", (raw: unknown) => {
      const parsed = Codex.safeParse(raw);
      if (parsed.success) setCodex(parsed.data);
    });
    s.on("safety:xcard", () => setXcard((n) => n + 1));
    s.on("book:available", (raw: unknown) => {
      const parsed = BookAvailable.safeParse(raw);
      if (parsed.success) setBooks(parsed.data.sources);
    });
    s.on("book:request", async (raw: unknown, ack: (r: BookReply) => void) => {
      const render = serving.current?.render;
      // Relayed to the player who asked: the code lets that phone word it in its own language.
      if (!render) return ack(refused("bookNotServed"));
      const page = BookPage.safeParse(raw);
      if (!page.success) return ack(refused("bookMalformed"));
      try {
        ack(await render(page.data));
      } catch {
        ack(refused("bookRenderFailed"));
      }
    });
    return () => {
      clearTimeout(retry);
      s.close();
    };
  }, [campaignId]);

  // External system: the Screen Wake Lock API. Phones and tablets shouldn't dim mid-session; re-acquired when the tab
  // comes back.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Denied (battery saver, unsupported, tab hidden): the screen may dim, nothing else breaks.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  // External system: the DOM. Remembers the last tapped button so `send` can mark it: iOS doesn't focus a tapped
  // button, so document.activeElement alone would miss phone taps.
  const tapped = useRef<{ el: HTMLButtonElement; at: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("button") : null;
      tapped.current = el && { el, at: performance.now() };
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Tap feedback (globals.css): the tapped button dims until the server answers, then rings once, applied or refused.
  const send: Send = useCallback(
    async (a) => {
      const last = tapped.current;
      const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
      const btn = focused ?? (last && performance.now() - last.at < TAP_WINDOW_MS ? last.el : null);
      btn?.setAttribute("aria-busy", "true");
      setNotices([]);
      const result = await emit({
        socket: socket.current,
        action: a,
        words: { noSignal: t("noSignal"), unreadable: t("unreadable"), noReply: t("noReply") },
      });
      if (btn) {
        btn.removeAttribute("aria-busy");
        btn.setAttribute("data-sent", result.ok ? "ok" : "no");
        setTimeout(() => btn.removeAttribute("data-sent"), SENT_MS);
      }
      if (result.ok && result.notices) setNotices(result.notices);
      return result.ok ? result : worded(result);
    },
    [t, worded],
  );
  const dismissNotices = useCallback(() => setNotices([]), []);

  const requestPage: RequestPage = useCallback(
    async (p) => {
      const s = socket.current;
      if (!s?.connected) return { ok: false, error: t("noSignal") };
      try {
        const reply = PageReply.safeParse(await s.timeout(PAGE_TIMEOUT_MS).emitWithAck("book:request", p));
        if (!reply.success) return { ok: false, error: t("pageDamaged") };
        return reply.data.ok ? reply.data : worded(reply.data);
      } catch {
        return { ok: false, error: t("pageNoReply") };
      }
    },
    [t, worded],
  );

  // The running session as draft recap lines (needs session:run).
  const draftRecap: DraftRecap = useCallback(async () => {
    const s = socket.current;
    if (!s?.connected) return { ok: false, error: t("noSignal") };
    try {
      const reply = DraftReply.safeParse(await s.timeout(ACK_TIMEOUT_MS).emitWithAck("session:draftRecap"));
      if (!reply.success) return { ok: false, error: t("unreadable") };
      return reply.data.ok ? reply.data : worded(reply.data);
    } catch {
      return { ok: false, error: t("noReply") };
    }
  }, [t, worded]);

  // GM: serve these sources with `render`, or stop (null or no sources).
  const serveBooks = useCallback((next: { sources: BookSource[]; render: RenderPage } | null) => {
    serving.current = next?.sources.length ? next : null;
    socket.current?.emit("book:serving", { sources: next?.sources ?? [] });
  }, []);

  return { state, codex, online, send, draftRecap, books, requestPage, serveBooks, xcard, notices, dismissNotices };
}

type EmitWords = { noSignal: string; unreadable: string; noReply: string };

async function emit({
  socket: s,
  action,
  words,
}: {
  socket: Socket | null;
  action: ActionInput;
  words: EmitWords;
}): Promise<ActionResult> {
  if (!s?.connected) return { ok: false, error: words.noSignal };
  try {
    const reply = ActionReply.safeParse(await s.timeout(ACK_TIMEOUT_MS).emitWithAck("action", action));
    return reply.success ? reply.data : { ok: false, error: words.unreadable };
  } catch {
    // It may still have applied: counters are deltas, so check the screen before tapping again.
    return { ok: false, error: words.noReply };
  }
}
