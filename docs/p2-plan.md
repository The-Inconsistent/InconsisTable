# InconsisTable P2: nhớ giữa các buổi, nhiều họ luật, bàn không GM, board game

> **Nháp.** Chốt sau buổi chơi thật của P1 (`docs/p1-plan.md`, "Đến buổi chơi thật"). Chưa phải kế hoạch đã duyệt:
> thứ tự và phạm vi còn đổi; các điểm ở "Đã chốt" đã quyết. Đọc `CLAUDE.md` trước: 8 nguyên tắc là bắt buộc.

## Mục tiêu (nháp)

P1 chơi được một ruleset kiểu d20 và một trận. P2 làm cho app có ích với mọi bàn, theo thứ tự:
1. **Bàn nhớ được giữa các buổi:** GM soạn và mở codex, prep, recap; "lần trước…" đầu buổi; quest.
2. **Mọi họ luật gọi được Test:** Test chỉ báo kết quả, không cần engine tính; kết quả nhiều mức cho họ d20.
3. **Tài nguyên chung và clock** cho các game kể chuyện.
4. **Một phòng biết nó chơi game gì và ngồi kiểu nào:** có GM, không GM, hay một mình.
5. **Dựng phòng nhanh,** kể cả khi người dùng chưa có manifest viết sẵn.
6. **Board game chơi được** trên cùng engine: lượt theo ghế, pha, tính điểm và xếp hạng (design §4.8, ADR 0007).

Thêm chiều sâu cho combat hoãn lại (xem "Không làm ở P2").

## Căn cứ

Từ `docs/research/tabletop-rpg-landscape.md` (đọc 2026-10-16):

- **Phần đầu:** D&D 5e (52%) và Pathfinder 2e (18%) chiếm khoảng 70% người dùng Foundry. PF2e cần 4 mức kết quả, P1
  chưa có.
- **Phần đuôi:** Roll20 hỗ trợ hơn 1.200 hệ luật, itch.io có khoảng 39 nghìn listing TTRPG. Không ai viết tay manifest
  JSON cho từng hệ.
- **Họ luật lớn:** d20, BRP/d100, PbtA, Forged in the Dark, Year Zero, Fate, 2d20, Savage Worlds, Cypher, Daggerheart.
  Cơ chế khác nhau rõ ở cách gieo, mức kết quả, thứ tự lượt và tài nguyên chung.
- **Kiểu chơi khác:** khoảng 2.354 listing TTRPG không cần GM, khoảng 1.518 game chơi một mình, nhiều game một trang.

## Review hướng đi (2026-10-17, trên `main` e2b7558)

**Đúng hướng, giữ nguyên:**
- Tách lõi khỏi luật (manifest + primitive), cùng ba tầng ruleset / pack / World: hợp với phần đuôi dài.
- Chơi trực tiếp, xúc xắc thật: khác Roll20 và Foundry, vốn lấy bàn ảo trực tuyến làm trung tâm.
- Không ship nội dung; SRD 5.1/5.2 và ORC chỉ do người dùng nhập: đúng với tình hình license trong nghiên cứu.
- Seat view và quyền theo scope (house decisions #21, #30, #31): chặt, là nền cho cả bàn không GM.

**Lệch, cần chỉnh:**
- **Phần làm thật dồn vào combat d20.** Khoảng 18 trong 32 house decisions nói về máu, initiative, condition, trận.
  Không mục nào nói về codex hay ghi nhớ. Combat chỉ là một phần nhỏ của game kể chuyện (PbtA, FitD, OSR một trang,
  game không GM), mà các họ này lại là phần lớn số tựa.
- **Ngay phần đầu cũng chưa đủ:** PF2e cần 4 mức kết quả; Test hiện chỉ ra `critical / success / failure`.
- **Trụ "ghi nhớ" gần như chưa có trên UI,** dù api đã sẵn. Tab PREP, CODEX, MAP của app GM chỉ hiện "coming"
  (`gm-app.tsx`); `codex.save/reveal/delete` có action nhưng GM không soạn được entry nào; `session.end` nhận `recap`
  nhưng nút ở PARTY gửi rỗng; điện thoại chỉ thấy danh sách entry đã reveal. Đây là phần trung lập với mọi hệ luật,
  nên phục vụ được mọi bàn với ít code nhất.
- **Mỗi họ luật mới tốn một primitive và vài house decision.** Với khoảng 8 họ cần, đi theo đường "engine tính mọi
  thứ" sẽ chậm. Test chỉ báo kết quả (B) phủ phần lớn họ kể chuyện mà không cần engine biết toán của họ.
- **Danh tính chỉ theo thiết bị** (house decision #32): mất cookie là mất danh tính, kể cả chủ phòng. Chấp nhận được
  cho bàn LAN riêng; với campaign kéo dài nhiều tháng thì là rủi ro, cần có cách khôi phục trước khi bàn dựa vào
  codex lâu dài.

## Hẹn từ P1

Đã ghi ở `docs/p1-plan.md` ("Sang P2", "Không làm ở P1"):

- Tablet GM phục vụ trang sách (`serveBooks` chưa được gọi ở đâu).
- Resource theo pool (party/GM/campaign). Gộp vào C bên dưới.
- Màn admin gỡ pack (takedown).
- `request.*`: người chơi xin tiêu resource. Gộp vào C.
- Library nhân vật.
- World và theme theo World, gồm theme W&G.
- House rule có patch.
- Form nhập ruleset và pack, thay cho dán JSON. Gộp vào E.
- Nâng phiên bản ruleset có migration và dry-run diff.
- Encounter budget: hoãn cùng chiều sâu combat.

## Thiếu, theo nhóm (theo thứ tự ưu tiên)

### A. Ghi nhớ: codex, prep, recap (web; api `codex`, `campaign`)

Api đã có: các kind `adventure`, `scene`, `npc`, `location`, `faction`, `item`, `handout`, `quest`, `lore`
(`core-schema/src/state.ts`), action `codex.save/reveal/delete`, `session.end` có `recap`, `session.edit`, nhật ký
`session_event`.

- **Tab CODEX của GM:** tạo, sửa, tìm entry theo kind; reveal cho cả bàn hoặc cho từng nhân vật; `@mention`.
- **Tab PREP của GM:** adventure → scene; scene gắn NPC, location, handout, Test dự kiến (design §3.4).
- **Recap cuối buổi:** ô recap ở bước kết thúc buổi, thay cho `session.end` gửi rỗng; sửa lại sau qua `session.edit`.
- **"Lần trước…" trên TV và điện thoại đầu buổi,** lấy từ recap buổi trước.
- **Quest và mục tiêu** của party hoặc của từng nhân vật: open / done / failed / secret (kind `quest` đã có).
  Tham chiếu auspex_gm: mục tiêu của buổi gắn với mission, và import adventure từ file campaign (2026-10-28).
- **Sổ của người chơi trên điện thoại:** entry đã reveal xếp theo kind, quest đang mở, recap các buổi.
- **Nháp recap từ `session_event`:** gom delta, Test, reveal của buổi thành nháp để GM sửa (design §3.4 "Sau").
- **Sau trong P2:** quan hệ giữa các nhân vật (bond, Hx kiểu PbtA); secret riêng từng nhân vật và reveal một phần
  (biết tên, chưa biết chỉ số).
- MAP để sau P2 (design §3.8).

### B. Test cho mọi họ luật (`packages/rules-engine`, `test-call`)

Hiện có: `dice.sumVsTarget`, `dice.poolSuccesses`. Một Test chỉ ra `critical / success / failure`
(`primitives/dice-sum-vs-target.ts`).

- **Test chỉ báo kết quả** (kind mới, ví dụ `reported`): manifest khai danh sách kết quả có tên và cite (ví dụ 3 dải
  của PbtA, đạt một phần của FitD, mức của CoC). Bàn gieo và tự tính bằng xúc xắc thật; người chơi (hoặc GM) chọn
  kết quả trên điện thoại; server chỉ kiểm kết quả có trong danh sách rồi ghi lại. Không ngưỡng, không modifier,
  không toán. Hợp nguyên tắc 5 và phủ phần lớn họ kể chuyện mà không cần primitive riêng cho từng họ. Cần một house
  decision: ai được báo (như #20), ai thấy kết quả của ai (như #21).
- **Kết quả nhiều mức cho `sumVsTarget`:** mức do manifest khai; đủ cho 4 mức của PF2e (lệch ngưỡng 10 thì lên hoặc
  xuống một mức) ở phần đầu.
- **Các cách gieo có tính toán khác** (roll-under d100, lấy viên cao nhất của pool, 4dF, hai viên so nhau, xúc xắc
  nổ, pool d20 gieo dưới): chỉ làm khi một bàn thật cần server tính, ví dụ để giấu ngưỡng. Trước đó dùng Test chỉ báo
  kết quả. Bộ phân tích xúc xắc đã hiểu `kh/kl` và nổ; hai primitive hiện chỉ nhận `NdX` đơn giản (`plainDice`).
- **`initiative` thành tuỳ chọn trong manifest.** Hiện nó bắt buộc, nên game không có lượt không nhập gọn được.

### C. Tài nguyên chung và clock (api, web)

- **Pool chung của party, GM hoặc campaign:** Momentum, Doom, Bennies, Hope/Fear, Glory/Ruin (hẹn từ P1). Design §1.6
  coi đây là điểm đau số 7.
- **Clock 4/6/8 ô:** cốt lõi của FitD, cũng dùng cho faction và đếm ngược. Design §3.4 ghi MVP, code chưa có. Một
  clock có thể là một entry codex gắn faction hay quest.
- **`request.*`:** người chơi xin tiêu resource hoặc pool, GM duyệt; phòng không GM thì tự áp và ghi nhật ký.

### D. Kiểu ngồi: có GM, không GM, một mình (`core-schema`, `apps/api`)

- **Khối `game` trong manifest:** `title`, `family`, `genres[]`, `players { min, max }`, `modes[]` (`gm`, `gmless`,
  `solo`), `cite`. Đây là dữ liệu mô tả, không phải chữ sách. Riêng "không cần GM" là luật nên phải có cite.
- **Cột `campaign.table_mode`** (`gm | gmless | solo`). Là cột chứ không để trong JSONB vì lobby cần lọc. Chọn lúc
  tạo phòng, trong số `modes` mà ruleset cho phép; chỉ đổi được giữa các buổi.
- **Phòng không GM** (đã chốt, ghi thành ADR khi làm):

  | Việc | Phòng có GM | Phòng không GM |
  |---|---|---|
  | Ghế | gm / cogm / player | chỉ player; chủ phòng vẫn là `owner_user_id` (mời, kick, quản lý phòng) |
  | Gọi Test | GM gọi | người chơi tự gọi cho nhân vật mình; ngưỡng công khai |
  | Thông tin `gm` | GM thấy | không ai thấy cho tới khi gieo bảng hoặc rút bài; bảng oracle thay GM (nguyên tắc 5 đã cho gieo bảng ngẫu nhiên) |
  | Reveal, spawn, bắt đầu/kết thúc buổi | GM | mọi ghế; ghi vào nhật ký |
  | Undo | GM, scope `combat` | mỗi người undo bước của mình; chủ phòng undo mọi bước |

- **Solo:** phòng không GM có một ghế, TV tuỳ chọn.
- **Chỗ phải đổi:** `canInCampaign` (`packages/core-schema/src/permissions.ts`), `runsAsGm` và bộ lọc seat view
  (`apps/api/src/view/`), `campaign.rules` (pack `private`). Seat view nhạy cảm về bảo mật: mỗi nhánh mới cần test
  "không ai thấy field `gm`".
- **Tài liệu:** `CONTEXT.md` thêm thuật ngữ "Table mode" và sửa định nghĩa "GM"; ADR trong `docs/adr/`; design §3.3
  bước 1.

### E. Thiết lập (web; dựa trên B, D)

- **Bước "Chọn game" ở wizard tạo phòng:** danh sách từ ruleset người dùng đã import (danh mục công khai vẫn là P4).
  Lọc theo số người, kiểu ngồi, thể loại. Thẻ phòng ở lobby hiện "chơi gì · có GM hay không".
- **Ruleset "Freeform":** ghi chú, một track máu và một Test chỉ báo kết quả, cho game tự chế và game một trang
  (design §3.3).
- **"Quick game":** chọn ruleset → QR → chơi trong dưới 2 phút (design §3.3).
- **Mẫu ruleset theo họ luật:** khung có sẵn cấu trúc d20, PbtA, FitD, YZE, d100; số và cite do người dùng điền. Khung
  chỉ có cấu trúc của engine, không số hay dải kết quả của game nào (điểm chốt 4).
- **Form nhập ruleset và pack** (hẹn từ P1).
- **Session Zero và safety:** Lines & Veils, bật X-Card (người chơi chạm trên điện thoại, chỉ GM nhận, ẩn danh; phòng
  không GM thì mọi người cùng nhận, vẫn ẩn danh). Design §1.4 và §3.3 bước 4; code chưa có.

### F. Board game (`packages/rules-engine`, `encounter`, `campaign`, web; dựa trên B, D)

Board game là ruleset trên cùng engine (ADR 0007, design §4.8). Phần lớn đã có: ghế, view theo ghế, resource,
visibility `owner`, encounter có vòng, undo, tạm dừng giữa buổi (#28), phòng không GM (D).

- **`initiative.seated`:** thứ tự theo ghế chọn lúc thiết lập; người đi đầu cố định, xoay vòng hoặc đặt tay. Cả ván
  là một encounter. Cần `initiative` tuỳ chọn (B) để game không lượt vẫn nhập được.
- **`phases`:** pha trong một vòng, theo lượt hoặc cùng lúc (mọi ghế đánh dấu xong thì sang pha kế). TV và điện
  thoại hiện vòng, pha, lượt của ai.
- **`scoring`:** biểu thức điểm, tiebreak, `endWhen` có cite. Server báo "đủ điều kiện kết thúc", không tự kết
  thúc; ghế chạy bàn kết thúc ván, server xếp hạng và ghi bảng `session_result` (cột, không JSONB).
- **Màn kết thúc ván:** bảng điểm từng người với phần cộng từ đâu (Breakdown như #25), điểm ẩn hiện ra lúc này.
- **Bảng xếp hạng campaign:** cộng dồn `session_result` qua các buổi, cho giải đấu và game legacy.
- **Thiết lập ngẫu nhiên:** chia không hoàn lại từ bảng ngẫu nhiên cho từng ghế (kịch bản, vai ẩn), kết quả
  visibility `owner`. Nguyên tắc 5 đã cho gieo bảng ngẫu nhiên; chia không hoàn lại cần một house decision.
- **House decision:** #36 thứ tự theo ghế, #37 pha, #38 kết thúc ván, #39 xếp hạng và game coop, #40 điểm ẩn. Chia
  không hoàn lại cần thêm một mục khi có bảng ngẫu nhiên. Kế hoạch làm: `docs/p2-board-game-plan.md`.
- **Mẫu ruleset board game** theo điểm chốt 4: chỉ cấu trúc engine, game bịa như `sample-d20`.
- **Chỗ phải đổi:** `Initiative` union và khối gốc mới (`packages/rules-engine/src/manifest.ts`), encounter
  (`apps/api/src/encounter/`), seat view cho điểm ẩn (`apps/api/src/view/`), `CONTEXT.md` (Phase, Score khi làm).

## Đã chốt (chủ sản phẩm)

2026-10-16:

1. **Nguyên tắc 4 trong phòng không GM:** chủ phòng (`owner_user_id`) được coi là người chạy phòng. Pack `private` của
   họ dùng được trong phòng không GM do chính họ làm chủ; vẫn không cấp được cho người khác. Ghi vào ADR của D và
   sửa câu nguyên tắc 4 trong `CLAUDE.md` khi làm.
2. **Ghế trong phòng không GM:** mọi ghế quyền ngang nhau ở P2. Ghế người dẫn xoay vòng để sau.
3. **Ngưỡng Test ẩn trong phòng không GM:** cấm hẳn; server từ chối Test có ngưỡng ẩn khi `table_mode` khác `gm`.
4. **Mẫu ruleset theo họ luật:** mẫu chỉ chứa cấu trúc của engine (có loại Test nào, resource nào, clock nào), không
   có số, dải kết quả hay tên mục của game nào; người dùng tự điền số và cite. Ghi thành house decision trong
   `docs/house-decisions.md` trước khi làm mẫu. Nếu một mẫu không tách được khỏi cơ chế của sách, chỉ ship mẫu
   homebrew bịa như `sample-d20`.

2026-10-17:

5. **Ghi nhớ lên đầu P2:** codex, prep, recap trên UI đi trước mọi thay đổi engine.
6. **Test chỉ báo kết quả** là đường mặc định cho họ luật mới; primitive có tính toán chỉ thêm khi bàn thật cần.
7. **Hoãn thêm chiều sâu combat** (xem "Không làm ở P2").

2026-10-29:

8. **Board game nằm trong phạm vi** (đảo dòng "ngoài phạm vi TTRPG" cũ): app phục vụ RPG tuỳ biến và board game nói
   chung. Board game là ruleset, không phải app riêng; linh kiện nằm trên bàn thật (ADR 0007).

## Thứ tự đề xuất

1. A: tab CODEX, recap cuối buổi, "lần trước…", quest, sổ người chơi. Rồi PREP, rồi nháp recap.
2. B: Test chỉ báo kết quả (house decision trước), rồi kết quả nhiều mức cho `sumVsTarget`; `initiative` tuỳ chọn.
3. C: pool chung, clock, `request.*`.
4. D + E: khối `game`, `table_mode`, bước Chọn game, Freeform. ADR ghi lại các điểm chốt 1–3 trước khi code.
5. E: mẫu ruleset theo họ luật (sau house decision của điểm chốt 4), Quick game, safety.
6. F: `seated` và `phases`, rồi `scoring` và màn kết thúc ván, rồi bảng xếp hạng campaign, rồi thiết lập ngẫu nhiên.

Các mục hẹn từ P1 xếp vào sau khi buổi chơi thật cho thấy cái nào cần trước.

## Không làm ở P2 (nháp)

- **Chiều sâu combat:** cách xếp lượt mới (luân phiên theo phe, popcorn, rút bài), legendary/lair action, reaction,
  encounter budget, tracker nhận điểm initiative mới giữa round (#27). Buổi chơi thật của P1 sẽ cho biết combat còn
  thiếu gì; chỉ sửa những gì bàn thật vấp phải.
- Các cách gieo có tính toán ngoài `sumVsTarget` và `poolSuccesses`, trừ khi một bàn thật cần (xem B).
- MAP.
- Mô phỏng linh kiện board game (bộ bài, túi, bàn cờ, bài trên tay, kiểm nước đi): linh kiện nằm trên bàn thật.
- Đồng hồ cờ theo lượt, trừ khi một bàn thật cần.
- Ghế người dẫn xoay vòng.
- Danh mục công khai, `pack_grant`, `pack:approve`: vẫn P4.
- Script sandbox, Redis.
