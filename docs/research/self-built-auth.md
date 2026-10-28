# Tự dựng xác thực và phân quyền cho InconsisTable (đọc ngày 2026-10-24)

Câu hỏi: dựng một service xác thực (authentication) và phân quyền (authorization) từ A đến Z theo best practice thì làm
thế nào? Trả lời cho InconsisTable, không trả lời chung chung.

Bối cảnh: đây là bản đối chiếu "tự làm" của [`auth-providers.md`](auth-providers.md) (khảo sát nhà cung cấp, khuyến nghị
Better Auth). Hiện chưa có tài khoản. Mỗi trình duyệt là một `app_user` ẩn danh, định danh bằng cookie `it_device` do
proxy web cấp (`apps/web/proxy.ts`); api chỉ lưu SHA-256 của secret trong bảng `device` (`apps/api/src/auth/`). Khách và
TV dùng token theo phòng (`access_token`), lời mời dùng mã đã băm (`invite`). Phân quyền là seat theo từng campaign
(`gm`, `cogm` có scope, `player`, `screen`) qua hàm thuần `canInCampaign` (`packages/core-schema`), cộng thêm `ADMIN_KEY`
dùng chung. Deploy chỉ local/LAN (house decision #32, `docs/deploy.md`). Ràng buộc: không trả tiền SaaS, tự host, Bun +
NestJS + Socket.IO, Next.js 16, Postgres 18 + Drizzle, TypeScript 5.9 (giữ nguyên), zod 4. Thiết bị ẩn danh phải nâng
lên tài khoản thật mà không mất phòng hay nhân vật. Mọi nguồn đọc ngày 2026-10-24, trừ khi ghi khác. "(thứ cấp)" đánh
dấu nguồn không phải chủ sở hữu thông tin.

## Tóm tắt và khuyến nghị

1. **Kiến trúc: một module `auth/` trong api NestJS, không dựng IdP riêng.** Chỉ có một app và một DB. REST và Socket.IO
   cùng tra một bảng session trong cùng tiến trình. Một IdP OIDC riêng chỉ đáng khi có nhiều app cần SSO, và khi đó dùng
   phần mềm có sẵn chứ không tự viết.
2. **Session: token mờ (opaque), lưu hash trong Postgres, không dùng JWT.** Repo đã làm đúng mẫu này cho `it_device`,
   `access_token` và `invite`. JWT chỉ thêm khoá ký và bài toán thu hồi, trong khi api đã có sẵn cơ chế kick socket.
3. **Nâng cấp tại chỗ: gắn credential vào chính `app_user` đang dùng.** Id không đổi, nên phòng, seat, nhân vật,
   ruleset và pack giữ nguyên mà không phải chuyển dữ liệu. Gộp hai user là việc riêng, để sau.
4. **Phân quyền: giữ `canInCampaign`.** Seat cộng với nhân vật đang giữ vốn đã là ReBAC một tầng, nằm trong Postgres.
   Không cần OpenFGA hay SpiceDB. `ADMIN_KEY` được thay bằng vai trò `admin` trên `app_user`, kèm MFA.
5. **Lằn ranh build hay mua:** tự làm phần của riêng dự án (session thiết bị, ghép thiết bị, mã khôi phục, admin). Phần
   này Better Auth cũng không làm thay. Dùng thư viện chuyên biệt cho giao thức (WebAuthn, OIDC). Nếu cần cùng lúc mật
   khẩu, email, nhiều social login và MFA, gắn Better Auth thay vì tự viết hết.
6. **Bước nhỏ nhất làm được ngay trên LAN:** session có hạn và thu hồi được, "ghép thiết bị" bằng QR, bộ mã khôi phục
   in ra giấy. Không cần email, HTTPS hay thư viện mới. Mất cookie không còn đồng nghĩa với mất danh tính.
7. **Phương án B, auth là service riêng (mục 8):** một OpenID Provider dựng trên `oidc-provider`, web là BFF
   (RFC 10017), api kiểm JWT bằng `jose`, seat vẫn ở api. Làm được, nhưng tốn thêm khoảng 10–20 ngày, cần TLS nên không
   chạy trên HTTP LAN, và chưa có lý do nào trong bốn lý do khiến nó đáng làm. Khuyến nghị 1 giữ nguyên.

| Hạng mục | Chọn | Lý do chính |
|---|---|---|
| Nơi chạy | Module `apps/api/src/auth/` | Một tiến trình, một DB, nguyên tắc 6 (server quyết định) |
| Session | Token ngẫu nhiên 192 bit, lưu SHA-256, cookie HttpOnly | [ASVS 7.2.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md) cần ≥128 bit; thu hồi tức thì |
| Mật khẩu | `Bun.password` argon2id (mặc định m=64 MiB, t=2) | Có sẵn trong runtime, vượt mức tối thiểu của OWASP |
| Passkey | `@simplewebauthn/server` | Đang bảo trì; `@oslojs/webauthn` đã deprecated |
| Social login | `openid-client` (OIDC, PKCE) | OpenID Certified; `arctic` đã deprecated |
| TOTP | Tự viết theo RFC 6238 bằng `node:crypto`, hoặc `otpauth` | Khoảng 30 dòng, có test vector trong RFC |
| Phân quyền | `canInCampaign` hiện có, thêm vai trò platform `admin` | Đủ cho mô hình, không thêm service |
| Mức kiểm chứng | ASVS 5.0 L1 toàn bộ V6/V7/V8, thêm một số mục L2 | L2 đầy đủ bắt buộc MFA cho mọi user |

## 1. Kiến trúc: thư viện trong api hay service riêng

| Lựa chọn | Được | Mất |
|---|---|---|
| **Module trong api NestJS** | Một lần tra DB cho REST và socket (`resolveCtx` đã làm vậy). Chung transaction với seat và phòng. Kick socket ngay khi thu hồi. Không thêm container | Code auth sống chung tiến trình với code game, nên lỗi ở game có thể chạm tới auth |
| IdP riêng (OIDC server tự viết) | Tách biệt, phục vụ được nhiều app | Phải viết authorization server: [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) có hàng chục yêu cầu cho cả hai phía. Api phải kiểm JWT ([RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)). Thêm một service |
| IdP có sẵn (Keycloak, Authentik...) | Không tự viết giao thức | Đã loại ở `auth-providers.md`: nặng, và luồng thiết bị ẩn danh vẫn phải tự làm |

Chọn module trong api. Hàng thứ hai, làm đúng cách (dựng trên thư viện đã chứng nhận chứ không tự viết), là mục 8.
Next.js không giữ session: proxy chỉ cấp hoặc đọc cookie, còn server component hỏi api (`/me`).
[Hướng dẫn auth của Next.js](https://nextjs.org/docs/app/guides/authentication) (cập nhật 2026-09-16) nói đúng điều này:
proxy chỉ làm "optimistic checks", chỉ đọc cookie và không gọi DB; kiểm tra thật nằm sát nguồn dữ liệu. Cùng trang đó
cũng khuyên dùng thư viện auth thay vì tự làm. Đây là chi phí thật, xem mục 7.

Luồng đăng nhập là các lệnh ghi qua REST, nằm ngoài socket. Nguyên tắc 6 trong `CLAUDE.md` liệt kê các ngoại lệ REST được
phép, nên phải thêm "auth của chính user" vào danh sách đó. Việc này cần một house decision.

## 2. Danh tính và credential

### 2.1 Mô hình dữ liệu (Drizzle, Postgres 18)

Đúng quy tắc dữ liệu của repo: mọi thứ cần lọc, join hoặc khoá ngoại đều là cột hoặc bảng, không dùng JSONB. Mọi secret
chỉ lưu hash.

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `app_user` (đã có) | thêm `email` (unique, nullable, đã chuẩn hoá), `email_verified_at`; `role` thêm `admin` | Id giữ nguyên khi nâng cấp |
| `device` (đã có) → đổi tên `session` | `token_hash` PK, `user_id`, `created_at`, `last_seen_at`, `expires_at`, `fresh_at` (lần xác thực lại gần nhất), `label` (tên máy do user đặt), `revoked_at` | Một dòng cho mỗi trình duyệt. Thiết bị ẩn danh cũng là một session |
| `password_credential` | `user_id` PK, `hash` (chuỗi PHC), `failed_count`, `locked_until`, `updated_at` | Tham số nằm trong chuỗi PHC, nên đổi tham số sau này không cần migration |
| `passkey` | `credential_id` PK, `user_id`, `public_key` (bytea), `counter`, `transports` text[], `device_type`, `backed_up`, `name`, `last_used_at` | Theo [mô hình của SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server) |
| `oauth_identity` | PK (`provider`, `subject`), `user_id`, `created_at` | Khoá là `sub` của nhà cung cấp, không phải email |
| `totp` | `user_id` PK, `secret_enc`, `key_version`, `last_step` | Secret phải đọc lại được để kiểm, nên mã hoá bằng khoá trong env thay vì băm. `last_step` chặn dùng lại mã |
| `recovery_code` | `code_hash` PK, `user_id`, `used_at` | Dùng một lần |
| `verification` | `token_hash` PK, `purpose` (`pair`, `email_verify`, `email_recover`, `oauth_state`), `user_id`, `email`, `expires_at`, `used_at`, `attempts` | Mọi mã dùng một lần đều nằm trong bảng này |
| `auth_event` | id uuidv7, `at`, `user_id`, `kind`, `ok`, `ip`, `user_agent` | Nhật ký audit; không bao giờ ghi token |

### 2.2 Thiết bị ẩn danh nâng lên tài khoản

- **Nâng cấp tại chỗ (mặc định).** Thiết bị đang là user U. Khi U thêm passkey, mật khẩu hoặc liên kết Google, credential
  được gắn thẳng vào U. Mọi bảng tham chiếu user (`campaign.owner_user_id`, `membership`, `ruleset.owner_user_id`,
  `pack.owner_user_id`, `actor.owner_user_id`, `ownership_transfer`) không đổi gì. Ngay sau đó cấp token session mới và
  thu hồi token cũ, vì [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) và
  [ASVS 7.2.4](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md) yêu cầu đổi session id khi
  quyền thay đổi.
- **Đăng nhập tài khoản A trên thiết bị đang là user ẩn danh B.** Nếu B không có dữ liệu (không phòng, seat, ruleset hay
  pack), chuyển session sang A rồi xoá B. Nếu B có dữ liệu, giai đoạn đầu từ chối và giải thích. Chức năng "gộp B vào
  A" để sau, chạy trong một transaction:
  - Đổi chủ của phòng B sang A.
  - Seat trùng phòng thì giữ vai trò mạnh hơn và hợp nhất nhân vật đang giữ.
  - Ruleset hoặc pack trùng `slug` (vì có unique (`owner_user_id`, `slug`)) thì thêm hậu tố.
  - Không sửa event log.

  Better Auth cũng không chuyển dữ liệu khi link
  ([plugin anonymous](https://www.better-auth.com/docs/plugins/anonymous), đọc ngày 2026-10-19), nên phần gộp này dự án
  phải tự viết dù chọn cách nào.

### 2.3 Ghép thiết bị và mã khôi phục (không cần email)

- **Ghép thiết bị:** thiết bị đã có danh tính hiện QR chứa mã dùng một lần (128 bit trở lên, sống tối đa 10 phút theo
  [ASVS 6.5.5](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md) cho yêu cầu out-of-band).
  Thiết bị mới quét mã và nhận một dòng `session` mới cho cùng user. Mẫu này giống QR mời và QR khách đang có.
- **Bộ mã khôi phục:** NIST yêu cầu mã khôi phục lưu sẵn có tối thiểu 64 bit, sinh từ RBG được phê duyệt, lưu dạng
  hash, và vô hiệu sau khi dùng ([SP 800-63B-4 §4.2](https://pages.nist.gov/800-63-4/sp800-63b.html)). ASVS cho phép
  băm nhanh khi secret có từ 112 bit trở lên ([6.5.2](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md)).
  Chọn mã 128 bit, viết bằng base32 (26 ký tự), băm SHA-256 như `hash()` hiện có, để tra trực tiếp không cần username.
  Trang mã được dựng và in ngay trong trình duyệt, đúng tinh thần nguyên tắc 3.

### 2.4 Email + mật khẩu

- **Băm:** OWASP xếp argon2id lên đầu, với mức tối thiểu m=19 MiB, t=2, p=1
  ([Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)). RFC 9106 có
  phương án khuyến nghị thứ hai là t=3, p=4, m=64 MiB ([§4](https://www.rfc-editor.org/rfc/rfc9106.html)).
  `Bun.password.hash` mặc định là `"argon2id"` ([bun-types](https://github.com/oven-sh/bun/blob/main/packages/bun-types/bun.d.ts));
  chạy thử trên Bun 1.3.11 cho chuỗi `$argon2id$v=19$m=65536,t=2,p=1$...`. Trang tài liệu
  [hashing](https://bun.com/docs/runtime/hashing) không ghi giá trị mặc định của `memoryCost` và `timeCost`, nên con số
  này là đo thực tế, không phải cam kết. Giữ mặc định, nhưng giới hạn số lần băm chạy đồng thời (64 MiB mỗi lần).
  Đăng nhập thành công với tham số cũ thì băm lại, như OWASP mô tả. Không dùng pepper: OWASP coi pepper là phòng thủ
  bổ sung, và đổi pepper buộc mọi user phải đặt lại mật khẩu.
- **Chính sách:** theo [NIST SP 800-63B-4 §3.1.1.2](https://pages.nist.gov/800-63-4/sp800-63b.html):
  - Tối thiểu 15 ký tự khi mật khẩu là yếu tố duy nhất, 8 ký tự khi đi kèm MFA.
  - Cho phép ít nhất 64 ký tự. Không ép kiểu ký tự. Không bắt đổi định kỳ.
  - Đối chiếu với danh sách mật khẩu cấm. Chuẩn hoá NFC.

  ASVS L1 chỉ yêu cầu tối thiểu 8 và chặn top 3000 mật khẩu phổ biến (6.2.1, 6.2.4); việc kiểm mật khẩu đã lộ thuộc L2
  (6.2.12). Đề xuất theo NIST (15 ký tự). Đây là một house decision cần ghi lại.
- **Mật khẩu đã lộ:** [Pwned Passwords range API](https://haveibeenpwned.com/API/v3) chỉ nhận 5 ký tự đầu của SHA-1
  (k-anonymity). Không cần API key, không giới hạn tần suất, và có header `Add-Padding: true` để che độ dài phản hồi. Khi
  không có mạng (LAN), bỏ qua bước này và chỉ dùng danh sách cục bộ. Ghi lại bằng một `ponytail:`.
- **Không đổ lỗi theo từng trường hợp:** đăng nhập, đăng ký và quên mật khẩu trả cùng một thông báo, cùng mã HTTP, và đi
  cùng đường code (vẫn băm khi user không tồn tại)
  ([Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)).
  Yêu cầu cùng thời gian phản hồi là [ASVS 6.3.8](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md),
  thuộc L3. Với email, chỉ cần giữ thông báo giống nhau là đạt L1.

### 2.5 Passkey (WebAuthn)

- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) thành W3C Recommendation ngày 2026-08-25. API chỉ có trong
  secure context (`[SecureContext]`, §5.1). Nếu effective domain không phải tên miền, ví dụ một địa chỉ IP, thì
  `create()` và `get()` ném `SecurityError` (§5.1.3 bước 7, §5.1.4.1 bước 6). **Vì vậy passkey không chạy được với
  `http://192.168.1.10:3000`.** Chỉ chạy được trên `localhost` hoặc với tên miền có HTTPS.
- Thư viện: `@simplewebauthn/server` 14.0.3 (2026-09-25, MIT, repo push 2026-10-11). Trang tài liệu chỉ ghi Node 22+ và
  Deno, không ghi Bun, nên phải chạy thử trên Bun trước khi cam kết. `@oslojs/webauthn` bị đánh dấu deprecated trên npm.
- Lưu challenge theo từng lần (bảng `verification`), kiểm `expectedOrigin` và `expectedRPID`.
- Chỉ mời tạo passkey sau khi đã đăng nhập, có nút "để sau"; ô username đặt `autocomplete="username webauthn"` để dùng
  conditional UI ([passkeys.dev](https://passkeys.dev/docs/use-cases/bootstrapping/)). Passkey đồng bộ được chấp nhận ở
  AAL2 nhưng không ở AAL3 ([SP 800-63B-4 §2.3.2](https://pages.nist.gov/800-63-4/sp800-63b.html)).

### 2.6 Social login (OAuth 2.0 / OIDC)

- Bắt buộc theo [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) (BCP 240, 1/2025):
  - Dùng PKCE với S256 (§2.1.1).
  - `state` dùng một lần, gắn với user agent (§4.7.1). Hủy ngay sau lần dùng đầu (§4.2.4).
  - Redirect URI phải khớp chính xác. Không có open redirect (§2.1, §4.11).
  - Khi dùng nhiều nhà cung cấp, chống mix-up bằng `iss` (§4.4.2).
  - Không dùng implicit grant và password grant (§2.1.2, §2.4).
- Với OIDC: kiểm `nonce`, `iss`, `aud`, `exp` trong ID token
  ([OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html)). Khoá liên kết là (`iss`, `sub`), không
  phải email. Tự động liên kết theo email là lỗ chiếm tài khoản quen thuộc. Better Auth từng có advisory "OAuth sign-in
  can link to an account an attacker registered in advance"
  ([GHSA, 2026-05-31](https://github.com/better-auth/better-auth/security/advisories)).
- Thư viện: `openid-client` 6.8.8 (2026-09-05, MIT). Chạy được trên Bun và Node, đã được chứng nhận OpenID cho profile
  Basic RP ([GitHub](https://github.com/panva/openid-client)). `arctic` đã deprecated từ 7/2026
  ([trang chủ](https://arctic.pilcrowonpaper.com/), npm cũng đánh dấu deprecated). Đừng chọn nó.

### 2.7 Magic link và mã qua email

NIST cấm dùng email làm kênh xác thực out-of-band ([SP 800-63B-4 §3.1.3.1](https://pages.nist.gov/800-63-4/sp800-63b.html)).
ASVS 6.3.6 cũng cấm, nhưng ở L3. NIST cho phép email làm kênh khôi phục: mã khôi phục gửi qua email có hiệu lực 24 giờ
(§4.2). Đề xuất: email chỉ dùng để xác minh địa chỉ và khôi phục. Mã email sống 15 phút, ngắn hơn trần 24 giờ của NIST,
và dùng một lần. Nếu muốn mã email làm cách đăng nhập chính cho người chơi, phải ghi rõ là lệch NIST bằng một house
decision.

### 2.8 Khôi phục tài khoản

Theo [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html):

- Thông báo luôn giống nhau dù email có tồn tại hay không. Token ngẫu nhiên, dùng một lần, có hạn, lưu hash.
- URL được dựng từ origin cấu hình (`WEB_ORIGIN`), không lấy từ header `Host`. Trang reset đặt
  `Referrer-Policy: no-referrer`.
- Không tự đăng nhập sau khi reset. Thu hồi các session khác. Báo cho user qua email.
- Không khoá tài khoản vì có yêu cầu reset.

Đặt lại mật khẩu không được bỏ qua MFA đang bật
([ASVS 6.4.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md)). Các đường khôi phục, xếp
theo thứ tự ưu tiên: mã khôi phục, thiết bị đã ghép, email.

### 2.9 MFA

- Thứ tự mạnh yếu theo [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html):
  passkey/FIDO2 > TOTP > SMS > email. Đổi yếu tố phải xác thực lại bằng yếu tố đã đăng ký và có thông báo ra ngoài kênh.
- TOTP theo [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html): bước 30 giây (§4.1), cho lệch tối đa một bước
  (§5.2), và không nhận lại cùng một mã (§5.2, tức `last_step`). Secret tối thiểu 112 bit; dưới 64 bit thì phải giới
  hạn tần suất ([SP 800-63B-4 §3.1.4–3.1.5](https://pages.nist.gov/800-63-4/sp800-63b.html)). Code dùng HMAC-SHA1 của
  `node:crypto` và kiểm bằng test vector ở Phụ lục B của RFC. `@oslojs/otp` đã deprecated trên npm. `otpauth` 9.5.2
  (2026-09-03, repo push 2026-10-18) là phương án dùng thư viện.
- Áp dụng cho InconsisTable: MFA bắt buộc với `admin`, tuỳ chọn với GM, không áp cho người chơi.
  [ASVS 6.3.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md) bắt MFA cho mọi user ở L2,
  nên đây là lý do mức mục tiêu là L1 cộng thêm (mục 6).

## 3. Session

### 3.1 Token mờ phía server, không dùng JWT

- Token là 24 byte ngẫu nhiên (192 bit), như `deviceSecret()` và `newSecret()` hiện có. ASVS 7.2.3 cần ít nhất 128 bit;
  NIST cần ít nhất 64 bit ([§5.1](https://pages.nist.gov/800-63-4/sp800-63b.html)). DB chỉ lưu SHA-256, nên lộ DB
  không lộ session.
- Lý do không dùng JWT:
  - Api cần thu hồi ngay: kick, rời phòng, đăng xuất mọi nơi. JWT cần danh sách chặn, tức là quay về tra DB.
  - Chỉ có một api đọc token.
  - [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html) liệt kê các bẫy phải tự gánh: allowlist thuật toán (§3.1),
    `aud`/`iss` (§3.8–3.9), explicit typing (§3.11).
  - Không có JWT thì không có khoá ký nào phải xoay vòng.
- Trang Next.js cũng mô tả "database sessions" là cách "more secure"
  ([hướng dẫn](https://nextjs.org/docs/app/guides/authentication)).

### 3.2 Cookie

| Thuộc tính | Giá trị | Nguồn |
|---|---|---|
| Tên | `__Host-it_session` trên HTTPS; `it_device` trên HTTP LAN | `__Host-` bắt buộc `Secure`, `Path=/`, không có `Domain` ([6265bis-22 §4.1.3.2](https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-22.html)) |
| `HttpOnly` | luôn bật | NIST §5.1 (SHOULD), OWASP Session |
| `Secure` | khi là HTTPS | Trình duyệt bỏ qua cookie `Secure` được đặt từ kết nối không an toàn (6265bis §5.7 bước 13) |
| `SameSite` | `Lax` | NIST §5.1; OWASP coi đây chỉ là phòng thủ bổ sung |
| Nội dung | chỉ token mờ, không chứa dữ liệu cá nhân | NIST §5.1 |
| Hạn | hạn thật nằm ở `session.expires_at`; Max-Age chỉ để dọn | NIST §5.1: cookie "SHALL NOT be relied on" để áp timeout |

Spec cookie mới vẫn là Internet-Draft. Bản 22 (2025-12-01) đang chờ RFC Editor ("blocked: Final Approval Pending", theo
[datatracker](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)), nên phải trích dẫn draft chứ chưa có số RFC.

### 3.3 Hạn, xoay vòng, thu hồi

| Loại session | Hạn tuyệt đối | Hạn khi không dùng | Căn cứ |
|---|---|---|---|
| Thiết bị ẩn danh | 1 năm, gia hạn trượt khi dùng | không có | Cookie chính là danh tính; hết hạn là mất danh tính. Ghép thiết bị và mã khôi phục giảm thiệt hại |
| Thiết bị có tài khoản | 30 ngày | không bắt buộc | NIST AAL1: tổng thời gian SHOULD ≤30 ngày, idle là tuỳ chọn (§2.1) |
| Thao tác nhạy cảm (đổi email, thêm hay xoá credential, xoá phòng, chuyển chủ phòng) | cần `fresh_at` trong vòng 10 phút | | [ASVS 7.5.1](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md), OWASP Authentication |
| Quyền admin (nâng quyền) | 24 giờ | 1 giờ | NIST AAL2 (§2.2): tổng ≤24 giờ, idle ≤1 giờ |

Mốc 10 phút là đề xuất, không có trong nguồn. OWASP gợi ý idle 15–30 phút cho app ít rủi ro, nhưng mức đó không hợp với
một bàn chơi, nơi điện thoại tắt màn hình hàng giờ. Vì vậy thiết bị có tài khoản theo AAL1 của NIST, còn quyền nhạy cảm
tách thành `fresh_at` và thời hạn admin riêng.

Các việc phải làm:

- Đổi token khi đăng nhập, nâng cấp hoặc xác thực lại (ASVS 7.2.4).
- Có danh sách "thiết bị của tôi", đăng xuất từng máy hoặc tất cả (ASVS 7.5.2, L2).
- Sau khi đổi credential, đề nghị đăng xuất các máy khác (ASVS 7.4.3, L2).
- Đăng xuất phải xoá ở server, không chỉ xoá cookie (ASVS 7.4.1).

### 3.4 CSRF

- REST đi qua rewrite của Next.js, nên trình duyệt chỉ thấy một origin.
- Thêm một middleware toàn cục trong Nest: với mọi method không phải GET, HEAD hay OPTIONS, yêu cầu
  `Sec-Fetch-Site: same-origin`. Nếu không có header đó thì `Origin` phải khớp `WEB_ORIGIN`, và `Origin: null` bị từ
  chối ([OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)).
  Middleware này phủ cả endpoint đăng nhập, vì login CSRF cũng là một kiểu tấn công.
- GET không được đổi state, vì `SameSite=Lax` vẫn gửi cookie khi điều hướng top-level bằng GET.

### 3.5 Socket.IO

- Handshake đã đọc cookie trong `server.use(...)` (`table.gateway.ts`). Middleware này
  [chỉ chạy một lần mỗi kết nối](https://socket.io/docs/v4/middlewares/), nên thu hồi session phải được đẩy tới socket:
  - Mỗi socket join room `session:<hash>`. Khi đăng xuất hoặc thu hồi, gọi `disconnectSockets()` trên room đó. Đây là
    mẫu trong [hướng dẫn của Socket.IO](https://socket.io/how-to/use-with-express-session). Repo đã có `kick()` cho seat;
    thêm một loại kick theo session.
  - Lưu `expiresAt` vào `socket.data`, kiểm ở mỗi action (gateway đã xử lý từng action), và ngắt kết nối khi hết hạn.
    Hướng dẫn trên dùng cách nạp lại mỗi 30 giây; kiểm theo action rẻ hơn.
- Kiểm `Origin` trong `allowRequest` ([server options](https://socket.io/docs/v4/server-options/)). Tài liệu không nói
  tuỳ chọn `cors` có áp dụng cho WebSocket upgrade hay không. `SameSite` tính theo site chứ không theo origin, nên một
  subdomain anh em vẫn gửi được cookie (OWASP CSRF).

### 3.6 HTTP trên LAN

- Trên `http://192.168.x.x`, cookie `Secure` bị bỏ qua và `__Host-` không dùng được. `localhost` và `127.0.0.0/8` được coi
  là "potentially trustworthy", còn IP LAN thì không ([Secure Contexts §3.1](https://www.w3.org/TR/secure-contexts/)).
  Passkey không chạy được trên IP (mục 2.5).
- Đề xuất ranh giới: trên HTTP LAN chỉ có thiết bị ẩn danh, ghép thiết bị và mã khôi phục. Mật khẩu, passkey và social
  login chỉ bật khi web chạy HTTPS với tên miền. Lý do: mật khẩu đi trên Wi-Fi không mã hoá thì ai trong mạng cũng đọc
  được. Token thiết bị cũng có thể bị đọc, nhưng thiệt hại giới hạn ở một danh tính ẩn danh trong mạng tin cậy, đúng như
  `docs/deploy.md` đã chấp nhận.
- Api đọc cả hai tên cookie. Lần đầu nhận `it_device` qua HTTPS thì đặt lại thành `__Host-it_session` và xoá cookie cũ.

## 4. Phân quyền

### 4.1 Mô hình hiện có, gọi đúng tên

| Tầng | Hiện nay | Kiểu |
|---|---|---|
| Platform | `app_user.role` (`user`, `creator`), `ADMIN_KEY` | RBAC |
| Phòng (tenant) | `membership` (`gm`, `cogm` + scope, `player`), `access_token` (`player`, `screen`), chủ phòng là `campaign.owner_user_id` | Quan hệ user–phòng: ReBAC một tầng |
| Đối tượng | `membership_character` cho quyền `:own` | Quan hệ seat–nhân vật: ReBAC |
| Trường | `gm`/`party`/`public` visibility, scope `codex.secrets` | ABAC trên thuộc tính của trường |

[OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) khuyên dùng ABAC
hoặc ReBAC thay vì RBAC thuần, và `canInCampaign` đã đi theo hướng đó. [OpenFGA](https://openfga.dev/docs/fga) (CNCF,
lấy cảm hứng từ [Zanzibar](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)) và
SpiceDB giải bài toán đồ thị quan hệ sâu, nhiều kiểu đối tượng và nhiều dịch vụ. Chúng chạy như một server riêng (HTTP
hoặc gRPC) với kho dữ liệu riêng. InconsisTable chỉ có một loại tenant (phòng), quan hệ sâu một bậc, và mọi dữ liệu nằm
trong một Postgres, nên join được trực tiếp. Không cần chúng. Mô hình ABAC đầy đủ
([NIST SP 800-162](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)) cũng không cần, ngoài lớp visibility đã có.

### 4.2 Kiểm quyền ở đâu

- **Một đường ghi** (nguyên tắc 6): mọi action của bàn đi qua `authorize` rồi `canInCampaign` trong dispatch. Giữ nguyên.
  [ASVS 8.3.1](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md) yêu cầu kiểm ở tầng service tin
  cậy; web chỉ dùng hàm này để ẩn nút.
- **Mặc định là từ chối:** REST nên có một guard toàn cục, buộc mỗi route khai báo rõ là public, chỉ cần session, hay
  chỉ cho chủ sở hữu. NestJS vừa ra [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization) theo đúng
  mẫu "denies by default", nhưng gói mới ở 0.1.0 (2026-10-08). Đề xuất chép mẫu đó bằng một `APP_GUARD` vài chục dòng
  thay vì phụ thuộc vào gói.
- **Tenant:** mọi truy vấn lọc theo `ctx.campaignId`, và id từ client không bao giờ được tin (quy tắc dữ liệu). Đây là
  [ASVS 8.4.1](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md) (L2) và 8.2.2 (BOLA, L1).
- **Thay đổi quyền có hiệu lực ngay:** kick hiện có đã đáp ứng 8.3.2 (L3).

### 4.3 Thay `ADMIN_KEY`

[ASVS 7.2.2](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md) (L1) yêu cầu session token
động, không dùng secret tĩnh. `ADMIN_KEY` dán vào trang `/admin` và vào socket là đúng thứ mục này cấm, một khi app lên
internet. Lộ trình:

1. Thêm `admin` vào `PLATFORM_ROLES`. Seat `{ kind: "admin" }` lấy từ session của user có vai trò này cộng với thời hạn
   admin còn hiệu lực (mục 3.3), thay cho handshake `adminKey`.
2. Bắt MFA (passkey hoặc TOTP) khi nâng quyền admin.
3. Giữ `ADMIN_KEY` chỉ cho script và smoke test qua header, ghi log như hiện nay, và tắt mặc định trên bản deploy công
   khai. Nếu sau này script cần quyền admin lâu dài, cấp token theo từng script (có hạn, lưu hash, thu hồi được).

## 5. Lạm dụng và vận hành

- **Giới hạn tần suất và khoá tài khoản:**
  - NIST cho tối đa 100 lần sai liên tiếp mỗi authenticator ([§3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)).
  - OWASP: đếm theo tài khoản chứ không theo IP; khoá tăng dần theo cấp số nhân; vẫn khôi phục được khi đang bị khoá
    ([Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)).
  - Đề xuất: sau 5 lần sai, chờ 2^n giây với trần 15 phút. Tới 100 lần sai thì tắt mật khẩu, chỉ mở lại qua khôi phục.
    Bộ đếm nằm ở `password_credential` để không mất khi restart.
  - `limiter()` hiện có chặn thêm theo IP, chống password spraying.
- **Credential stuffing:** cách mạnh nhất là MFA; còn lại là các lớp phòng thủ như kiểm mật khẩu đã lộ và báo cho user
  khi có đăng nhập lạ ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html)).
  Passkey không bị loại tấn công này. Đây là thêm một lý do để đặt passkey làm cách đăng nhập chính của GM.
- **Email (chi phí khi tự host):** Gmail yêu cầu mọi người gửi phải có SPF hoặc DKIM, PTR hợp lệ, TLS, và tỉ lệ spam dưới
  0,3% ([Google](https://support.google.com/a/answer/81126)). Tự chạy SMTP từ IP nhà là khó đạt các điều kiện này. Thực
  tế là gửi qua một SMTP relay bằng `nodemailer` (10.2.1, 2026-10-22, MIT-0) và cấu hình SPF/DKIM trên tên miền của
  mình. Bảng giá relay chưa kiểm tra. Kế hoạch dưới đây để email ra sau cùng, nên các giai đoạn đầu không tốn đồng nào.
- **Secret và xoay khoá:**
  - Không có khoá ký nào, vì không dùng JWT.
  - Secret còn lại: khoá mã hoá TOTP (gắn `key_version` để xoay; giải mã bằng khoá cũ, mã hoá lại bằng khoá mới ở lần
    dùng kế tiếp), client secret OAuth, mật khẩu SMTP, và `ADMIN_KEY` trong lúc chưa bỏ được.
  - Tất cả để trong `*.env` như `docs/deploy.md` đã quy định.
- **Audit log:** ghi các sự kiện: đăng nhập thành công hoặc thất bại, nâng cấp, ghép thiết bị, thêm hoặc xoá credential,
  khôi phục, thu hồi session, nâng quyền admin, và lỗi phân quyền. Không ghi token, mật khẩu, mã OTP hay secret
  ([OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)). Dùng bảng `auth_event`
  riêng; `admin_event` giữ nguyên cho thao tác của admin.
- **Security header** (đặt trong `next.config` `headers()`, theo
  [OWASP HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)):
  - HSTS, chỉ khi chạy HTTPS.
  - CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
  - Riêng các trang có mã trong URL (`/invite`, `/join`, trang ghép thiết bị, trang reset) đặt `no-referrer`.
  - Bỏ `X-Powered-By`.

## 6. Kiểm thử và mức ASVS

Mục tiêu: [ASVS 5.0](https://github.com/OWASP/ASVS/tree/master/5.0/en) (phát hành 2025-05-30) **L1 cho V6, V7, V8**
trước khi mở ra internet. Thêm các mục L2 sau: 6.2.12 (mật khẩu đã lộ), 7.3.1–7.3.2 (timeout), 7.4.3 và 7.5.1–7.5.2
(session, xác thực lại), 8.4.1 (tách tenant). Không nhắm L2 đầy đủ vì 6.3.3 bắt MFA cho mọi user. Quyết định này cần
một house decision.

Test đơn vị (`bun run test`, hàm thuần):

- Sinh token đủ độ dài và ký tự hợp lệ (đã có `api.test.ts`).
- TOTP khớp test vector Phụ lục B của RFC 6238, từ chối mã dùng lại, chỉ cho lệch một bước.
- Tính hạn session: trượt, tuyệt đối, `fresh_at`, thời hạn admin.
- Ma trận `canInCampaign` (đã có `permissions.test.ts`), thêm trường hợp `admin` lấy từ vai trò.
- Chuẩn hoá NFC và độ dài mật khẩu.

Smoke test (`bun run test:smoke`, đầu cuối):

- Nâng cấp giữ nguyên phòng, seat, nhân vật và ruleset; token cũ bị từ chối.
- Mã ghép thiết bị chỉ dùng được một lần và hết hạn sau 10 phút.
- Đăng xuất hoặc thu hồi làm socket đang mở rớt ngay; handshake bằng token đã thu hồi bị từ chối.
- Đăng nhập sai, email không tồn tại và tài khoản bị khoá đều trả cùng body và cùng mã.
- Lần sai thứ N bị chờ; lần sai thứ 100 tắt mật khẩu.
- POST có `Sec-Fetch-Site: cross-site` hoặc `Origin` lạ bị từ chối, cả với socket.
- Admin không có MFA thì không nâng quyền được.

Review theo `.claude/code-review.md`, đối chiếu từng mục ASVS đã chọn. Test tự động không thay được pentest thủ công
(OWASP Authorization).

## 7. Kế hoạch theo giai đoạn

| Giai đoạn | Làm gì | Mở khoá được gì | Cần | Ước lượng (thứ cấp: ước tính của người viết) |
|---|---|---|---|---|
| **A. Session gọn** | `device` thêm `last_seen_at`, `expires_at`, `revoked_at`, `label`. Trang "thiết bị của tôi" và đăng xuất. Kick theo session. Middleware Origin/Fetch-Metadata cho REST, `allowRequest` cho socket. Header bảo mật | Thu hồi được, nền cho mọi bước sau | Không cần gì mới | 2–4 ngày |
| **B. Không mất danh tính** | Ghép thiết bị bằng QR, bộ mã khôi phục in được, bảng `verification`, `recovery_code`, `auth_event` | Mất cookie không còn là mất phòng; GM dùng cả tablet và điện thoại. Giải quyết nỗi đau chính của house decision #32 mà không cần email | Chạy được trên LAN và HTTP | 3–5 ngày |
| **C. Admin là một user** | Vai trò `admin`, TOTP và mã khôi phục, thời hạn admin, bỏ `adminKey` khỏi trình duyệt | Không còn secret dùng chung. Đạt ASVS 7.2.2 | TOTP chạy trên HTTP; passkey cần HTTPS | 3–4 ngày |
| **D. Tài khoản trên internet** | HTTPS và tên miền, cookie `__Host-`. Passkey cho GM; mật khẩu làm phương án dự phòng (argon2id, HIBP, khoá tăng dần); email để xác minh và khôi phục | Deploy công khai (bỏ cảnh báo trong `deploy.md`) | SMTP relay, tên miền, TLS | 8–12 ngày |
| **E. Social login** | OIDC (Google trước) qua `openid-client`, liên kết theo (`iss`, `sub`) | Đăng ký một chạm cho người chơi | Đăng ký client OAuth | 3–5 ngày cho provider OIDC đầu tiên |
| **F. Gộp tài khoản** | Gộp user ẩn danh có dữ liệu vào tài khoản (mục 2.2) | Đăng nhập trên máy cũ không mất gì | | 2–3 ngày |

Các giai đoạn A, B, C không phụ thuộc vào việc chọn tự làm hay Better Auth. Better Auth không có ghép thiết bị theo mô
hình `device` hiện tại, không chuyển dữ liệu khi link, và không biết seat. **Điểm quyết định thật nằm trước giai đoạn D.**

### Tự làm hay Better Auth (cho giai đoạn D–E)

| | Tự làm (D–E) | Better Auth (D–E) |
|---|---|---|
| Công sức ban đầu | 11–17 ngày (ước tính) | 3–6 ngày (ước tính): mount handler, map `user` sang `app_user`, viết `onLinkAccount`, nối session với socket |
| Code phải sở hữu | Mọi luồng: đăng ký, đăng nhập, reset, xác minh email, passkey, OIDC callback, khoá tài khoản | Cấu hình, phần nối với `app_user` và seat, phần gộp dữ liệu |
| Bề mặt tấn công | Nhỏ, chỉ những gì mình viết | Lớn hơn, nhưng chỉ bật plugin nào thì mới có bề mặt đó |
| Ai tìm lỗi | Chỉ mình (review cộng với ASVS) | Cộng đồng: 37 advisory từ 2024-12 tới 2026-09, 3 critical và 22 high, chủ yếu ở OAuth, SSO, magic link và các plugin ([GHSA](https://github.com/better-auth/better-auth/security/advisories)) |
| Rủi ro vận hành | Lỗi logic không ai báo | Phải nâng phiên bản nhanh mỗi khi có advisory; gói NestJS là gói cộng đồng; hướng đi sau khi về Vercel |
| Phụ thuộc mới | `@simplewebauthn/server`, `openid-client`, `nodemailer` | `better-auth`, `@better-auth/passkey`, có thể thêm gói NestJS cộng đồng |
| Dữ liệu | Bảng do mình thiết kế, đúng quy tắc dữ liệu | Bảng của Better Auth (đổi tên được), nằm cạnh `app_user` |

Đọc danh sách advisory theo cả hai chiều. Lỗi kiểu "OAuth state dùng được như magic link" hay "mật khẩu của kẻ tấn công
vẫn dùng được sau khi đăng nhập bằng magic link" là đúng loại lỗi một đội nhỏ cũng sẽ mắc, nhưng không ai báo cho mình.
Mặt khác, phần lớn các advisory nằm ở plugin dự án không dùng (SSO, SCIM, organization, oauth-provider).

**Lằn ranh:**

- Nếu giai đoạn D chỉ cần **passkey cho GM, mật khẩu dự phòng và email khôi phục**, tự làm vẫn hợp lý: ít luồng, thư
  viện giao thức đã được chứng nhận, và mọi thứ nằm trong `auth/` vốn đã có.
- Nếu cần **từ hai social provider trở lên, cộng magic link hay mã email để đăng nhập, cộng MFA cho mọi user**, chọn
  Better Auth cho phần phương thức đăng nhập, gắn vào `app_user`, và giữ A, B, C cùng `canInCampaign` như cũ.

Giá trị của việc tự viết những luồng đó không bù được chi phí sở hữu và bảo trì chúng.

Không bao giờ tự viết: thuật toán mật mã (dùng `Bun.password`, `node:crypto`, WebCrypto), phần kiểm tra WebAuthn
attestation và assertion, phần OIDC client, và một authorization server.

## 8. Phương án B: auth là service riêng (IdP OIDC)

Câu hỏi của chủ dự án: nếu muốn auth là một service riêng thì dựng thế nào, và best practice là gì? Mục này mô tả phương
án đó đủ chi tiết để so với mục 1. "Service riêng" ở đây là một OpenID Provider (OP) chạy tiến trình riêng, dựng trên
thư viện đã được chứng nhận. Không tự viết giao thức: authorization server vẫn nằm trong danh sách "không bao giờ tự
viết" ở mục 7.

### 8.1 Hình dạng hệ thống

| Thành phần | Vai trò | Giữ gì | Không bao giờ giữ |
|---|---|---|---|
| `apps/auth` (mới) | OpenID Provider | Credential, session đăng nhập ở OP, grant, refresh token, khoá ký | Seat, phòng, dữ liệu game |
| `apps/web` | Confidential client theo mẫu BFF | Session cookie của trình duyệt, gắn với token nằm ở server | Token trong JS hay `localStorage` |
| `apps/api` | Resource server | `app_user`, seat, `canInCampaign`, liên kết (`iss`, `sub`), thiết bị ẩn danh | Mật khẩu, passkey, refresh token |

**OP: `oidc-provider`.**

- `oidc-provider` 9.13.0 (2026-10-22, MIT, theo npm registry). Phụ thuộc trực tiếp chỉ có `koa`, `jose` và `debug`.
  [README](https://github.com/panva/node-oidc-provider) cho biết tác giả là người bảo trì duy nhất.
- Chứng nhận: bảng [Certified OpenID Providers & Profiles](https://openid.net/certification/certified-openid-providers-profiles/)
  có dòng "Filip Skokan, node oidc-provider" cho sáu profile OP: Basic, Implicit, Hybrid, Config, Form Post và 3rd
  Party-Init, cùng ngày 29-Jul-2020 (không có Dynamic). README còn ghi chứng nhận Back-Channel Logout, RP-Initiated
  Logout, FAPI 1.0, FAPI CIBA và FAPI 2.0; bảng OP profile ở trang trên không có các mục này, nên chưa đối chiếu được
  trên openid.net. Dòng chứng nhận không ghi phiên bản và có từ 2020, nên nó không chứng nhận riêng bản 9.13.0.
- Thư viện có sẵn (theo [docs](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md)): endpoint
  authorization, token, discovery, JWKS, introspection (RFC 7662), revocation, JWT access token (RFC 9068), PKCE, xoay
  refresh token, RP-Initiated Logout và Back-Channel Logout.
- Thư viện không có:
  - **Giao diện.** Nó chỉ kèm view và handler interaction tối giản, bản triển khai phải tự viết. `devInteractions` bật
    mặc định, nhận mọi username và mọi mật khẩu, và docs ghi nó MUST tắt khi chạy thật.
  - **Kho lưu.** Adapter mặc định nằm trong bộ nhớ và mất hết khi restart; production MUST có adapter riêng. Phải viết
    một adapter Postgres bằng Drizzle.
- Hệ quả: các luồng ở mục 2 (passkey, mật khẩu, TOTP, mã khôi phục, email) không biến mất. Chúng chuyển vào trang
  interaction của OP. Phương án B thêm việc chứ không bớt việc.
- **Bun:** `lib/index.js` dò `typeof Bun` và in cảnh báo "Unsupported runtime. Use Node.js v22.x LTS, or a later LTS
  release." Chạy thử ngày 2026-10-24 trên Bun 1.3.11 (Windows) với bản 9.13.0 và `jose` 6.2.13:
  - Luồng code + PKCE S256 qua `devInteractions` chạy hết, trả access token `typ: at+jwt` ký ES256.
  - Một api giả kiểm token đó bằng `createRemoteJWKSet` + `jwtVerify` (`iss`, `aud`, `typ`, thuật toán): đạt.
  - Bật `rotateRefreshToken: true`: refresh token được xoay. Dùng lại token cũ thì nhận `invalid_grant`, và token mới
    cũng bị thu hồi theo.

  Kết luận: chạy được, nhưng tác giả không hỗ trợ Bun. Vì là service riêng, OP có thể chạy bằng Node 22+ LTS mà không
  ảnh hưởng api và web. `CLAUDE.md` ghi Bun là runtime, nên chọn runtime cho OP là một house decision.
- Gắn vào đâu: thư viện dựa trên Koa, mount được vào connect, express, fastify, hapi và koa; bảng cấu hình proxy trong
  docs có cả Nest. Chạy độc lập (`provider.listen`) đúng với ý "service riêng". Đứng sau proxy TLS thì phải đặt
  `provider.proxy = true` (docs, mục "Trusting TLS offloading proxies").

**Web: confidential client theo mẫu BFF.**

- Bản draft "OAuth 2.0 for Browser-Based Applications" nay đã là [RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html)
  (BCP 212, tháng 8/2026). Theo §6.1, BFF có ba việc:
  - Làm confidential client với OP.
  - Giữ access token và refresh token sau một session cookie, không để trình duyệt thấy token.
  - Chuyển mọi request tới resource server, kèm đúng access token.
- Cookie (§6.1.3.2): MUST có `Secure` và `HttpOnly`. SHOULD có `SameSite=Strict`, `Path=/`, không có `Domain`, và tên
  bắt đầu bằng `__Host-Http-`.
- CSRF: BFF MUST có phòng thủ (§6.1.3.3). Middleware Origin/Fetch-Metadata ở mục 3.4 dùng lại được.
- Proxy: BFF MUST giữ allowlist host và path đích, để không bị lừa gửi token tới server lạ (§6.1.3.6).
- Session phía server chỉ được khuyến nghị cho quy mô nhỏ (§6.1.2.3), và InconsisTable đúng là quy mô nhỏ. Token để
  trong một bảng của web. Nếu để trong cookie thì cookie SHOULD được mã hoá (§6.1.3.2).
- Client OIDC là `openid-client` 6.8.8 (mục 2.6), chạy trong route handler của Next.
- Thay đổi so với hiện nay (suy luận, chưa thử): `next.config` đang rewrite `/api` và `/socket.io` thẳng sang api.
  Rewrite tĩnh không biết session nên không gắn được header `Authorization`. `/api/*` phải thành route handler: đọc
  session, làm mới token khi cần, gắn header, rồi chuyển tiếp tới api trong allowlist.
- [ASVS 10.1.1](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md) (L2): token chỉ tới
  component cần nó. Với BFF, chỉ backend thấy access token và refresh token.

**Api: resource server.**

- Kiểm token bằng `jose` (`createRemoteJWKSet` + `jwtVerify`), theo [RFC 9068 §4](https://www.rfc-editor.org/rfc/rfc9068.html):
  - `typ` phải là `at+jwt`.
  - `iss` khớp chính xác issuer.
  - `aud` chứa định danh của api.
  - Chữ ký kiểm bằng khoá của OP; từ chối `alg: none`.
  - `exp` chưa qua, cho lệch tối đa vài phút.

  Cộng thêm RFC 8725: allowlist thuật toán (§3.1), `iss` và `aud` (§3.8–3.9), explicit typing (§3.11).
- `oidc-provider` mặc định cấp access token mờ. Muốn JWT thì bật `features.resourceIndicators`
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)) và trả `accessTokenFormat: 'jwt'` cho resource server là
  api (docs; đã chạy thử ở trên).
- `createRemoteJWKSet` giữ khoá 10 phút (`cacheMaxAge`). Gặp `kid` lạ thì tải lại JWKS, nếu đã qua `cooldownDuration`
  30 giây kể từ lần tải trước (khai báo kiểu của `jose` 6.2.13).

**JWT hay token mờ cộng introspection.**

| | JWT access token (RFC 9068) | Token mờ + introspection ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html)) |
|---|---|---|
| Kiểm ở api | Tại chỗ, bằng khoá công khai | Mỗi request hỏi OP, hoặc dùng cache |
| Thu hồi | Không thấy cho tới `exp`. Phải giữ TTL ngắn, hoặc thêm danh sách chặn | Thấy ngay nếu không cache. Có cache thì có một khoảng token đã thu hồi vẫn dùng được (§4); không được cache quá `exp` |
| Khi OP sập | Token đang có vẫn chạy tới `exp`, chỉ không làm mới được | Api không kiểm được token nào |
| Chi phí | Tải JWKS định kỳ | Một round-trip mỗi request; api cần credential riêng để gọi introspection |
| Lộ thông tin | Payload đọc được (base64url) | Token không chứa gì |

Chọn JWT với access token sống 5 phút; mặc định của thư viện là 1 giờ.
[RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700.html) nêu đúng lý do này: có refresh token thì access token
được phép sống ngắn. Thu hồi cần nhanh hơn 5 phút (đăng xuất, khoá
tài khoản) thì đẩy qua back-channel logout (8.2, 8.3). Kick khỏi phòng không dính tới token, vì seat nằm ở api (8.4).

### 8.2 Luồng

- **Authorization code + PKCE S256** ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html)). RFC 9700 §2.1.1: public
  client MUST dùng PKCE; với confidential client thì RECOMMENDED, vì PKCE chống tiêm code và chặn luôn CSRF. Mặc định
  của `oidc-provider` chỉ bắt PKCE cho public client, nên phải cấu hình `pkce.required` trả `true` cho mọi client.
  ASVS 10.4.6 (L2) cũng bắt PKCE và cấm `plain`.
- **`state` và `nonce`:**
  - `state` dùng một lần, gắn với user agent (mục 2.6).
  - `nonce` được kiểm trong ID token ([OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html),
    ASVS 10.5.1, L2).
  - `state`, `nonce` và code verifier nằm trong một cookie tạm của BFF. ASVS 10.1.2 (L2) đòi giá trị nhận về phải thuộc
    luồng do chính user agent đó mở. Đây cũng là chốt chặn login CSRF khi liên kết thiết bị ẩn danh (8.4).
- **`redirect_uri` khớp chính xác** với danh sách đã đăng ký (RFC 9700 §2.1; ASVS 10.4.1, L1). Mỗi môi trường đăng ký
  URI riêng, không dùng wildcard.
- **Authorization code** dùng một lần và sống tối đa 10 phút (ASVS 10.4.2–10.4.3, L1). Mặc định của thư viện là 60 giây.
- **Refresh token:**
  - RFC 9700 §2.2.2 chỉ bắt xoay vòng (hoặc sender-constrained) cho public client. Với confidential client, RFC 6749 đã
    buộc refresh token chỉ dùng được bởi chính client được cấp.
  - Vẫn bật `rotateRefreshToken: true` để có phát hiện dùng lại theo §4.14.2: token cũ xuất hiện lần nữa thì OP thu hồi
    cả chuỗi. Mặc định của thư viện chỉ xoay token của confidential client khi đã qua 70% TTL, và ngừng gia hạn sau một
    năm.
  - Refresh token phải có hạn tuyệt đối, kể cả khi gia hạn trượt (ASVS 10.4.8, L2).
- **Thời hạn** (đề xuất, không có trong nguồn): access token 5 phút; authorization code 60 giây; session ở OP và grant
  theo mục 3.3 (30 ngày cho thiết bị có tài khoản). Mặc định của thư viện là 14 ngày cho cả session và grant, và docs ghi
  các mặc định này SHOULD được chỉnh.
- **Đăng xuất:**
  - [RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html) (Final): BFF xoá session
    của mình, rồi chuyển trình duyệt tới `end_session_endpoint` của OP, kèm `id_token_hint` và một
    `post_logout_redirect_uri` đã đăng ký. OP phải chống ép đăng xuất, bằng cách hỏi lại user hoặc kiểm tham số
    (ASVS 10.6.2, L2).
  - [Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html) (Final, kèm errata set 1):
    khi session ở OP kết thúc, OP POST một logout token tới `backchannel_logout_uri` của từng RP. Token có `iss`, `aud`,
    `iat`, `exp`, `jti`, và `events` với khoá `http://schemas.openid.net/event/backchannel-logout`. Nó có `sub`, `sid`,
    hoặc cả hai, và MUST NOT có `nonce` (§2.4). RP kiểm nó như ID token, trả 200 khi xong và 400 khi lỗi, kèm
    `Cache-Control: no-store` (§2.6, §2.8). ASVS 10.5.5 (L2) đòi kiểm thêm `typ: logout+jwt`. Refresh token của session
    đó mà không có `offline_access` thì SHOULD bị thu hồi (§2.7).

### 8.3 Socket.IO

Với BFF, trình duyệt không có access token, nên handshake không thể mang access token. Có ba cách:

| Cách | Làm gì | Đánh giá |
|---|---|---|
| **Vé socket (chọn)** | Trình duyệt gọi `POST /bff/socket-ticket`. BFF gọi api bằng access token, api trả một vé mờ ≥128 bit, dùng một lần, sống 30 giây, chỉ lưu hash, mang `sub`, `sid` và hạn của session BFF. Trình duyệt gửi `io({ auth: { ticket } })`, middleware đọc `socket.handshake.auth` ([docs](https://socket.io/docs/v4/middlewares/)) | Token không ra trình duyệt. Thêm một endpoint và một bảng nhỏ |
| Token-mediating backend (RFC 10017 §6.2) | BFF đưa access token cho JS, chỉ để mở socket | Mã độc trong trang lấy được token (§5.1.1); trái ASVS 10.1.1 |
| Socket đi qua BFF | Web nhận WebSocket, gắn token, chuyển tiếp sang api | Rewrite hiện tại không làm được; cần một server tuỳ biến đứng trước Next |

- Middleware Socket.IO chỉ chạy một lần mỗi kết nối. Không gắn socket với `exp` 5 phút của access token, vì kết nối lại
  mỗi 5 phút là phiền ở bàn chơi. Socket gắn với `sid`: api lưu `sub`, `sid` và hạn session vào `socket.data`, rồi cho
  socket join room `sid:<sid>` và `sub:<sub>`.
- **Thu hồi:**
  - OP gửi back-channel logout tới web, vì web là RP. Api là resource server, không tham gia session ở OP, nên không
    nhận logout token. Web xoá session của mình rồi báo api qua một endpoint nội bộ có xác thực.
  - Api gọi `io.in("sid:<sid>").disconnectSockets()`, hoặc dùng room `sub:<sub>` khi logout token không có `sid` (§2.4:
    thiếu `sid` nghĩa là mọi session của `sub` đó). Đây là kick theo session ở mục 3.5, chỉ khác nguồn sự kiện.
  - Api ghi `sid` đã thu hồi vào một bảng, và middleware từ chối vé của `sid` đó, để kết nối lại không lách được.
  - `disconnectSockets` chạy được trên nhiều node nếu có adapter tương thích ([server API](https://socket.io/docs/v4/server-api/)).
- **Hết hạn:** khi BFF không làm mới được token nữa (refresh token hết hạn hoặc bị thu hồi), lần xin vé tiếp theo thất
  bại. Không có sự kiện thu hồi thì socket sống tới hạn session đã lưu trong `socket.data`, và api kiểm hạn đó ở mỗi
  action như mục 3.5. Lỗi handshake trả về qua `connect_error` kèm `err.data`, để client biết phải đăng nhập lại thay vì
  thử lại mãi.

### 8.4 Tách xác thực và phân quyền

- **Trong token:** `sub`, `scope` (ví dụ `table` cho bàn chơi và `admin` cho admin console), và vai trò platform. Theo
  ASVS 10.3.2 (L2), resource server quyết định dựa trên claim của token. Admin cần thêm độ mạnh xác thực: nếu token có
  `acr`, `amr` hay `auth_time` thì api kiểm chúng (ASVS 10.3.4, L2), thay cho `fresh_at` ở mục 3.3.
- **Không để trong token: seat.**
  - Seat đổi giữa phiên (kick, nhận lời mời, chuyển chủ phòng), và kick phải có hiệu lực ngay (ASVS 8.3.2, mục 4.2).
    Seat để trong token sẽ cũ cho tới `exp`, và token phình theo số phòng.
  - `membership`, `canInCampaign` và `authorize` trong dispatch giữ nguyên. Api tra seat theo `app_user.id` như hiện nay.
- **Ánh xạ danh tính:** bảng mới `identity_link` ở api, PK (`iss`, `sub`), `user_id` trỏ tới `app_user.id`,
  `created_at`. Khoá là cặp này chứ không phải email (mục 2.6). ASVS 10.3.3 và 10.5.2 (L2) đòi định danh user bằng
  claim không thể gán cho người khác.
- **Thiết bị ẩn danh ở lại api.** `it_device`, `access_token` của khách và TV, và mã mời không đi qua OP. Chúng là
  session cục bộ của api, nên giai đoạn A–C ở mục 7 vẫn đúng.
- **Nâng cấp:**
  - User ẩn danh U đăng nhập lần đầu. Callback ở BFF có cả cookie `it_device` (cùng site) và token mới. Api tạo
    `identity_link` từ (`iss`, `sub`) tới U. Id không đổi, giống nâng cấp tại chỗ ở mục 2.2.
  - Nếu (`iss`, `sub`) đã gắn với một user A khác, áp quy tắc "đăng nhập tài khoản A trên thiết bị đang là user ẩn
    danh B" ở mục 2.2.
  - Chỉ liên kết từ một callback đã kiểm `state` và PKCE. Nếu không, kẻ tấn công có thể đăng nhập nạn nhân vào tài
    khoản của mình và gắn thiết bị của nạn nhân vào đó (login CSRF).
- **Hai kho user:** OP giữ credential và email; api giữ `app_user` và dữ liệu game. Xoá tài khoản phải chạy ở cả hai.

### 8.5 Vận hành

- **Khoá ký:**
  - ES256 (EC P-256) hoặc Ed25519 (OKP). `oidc-provider` nhận cả hai; RFC 9068 §4 khuyến nghị khoá bất đối xứng. Mỗi
    khoá có `kid`.
  - Xoay theo thứ tự docs: thêm khoá mới vào cuối `keys`, reload; đưa nó lên đầu (khoá đầu là khoá ký), reload lần nữa.
    Giữ khoá cũ trong JWKS tới khi token cuối cùng ký bằng nó hết hạn: 5 phút cho access token, và 1 giờ cho ID token
    theo mặc định.
  - Phía api, `jose` tự tải lại khi gặp `kid` lạ. Khoá riêng để trong `*.env` hoặc file secret, như `docs/deploy.md`.
  - [ASVS 9.1.1–9.1.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x18-V9-Self-contained-Tokens.md) (L1): kiểm chữ
    ký, allowlist thuật toán, và chỉ lấy khoá từ nguồn cấu hình sẵn cho issuer đó.
- **Dữ liệu tách:** OP dùng một database `auth` riêng (hoặc schema riêng) với role Postgres riêng; api không đọc được.
  Một instance Postgres 18 là đủ, không thêm container. Adapter tự viết lưu các model của OP (Session, Grant,
  AuthorizationCode, RefreshToken, Interaction...). Các bảng credential ở mục 2.1 (mật khẩu, passkey, TOTP, mã khôi phục)
  chuyển sang đây.
- **TLS là bắt buộc:**
  - OIDC Core: giao tiếp với Authorization Endpoint và Token Endpoint MUST dùng TLS (§3.1.2, §3.1.3); Issuer
    Identifier là URL `https` (§1.2); mọi bản triển khai MUST hỗ trợ TLS (§16.17). Redirect URI được phép dùng `http` khi
    client là confidential (§3.1.2.1), còn endpoint của OP thì không.
  - RFC 10017 bắt cookie của BFF có `Secure`, mà trình duyệt bỏ cookie `Secure` trên HTTP (mục 3.6).
  - Xung đột với `docs/deploy.md`: bản deploy hiện chạy ở `http://192.168.1.10:3000`. Thư viện vẫn chạy trên
    `http://localhost` (lần chạy thử ở trên), nhưng như vậy là lệch spec và chỉ dùng cho dev.
  - Hệ quả: phương án B chỉ bật được khi có tên miền và TLS, đúng ranh giới ở mục 3.6. Trên HTTP LAN chỉ còn thiết bị ẩn
    danh của api. TLS trên LAN (CA nội bộ phải cài lên mọi điện thoại, hoặc chứng chỉ công khai cho một tên miền trỏ về
    IP LAN) là việc riêng, chưa kiểm.
- **Cookie và subdomain:**
  - `auth.example.com` và `table.example.com` cùng site (eTLD+1) nhưng khác origin. `SameSite=Strict` không chặn
    request giữa hai subdomain, nên một subdomain bị chiếm có thể CSRF vào BFF (RFC 10017 §6.1.3.3.1).
  - Cookie của BFF dùng `__Host-Http-` và không có `Domain`, nên không chia với OP; cookie của OP ở lại `auth.*`. Không
    đặt `Domain=example.com` để "chia sẻ đăng nhập": SSO đã do redirect tới OP lo.
  - Cách khác là mount OP dưới một path cùng origin với web (docs có ví dụ issuer `https://op.example.com/oidc`). Chỉ cần
    một chứng chỉ và ít cấu hình hơn, nhưng mất tách biệt về origin, và web phải proxy thêm path đó.
- **Giới hạn tần suất:** `limiter()` nằm trong api, OP không dùng được. OP cần một lớp riêng (middleware Koa) cho trang
  interaction và token endpoint, theo các mức ở mục 5.
- **Audit:** OP ghi đăng nhập, MFA, đăng xuất và phát hiện dùng lại refresh token vào bảng của nó. `Provider` phát sự
  kiện (lần chạy thử đã nghe `server_error` qua `provider.on`). Api giữ `admin_event`. Không ghi token (mục 5).
- **Mức ASVS:** thêm V9 và V10 vào mục tiêu ở mục 6. Phần lớn yêu cầu V10 cho client và resource server là L2 (10.1.1,
  10.1.2, 10.2.1, 10.3.1–10.3.4, 10.4.6, 10.5.1, 10.5.5, 10.6.2). L1 chủ yếu là các mục của authorization server như
  10.4.1–10.4.3 và 10.4.5. Kiểm `aud` là 9.2.3 và 10.3.1, đều L2. Nhắm L1 cho phương án B tức là không bắt buộc kiểm
  `aud`, điều không chấp nhận được. Vậy mục tiêu là L2 cho các mục V9 và V10 áp dụng được; V6–V8 giữ như mục 6.
- **Aspire:** thêm một app vào `aspire-apphost/apphost.mts`, cùng kiểu với api:

  ```ts
  const authDb = await postgres.addDatabase("auth");
  const auth = await builder.addJavaScriptApp("auth", "../apps/auth", { runScriptName: "dev" });
  await auth.withBun({ install: false });
  await auth.withHttpEndpoint({ port: 4100, env: "PORT" });
  await auth.withEnvironment("DATABASE_URL", await authDb.uriExpression());
  await auth.waitFor(authDb);
  await web.waitFor(auth); // BFF đọc discovery của OP khi khởi động
  ```

  Api cần thêm biến issuer và audience; web cần `client_id`, client secret và issuer. Nếu house decision chọn Node cho
  OP thì `withBun` phải đổi; API Aspire cho Node chưa kiểm. Bản deploy cũng thêm một service vào `deploy/compose.yaml`.

### 8.6 So sánh và khi nào đáng

| | Module trong api (mục 1–7) | IdP riêng trên `oidc-provider` | Keycloak / Zitadel / Logto |
|---|---|---|---|
| Công sức (thứ cấp: ước tính của người viết) | 21–33 ngày cho A–F (mục 7) | Khoảng 30–50 ngày: A–C và F như cũ, cộng OP và adapter Postgres, trang interaction (bằng D), BFF, resource server, vé socket, back-channel logout, TLS | A–C và F vẫn tự làm, cộng 5–10 ngày tích hợp (BFF, resource server, liên kết, theme trang đăng nhập) |
| Chi phí vận hành | Không thêm tiến trình | Thêm một tiến trình (Node hoặc Bun) và một database; xoay khoá; TLS bắt buộc | Thêm một server: Keycloak cần khoảng 1250 MB RAM mỗi pod ([sizing](https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing)); Zitadel (Go) và Logto (Node) kèm Postgres riêng (`auth-providers.md`), RAM chưa đo |
| Giao thức | Chỉ OIDC client (`openid-client`) | Thư viện đã chứng nhận; cấu hình là việc của mình | Có sẵn, cấu hình qua console |
| Rủi ro chính | Auth chung tiến trình với game | Cấu hình sai (quên tắt `devInteractions`, adapter, PKCE cho confidential client); Bun không được hỗ trợ; một người bảo trì | Nâng phiên bản server lớn; ghép thiết bị bằng QR và mã khôi phục in giấy khó đưa vào trang đăng nhập của họ; Zitadel là AGPL-3.0 |
| Thu hồi | Tức thì (tra DB) | Tới 5 phút cho REST; tức thì cho socket qua back-channel logout | Như cột giữa |
| HTTP LAN | Chạy được (thiết bị ẩn danh, ghép thiết bị, mã khôi phục) | Không (OIDC cần TLS) | Không |

Service riêng đáng làm khi có ít nhất một trong các điều sau:

- Có app thứ hai cần đăng nhập chung (SSO), ví dụ một công cụ dựng World chạy riêng.
- Bên thứ ba cần gọi api thay mặt user (app khác, bot). Khi đó cần OAuth đúng nghĩa, có consent (ASVS V10.7).
- Cần cô lập kho credential khỏi code game: ít người được deploy OP, audit riêng.
- Có người lo riêng phần auth.

Hôm nay chưa có điều nào đúng, nên khuyến nghị ở mục 1 giữ nguyên. Để sau này chuyển sang B vẫn rẻ:

- Giữ khoá liên kết là (`iss`, `sub`) từ giai đoạn E (bảng `oauth_identity` ở mục 2.1 đã có khoá này).
- Giữ `canInCampaign` chỉ phụ thuộc user và seat, không phụ thuộc loại credential.
- Mọi kiểm tra session ở api đi qua một chỗ (`resolveCtx`, cộng handshake socket), để sau này đổi sang kiểm JWT mà
  không chạm phần còn lại.

Nếu đã cần IdP mà không muốn tự sở hữu trang đăng nhập, dùng phần mềm có sẵn; `auth-providers.md` đánh giá Logto là
"ổn nếu cần IdP OIDC riêng".

## Nguồn

Ngày đọc của mọi nguồn là 2026-10-24.

- NIST: [SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) (bản chính thức tháng 7/2025, ghi nhận bản cuối
  ngày 31/07/2025 theo [CSRC](https://csrc.nist.gov/pubs/sp/800/63/4/final)),
  [SP 800-162](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
- OWASP Cheat Sheets: [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
  [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
  [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
  [MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html),
  [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html),
  [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
  [Credential Stuffing](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html),
  [HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html),
  [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- OWASP ASVS 5.0: [V6 Authentication](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md),
  [V7 Session](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md),
  [V8 Authorization](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md); ngày phát hành lấy từ
  [GitHub releases](https://github.com/OWASP/ASVS/releases) (`v5.0.0_release`, 2025-05-30)
- IETF: [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html),
  [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html), [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html),
  [draft-ietf-httpbis-rfc6265bis-22](https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-22.html)
  ([trạng thái](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/))
- OpenID: [Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html),
  [RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html),
  [Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html),
  [Certified OpenID Providers & Profiles](https://openid.net/certification/certified-openid-providers-profiles/)
- Mục 8: [RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html) (trước là draft-ietf-oauth-browser-based-apps-27;
  [datatracker](https://datatracker.ietf.org/doc/rfc10017/)), [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html),
  [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html),
  [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html);
  [ASVS V9](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x18-V9-Self-contained-Tokens.md),
  [ASVS V10](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md);
  `oidc-provider` 9.13.0 (2026-10-22, npm registry): [README](https://github.com/panva/node-oidc-provider),
  [docs](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md), và cảnh báo runtime trong
  `lib/index.js` của gói; [Socket.IO server API](https://socket.io/docs/v4/server-api/);
  [Keycloak sizing](https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing). Lần chạy
  thử `oidc-provider` trên Bun 1.3.11 là của người viết, ngày 2026-10-24; script không nằm trong repo.
- W3C: [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) (Recommendation 2026-08-25),
  [Secure Contexts](https://www.w3.org/TR/secure-contexts/); [passkeys.dev](https://passkeys.dev/docs/use-cases/bootstrapping/)
- Runtime và framework: [Bun hashing](https://bun.com/docs/runtime/hashing),
  [bun-types](https://github.com/oven-sh/bun/blob/main/packages/bun-types/bun.d.ts) (mặc định argon2id; tham số m/t đo
  trên Bun 1.3.11), [Next.js authentication](https://nextjs.org/docs/app/guides/authentication),
  [NestJS authorization](https://docs.nestjs.com/security/authorization),
  [Socket.IO middlewares](https://socket.io/docs/v4/middlewares/),
  [Socket.IO server options](https://socket.io/docs/v4/server-options/),
  [Socket.IO với express-session](https://socket.io/how-to/use-with-express-session)
- Thư viện, với phiên bản và ngày lấy từ npm registry và GitHub API:
  - `@simplewebauthn/server` 14.0.3 (2026-09-25), [docs](https://simplewebauthn.dev/docs/packages/server)
  - `openid-client` 6.8.8 (2026-09-05), [GitHub](https://github.com/panva/openid-client)
  - `jose` 6.2.13 (2026-10-20)
  - `otpauth` 9.5.2 (2026-09-03)
  - `nodemailer` 10.2.1 (2026-10-22)
  - `@nestjs/authorization` 0.1.0 (2026-10-08)
  - `better-auth` 1.7.12 (2026-10-20)
  - `arctic` 3.7.0 deprecated ([trang chủ](https://arctic.pilcrowonpaper.com/), npm)
  - `@oslojs/crypto`, `@oslojs/otp`, `@oslojs/webauthn`, `@oslojs/jwt`, `@oslojs/oauth2` bị đánh dấu deprecated trên
    npm (`@oslojs/encoding` thì chưa)
- Mô hình phân quyền: [OpenFGA](https://openfga.dev/docs/fga),
  [Zanzibar](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)
- Khác: [Have I Been Pwned API v3](https://haveibeenpwned.com/API/v3),
  [Gmail sender guidelines](https://support.google.com/a/answer/81126),
  [Better Auth security advisories](https://github.com/better-auth/better-auth/security/advisories) (đếm qua GitHub API)
