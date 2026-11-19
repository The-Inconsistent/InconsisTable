# InconsisTable P3: port Wrath & Glory

> Kế hoạch cho giai đoạn P3 của `docs/design.md` (§7). **Nháp, chờ chủ sản phẩm duyệt trước khi code phần platform.**
> Đọc `CLAUDE.md` trước: 8 nguyên tắc là bắt buộc. Dựa trên `docs/adr/0010-game-modules.md` (đang ở trạng thái đề xuất).
> Nguồn đối chiếu là repo `The-Inconsistent/auspex_gm` (bản local: `~/antigravity/wrath_glory`), commit `38712298`.

## Mục tiêu

Bàn Wrath & Glory đang chạy trên Auspex chuyển sang InconsisTable mà không mất tính năng nào bàn đang dùng. Wrath &
Glory vào app như mọi game khác: một ruleset và các pack `private` do chủ bàn nhập, cùng một World cho giao diện. Repo
này không chứa một dòng nội dung nào của sách (ADR 0001).

**Xong khi:**
1. Mọi test luật của auspex_gm có bản tương ứng xanh (danh sách ở "Chuẩn đối chiếu").
2. 11 nhân vật pregen dựng lại bằng builder của InconsisTable ra đúng sheet và đúng sổ XP.
3. Một buổi chơi thật của bàn The Long Vigil trên bản prod của InconsisTable, từ `session.start` tới recap.
4. `bun run typecheck`, `lint`, `test`, `test:go`, `test:smoke` xanh; fixture trong repo vẫn chỉ là game bịa.

## Nguyên tắc nội dung

- Ruleset và pack Wrath & Glory được **sinh ra từ dữ liệu của auspex_gm**, không gõ lại từ trí nhớ (nguyên tắc 1).
  Script sinh nằm trong repo auspex_gm (`packages/data/port/`), vì dữ liệu sách đã ở đó và repo đó private. File sinh ra
  không commit vào repo nào; chủ bàn nhập qua `/library`.
- Mỗi primitive, effect type hay widget mới phải dùng được cho game khác và được thử trên giấy với 5e SRD trước khi
  merge (ADR 0010, luật 5). Test và fixture của nó dùng game bịa (`sample-*`), không có tên hay số của Wrath & Glory.
- Chỗ sách mơ hồ: lấy đúng quyết định đã ghi ở `docs/rules-flow.md` §11 của auspex_gm, chép thành `decisions[]` của
  ruleset bằng lời mình. Chỗ engine phải chọn: `docs/house-decisions.md`.
- Trên GitHub viết đủ tên sách (Vow of Absolution, không viết tắt).

## Đã làm (bước 0, 2026-11-19)

Viết thử ruleset bậc 1 và chạy qua validator hiện tại, để danh sách thiếu bên dưới là thật chứ không đoán.

- Nhánh `feat/inconsistable-ruleset` của auspex_gm: `packages/data/port/ruleset.ts` dựng manifest từ hằng số và dữ liệu
  luật của chính repo đó; `write.ts` ghi ra file; `ruleset.test.ts` so với hàm luật của auspex_gm.
- Manifest `wrath-and-glory@0.1.0` (28 KB) qua được `compileRuleset` bản TypeScript **và** `engine.CompileRuleset`
  bản Go.
- Đối chiếu xanh trên cả 11 pregen: 11 Trait và 18 tổng Skill khớp `deriveStats` và `skillTotal`; pool của Test khớp
  `testPool`; DN của Corruption Test khớp `corruptionTestDn` với 0 tới 30 điểm; trần Glory và Ruin khớp `poolMax` với 1
  tới 8 người chơi.
- Manifest này có: entity `agent` (7 Attribute, 18 Skill, Tier, XP, giáp, 11 ô bonus), Trait là derived có cite,
  resource Wounds, Shock, Wrath, Glory (party), Ruin (gm), Wealth, Corruption, 7 loại đạn, 14 Condition, bốn Test dạng
  dice pool (Wrath Die, Exalted Icon, Shift), bốn trạng thái máu, bốn quyết định, layout sheet.
- Chưa thử: nhập file này vào một api đang chạy và chơi thử trên trình duyệt.

## Thiếu

**Đã kiểm chứng** (validator từ chối, hoặc đọc thẳng trong code):

| # | Thiếu | Hiện phải làm gì | Hướng sửa |
|---|---|---|---|
| 1 | Test và trạng thái máu bị kiểm tra với **mọi** loại actor. Test chỉ Agent mới gieo (đọc `derived.conviction`) làm manifest bị từ chối ngay khi có loại actor thứ hai | Bỏ hẳn entity Threat khỏi bậc 1 | **Đã sửa** (house decision #50): `tests.<id>.entities` và `health.states[].entities`, như `resources[].entities` đã có |
| 2 | Phòng có nhân vật đã dựng không đổi được sang phiên bản khác của ruleset (`charactersUseOtherVersion`) | Không sửa được ruleset khi bàn đã chơi | **Đã sửa một nửa** (house decision #51): phòng chuyển được sang phiên bản mà mọi giá trị đang lưu vẫn hợp lệ. Phiên bản đổi tên hoặc bỏ thứ đang dùng vẫn chờ migration có khai báo (design §4.5) |
| 3 | Không có field cấp campaign (Tier) | Mỗi sheet tự ghi Tier | `campaignFields` trong manifest + `campaign_option` (design §5.4) |
| 4 | Effect chỉ gắn được vào Condition. Bonus từ Species, Talent, giáp, Mutation không có chỗ khai | GM gõ 11 ô `mod.*` | Entry của pack mang `effects`, áp theo thứ tự của design §4.4 |
| 5 | `initiative` chỉ có `ranked` và `seated` | Không khai `initiative`, nên `encounter.start` bị từ chối: chưa có trận | Primitive xếp lượt luân phiên theo phe, có Seize |
| 6 | `health.tracks` đếm xuống. Wounds và Shock đếm lên và vượt trần | Khai là resource `capped: false` và bốn `health.states`; không có luật khi trúng đòn | Primitive máu đếm lên (Dying, Traumatic Injury, Annihilation, Exhausted đổi Shock thành Wounds) |
| 7 | House decision #23: resource có trần khởi đầu ở trần | Wounds khởi đầu bằng Max Wounds, GM phải kéo về 0 | **Đã sửa** (house decision #52): resource khai giá trị khởi đầu (`start`) |
| 8 | Sự kiện nghỉ mang tên của engine ("Long rest") | Respite khai là `longRest` | Từ vựng của World (ADR 0010 mục 2) |
| 9 | `layout` chỉ vẽ sheet; `terms` không ai đọc; Theme theo thiết bị | Sheet là danh sách số | ADR 0010 mục 2 và 3 |

**Từ khảo sát auspex_gm, chưa thử trên manifest:**

| # | Thiếu | Nguồn trong auspex_gm |
|---|---|---|
| 10 | Mob: một combatant nhiều thành viên, mỗi thành viên 1 Wound; trần "–" (không bao giờ nhận Shock) | `combatant.adjust`, `threatStatus` |
| 11 | Hệ quả của Test: Wrath Critical cộng Glory, Corruption nhận DN − Icon (gấp đôi khi Complication) | `corruption.ts`; hiện GM tự bấm |
| 12 | Luật "hiện như": Corruption của người khác chỉ hiện khi Lost, Mutation hiện "Unseen" nhưng vẫn tính số, Threat ẩn / chỉ thanh máu / đủ chỉ số, lượt của Threat ẩn hiện là "unseen" | `toPlayerView` |
| 13 | Builder mua bằng XP: bảng giá luỹ tiến, Archetype, Ascension, mua thêm sau khi tạo | `build.ts` (2.498 dòng), `build.test.ts` (68 case) |
| 14 | Bảng tra do GM gõ kết quả xúc xắc thật rồi áp phần cơ chế (Critical Hit, Perils of the Warp) | `lookups.ts` |
| 15 | Psychic trong trận: mỗi Round một power, power đang duy trì cộng DN | `psychic.ts` |
| 16 | Tính năng bàn: giao và thu đồ (#64), handout cho một nhân vật (#65), Intel (#66), chữ trợ giúp (#67), Objective theo buổi, whisper, ảnh, thẻ in, phục vụ trang sách trên tablet GM | danh sách ở "Bậc 4" |

## Các bậc

Mỗi bước một PR, xong bằng test của nó. Bậc sau chỉ bắt đầu khi bậc trước có bàn chơi thử được.

### Bậc 0. Mở đường (platform, không có gì riêng Wrath & Glory)

1. Chốt ADR 0010.
2. Nâng phiên bản ruleset cho phòng đã có nhân vật (thiếu 2). Không có bước này thì mỗi lần sửa manifest là một lần
   dựng lại nhân vật.
3. `entities` cho Test và trạng thái máu (thiếu 1).
4. Số phiên bản core và kiểm `core` range lúc nhập (ADR 0010 mục 6).

### Bậc 1. Luật: sheet, Test, pool, trận

1. Field cấp campaign (thiếu 3) và giá trị khởi đầu của resource (thiếu 7).
2. Primitive xếp lượt luân phiên theo phe (thiếu 5): hai phe, phe người chơi chọn trước mỗi Round, Seize tốn một
   resource khai trong manifest, cờ đã đi / phục kích / giữ lượt. Thử trên giấy với một game có lượt theo phe khác.
3. Primitive máu đếm lên (thiếu 6) và Mob (thiếu 10).
4. Schema pack cho Threat, **dừng để chủ sản phẩm duyệt schema**, rồi mới viết script chuyển 369 stat block.
5. Ruleset `0.2.0` có Threat, initiative và máu; chơi thử một trận trên LAN.

### Bậc 2. Ai thấy gì

1. Luật "hiện như" tổng quát trong manifest (thiếu 12): một giá trị có thể hiện cho người không phải chủ dưới dạng một
   nhãn theo ngưỡng, hoặc ẩn tên mà giữ số. Seat view là nơi duy nhất quyết định; mỗi nhánh mới có test "ghế này không
   nhận được giá trị gốc", ở cả TypeScript và Go.
2. Mức hiện của combatant (ẩn, thanh máu, đủ chỉ số).

### Bậc 3. Builder và dữ liệu

1. Entry mang effect (thiếu 4).
2. Schema pack cho catalogue tạo nhân vật (Species, Archetype, Talent, Keyword, power, package) và wargear, **dừng để
   duyệt schema**, rồi script chuyển.
3. Primitive sổ XP (thiếu 13): manifest khai bảng giá và các bước; engine giữ sổ. Đích: 11 pregen ra đúng sheet và sổ.
4. Ascension và mua thêm sau khi tạo.

### Bậc 4. Bàn chuyển sang

1. World Wrath & Glory (Theme, từ vựng) và widget cho sheet, lượt và TV, theo ADR 0010.
2. Các tính năng bàn đang dùng mà InconsisTable chưa có (thiếu 14, 15, 16). Phần lớn trung lập với hệ luật, làm ở core.
3. Nhập campaign đang chơi: đọc file export `auspex-campaign` (codex, recap, nhân vật) thành dữ liệu của một phòng.
4. Một buổi chơi thật; Auspex giữ nguyên tới khi buổi đó xong.

## Chuẩn đối chiếu

Từ auspex_gm, theo bậc dùng tới:

| Bậc | Bộ test | Cỡ |
|---|---|---|
| 1 | `packages/shared/src/state.test.ts` (lượt, Seize, sát thương, trạng thái), `attack`, `corruption`, `spend`, `lookups`, `psychic` | 39 + 6 + 7 + 5 + 15 + 4 case |
| 2 | `state.test.ts` phần `toPlayerView`, `codex.test.ts` | 16 case codex |
| 3 | `packages/data/build.test.ts` trên 11 pregen | 68 case |
| 4 | `apps/api/test/smoke.test.ts` | 40 khối test |

Mỗi bậc thêm test vào `packages/data/port/` của auspex_gm, so engine của InconsisTable với hàm luật của auspex_gm, như
bước 0 đã làm.

## Cần chủ sản phẩm chốt

1. **ADR 0010:** phòng pin từng phần (ruleset, pack, World) hay pin một hash module như đề xuất 2026-11-02.
2. **Chỗ để script và file sinh ra:** kế hoạch này đặt script trong auspex_gm. Phương án khác là repo
   `inconsistable-content`, hiện ghi rõ "toàn bộ là tác phẩm tự viết".
3. **Bậc 0 trước hay song song:** nâng phiên bản ruleset (thiếu 2) là việc nặng nhất của bậc 0. Làm trước thì bậc 1 chậm
   một bước; làm sau thì mỗi lần sửa manifest phải dựng lại nhân vật thử.
4. **Wounded cộng 1 DN** (Core p.193): Auspex để GM tự cộng khi gọi Test. Giữ như vậy, hay để ruleset tự cộng?
5. **Bản đồ in có ô lưới** mà Auspex đã hứa: vẫn chưa quyết, ngoài phạm vi P3.

## Không làm ở P3

- Danh mục công khai, `pack_grant`, Redis, S3: vẫn P4.
- Script sandbox: mọi cơ chế mới là primitive.
- App gieo Test thay người chơi: `wrath-and-glory` không bật (nguyên tắc 5).
- Game khác (Warhammer Quest, Cyberpunk RED, 5e SRD): P5; 5e SRD chỉ là phép thử trên giấy.
