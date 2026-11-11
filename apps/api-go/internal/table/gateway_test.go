package table

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

const testCampaign = "0190a000-0000-7000-8000-000000000100"

// A raw Socket.IO v4 client over one websocket, so the tests see the frames themselves: the disconnect packet, the
// close, what an oversized frame does.
type rawClient struct {
	conn   *websocket.Conn
	frames chan string
	closed chan struct{}
}

func dial(t *testing.T, server *httptest.Server, auth map[string]any) *rawClient {
	t.Helper()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/socket.io/?EIO=4&transport=websocket"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	c := &rawClient{conn, make(chan string, 64), make(chan struct{})}
	go func() {
		defer close(c.closed)
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return
			}
			text := string(message)
			if text == "2" { // engine.io ping
				_ = conn.WriteMessage(websocket.TextMessage, []byte("3"))
				continue
			}
			c.frames <- text
		}
	}()
	c.expect(t, "0{") // engine.io open
	body, _ := json.Marshal(auth)
	c.send(t, "40"+string(body))
	t.Cleanup(func() { _ = conn.Close() })
	return c
}

func (c *rawClient) send(t *testing.T, frame string) {
	t.Helper()
	if err := c.conn.WriteMessage(websocket.TextMessage, []byte(frame)); err != nil {
		t.Fatal(err)
	}
}

// emit sends an event with an ack id.
func (c *rawClient) emit(t *testing.T, ackID int, event string, payload any) {
	t.Helper()
	body, _ := json.Marshal([]any{event, payload})
	c.send(t, "42"+strconv.Itoa(ackID)+string(body))
}

// expect waits for the next frame that starts with prefix, skipping others.
func (c *rawClient) expect(t *testing.T, prefix string) string {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case f := <-c.frames:
			if strings.HasPrefix(f, prefix) {
				return f
			}
		case <-c.closed:
			t.Fatalf("closed while waiting for %q", prefix)
		case <-deadline:
			t.Fatalf("no %q within 3 s", prefix)
		}
	}
}

// ack waits for the ack of one id and returns its payload.
func (c *rawClient) ack(t *testing.T, ackID int) map[string]any {
	t.Helper()
	frame := c.expect(t, "43"+strconv.Itoa(ackID)+"[")
	var args []map[string]any
	if err := json.Unmarshal([]byte(strings.TrimPrefix(frame, "43"+strconv.Itoa(ackID))), &args); err != nil || len(args) == 0 {
		t.Fatalf("bad ack %q: %v", frame, err)
	}
	return args[0]
}

func seats() map[string]cs.Seat {
	return map[string]cs.Seat{
		"gm":     {Kind: cs.SeatMember, Role: "gm"},
		"player": {Kind: cs.SeatMember, Role: "player"},
	}
}

// testGateway is a gateway with no database: the handshake's "who" picks a seat, the snapshot is an empty room, and
// apply is the test's.
func testGateway(t *testing.T, apply func(context.Context, cs.Ctx, cs.Action) (Result, error)) (*Gateway, *httptest.Server) {
	t.Helper()
	g := newGateway(nil, deps{
		resolve: func(_ context.Context, _ *http.Request, handshake map[string]any) (*seat, error) {
			who, _ := handshake["who"].(string)
			s, known := seats()[who]
			if !known {
				return nil, nil
			}
			userID := who
			return &seat{ctx: cs.Ctx{CampaignID: testCampaign, UserID: &userID, Seat: s}, seatKey: testCampaign + ":" + who}, nil
		},
		load: func(context.Context, string) (*Loaded, error) {
			state := cs.LiveState{Campaign: cs.CampaignInfo{ID: testCampaign, Name: "Room"}, Actors: []cs.Actor{}}
			return &Loaded{Snapshot: view.Snapshot{State: state}}, nil
		},
		apply:  apply,
		logKey: func(context.Context, string, string, string) error { return nil },
	})
	server := httptest.NewServer(g)
	t.Cleanup(func() {
		server.Close()
		g.Close()
	})
	return g, server
}

func joined(t *testing.T, server *httptest.Server, who string) *rawClient {
	t.Helper()
	c := dial(t, server, map[string]any{"who": who})
	c.expect(t, "40{")
	c.expect(t, `42["state"`)
	return c
}

func TestAnUnknownSeatIsRefusedUnauthorized(t *testing.T) {
	_, server := testGateway(t, nil)
	c := dial(t, server, map[string]any{"who": "nobody"})
	if f := c.expect(t, "44"); !strings.Contains(f, `"unauthorized"`) {
		t.Fatalf("want an unauthorized connect error, got %q", f)
	}
}

func TestAnAdminKeyHandshakeCountsOnTheLimiterRestShares(t *testing.T) {
	g, server := testGateway(t, nil)
	g.allowAdminKey = core.NewLimiter(2, time.Minute)
	g.allowAdminKey.Allow("127.0.0.1") // one REST call with x-admin-key
	joined(t, server, "gm")            // no adminKey: not counted
	first := dial(t, server, map[string]any{"who": "gm", "adminKey": "wrong"})
	first.expect(t, "40{")
	second := dial(t, server, map[string]any{"who": "gm", "adminKey": "wrong"})
	if f := second.expect(t, "44"); !strings.Contains(f, `"rate limited"`) {
		t.Fatalf("want rate limited, got %q", f)
	}
}

// A sign-out that ends the session after the middleware read it but before the socket joined its session room.
func TestASessionEndedBeforeTheJoinIsKicked(t *testing.T) {
	g, server := testGateway(t, nil)
	userID := "signed"
	g.resolve = func(context.Context, *http.Request, map[string]any) (*seat, error) {
		return &seat{ctx: cs.Ctx{CampaignID: testCampaign, UserID: &userID, Seat: seats()["player"]}, seatKey: "signed",
			session: &seatSession{tokenHash: "hash", endsAt: time.Now().Add(time.Hour)}}, nil
	}
	var asked atomic.Value
	g.sessionLive = func(_ context.Context, tokenHash string) (bool, error) {
		asked.Store(tokenHash)
		return false, nil // deleted by the sign-out
	}
	c := dial(t, server, map[string]any{})
	c.expect(t, "40{")
	if f := c.expect(t, "4"); f != "41" {
		t.Fatalf("want the disconnect packet before any snapshot, got %q", f)
	}
	select {
	case <-c.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("the transport stayed open")
	}
	if asked.Load() != "hash" {
		t.Fatalf("read the session %v", asked.Load())
	}
}

func TestAKickSendsTheDisconnectPacketThenClosesTheTransportAfterTheGrace(t *testing.T) {
	g, server := testGateway(t, nil)
	c := joined(t, server, "player")
	start := time.Now()
	g.kick(testCampaign, []Kick{{All: true}})
	c.expect(t, "41") // the packet use-table reloads on
	select {
	case <-c.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("the transport stayed open after the kick")
	}
	if elapsed := time.Since(start); elapsed < KickGrace*3/4 {
		t.Fatalf("closed after %v, before the %v grace", elapsed, KickGrace)
	}
}

func TestAnOversizedFrameClosesTheConnectionPromptly(t *testing.T) {
	_, server := testGateway(t, func(context.Context, cs.Ctx, cs.Action) (Result, error) {
		t.Error("an oversized frame reached a handler")
		return Result{OK: true}, nil
	})
	c := joined(t, server, "gm")
	pad := strings.Repeat("a", cs.MaxPageBytes+200_000)
	start := time.Now()
	// The server may cut the connection while the frame is still being written, so a failed write is expected.
	_ = c.conn.WriteMessage(websocket.TextMessage, []byte(`421["action",{"type":"encounter.start","pad":"`+pad+`"}]`))
	select {
	case <-c.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("the connection stayed open for 2 s after an oversized frame")
	}
	t.Logf("closed %v after the frame", time.Since(start))
}

func TestAnOversizedPollingPostClosesTheSessionPromptly(t *testing.T) {
	g, server := testGateway(t, func(context.Context, cs.Ctx, cs.Action) (Result, error) {
		t.Error("an oversized frame reached a handler")
		return Result{OK: true}, nil
	})
	base := server.URL + "/socket.io/?EIO=4&transport=polling"
	post := func(sid string, body io.Reader, length int64) int {
		req, _ := http.NewRequest(http.MethodPost, base+"&sid="+sid, body)
		req.ContentLength = length
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		return res.StatusCode
	}
	// Once with a length the library would refuse, once chunked, which it would cut short and drop.
	for _, length := range []int64{-1, maxFrameBytes + 200_000} {
		res, err := http.Get(base)
		if err != nil {
			t.Fatal(err)
		}
		var open struct {
			SID string `json:"sid"`
		}
		raw, _ := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if err := json.Unmarshal(raw[1:], &open); err != nil || open.SID == "" {
			t.Fatalf("bad open packet %q", raw)
		}
		if code := post(open.SID, strings.NewReader(`40{"who":"gm"}`), -1); code != http.StatusOK {
			t.Fatalf("connect answered %d", code)
		}
		frame := `42["action",{"pad":"` + strings.Repeat("a", maxFrameBytes) + `"}]`
		if length > 0 {
			frame += strings.Repeat(" ", int(length)-len(frame))
		}
		if code := post(open.SID, strings.NewReader(frame), length); code != http.StatusRequestEntityTooLarge {
			t.Fatalf("an oversized POST (length %d) answered %d", length, code)
		}
		if _, alive := g.io.Engine().Clients().Load(open.SID); alive {
			t.Fatalf("the session outlived an oversized POST (length %d)", length)
		}
	}
}

func TestAPanicInAHandlerRefusesServerErrorAndTheServerStaysUp(t *testing.T) {
	var calls atomic.Int32
	_, server := testGateway(t, func(context.Context, cs.Ctx, cs.Action) (Result, error) {
		if calls.Add(1) == 1 {
			panic("boom")
		}
		return Result{}, errors.New("database down")
	})
	c := joined(t, server, "gm")
	c.emit(t, 1, "action", map[string]any{"type": "encounter.start"})
	if got := c.ack(t, 1); got["code"] != "serverError" {
		t.Fatalf("a panicking action answered %v", got)
	}
	// The same socket, and a new one, are still served.
	c.emit(t, 2, "action", map[string]any{"type": "encounter.start"})
	if got := c.ack(t, 2); got["code"] != "serverError" {
		t.Fatalf("the next action answered %v", got)
	}
	c.emit(t, 3, "action", map[string]any{"type": "nope"})
	if got := c.ack(t, 3); got["code"] != "badRequest" {
		t.Fatalf("a broken action answered %v", got)
	}
	joined(t, server, "player")
}

func TestPageRequestsInFlightAreCappedPerCampaign(t *testing.T) {
	g, server := testGateway(t, nil)
	g.pageTimeout = 500 * time.Millisecond
	gm := joined(t, server, "gm")
	gm.emit(t, 1, "book:serving", map[string]any{"sources": []string{"src"}})
	player := joined(t, server, "player")
	player.expect(t, `42["book:available",{"sources":["src"]}`)
	const asked = MaxPagesInFlight + 1
	for i := range asked {
		player.emit(t, 10+i, "book:request", map[string]any{"source": "src", "page": i + 1})
	}
	// The GM tablet never answers: one request over the cap is refused at once, the rest time out. Acks come back in
	// any order.
	counts := map[string]int{}
	for range asked {
		frame := player.expect(t, "431")
		var args []map[string]any
		if err := json.Unmarshal([]byte(frame[strings.Index(frame, "["):]), &args); err != nil || len(args) == 0 {
			t.Fatalf("bad ack %q", frame)
		}
		counts[args[0]["code"].(string)]++
	}
	if counts["bookBusy"] != 1 || counts["bookNoReply"] != MaxPagesInFlight {
		t.Fatalf("want 1 bookBusy and %d bookNoReply, got %v", MaxPagesInFlight, counts)
	}
	g.pagesMu.Lock()
	defer g.pagesMu.Unlock()
	if len(g.pages) != 0 {
		t.Fatalf("pages in flight left behind: %v", g.pages)
	}
}
