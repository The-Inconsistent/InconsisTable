# InconsisTable P1: một ruleset homebrew chơi được trọn một buổi

> Kế hoạch cho giai đoạn P1 của `docs/design.md` (§7). Chờ duyệt trước khi code.
> Dựng trên P0 (`docs/p0-plan.md`, nhánh `claude/p0-skeleton`). Đọc `CLAUDE.md` trước: 8 nguyên tắc là bắt buộc.

## Mục tiêu

Một bàn chơi one-shot với một ruleset homebrew từ lúc tạo nhân vật tới hết buổi, chỉ dùng app để giữ sổ sách:
- Nhập ruleset và pack có kiểm tra cite.
- Actor có giá trị thật, builder tạo nhân vật.
- Sheet chơi trên điện thoại.
- Combat tracker trên tablet GM.
- Undo phía server.

**Xong khi:**
1. `bun run typecheck`, `lint`, `test` xanh trên CI.
2. Test engine: `creation`, pack validator (từ chối entry thiếu cite, miễn cho homebrew), hết hạn condition, reset theo
   `resetOn`, đều chạy trên fixture tự chế.
3. Smoke test end-to-end (fixture tự chế, không có chữ SRD):
   - Nhập ruleset và pack qua REST; bản thiếu cite bị từ chối và trả về đúng `path`.
   - Chủ phòng pin ruleset vào phòng; người chơi build nhân vật; GM thêm 3 quái từ pack.
   - Bắt đầu trận, `next` qua hết một round; sát thương bị clamp; death save; condition `ownTurnEnd` tự hết.
   - Undo đưa đúng giá trị về, kể cả khi có delta khác ghi sau nó.
   - Người chơi không thấy field `gm`; pack `private` không tới được người không có ghế hay phòng mà chủ pack không
     làm GM.
4. Chơi thử trên trình duyệt (tablet GM, 2 điện thoại, TV) với ruleset và pack homebrew nhập qua `/library`, từ tạo
   nhân vật tới `session.end` (chi tiết ở "P1 xong khi" bên dưới).

## Nguyên tắc nội dung

- Repo **không chứa** manifest `dnd5e-srd`, pack SRD, chữ SRD hay stat block. Người dùng tự nhập qua chính công cụ nhập.
- Test và fixture chỉ dùng bộ luật tự chế như `packages/rules-engine/src/fixtures/sample-d20.ts`: tên, số và cite
  ("Sample p.N") đều bịa, đủ nhỏ để đọc hết.
- Engine chỉ thêm **tham số** cho primitive. Con số và cite của 5e nằm trong manifest người dùng nhập.
- Chỗ sách mơ hồ: ghi vào `decisions[]` của manifest (ruleset) hoặc `docs/house-decisions.md` (engine). Không quyết
  trong code.

## Đã có ở P0, dùng lại

| Có sẵn | Dùng cho |
|---|---|
| `rules-engine`: `validateRuleset` (đã bắt cite, miễn homebrew), `compileRuleset`, `deriveValues`, `applyBaseEffects`, `resourceBounds`, `resetValue`, `healthStatesOf`, `toViewerView` | Importer, snapshot, sheet |
| Primitive `initiative.ranked` (`start/next/remove`), `health.tracks` (`damage/heal/deathSave`), `resource.capped` (`adjust`), `dice.sumVsTarget` (`resolve`); `runOp` + `checkDeltas` | Combat, sheet, Test |
| Bảng `actor`, `actor_field/resource/condition/choice/link`, `ruleset`, `ruleset_version`, `resource_pool`, `session_event`; `campaign.ruleset_version_id` (còn null) | Mọi workstream; chưa có code nào ghi các bảng giá trị hay `session_event` |
| `table.dispatch.ts` (`authorize`, `touches`, `kicks`, `state_version`), hàng đợi theo campaign ở gateway | Đường mutation duy nhất cho ruleset action |
| Permission `campaign:ruleset` (chỉ chủ phòng), `encounter:run`, `test:call`, `character:edit:own/any` | Không cần thêm quyền mới ngoài `pack:*` |
| Relay `book:*` (`core-schema/book.ts`, gateway) | Chạm cite là mở trang PDF của GM |
| Web: `use-table`, khung tab GM (`track`, `rules` còn trống), app người chơi, màn hình TV | Chỗ gắn các màn mới |

## Workstream

**Mọi workstream có UI (C, D, E, F, G) phải chạy skill `frontend-design:frontend-design` trước khi code UI.**

### A. Engine: creation, pack, hết hạn, reset (`packages/rules-engine`)

- **Mục tiêu:** manifest và pack đủ chỗ cho 5e mà không cần nội dung trong repo.
- **Thêm vào manifest:**
  - `creation: CreationStep[]`: chọn entry pack theo entity (`choose`), gán chỉ số theo bảng/điểm do manifest khai
    (`assign`), nhập field (`fields`). Mỗi step có `cite`.
  - `decisions[]` (`{ id, text, cite? }`): house decision của ruleset, hiện ở RULES.
  - Tham số `health.tracks` còn thiếu mà house decision #7 đã nói ruleset phải tự khai: sát thương khi đang dying
    tính thất bại, chết ngay khi sát thương dư vượt ngưỡng (biểu thức).
- **Pack:** `Pack { id, version, ruleset: range, license, sources[], entries[] }`; entry `{ key, type, name, cite,
  visibility, body }`, `type` là một entity của ruleset và `body` là giá trị field, kiểm theo `FieldDef`. Validator
  từ chối entry thiếu `cite` (trừ homebrew) và trả cảnh báo khi mô tả của pack `private` dài quá ngưỡng.
- **Primitive mới:** `conditions.expire` (`ownTurnEnd`, `roundEnd`, `encounterEnd`, đếm `expiresAfter`) và
  `rest` (áp `resetOn` cho `shortRest/longRest/sessionStart/sessionEnd/encounterEnd`).
- **Test:** fixture `sample-d20` mở rộng + một pack tự chế; creation hợp lệ và không hợp lệ; cite thiếu bị từ chối;
  thứ tự hết hạn condition; reset về `max`/`min`.
- **Xong khi:** `bun run test` xanh; không đổi API của các primitive P0.

### B. Pipeline ruleset action và undo (`core-schema`, `apps/api/src/table`, `campaign`)

- **Mục tiêu:** một đường ghi cho mọi delta, mỗi delta có `before/after` trong `session_event`.
- **Action:** `rule.op { primitive, op, input }` (chung cho mọi op của registry), `field.set { actorId, field, value }`,
  `condition.add/remove`, `actor.rest { event }`, `event.undo`.
- **Pipeline (design §5.3):** parse → state guard → `can(op.perm)` → `runOp` → kiểm `editableBy` theo ghế (`owner`
  chỉ ghi nhân vật mình giữ; `ownerSpendOnly` chỉ delta âm) → ghi → broadcast.
  - Một helper `writeDelta` duy nhất: resource dùng câu `INSERT … ON CONFLICT … LEAST/GREATEST … RETURNING OLD/NEW`
    của §5.4 (clamp ở server); field và turn dùng `UPDATE … RETURNING OLD/NEW`.
  - `touches` và `kicks` của ruleset action lấy từ op, không viết tay trong `dispatch`.
  - `session.start/end` gọi `rest` cho các resource có `resetOn` tương ứng.
- **Schema:** `session_event` thêm cột `action_id uuid` (gom các delta của một action), `seat_user_id text`,
  `undone_by uuid null`; index `(campaign_id, undone_by, created_at)`. Payload vẫn là JSONB (log chỉ ghi thêm).
- **Undo:** GM và co-GM `combat` undo action gần nhất chưa undo của session đang chạy, lần lượt ngược về trước, trong
  cùng transaction, ghi một event `undo` mới. Delta `add` đảo `after − before` (không đè delta đến sau). Delta `set`
  (field, turn) chỉ undo khi giá trị hiện tại còn bằng `after`; khác thì từ chối và báo rõ. Không có redo.
- **Snapshot:** `table.state.ts` nạp hàng giá trị, compile manifest một lần theo `hash` (cache trong process), tính
  derived, rồi `toViewerView` cho từng ghế. `LiveState.actors` mang thêm `entity`, `fields`, `resources`, `derived`,
  `conditions`.
- **Test:** unit cho `editableBy` và undo khi có delta xen giữa; smoke cho clamp, undo, người chơi bị từ chối khi ghi
  field `gm`.
- **Xong khi:** mọi ghi giá trị actor đi qua `writeDelta`; không còn `UPDATE` tay nào trên bảng giá trị.

### C. Importer ruleset và pack (`apps/api/src/ruleset`, web)

- **Mục tiêu:** người dùng dán JSON hoặc chọn file, thấy lỗi theo `path`, lưu phiên bản bất biến, mặc định riêng tư.
- **Schema:** `pack` (`owner_user_id`, `license` `private|srd|cc-by|orc|original`, `attribution`, `hidden_at`,
  `disabled_at`), `pack_version` (`hash`, bất biến), `pack_entry` (`key`, `type`, `name`, `level`, `tags text[]`,
  `visibility` `public|party|gm`, `cite`, `content_hash`, `body jsonb`; index `(pack_version_id, type)`, `pg_trgm` trên
  `name`, không GIN trên `body`), `campaign_pack (campaign_id, pack_version_id)` với FK `RESTRICT`.
- **Cách lưu (chốt 2026-10-13):** file gốc là của người dùng, giữ ở đâu tuỳ họ; sau khi nhập, DB là bản chính và file
  tải lên bị bỏ. Ruleset là JSONB nguyên khối; pack là một hàng mỗi entry (cột có kiểu để lọc, `body` để hiển thị).
- **Nhập trong một transaction:** parse + zod; giới hạn file ≤ 5 MB, ≤ 5.000 entry/pack, `body` ≤ 16 KB/entry;
  bắt buộc `cite` (trừ homebrew); cảnh báo mô tả > 280 ký tự; chuẩn hoá key `pack:key`; tính `content_hash`, diff với
  bản trước (thêm/sửa/xoá), ghi `pack_version` + entry, trả diff cho người dùng.
- **Vòng đời:** mỗi lần nhập là một phiên bản mới, không sửa đè. Phòng pin phiên bản; spawn chép giá trị thành hàng
  nên đổi pack không đổi bàn đang chơi. "Xoá" là ẩn (`hidden_at`); chỉ xoá thật khi không phòng nào tham chiếu.
- **Quota và gỡ:** quota theo user (số pack, tổng dung lượng). Admin đặt `disabled_at` để gỡ ngay khi có yêu cầu
  (notice-and-takedown), ghi `admin_event`. Chủ pack tải lại JSON của mình (`GET /api/packs/:id/export`).
- **License:** `srd|cc-by|orc` bắt buộc `attribution` và hiện trên UI; không tự lên danh mục công khai (cần
  `pack:approve`, P4).
- **Đường đi:** REST cho ghi thuộc chủ sở hữu ngoài campaign (§5.3): `POST /api/rulesets`, `POST /api/packs`,
  `GET` danh sách của tôi. Gắn vào phòng là socket action: `campaign.setRuleset` (`campaign:ruleset`, từ chối khi đã
  có actor dùng phiên bản khác), `campaign.attachPack` (pack `private` chỉ gắn được vào phòng mà người gọi là chủ pack
  và đang làm GM). Cập nhật danh sách ngoại lệ trong `CLAUDE.md`.
- **Đọc theo ghế:** `GET /api/campaigns/:id/rules` trả manifest đã lọc và entry pack theo ghế; entry `gm` chỉ tới ghế
  GM. Không có route nào phục vụ pack cho người không có ghế.
- **Web:** "Ruleset & Pack của tôi" trong lobby: dán/tải file, danh sách problem bấm được, nhắc "tóm tắt bằng lời của
  bạn, kèm trang" ngay ở ô nhập, cảnh báo mô tả dài. Bước chọn ruleset khi tạo phòng.
- **Test:** smoke nhập fixture hợp lệ, bản thiếu cite, bản quá cỡ; pack private bị từ chối ở phòng người khác.
- **Xong khi:** một phòng mới pin được ruleset và pack đã nhập; rate limit trên route nhập.
- **Đã làm, chi tiết chọn khi code (2026-10-13):** quota 50 pack / 50 MB mỗi user (tính mọi phiên bản còn lưu, kể cả pack
  đã ẩn); POST nhập 20 lần/phút/IP. Nhập lại đúng nội dung (cùng hash, cùng phiên bản ruleset) không ghi gì. Phiên bản
  cũ chưa phòng nào gắn bị xoá khi có bản mới (bản phòng đang gắn thì giữ), nên nhập lại bản sửa không ăn quota. License
  và ruleset của pack cố định từ lần nhập đầu (không đổi `private` thành `srd` bằng cách nhập lại). "Xoá" pack ẩn ngay và
  xoá thật nếu không phòng nào dùng. Pack `private` chỉ được phục vụ khi chủ pack vẫn là GM của phòng. Pack gắn theo
  ruleset (cùng `ruleset`, chưa so khoảng phiên bản). Admin gỡ qua `POST /api/admin/packs/:id/disable`.

### D. Actor và builder (`apps/api/src/actor`, web)

- **Mục tiêu:** nhân vật có giá trị thật; quái từ pack vào bàn.
- **Action:** `actor.create` nhận `entityType`; `actor.build { actorId, choices, fields }` (server chạy lại `creation`
  rồi ghi `actor_choice`, `actor_field`, `actor_resource` ban đầu qua `writeDelta`); `actor.spawn { packKey, count,
  temporary }` tạo N actor `creature` tự đánh số, chép `body` thành hàng (pack version bất biến nên hàng đã là
  snapshot).
- **Lối thoát nhập tay:** GM (hoặc chủ nhân vật với field `editableBy: owner`) sửa field bằng `field.set`.
- **Nháp builder:** bảng `builder_draft` (`user_id`, `campaign_id`, `ruleset_version_id`, `body` JSONB đọc/ghi nguyên
  khối, khoá chính `(user_id, campaign_id)`); action `draft.save` / `draft.discard`, chỉ chủ nháp đọc được; xoá khi
  `actor.build` thành công.
- **Web:** builder trên điện thoại theo `creation`, xem trước bằng engine ở client, server quyết định khi gửi. GM tạo
  pregen trong PARTY.
- **Test:** unit cho build hợp lệ/không; smoke build một nhân vật và spawn 3 quái.
- **Xong khi:** nhân vật build xong hiện đúng derived trên sheet của chủ và GM.

### E. Sheet chơi (web; dựa trên B, D)

- **Mục tiêu:** sheet điện thoại render từ `layout`, đọc được ở khoảng cách một cánh tay.
- Nút ± chỉ trên resource `owner`/`ownerSpendOnly`; còn lại người chơi nói với GM.
- Chạm số derived mở **Breakdown** (§4.4): từng nguồn cộng trừ kèm cite; chạm cite mở trang qua relay `book:*`.
- Condition đang có, slot, nghỉ ngắn/dài (GM bấm `actor.rest`).
- Tab RULES (GM và người chơi): condition, `decisions[]`, entry pack theo ghế, kèm cite.
- **Test:** unit cho map `layout` → section; kiểm thủ công ở 375px.
- **Xong khi:** người chơi đọc và tiêu resource của mình mà không cần hỏi GM.

### F. Combat tracker (api `encounter`, web TRACK; dựa trên B, D)

- **Schema:** `encounter (id, campaign_id, round, active, current_combatant_id)`, `combatant (id, encounter_id,
  actor_id, side, ord, initiative_score, visibility enum[hidden|bar|full])`. Không có `stat_snapshot`: actor
  `creature` đã chép giá trị lúc spawn.
- **Encounter mở qua nhiều session:** một encounter có thể còn mở khi hết session. Khi không có session đang chạy, mọi
  action của encounter bị từ chối ("Start a session to continue"); TV và điện thoại vẫn hiện thứ tự với nhãn
  "Paused", không có banner đến lượt và không rung. Undo chỉ trong session đang chạy (quyết định 2).
- **Action:** `encounter.start/end/add/remove` (core, `encounter:run`); `turn.op` → `initiative.ranked`, rồi
  `conditions.expire`; `encounter.end` chạy `rest(encounterEnd)` và dọn actor `temporary` trừ con GM giữ.
- **Web:** TRACK trên tablet: thứ tự, lượt hiện tại, bàn phím sát thương/hồi máu/HP tạm, death save, condition có
  thời hạn, ẩn combatant, nút **Undo** luôn trong tầm tay. Điện thoại: banner "đến lượt bạn" + rung. TV: thứ tự và
  thanh máu theo visibility.
- **Test:** smoke một round đầy đủ; người chơi không thấy combatant `hidden`; undo một `next`.
- **Xong khi:** GM chạy trọn một trận 3 PC đấu 3 quái chỉ bằng tablet.

### G. Gọi Test (api, web; dựa trên B)

- **Schema (đã dựng):** `test_call` (`test_id`, `inputs` jsonb = giá trị GM cấp cho các biểu thức của Test, `hide_target`,
  `show_outcome`, `revealed`, `status`); `test_call_target` (modifier và target tính cho từng nhân vật lúc gọi và giữ
  nguyên); `test_report` (`faces`, `natural`, `total`, `outcome` do server tính, `reported_by`).
- **Action:** `test.call` (`test:call`), `test.report` (chủ nhân vật; người chơi nhập số trên xúc xắc thật, server
  tính outcome bằng `dice.sumVsTarget.resolve` vì DC có thể ẩn), `test.close` ghi vào `session_event`.
- **Web:** điểm vào là tab Tests, cùng nút "Call a Test" trong TRACK mở đúng form đó với combatant đang chọn điền sẵn; điện thoại hiện `d20 + mod` đã tính và ô nhập số; GM thấy bảng tổng hợp.
- **Xong khi:** smoke gọi, báo, đóng một Test có DC ẩn; người chơi không nhận được DC.

## P1 xong khi

- PR #13 đã merge. Clerk (role, invite-only) đã bỏ ở #46. Mặc định không có tài khoản: mỗi thiết bị là một user ẩn
  danh (cookie `it_device`); đăng nhập InconsisID là tuỳ chọn (`IDP_SIGN_IN`, chỉ trên HTTPS, house decision #33,
  PR #52). Admin vẫn bằng `ADMIN_KEY` (house decision #32).
- Ruleset homebrew và pack đã nhập qua `/library`.
- Chơi thử trong LAN: 9 bước trình duyệt của `docs/handoff.md`, cộng dựng một nhân vật, một trận và một Test.
- Một buổi chơi thật với nhóm, chơi Wrath & Glory trên máy này hoặc LAN tin cậy (`docs/deploy.md`); chưa có
  host công khai: `docs/deploy.md` vẫn chờ tài khoản và các sửa lỗi bảo mật #15–#19. Xem "Đến buổi chơi thật".

### Đến buổi chơi thật (chốt 2026-10-14)

Chơi thử LAN đã xong (#21, #22). P1 chỉ đóng sau buổi chơi thật; không ép mốc.

Luồng code, theo thứ tự, mỗi mục một PR:

1. **Một đường đổi HP** (kiến trúc #5): web chọn `health.tracks` cho resource HP, `resource.capped` cho phần còn lại;
   server từ chối `resource.capped` nhắm vào resource HP; bỏ `stepsOf` chép lại `editableBy`; co-GM không còn
   `gm=true` cứng.
2. **Dice pool, mức Wrath & Glory tối thiểu** (spec issue riêng). Engine trung lập, mọi con số từ ruleset: pool từ
   biểu thức, modifier của Test Call cộng/trừ xúc xắc, dải mặt tính điểm (có mặt tính đôi), xúc xắc đặc biệt gắn cờ
   critical/complication. Server tính icon so DN, margin, số viên shift được và các cờ; tiêu shift do bàn quyết. DN ẩn
   như DC. Người chơi báo bằng stepper đếm theo dải cộng mặt xúc xắc đặc biệt. Wounds/Shock tạm dùng track đếm xuống,
   initiative GM nhập, soak GM tự tính.
3. **Module Seat view** (#23), gồm cả view của Test pool.
4. **Bảo mật** #15–#19, gộp một PR.
5. **Bàn giao deploy** cho devops: Containerfile api và web, compose có Postgres 18, `docs/deploy.md` (env, health
   check, `TRUST_CF`). Xong ở PR #32; từ #46 chỉ chạy local hoặc LAN, chưa có host công khai.

Luồng nội dung, song song: Claude dựng khung manifest W&G trong `inconsistable-content` theo tên mục chủ sản phẩm
đưa; chủ sản phẩm điền số, cite trang và tóm tắt bằng lời mình (nguyên tắc 1, 2); chỗ sách mơ hồ ghi vào
house-decisions của ruleset.

Nháp `docs/p2-plan.md` khi rảnh, chốt sau buổi chơi.

### Theme nền và admin tối thiểu (chốt 2026-10-14)

- **Theme nền "quán trọ đêm + thẻ giấy":** nền tối ấm (gỗ, ánh nến, đồng); sheet, Test Call, entry là thẻ giấy da
  trên bàn. GM, điện thoại, TV luôn tối; lobby, library, builder, admin theo hệ thống (sáng = giấy da, tối = quán
  trọ). Chung token, khác mật độ: tablet dày, điện thoại nút to, TV chữ rất to và tương phản cao.
- **Chữ:** giữ Atkinson Hyperlegible cho số và chữ chạy; thêm một font tiêu đề có cá tính (chọn ở prototype), tránh
  font fantasy sáo mòn.
- **Texture và icon:** CSS/SVG inline tự vẽ, không ảnh, không phụ thuộc license.
- **Chỗ cho World:** mọi màu, font, texture là CSS token để một World gán lại; chưa có bảng `world` hay UI chọn theme
  (`ponytail:` sang P2). Theme W&G thuộc P2.
- Giữ các quy tắc của `.claude/frontend-code-style.md`; sửa token `--red` mà nó nhắc nhưng không tồn tại.
- **Admin tối thiểu:** một màn danh sách campaign và OPEN AS ADMIN, cùng họ theme nhưng tiết chế (dày, không trang
  trí); sửa link `/admin` ở lobby đang trỏ vào trang trống. Pack/takedown, khoá tài khoản, log admin: sau.
- **Thứ tự:** `/prototype` 2–3 biến thể ngay (branch `prototype/theme`, route `/proto`, dữ liệu giả; sheet điện
  thoại, thẻ Test Call, TRACK tablet), chọn trên thiết bị thật; áp theme vào app sau khi Dice pool merge; admin tối
  thiểu đi cùng bàn giao deploy. Tất cả xong trước buổi chơi thật.

### Sang P2

- Tablet GM phục vụ trang sách (`serveBooks` chưa được gọi ở đâu).
- Resource theo pool (party/GM/campaign).
- Màn admin gỡ pack (takedown).

## Thứ tự làm

1. **A** và **B** song song (engine thuần ∥ api). B dùng primitive P0, chỉ cần A cho `conditions.expire` và `rest`
   ở bước cuối.
2. **C** sau A (cần schema pack). Phần web của C bắt đầu được khi REST của C có hình dạng.
3. **D** sau B và C.
4. **E**, **F**, **G** song song sau D (G chỉ cần B, có thể bắt đầu sớm hơn).
5. Smoke test đầy đủ, rồi chơi thử trên trình duyệt; sửa cho xanh.

Mỗi workstream song song chạy ở session/agent riêng, trên nhánh riêng, merge qua PR với `/review`. Ai đổi
`*.schema.ts` thì chạy `db:generate`; trước khi có dữ liệu thật, migration vẫn tạo lại từ đầu.

## Quyết định đã chốt (chủ sản phẩm, 2026-10-12)

1. **Initiative:** GM nhập hết. Quái thì GM gieo thật rồi nhập; PC báo miệng, GM nhập. App không gieo, nên nguyên
   tắc 5 không cần ngoại lệ.
2. **Phạm vi undo:** GM và co-GM có scope `combat`, mọi bước của session đang chạy, theo thứ tự ngược. Không có redo
   ở P1.
3. **Undo một delta `set`** (field, turn) khi giá trị hiện tại khác `after` của bước đó: từ chối và báo rõ; phải undo
   các bước sau trước. Không ghi đè ngầm.
4. **Nháp builder:** lưu trên server, một tài liệu JSONB đọc/ghi nguyên khối, khoá theo (user, campaign). Chỉ là bảng
   nháp tối thiểu, chưa phải library nhân vật (vẫn P2).
5. **Form nhập pack:** P2. P1 chỉ dán JSON và tải file, qua validator cite.
6. **Ngưỡng cảnh báo** mô tả dài trong pack `private`: 280 ký tự, chỉ cảnh báo, không chặn.
7. **Chơi thử P1:** máy dev trong LAN (Aspire/Podman), điện thoại vào qua IP LAN (`DEV_ORIGINS`,
   `NEXT_PUBLIC_DEV_HOST`). Chưa deploy.

8. **Nội dung playtest:** một ruleset homebrew kiểu d20 cùng một pack nhỏ đủ một one-shot, do Claude soạn trong repo
   riêng `The-Inconsistent/inconsistable-content` (private), nhập qua `/library`, không bao giờ commit vào repo này.
   Không có converter SRD trong repo; hệ thống chỉ lưu bản đã nhập (xem C).

## Không làm ở P1

- Nâng phiên bản ruleset có migration và dry-run diff: P1 chỉ pin một lần (`ponytail:` ở `campaign.setRuleset`).
- `request.*` (xin tiêu resource), library nhân vật, World/theme, house rule có patch, encounter budget: P2.
- `pack_grant`, danh mục công khai, `pack:approve`: P4. Tài khoản đi qua InconsisID (house decision #33, ADR 0005),
  có từ PR #52 nhưng tuỳ chọn.
- Script sandbox, patch broadcast, Redis.

## Cần làm trước khi bắt đầu

- PR #1 (P0) đã review và merge vào `main`; các bước 1–6 của `docs/handoff.md` xong.
- Các mục 1–3 đã chốt; B và F bắt đầu được.
