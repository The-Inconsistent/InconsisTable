# InconsisTable P2: nhiều họ luật, bàn không GM, nhớ giữa các buổi

> **Nháp.** Chốt sau buổi chơi thật của P1 (`docs/p1-plan.md`, "Đến buổi chơi thật"). Chưa phải kế hoạch đã duyệt:
> thứ tự, phạm vi và các câu hỏi mở dưới đây đều còn đổi. Đọc `CLAUDE.md` trước: 8 nguyên tắc là bắt buộc.

## Mục tiêu (nháp)

P1 chơi được một ruleset kiểu d20. P2 mở app cho phần lớn các bàn còn lại:
- Engine diễn tả được các họ luật lớn ngoài d20: kết quả nhiều mức, pool, roll-under, clock, pool chung.
- Một phòng biết nó chơi game gì và ngồi kiểu nào: có GM, không GM, hay một mình.
- Dựng phòng nhanh, kể cả khi người dùng chưa có manifest viết sẵn.
- Bàn nhớ được giữa các buổi: quest, "lần trước…", nháp recap.

## Căn cứ

Từ `docs/research/tabletop-rpg-landscape.md` (đọc 2026-10-16):

- **Phần đầu:** D&D 5e (52%) và Pathfinder 2e (18%) chiếm khoảng 70% người dùng Foundry. PF2e cần 4 mức kết quả, P1
  chưa có.
- **Phần đuôi:** Roll20 hỗ trợ hơn 1.200 hệ luật, itch.io có khoảng 39 nghìn listing TTRPG. Không ai viết tay manifest
  JSON cho từng hệ.
- **Họ luật lớn:** d20, BRP/d100, PbtA, Forged in the Dark, Year Zero, Fate, 2d20, Savage Worlds, Cypher, Daggerheart.
  Cơ chế khác nhau rõ ở cách gieo, mức kết quả, thứ tự lượt và tài nguyên chung.
- **Kiểu chơi khác:** khoảng 2.354 listing TTRPG không cần GM, khoảng 1.518 game chơi một mình, nhiều game một trang.

## Hẹn từ P1

Đã ghi ở `docs/p1-plan.md` ("Sang P2", "Không làm ở P1"):

- Tablet GM phục vụ trang sách (`serveBooks` chưa được gọi ở đâu).
- Resource theo pool (party/GM/campaign). Gộp vào D bên dưới.
- Màn admin gỡ pack (takedown).
- `request.*`: người chơi xin tiêu resource. Gộp vào D.
- Library nhân vật.
- World và theme theo World, gồm theme W&G.
- House rule có patch.
- Encounter budget (ngân sách độ khó do ruleset định nghĩa).
- Form nhập ruleset và pack, thay cho dán JSON. Gộp vào C.
- Nâng phiên bản ruleset có migration và dry-run diff.

## Thiếu, theo nhóm

### A. Engine: họ luật ngoài d20 (`packages/rules-engine`)

Hiện có: `dice.sumVsTarget`, `dice.poolSuccesses`, `initiative.ranked`. Một Test chỉ ra `critical / success /
failure` (`primitives/dice-sum-vs-target.ts`).

- **Kết quả nhiều mức:** dải kết quả do manifest khai. Ví dụ: 4 mức PF2e (lệch ngưỡng 10 thì lên hoặc xuống một mức),
  3 dải PbtA (10+, 7–9, 6−), đạt một phần FitD (4–5), hard/extreme của CoC (theo phần của chỉ số). Ưu tiên cao nhất
  vì PF2e nằm ở phần đầu.
- **Thêm cách gieo:**
  - Roll-under d100 có mức (BRP, CoC, WFRP).
  - Lấy viên cao nhất của pool, hai viên 6 là critical (FitD).
  - 4dF cộng kỹ năng so với thang (Fate).
  - Hai viên so nhau, sinh tài nguyên cho bên nào thắng (Daggerheart Hope/Fear).
  - Xúc xắc nổ cộng tiếp, cộng wild die (Savage Worlds).
  - Pool d20 gieo dưới, sinh Momentum/Threat (2d20).
  Bộ phân tích xúc xắc đã hiểu `kh/kl` và nổ, nhưng hai primitive Test hiện chỉ nhận `NdX` đơn giản
  (`manifest.ts`, `plainDice`).
- **Thêm cách xếp lượt:** luân phiên theo phe (W&G, Draw Steel), popcorn (người vừa đi chọn người kế), rút bài (Savage
  Worlds), không có lượt (PbtA, FitD).
- **`initiative` thành tuỳ chọn trong manifest.** Hiện nó bắt buộc, nên game không có lượt không nhập gọn được.
- **Khối `game` trong manifest:** `title`, `family`, `genres[]`, `players { min, max }`, `modes[]` (`gm`, `gmless`,
  `solo`), `cite`. Đây là dữ liệu mô tả, không phải chữ sách. Riêng "không cần GM" là luật nên phải có cite.

### B. Kiểu ngồi: có GM, không GM, một mình (`core-schema`, `apps/api`)

- **Cột `campaign.table_mode`** (`gm | gmless | solo`). Là cột chứ không để trong JSONB vì lobby cần lọc. Chọn lúc
  tạo phòng, trong số `modes` mà ruleset cho phép; chỉ đổi được giữa các buổi.
- **Phòng không GM** (đề xuất, cần ADR):

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
- **Sau P2:** ghế "người dẫn" xoay vòng theo cảnh (Microscope, Kingdom). Chỉ làm khi có bàn thật cần.

### C. Thiết lập (web; dựa trên A, B)

- **Bước "Chọn game" ở wizard tạo phòng:** danh sách từ ruleset người dùng đã import (danh mục công khai vẫn là P3).
  Lọc theo số người, kiểu ngồi, thể loại. Thẻ phòng ở lobby hiện "chơi gì · có GM hay không".
- **Ruleset "Freeform":** chỉ ghi chú và một track máu, cho game tự chế và game một trang (design §3.3).
- **"Quick game":** chọn ruleset → QR → chơi trong dưới 2 phút (design §3.3).
- **Mẫu ruleset theo họ luật:** khung có sẵn cấu trúc d20, PbtA, FitD, YZE, d100; số và cite do người dùng điền. Cần
  quyết trước xem khung chỉ có cấu trúc có tính là "game content" hay không (câu hỏi mở 4).
- **Form nhập ruleset và pack** (hẹn từ P1).
- **Session Zero và safety:** Lines & Veils, bật X-Card (người chơi chạm trên điện thoại, chỉ GM nhận, ẩn danh; phòng
  không GM thì mọi người cùng nhận, vẫn ẩn danh). Design §1.4 và §3.3 bước 4; code chưa có.

### D. Tương tác tại bàn (api, web)

- **Pool chung của party, GM hoặc campaign:** Momentum, Doom, Bennies, Hope/Fear, Glory/Ruin (hẹn từ P1). Design §1.6
  coi đây là điểm đau số 7.
- **Clock 4/6/8 ô:** cốt lõi của FitD, cũng dùng cho faction và đếm ngược. Design §3.4 ghi MVP, code chưa có.
- **`request.*`:** người chơi xin tiêu resource hoặc pool, GM duyệt; phòng không GM thì tự áp và ghi nhật ký.

### E. Ghi nhớ giữa các buổi (api `codex`, `campaign`; web)

- **Quest và mục tiêu** của party hoặc của từng nhân vật: open / done / failed / secret (design §1.3).
- **"Lần trước…" trên TV đầu buổi,** lấy từ recap buổi trước. Recap và nhật ký đã có; chỉ thiếu màn hiển thị.
- **Nháp recap từ `session_event`:** gom delta, Test, reveal của buổi thành nháp để GM sửa (design §3.4 "Sau").
- **Quan hệ giữa các nhân vật** (bond, Hx kiểu PbtA).
- **Secret riêng từng nhân vật, reveal một phần** (biết tên, chưa biết chỉ số) (design §3.4 "Sau").

## Câu hỏi mở

1. **Nguyên tắc 4 trong phòng không GM:** pack `private` hiện chỉ dùng được ở phòng chủ pack làm GM. Phòng không GM
   không ai làm GM, nên pack riêng bị khoá. Có coi chủ phòng là "người chạy phòng" không?
2. **Phòng không GM:** mọi ghế quyền ngang nhau (đề xuất), hay có ghế người dẫn ngay từ P2?
3. **Ngưỡng Test ẩn trong phòng không GM:** đề xuất cấm hẳn, vì không ai giữ bí mật.
4. **Mẫu ruleset theo họ luật:** một khung chỉ có cấu trúc, không số, không cite, có vi phạm "ships no game content"
   không? Nếu có, chỉ ship mẫu cho ruleset homebrew bịa.

## Thứ tự đề xuất

1. A: kết quả nhiều mức cho `sumVsTarget` (mở PF2e, PbtA, CoC với một thay đổi nhỏ).
2. D: clock và pool chung (FitD, 2d20, Daggerheart, W&G).
3. A + B + C: khối `game`, `table_mode`, bước Chọn game, Freeform. ADR và câu hỏi 1–3 chốt trước.
4. C: mẫu ruleset theo họ luật, sau khi chốt câu hỏi 4.
5. A: cách xếp lượt luân phiên phe và popcorn; các cách gieo còn lại theo nhu cầu bàn thật.
6. E: quest, "lần trước…", nháp recap.

Các mục hẹn từ P1 xếp vào sau khi buổi chơi thật cho thấy cái nào cần trước.

## Không làm ở P2 (nháp)

- Board game dungeon crawler (Gloomhaven, HeroQuest): ngoài phạm vi TTRPG của app.
- Ghế người dẫn xoay vòng.
- Danh mục công khai, `pack_grant`, `pack:approve`: vẫn P3.
- Script sandbox, Redis.
