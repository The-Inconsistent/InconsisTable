package table

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zishang520/socket.io/servers/socket/v3"
	"github.com/zishang520/socket.io/v3/pkg/types"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/admin"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

const (
	// PageTimeout is how long a page request waits on the GM's tablet.
	PageTimeout = 15 * time.Second
	// MaxPagesInFlight is the page requests waiting on a GM tablet at once, per campaign.
	//
	// ponytail: in-process counter, one api instance and one flat cap for the whole table; per-seat caps or a queue if
	// a table needs more.
	MaxPagesInFlight = 8
	// KickGrace is how long a kicked socket keeps its transport after the disconnect packet, and how long a kick that
	// reaches the sender waits so the ack lands first.
	KickGrace = 200 * time.Millisecond
)

func room(campaignID string) socket.Room { return socket.Room("c:" + campaignID) }

// One room per signed-in session, so ending a session disconnects exactly its sockets (§7.7).
func sessionRoom(tokenHash string) socket.Room { return socket.Room("s:" + tokenHash) }

// seat is what a socket carries: who it is, the key of its seat (the rate limits' key), whether it's the admin-key
// script (exempt from the action limit), the signed-in session it came through, and the book sources a GM tablet serves
// from its own PDFs (presence only, so it dies with the socket).
type seat struct {
	ctx     cs.Ctx
	seatKey string
	script  bool
	session *seatSession
	mu      sync.Mutex
	books   []string
}

type seatSession struct {
	tokenHash string
	endsAt    time.Time
}

func (s *seat) servedBooks() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.books
}

// What the gateway asks of the database, as functions so the socket's own behaviour is tested without one. resolve is
// the handshake's seat (nil: unauthorized), load a campaign's snapshot, apply one action in its transaction, logKey an
// admin-key event, sessionLive whether a signed-in session is still there.
type deps struct {
	resolve     func(ctx context.Context, r *http.Request, handshake map[string]any) (*seat, error)
	load        func(ctx context.Context, campaignID string) (*Loaded, error)
	apply       func(ctx context.Context, c cs.Ctx, a cs.Action) (Result, error)
	logKey      func(ctx context.Context, action, campaignID, detail string) error
	sessionLive func(ctx context.Context, tokenHash string) (bool, error)
}

// Gateway is the table socket.
type Gateway struct {
	deps
	io    *socket.Server
	http  http.Handler
	queue *Serial

	pagesMu sync.Mutex
	pages   map[string]int

	// Per IP for connects (a whole table shares one NAT, and all of it reconnects after an api restart), per seat for
	// actions (reconnecting or opening more sockets doesn't reset it): a GM tapping fast stays far below 2/s.
	allowConnect *core.Limiter
	allowAction  *core.Limiter
	// A handshake carrying an adminKey, right or wrong, counts on the limiter REST's x-admin-key calls share.
	allowAdminKey *core.Limiter
	// A player flipping through cited pages; each one costs the GM's tablet a render. Per seat, like actions.
	allowPage *core.Limiter

	kickGrace   time.Duration
	pageTimeout time.Duration
}

// NewGateway builds the socket server. webOrigins is WEB_ORIGIN split; no origin means no cross-origin browser.
// adminKeyLimit is the limiter REST's admin-key calls count on, shared so the two doors are one.
func NewGateway(db *pgxpool.Pool, authService *auth.Service, webOrigins []string, adminKeyLimit *core.Limiter) *Gateway {
	logKey := func(ctx context.Context, action, campaignID, detail string) error {
		return admin.LogAdminKey(ctx, db, action, campaignID, detail)
	}
	g := newGateway(webOrigins, deps{
		resolve: func(ctx context.Context, r *http.Request, handshake map[string]any) (*seat, error) {
			return resolveSeat(ctx, authService, logKey, r, handshake)
		},
		load: func(ctx context.Context, campaignID string) (*Loaded, error) {
			return LoadSnapshot(ctx, db, campaignID)
		},
		apply: func(ctx context.Context, c cs.Ctx, a cs.Action) (Result, error) {
			var result Result
			err := core.InTx(ctx, db, func(tx pgx.Tx) error {
				var err error
				result, err = ApplyAction(ctx, tx, c, a)
				return err
			})
			return result, err
		},
		logKey:      logKey,
		sessionLive: authService.SessionLive,
	})
	g.allowAdminKey = adminKeyLimit
	return g
}

// The handshake's seat: who the socket is, and the signed-in session it came through. The admin key's opening of a room
// is logged before it is let in.
func resolveSeat(ctx context.Context, authService *auth.Service, logKey func(context.Context, string, string, string) error,
	r *http.Request, handshake map[string]any) (*seat, error) {
	resolved, err := authService.ResolveSocketCtx(ctx, handshake, cookieOf(r))
	if err != nil || resolved == nil {
		return nil, err
	}
	data := &seat{ctx: resolved.Ctx, seatKey: resolved.SeatKey, script: resolved.Script}
	if resolved.Script {
		return data, logKey(ctx, "room.open", resolved.Ctx.CampaignID, "")
	}
	// The seat came through the session cookie only if its user is the session's (not a guest token).
	session, err := authService.SessionOf(ctx, cookieOf(r))
	if err != nil {
		return nil, err
	}
	if session != nil && resolved.Ctx.UserID != nil && session.User.UserID == *resolved.Ctx.UserID {
		data.session = &seatSession{session.TokenHash, session.EndsAt}
	}
	return data, nil
}

// newGateway wires the socket server around the database functions in d.
func newGateway(webOrigins []string, d deps) *Gateway {
	g := &Gateway{
		deps:  d,
		queue: NewSerial(), pages: map[string]int{},
		allowConnect:  core.NewLimiter(60, time.Minute),
		allowAction:   core.NewLimiter(120, time.Minute),
		allowPage:     core.NewLimiter(30, time.Minute),
		allowAdminKey: core.NewLimiter(20, time.Minute),
		kickGrace:     KickGrace, pageTimeout: PageTimeout,
	}
	opts := socket.DefaultServerOptions()
	var origin any = false
	if len(webOrigins) > 0 {
		origin = webOrigins
	}
	opts.SetCors(&types.Cors{Origin: origin, Credentials: true})
	opts.SetMaxHttpBufferSize(maxFrameBytes)
	opts.SetServeClient(false)
	g.io = socket.NewServer(nil, opts)
	g.io.Use(g.middleware)
	_ = g.io.On("connection", func(args ...any) {
		if s, ok := args[0].(*socket.Socket); ok {
			g.onConnection(s)
		}
	})
	g.http = g.io.ServeHandler(opts)
	return g
}

// The largest frame the socket reads: a relayed book page (book:request), plus the ack envelope.
const maxFrameBytes = cs.MaxPageBytes + 100_000

// ServeHTTP serves /socket.io/.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && r.URL.Query().Get("transport") == "polling" && !g.pollFits(w, r) {
		return
	}
	g.http.ServeHTTP(w, r)
}

// pollFits reads a polling POST's body, at most one byte past the frame limit. Over the limit, the library would answer
// 413 (or, for a body sent without a length, cut it short and drop it) and keep the session until the ping timeout; here
// the session closes at once. A websocket needs nothing: the library's read limit closes it with 1009.
func (g *Gateway) pollFits(w http.ResponseWriter, r *http.Request) bool {
	fits := r.ContentLength <= maxFrameBytes
	if fits {
		body, err := io.ReadAll(io.LimitReader(r.Body, maxFrameBytes+1))
		_ = r.Body.Close()
		if fits = err == nil && len(body) <= maxFrameBytes; fits {
			r.Body, r.ContentLength = io.NopCloser(bytes.NewReader(body)), int64(len(body))
			return true
		}
	}
	if conn, ok := g.io.Engine().Clients().Load(r.URL.Query().Get("sid")); ok {
		conn.Close(true)
	}
	w.WriteHeader(http.StatusRequestEntityTooLarge)
	return false
}

// Close stops the socket server.
func (g *Gateway) Close() { g.io.Close(nil) }

// guard runs fn behind a recover: a panic logs and runs onPanic, and never takes the process down.
func guard(name string, onPanic func(), fn func()) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("table: panic in %s: %v\n%s", name, r, debug.Stack())
			if onPanic != nil {
				onPanic()
			}
		}
	}()
	fn()
}

func seatOf(s *socket.Socket) *seat {
	d, _ := s.Data().(*seat)
	return d
}

func cookieOf(r *http.Request) string { return strings.Join(r.Header.Values("Cookie"), "; ") }

// Authenticate in middleware, before the connection is accepted, so no event can arrive without a seat. Anything but
// "unauthorized" makes the client retry later (use-table), so a limited socket backs off.
func (g *Gateway) middleware(s *socket.Socket, next func(*socket.ExtendedError)) {
	refuse := func(message string) { next(socket.NewExtendedError(message, nil)) }
	guard("socket middleware", func() { refuse("unavailable") }, func() {
		r := s.Request().Request()
		ip := core.ClientIP(r)
		if !g.allowConnect.Allow(ip) {
			refuse("rate limited")
			return
		}
		if key, _ := s.Handshake().Auth["adminKey"].(string); key != "" && !g.allowAdminKey.Allow(ip) {
			refuse("rate limited")
			return
		}
		data, err := g.resolve(context.Background(), r, s.Handshake().Auth)
		if err != nil {
			// DB down: the client retries (use-table), unlike "unauthorized" which it treats as a dead token.
			log.Printf("table: handshake: %v", err)
			refuse("unavailable")
			return
		}
		if data == nil {
			refuse("unauthorized")
			return
		}
		s.SetData(data)
		next(nil)
	})
}

func (g *Gateway) onConnection(s *socket.Socket) {
	data := seatOf(s)
	if data == nil {
		s.Disconnect(true)
		return
	}
	campaignID := data.ctx.CampaignID
	if data.session != nil {
		s.Join(room(campaignID), sessionRoom(data.session.tokenHash))
	} else {
		s.Join(room(campaignID))
	}
	on := func(event string, handler func(body any, ack func(any))) {
		_ = s.On(event, func(args ...any) {
			var body any = schema.Undefined
			ack := func(any) {}
			if n := len(args); n > 0 {
				if reply, ok := args[n-1].(socket.Ack); ok {
					ack = func(v any) { reply([]any{v}, nil) }
					args = args[:n-1]
				}
			}
			if len(args) > 0 {
				body = args[0]
			}
			guard(event, func() { ack(Refused("serverError", nil)) }, func() { handler(body, ack) })
		})
	}
	on("action", func(body any, ack func(any)) { g.onAction(s, body, ack) })
	on("book:serving", func(body any, _ func(any)) { g.onBookServing(s, body) })
	on("book:request", func(body any, ack func(any)) {
		// It waits on another socket for up to PageTimeout, so it must not hold this socket's events up.
		go guard("book:request", func() { ack(Refused("serverError", nil)) }, func() { ack(g.onBookRequest(s, body)) })
	})
	_ = s.On("disconnect", func(...any) {
		// A serving GM left (closed the tab, lost signal): the players' page links go back to plain text.
		if len(data.servedBooks()) > 0 {
			guard("disconnect", nil, func() { g.announceBooks(campaignID, nil) })
		}
	})
	go guard("connection", func() { s.Disconnect(true) }, func() {
		// A sign-out between the middleware and the join above missed this socket in EndSessions: read the session again
		// now it is in the room, and kick it the same way when it is gone (or the read fails).
		if data.session != nil {
			if live, err := g.sessionLive(context.Background(), data.session.tokenHash); err != nil || !live {
				g.kickSocket(s)
				return
			}
		}
		// In the campaign's queue, so this first snapshot can't land after (and overwrite) a newer broadcast.
		var loadErr error
		g.queue.Do(campaignID, func() {
			loaded, err := g.load(context.Background(), campaignID)
			if err != nil {
				loadErr = err
				return
			}
			if loaded != nil {
				g.emitView(s, loaded, Touches{true, true})
			}
		})
		if loadErr != nil {
			// No snapshot to show (DB down): drop the socket so the client reconnects instead of waiting.
			log.Printf("table: first snapshot: %v", loadErr)
			s.Disconnect(true)
			return
		}
		g.announceBooks(campaignID, s)
	})
}

// The handshake runs once per connection, so each event checks the session it came through is still within its limits
// (§7.7). A dead one is refused and the socket dropped a moment later, after the refusal reaches it.
func (g *Gateway) sessionEnded(s *socket.Socket) bool {
	session := seatOf(s).session
	if session == nil || time.Now().Before(session.endsAt) {
		return false
	}
	time.AfterFunc(g.kickGrace, func() { g.kickSocket(s) })
	return true
}

func (g *Gateway) onAction(s *socket.Socket, body any, ack func(any)) {
	data := seatOf(s)
	if g.sessionEnded(s) {
		ack(Refused("unauthorized", nil))
		return
	}
	if !data.script && !g.allowAction.Allow(data.seatKey) {
		ack(Refused("tooManyActions", nil))
		return
	}
	action, issues := cs.ParseAction(body)
	if issues != nil {
		ack(Refused("badRequest", cs.Params{"detail": schema.Prettify(issues)}))
		return
	}
	if data.script {
		if err := g.logKey(context.Background(), "key.action", data.ctx.CampaignID, action.Type()); err != nil {
			log.Printf("table: %v", err)
			ack(Refused("serverError", nil)) // an admin-key action that can't be logged doesn't run
			return
		}
	}
	// Queued before this returns, so two actions from one socket run in the order they came.
	g.run(data.ctx, action, ack)
}

// Run applies one action as the socket handler does and waits for its ack: queued per campaign, in a transaction,
// then the kicks and the rebroadcast. For the admin REST route.
func (g *Gateway) Run(c cs.Ctx, a cs.Action) any {
	var out any
	done := make(chan struct{})
	g.run(c, a, func(v any) { out = v; close(done) })
	<-done
	return out
}

func (g *Gateway) run(c cs.Ctx, a cs.Action, reply func(any)) {
	g.queue.Go(c.CampaignID, func() {
		var result Result
		replied := false
		answer := func(v any) {
			if !replied {
				replied = true
				reply(v)
			}
		}
		committed := false
		guard("action "+a.Type(), func() { answer(Refused("serverError", nil)) }, func() {
			var err error
			result, err = g.apply(context.Background(), c, a)
			var refusal *cs.Error
			if errors.As(err, &refusal) {
				answer(Refused(refusal.Code, refusal.Params))
				return
			}
			if err != nil {
				log.Printf("table: %s: %v", a.Type(), err)
				answer(Refused("serverError", nil))
				return
			}
			committed = true
		})
		if !committed {
			return
		}
		// Committed: report success even if fan-out fails, or a retap would apply a delta twice. The next broadcast
		// resyncs.
		guard("fan-out "+a.Type(), nil, func() {
			kicks := KicksOf(c, a)
			if KicksSender(a) {
				// Kicks that reach the sender go a moment later: the ack has to reach them first.
				time.AfterFunc(g.kickGrace, func() {
					guard("kick", nil, func() { g.kick(c.CampaignID, kicks) })
				})
			} else {
				g.kick(c.CampaignID, kicks)
			}
			if err := g.broadcast(c.CampaignID, TouchesOf(a)); err != nil {
				log.Printf("table: broadcast: %v", err)
			}
		})
		answer(result)
	})
}

// Mutate is for REST changes to a table (accepting an invite): the same queue as socket actions, then the same
// broadcast of the state.
func (g *Gateway) Mutate(campaignID string, fn func() error) error {
	err := errors.New("panicked") // stays set only if fn panicked, which the queue logs
	g.queue.Do(campaignID, func() { err = fn() })
	if err != nil {
		return err
	}
	guard("mutate broadcast", nil, func() {
		if berr := g.broadcast(campaignID, Touches{State: true}); berr != nil {
			log.Printf("table: broadcast: %v", berr)
		}
	})
	return err
}

// The local sockets in a room. One api instance, as the queue assumes.
func (g *Gateway) socketsIn(r socket.Room) []*socket.Socket {
	var out []*socket.Socket
	g.io.Sockets().Sockets().Range(func(_ socket.SocketId, s *socket.Socket) bool {
		if s.Connected() && s.Rooms().Has(r) && seatOf(s) != nil {
			out = append(out, s)
		}
		return true
	})
	return out
}

// One socket's Seat view, as the events the web reads. The gateway decides nothing about what is in it.
func (g *Gateway) emitView(s *socket.Socket, loaded *Loaded, what Touches) {
	v := view.Of(loaded.Snapshot, loaded.Compiled, seatOf(s).ctx)
	if what.State {
		_ = s.Emit("state", v.State)
	}
	if what.Codex {
		_ = s.Emit("codex", v.Codex)
	}
}

func (g *Gateway) broadcast(campaignID string, what Touches) error {
	if !what.State && !what.Codex {
		return nil
	}
	loaded, err := g.load(context.Background(), campaignID)
	if err != nil || loaded == nil {
		return err
	}
	// ponytail: payload computed per socket, fine at table size (one GM, a few phones, one Screen); cache by a
	// seat-kind key if rooms grow.
	for _, s := range g.socketsIn(room(campaignID)) {
		g.emitView(s, loaded, what)
	}
	return nil
}

// kickSocket disconnects a socket with the disconnect packet, which use-table reloads on, then closes its transport
// after a grace period, so a client cannot stay connected by ignoring the packet (ADR 0008: closing at once loses the
// packet).
func (g *Gateway) kickSocket(s *socket.Socket) {
	conn := s.Conn()
	s.Disconnect(false)
	time.AfterFunc(g.kickGrace, func() { conn.Close(false) })
}

// Disconnects the sockets whose seat just changed or went: they reconnect and resolve their seat again.
func (g *Gateway) kick(campaignID string, kicks []Kick) {
	if len(kicks) == 0 {
		return
	}
	for _, s := range g.socketsIn(room(campaignID)) {
		c := seatOf(s).ctx
		if slices.ContainsFunc(kicks, func(k Kick) bool { return k.Hits(c) }) {
			g.kickSocket(s)
		}
	}
}

// EndSessions is for sign-out and back-channel logout: the sessions' sockets go now. They reconnect as whoever the
// cookies still name.
func (g *Gateway) EndSessions(tokenHashes []string) {
	for _, hash := range tokenHashes {
		for _, s := range g.socketsIn(sessionRoom(hash)) {
			g.kickSocket(s)
		}
	}
}

// A GM tablet serves these sources from PDFs picked on that device; an empty list stops serving.
func (g *Gateway) onBookServing(s *socket.Socket, body any) {
	data := seatOf(s)
	if g.sessionEnded(s) {
		return
	}
	parsed, issues := schema.Parse(cs.BookServing, body)
	if !cs.CanInCampaign(data.ctx, "codex:write", "") || len(issues) > 0 {
		return
	}
	var sources []string
	for _, x := range parsed.(map[string]any)["sources"].([]any) {
		sources = append(sources, x.(string))
	}
	data.mu.Lock()
	data.books = sources
	data.mu.Unlock()
	g.announceBooks(data.ctx.CampaignID, nil)
}

// This campaign's GM sockets that serve at least one book.
func (g *Gateway) bookServers(campaignID string) []*socket.Socket {
	var out []*socket.Socket
	for _, s := range g.socketsIn(room(campaignID)) {
		if len(seatOf(s).servedBooks()) > 0 {
			out = append(out, s)
		}
	}
	return out
}

// Which sources any GM is serving right now, to everyone at the table (or to one socket that just joined).
func (g *Gateway) announceBooks(campaignID string, to *socket.Socket) {
	sources := []string{}
	for _, s := range g.bookServers(campaignID) {
		for _, b := range seatOf(s).servedBooks() {
			if !slices.Contains(sources, b) {
				sources = append(sources, b)
			}
		}
	}
	payload := map[string]any{"sources": sources}
	if to != nil {
		_ = to.Emit("book:available", payload)
		return
	}
	_ = g.io.To(room(campaignID)).Emit("book:available", payload)
}

// A reading seat asks for one page; a GM socket serving that source renders it and the image comes back in this ack
// only. Nothing is stored (CLAUDE.md, "Books never reach the server").
//
// ponytail: any page of a served book, allow-list the cited pages if the table ever needs it.
func (g *Gateway) onBookRequest(s *socket.Socket, body any) any {
	data := seatOf(s)
	if g.sessionEnded(s) {
		return Refused("unauthorized", nil)
	}
	if data.ctx.Seat.Kind == cs.SeatToken && data.ctx.Seat.Role == "screen" {
		return Refused("bookScreenNone", nil)
	}
	if !g.allowPage.Allow(data.seatKey) {
		return Refused("tooManyPages", nil)
	}
	parsed, issues := schema.Parse(cs.BookPage, body)
	if len(issues) > 0 {
		return Refused("badRequest", cs.Params{"detail": schema.Prettify(issues)})
	}
	page := parsed.(map[string]any)
	source := page["source"].(string)
	var server *socket.Socket
	for _, candidate := range g.bookServers(data.ctx.CampaignID) {
		if slices.Contains(seatOf(candidate).servedBooks(), source) {
			server = candidate
			break
		}
	}
	if server == nil {
		return Refused("bookNotServed", nil)
	}
	campaignID := data.ctx.CampaignID
	g.pagesMu.Lock()
	if g.pages[campaignID] >= MaxPagesInFlight {
		g.pagesMu.Unlock()
		return Refused("bookBusy", nil)
	}
	g.pages[campaignID]++
	g.pagesMu.Unlock()
	defer func() {
		g.pagesMu.Lock()
		if g.pages[campaignID]--; g.pages[campaignID] <= 0 {
			delete(g.pages, campaignID)
		}
		g.pagesMu.Unlock()
	}()

	type answer struct {
		reply    any
		timedOut bool
	}
	replies := make(chan answer, 1)
	// ponytail: a reply that never comes leaves its ack entry on the GM socket until it disconnects, if the library's
	// timeout flag was lost to a concurrent emit; the timer below still answers the reader.
	server.Timeout(g.pageTimeout).EmitWithAck("book:request", page)(func(args []any, err error) {
		var reply any
		if len(args) > 0 {
			reply = args[0]
		}
		replies <- answer{reply, err != nil}
	})
	var got answer
	select {
	case got = <-replies:
	case <-time.After(g.pageTimeout):
		got.timedOut = true
	}
	if got.timedOut {
		return Refused("bookNoReply", nil)
	}
	reply := got.reply
	// Only a GM socket answers, but its reply is still parsed before it's passed on.
	ack, ok := cs.BookAck(reply)
	if !ok {
		return Refused("bookRenderFailed", nil)
	}
	return ack
}
