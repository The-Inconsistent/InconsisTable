# InconsisTable P2 F: board game chơi được

> Kế hoạch cho nhóm F của `docs/p2-plan.md`. Chờ duyệt trước khi code. Căn cứ: ADR 0007, design §4.8, house decisions
> #36–#40. Đọc `CLAUDE.md` trước: 8 nguyên tắc là bắt buộc.

## Mục tiêu

Một ván board game homebrew (fixture bịa, không có luật của game thật nào) chơi được từ thiết lập tới bảng xếp hạng,
chỉ dùng app để giữ sổ: thứ tự theo ghế, người đi đầu xoay vòng, pha theo lượt và pha cùng lúc, điểm, kết thúc ván,
xếp hạng, và bảng xếp hạng qua nhiều ván của một campaign.

**Xong khi:**
1. `bun run typecheck`, `lint`, `test` xanh trên CI.
2. Test engine cho `initiative.seated`, `round.phases`, `score.final` trên fixture `sample-harvest`.
3. Smoke test end-to-end: nhập `sample-harvest`, ba ghế, chơi hết 4 vòng (mỗi vòng một pha cùng lúc và một pha theo
   lượt), người đi đầu xoay đúng, `endWhen` báo đủ điều kiện, `game.end` ra thứ hạng đúng kể cả cùng hạng, Undo trả
   người đi đầu và pha về đúng.
4. Seat view: tổng điểm dựng từ giá trị `owner` không tới ghế khác trước `game.end` (#40); sau đó mọi ghế thấy tổng,
   hạng, tiebreak, còn giá trị gốc giữ nguyên visibility.
5. Chơi thử trên trình duyệt: tablet, 3 điện thoại, TV.

## Phụ thuộc

- **B, `initiative` tuỳ chọn:** không chặn F. F chỉ thêm một strategy vào union.
- **D, `table_mode` và phòng không GM:** F1–F4 làm và test trong phòng có GM (người dẫn giữ ghế GM, như một host).
  Phòng không GM chỉ cần D đổi người "chạy bàn": quyền `encounter:run` và `session:run` sang mọi ghế (P2 D). Không
  có nhánh nào của F tự kiểm `table_mode`.
- **Bảng ngẫu nhiên:** chưa có trong engine (`dice.ts` mới chỉ ghi chú). Chia vai ẩn và kịch bản ngẫu nhiên để sau
  F, cần thêm một house decision.

## Mô hình dữ liệu

Trạng thái lượt hiện là `TurnState { round, currentId, order }` (`packages/rules-engine/src/primitives/primitive.ts`),
khoá delta là `TurnKey = round | currentId | order` (`enums.ts`), và `planNext` gọi cứng `initiative.ranked`
(`apps/api/src/encounter/encounter.plan.ts`). F mở rộng đúng chỗ đó:

```ts
interface TurnState {
  round: number;
  currentId: string | null;   // null trong pha cùng lúc
  order: string[];
  firstId: string | null;     // mới, #36: người đi đầu của vòng
  phaseId: string | null;     // mới, #37: null khi manifest không có phases
  done: string[];             // mới, #37: actor đã xong pha cùng lúc
}
TurnKey = "round" | "currentId" | "order" | "firstId" | "phaseId" | "done";
```

- **Postgres:** `encounter.first_combatant_id` (FK `combatant`, `set null`), `encounter.phase_id` (text, id trong
  manifest), `combatant.done` (boolean). Đều là cột: được ghi theo delta và đọc lại khi Undo.
- **`session_result`:** `id`, `campaign_id`, `session_id`, `encounter_id`, `actor_id`, `score` int, `tiebreaks`
  int[], `place` int null (coop: null), `outcome` text null (`win | lose`, coop), `ended_early` boolean, `created_at`.
  Index `(campaign_id, created_at)` cho bảng xếp hạng. Cột chứ không JSONB: lọc và cộng dồn qua nhiều buổi.
- **Manifest** (`packages/rules-engine/src/manifest.ts`): `SeatedInitiative` vào union `Initiative`; khối gốc tuỳ chọn
  `phases: Phase[]` (tối đa 12) và `scoring: Scoring` như design §4.8. Validator: `cite` bắt buộc trên cả ba (trừ
  homebrew); `outcome` chỉ được có khi `mode: coop`, và coop cần ít nhất một `endWhen` `win`; id pha không trùng.

## Các bước (mỗi bước một PR, xong bằng test của nó)

### F1. `initiative.seated` (rules-engine, api, web)

- Primitive `initiative.seated`, ops `start` (thứ tự từ `ord`, `firstId` là người đầu), `next`, `remove`, `first`
  (đặt tay, `manual`). `next` đi theo thứ tự xoay từ `firstId`; hết vòng thì `round + 1`, `rotate` dời `firstId` một
  chỗ. `remove` theo #36 và #3.
- `planNext`/`planPrev` gọi `initiative.<strategy>` của manifest thay vì cứng `ranked`; `planPrev` đi lùi trong thứ tự
  xoay. Test hiện có của `encounter.plan.test.ts` phải giữ nguyên.
- `writeTurn` nhận `firstId`; `loadTurn` đọc nó. Undo của `firstId` như `currentId`.
- Action `turn.first { combatantId }`, quyền `encounter:run`.
- Web tracker: strategy `seated` không có ô điểm initiative; đổi chỗ bằng `encounter.move` không cần cùng điểm; dấu
  người đi đầu trên tablet, TV và điện thoại.
- Test: xoay qua 3 vòng; người đi đầu rời bàn; người đang đi rời bàn ở cuối vòng; Undo một lần wrap trả cả `round`
  và `firstId`.

### F2. `phases` (rules-engine, api, web)

- `TurnState.phaseId` và `done`; cột tương ứng. Bắt đầu encounter thì `phaseId` là pha đầu.
- Pha `turns`: `next` như F1 trong pha; hết lượt người cuối thì sang pha kế, bắt đầu lại từ `firstId`; hết pha cuối
  thì hết vòng (rotate ở đây).
- Pha `simultaneous`: `currentId` null. Action `phase.done { actorId }` (quyền `character:edit:own`: chỉ nhân vật
  mình giữ; GM cho mọi actor) thêm actor vào `done`; đủ hết thì server tự sang pha kế trong cùng action. `turn.next`
  trong pha cùng lúc là "sang pha không chờ" (#37), log ghi tên ai chưa xong.
- Thứ tự expiry theo #37 và #15; `ownTurnEnd` không tick trong pha cùng lúc.
- Web: banner "Vòng 3 · Plan" trên TV và điện thoại; nút XONG lớn trên điện thoại trong pha cùng lúc (nguyên tắc 8:
  một chạm, đọc được ở khoảng cách một cánh tay); tablet thấy ai chưa xong.
- Test: một vòng hai pha; một ghế vắng, GM sang pha không chờ; Undo một lần tự sang pha đưa `done` và `phaseId` về.

### F3. `scoring` và kết thúc ván (rules-engine, api, web)

- Primitive thuần `score.final`: op `check` (đánh giá `endWhen`, trả danh sách đủ điều kiện) và `rank` (điểm,
  tiebreak, hạng kiểu 1, 1, 3; coop trả `outcome`). Không ghi state; test đơn vị đủ cả cùng hạng, `order: low`, coop
  thắng, coop dừng sớm thành `lose`.
- Snapshot mang `game.endMet: string[]` (id hoặc chỉ số `endWhen`), tính lại sau mỗi action trong `loadLive`.
- Action `game.end` (quyền `encounter:run`, cần session đang chạy #28): `rank`, ghi `session_result`, đóng encounter
  như `encounter.end` (#26). Không undo được: Undo bỏ qua và ghi chú như #26.
- Action `result.set { resultId, score }` (quyền `encounter:run`): sửa điểm, xếp hạng lại cả ván, có log.
- Seat view (`apps/api/src/view/`): trước khi hết ván, tổng điểm (derived) theo #40; kết quả ván gửi cho mọi ghế.
- Web: TV và điện thoại báo "đủ điều kiện kết thúc" (không rung, không chặn); màn kết thúc ván trên TV với hạng, tổng,
  Breakdown (#25) theo seat view.
- Test: smoke "Xong khi" mục 3 và 4.

### F4. Bảng xếp hạng campaign (api, web)

- Snapshot mang 20 ván gần nhất của campaign từ `session_result` (ponytail: phân trang khi một campaign quá 20 ván).
- Màn "Bảng xếp hạng" trên tablet và điện thoại: số ván thắng và hạng trung bình theo nhân vật. Coop: số ván thắng
  của cả bàn.
- Test: hai ván, bảng cộng đúng; một ghế đã rời campaign vẫn có tên trong lịch sử.

### F5. Fixture và mẫu (rules-engine, docs)

- `packages/rules-engine/src/fixtures/sample-harvest.ts`: game bịa ở design §4.8, mọi cite "Sample p.N". Dùng cho test
  F1–F4 và smoke; viết từ đầu F1 rồi lớn dần.
- Mẫu ruleset board game theo điểm chốt 4 của P2: chỉ cấu trúc (`seated`, `phases`, `scoring`), không số của game nào.

## Thứ tự

F5 (fixture tối thiểu) cùng F1, rồi F2, F3, F4. Mỗi bước một PR từ `main`, xanh CI rồi mới sang bước sau. F2 và F3
đều đổi `TurnState` và seat view nên không chạy song song.

## Không làm ở F

- Chia vai ẩn và thiết lập ngẫu nhiên (cần bảng ngẫu nhiên và một house decision).
- Đồng hồ cờ theo lượt.
- Đội (team) trong game cạnh tranh: hạng theo đội cần `scoring.teams`; thêm khi một bàn thật cần.
- Mô phỏng linh kiện, kiểm nước đi (ADR 0007).

## Chỗ phải đổi

| Nơi | F1 | F2 | F3 | F4 |
|---|---|---|---|---|
| `packages/rules-engine/src/manifest.ts`, `enums.ts`, `primitives/` | ✔ | ✔ | ✔ | |
| `packages/core-schema/src/encounter.ts`, `actions.ts` (action, quyền) | ✔ | ✔ | ✔ | |
| `apps/api/src/encounter/` (schema, plan, turn, actions) | ✔ | ✔ | ✔ | |
| `apps/api/src/campaign/event.undo.ts` | ✔ | ✔ | ✔ | |
| `apps/api/src/view/`, `table/` (snapshot, seat view) | | ✔ | ✔ | ✔ |
| `apps/api/src/campaign/` hoặc thư mục mới `game/` (`session_result`) | | | ✔ | ✔ |
| `apps/web` (tracker, banner, màn kết thúc, bảng xếp hạng) | ✔ | ✔ | ✔ | ✔ |
| `CONTEXT.md` (Phase, Score, Result) | | ✔ | ✔ | |
| `apps/api/drizzle/` (`db:generate`) | ✔ | ✔ | ✔ | |

UI theo `.claude/frontend-code-style.md`, chạy skill `frontend-design` trước khi dựng màn mới.
