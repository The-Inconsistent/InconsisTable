# Dịch vụ xác thực cho InconsisTable (đọc ngày 2026-10-19)

Câu hỏi: hiện nay dịch vụ xác thực (auth) nào tốt nhất? Trả lời cho InconsisTable, không trả lời chung chung.

Bối cảnh: hiện chưa có tài khoản. Mỗi trình duyệt là một user ẩn danh, định danh bằng cookie `it_device` do proxy web
cấp (`apps/web/proxy.ts`). Admin dùng chung `ADMIN_KEY`. Deploy chỉ chạy local hoặc LAN (house decision #32,
`docs/deploy.md`). Seam để thay là `packages/auth` (`deviceUser`, ghi chú `ponytail:`). Stack gồm Bun, Next.js 16
(web), NestJS + Socket.IO chạy tiến trình riêng (api), Postgres 18 + Drizzle, TypeScript 5.9. Clerk đã bị gỡ ở #46
(`cf79d1b`) vì **tốn tiền** (chủ dự án xác nhận 2026-10-19; commit và PR không ghi lý do). Ngày phát
hành lấy từ npm registry và GitHub API, đọc ngày 2026-10-19. "(thứ cấp)" đánh dấu nguồn không phải chủ sở hữu thông tin.

## Tóm tắt

| Ứng viên | Loại, license | Gói miễn phí (2026-10-19) | Còn bảo trì? | User ẩn danh, sau nâng lên tài khoản thật | User nằm ở đâu | Hợp InconsisTable |
|---|---|---|---|---|---|---|
| **Better Auth** | Thư viện TS, [MIT](https://github.com/better-auth/better-auth) | Miễn phí, tự chạy | Rất sôi động: v1.7.11 ngày 2026-10-19 ([npm](https://registry.npmjs.org/better-auth)); [gia nhập Vercel 2026-07-07](https://better-auth.com/blog/better-auth-joins-vercel) | **Có**, plugin [anonymous](https://www.better-auth.com/docs/plugins/anonymous) + `onLinkAccount` | **Postgres của mình**, qua [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle) | **Tốt nhất** |
| Auth.js (NextAuth) | Thư viện, ISC | Miễn phí | Chỉ còn vá lỗi: [team Better Auth tiếp quản 2025-09-22](https://www.better-auth.com/blog/authjs-joins-better-auth); v5 vẫn beta (`5.0.0-beta.32`, [npm](https://registry.npmjs.org/next-auth)) | Không có sẵn | Postgres của mình | Không nên chọn cho dự án mới |
| Lucia | Thư viện, MIT | – | [Deprecated từ 3/2025](https://lucia-auth.com/) | – | – | Loại |
| Supabase Auth | SaaS, hoặc tự host server Go [MIT](https://github.com/supabase/auth) | [50.000 MAU](https://supabase.com/pricing), project bị dừng sau 1 tuần không hoạt động | v2.197.0 ngày 2026-09-09 | **Có**, [anonymous sign-in](https://supabase.com/docs/guides/auth/auth-anonymous) + `linkIdentity`/`updateUser` | Postgres của Supabase (SaaS), hoặc schema `auth` trong Postgres của mình (tự host) | Lựa chọn thứ hai |
| Clerk | SaaS đóng | [50.000 MRU mỗi app](https://clerk.com/pricing) | Có (`@clerk/nextjs` 7.9.17, 2026-10-16) | Không thấy trong tài liệu | Ở Clerk, đồng bộ qua webhook | Đã thử và đã gỡ |
| WorkOS AuthKit | SaaS đóng | [1 triệu MAU](https://workos.com/pricing) | Có (4.4.0, 2026-09-30) | Chưa kiểm tra | Ở WorkOS | Phương án hosted nếu bỏ yêu cầu tự host |
| Auth0 (Okta) | SaaS đóng | [25.000 MAU](https://auth0.com/pricing); gói trả phí rẻ nhất $35/tháng cho 500 MAU | Có | Không kiểm tra | Ở Auth0 | Đắt khi lớn, nặng |
| Firebase Auth | SaaS đóng | [50.000 MAU](https://firebase.google.com/pricing) | Có (`firebase` 13.0.0, 2026-10-07) | **Có**, [anonymous + `linkWithCredential`](https://firebase.google.com/docs/auth/web/anonymous-auth) | Ở Google | Lệch stack (Postgres, tự host) |
| Stytch | SaaS đóng | [10.000 MAU](https://stytch.com/pricing) | [Twilio mua, hoàn tất 2025-11-14](https://stytch.com/docs/resources/changelog) | Không kiểm tra | Ở Stytch | Không |
| Kinde | SaaS đóng | [10.500 MAU](https://kinde.com/pricing/), Pro $25/tháng | Có | Không kiểm tra | Ở Kinde | Không |
| Descope | SaaS đóng | [7.500 MAU](https://www.descope.com/pricing), Pro $249/tháng | Có | Không kiểm tra | Ở Descope | Không |
| Logto | OSS [MPL-2.0](https://github.com/logto-io/logto) + cloud | Cloud [50.000 MAU](https://logto.io/pricing) | v1.45.0, 2026-10-13 | Không kiểm tra | Postgres riêng của Logto | Ổn nếu cần IdP OIDC riêng |
| SuperTokens | OSS Apache-2.0 (ngoài `ee/`) + cloud | Tự host miễn phí; cloud [5.000 MAU](https://supertokens.com/pricing). Account linking và MFA tính phí | v12.3.1, 2026-10-16 | Account linking là tính năng trả phí | Core Java riêng | Không |
| Keycloak | OSS [Apache-2.0](https://github.com/keycloak/keycloak), [CNCF incubating](https://www.keycloak.org/) | Miễn phí | 26.8.1, 2026-10-13 | Không kiểm tra | Server Java riêng | Quá nặng |
| Zitadel | OSS [AGPL-3.0](https://github.com/zitadel/zitadel) + cloud | Cloud [100 DAU](https://zitadel.com/pricing) | v4.19.5, 2026-10-15 | Không kiểm tra | Server Go riêng | Quá nặng |
| Ory Kratos | OSS [Apache-2.0](https://github.com/ory/kratos) + Ory Network | Gói Developer miễn phí, production [$770/năm](https://www.ory.com/pricing) | v26.2.0, 2026-03-20; lần push cuối 2026-07-29 | Không kiểm tra | Server Go riêng | Quá nặng |
| Authentik | OSS MIT (ngoài `enterprise/`) | Miễn phí tự host | 2026.8.4, 2026-10-14 | Không kiểm tra | Server Python riêng | Dành cho SSO homelab, không phải đăng ký người dùng cuối |
| Hanko | OSS AGPL-3.0 (elements MIT) + cloud | Cloud [10.000 MAU](https://www.hanko.io/pricing) | backend v3.1.0, 2026-10-01 | Không kiểm tra | Server Go riêng | Ưu tiên passkey, thêm một service |
| Pocket ID | OSS [BSD-2-Clause](https://github.com/pocket-id/pocket-id) | Miễn phí | v2.18.0, 2026-10-04 | Không | Server Go riêng | Chỉ hỗ trợ passkey ([README](https://github.com/pocket-id/pocket-id)), hợp homelab |

Kết luận: chọn **Better Auth**, nhúng vào api NestJS và dùng chung Postgres 18 qua Drizzle. Đây là ứng viên duy nhất
đồng thời đáp ứng các điều sau: user nằm trong DB của mình, có user ẩn danh nâng lên được, không tốn tiền, không thêm
service, viết bằng TypeScript. Supabase Auth tự host đứng thứ hai. Nếu muốn hosted và chịu được việc dữ liệu nằm ở
vendor thì chọn WorkOS AuthKit.

## Từng ứng viên

### Better Auth

- Thư viện TypeScript, giấy phép [MIT](https://github.com/better-auth/better-auth), khoảng 30,4 nghìn sao. Bản mới nhất
  là v1.7.11 ngày 2026-10-19, cùng nhánh 1.8.0-beta ([releases](https://github.com/better-auth/better-auth/releases),
  [npm](https://registry.npmjs.org/better-auth)).
- Ngày 2026-07-07, Better Auth [gia nhập Vercel](https://better-auth.com/blog/better-auth-joins-vercel). Bài viết cam
  kết giữ dự án "open source, framework and platform agnostic", nhưng không nhắc tới giấy phép. Bài cũng cho biết sản
  phẩm hosted "Better Auth Infrastructure" (dashboard, audit log) đã ra mắt ngày 1/1. Từ ngày 2025-09-22, team này
  [cũng bảo trì Auth.js](https://www.better-auth.com/blog/authjs-joins-better-auth).
- **User ẩn danh:** `signIn.anonymous()` tạo user có email giả. Khi user đó đăng nhập hoặc đăng ký bằng phương thức
  khác, callback `onLinkAccount({ anonymousUser, newUser })` được gọi. Thư viện **không tự chuyển dữ liệu**, và mặc
  định xoá user ẩn danh sau khi link. Có thể tắt việc xoá bằng `disableDeleteAnonymousUser`
  ([docs](https://www.better-auth.com/docs/plugins/anonymous)).
- **Backend tách rời:** plugin JWT có endpoint JWKS (`/api/auth/jwks`) và `/api/auth/token`, mặc định ký bằng
  EdDSA/Ed25519, nên một backend khác có thể tự kiểm tra token mà không cần gọi DB
  ([docs](https://www.better-auth.com/docs/plugins/jwt)). Với NestJS có gói cộng đồng `@thallesp/nestjs-better-auth`,
  cung cấp `AuthModule.forRoot`, `@Session()`, `@AllowAnonymous()`, và yêu cầu `bodyParser: false`
  ([docs](https://www.better-auth.com/docs/integrations/nestjs)). Gói này do cộng đồng bảo trì, không phải bản chính
  thức.
- **Next.js 16:** cách tích hợp là route `/api/auth/[...all]` với `toNextJsHandler`. Tài liệu nói rõ về `proxy.ts`
  của Next 16: proxy chỉ nên kiểm tra cookie, còn trang phải gọi `auth.api.getSession` để xác thực thật
  ([docs](https://www.better-auth.com/docs/integrations/next)).
- **Drizzle/Postgres:** dùng `drizzleAdapter(db, { provider: "pg" })`. CLI `auth generate` sinh schema, sau đó chạy
  `drizzle-kit generate` như bình thường. Đổi được tên bảng (`modelName`, `usePlural`) và chọn schema Postgres riêng
  (`schemaName`) ([docs](https://www.better-auth.com/docs/adapters/drizzle)).
- **Bun:** trang cài đặt dùng `bun add` và `bun x auth@latest`, có liệt kê Elysia (framework của Bun), nhưng không nói
  rõ là hỗ trợ Bun runtime ([docs](https://www.better-auth.com/docs/installation)).
- **Phương thức đăng nhập:** [magic link](https://www.better-auth.com/docs/plugins/magic-link),
  [email OTP](https://www.better-auth.com/docs/plugins/email-otp) và
  [passkey](https://www.better-auth.com/docs/plugins/passkey) (gói riêng `@better-auth/passkey`, xây trên
  SimpleWebAuthn, `rpID` chạy được với `localhost`).
- **SSO**, có ba nghĩa:
  - Đăng nhập bằng Google, Discord, GitHub...: tính năng có sẵn.
  - Đăng nhập qua IdP ngoài: plugin [`@better-auth/sso`](https://www.better-auth.com/docs/plugins/sso), hỗ trợ OIDC,
    OAuth2 và SAML 2.0. Giấy phép MIT, v1.7.11 ([npm](https://registry.npmjs.org/@better-auth/sso/latest)). Tự host
    miễn phí; các bước cài trong docs không cần trả phí.
  - Làm IdP cho app khác: plugin [`@better-auth/oauth-provider`](https://www.better-auth.com/docs/plugins/oauth-provider),
    OAuth 2.1 + OpenID Connect, PKCE S256, refresh token, client credentials, device code. MIT, v1.7.11
    ([npm](https://registry.npmjs.org/@better-auth/oauth-provider/latest)). Trang docs không ghi stable hay beta.
- **Self-service SSO tính phí:** đây là dashboard để khách của mình tự cấu hình kết nối SSO, thuộc dịch vụ hosted Better
  Auth Infrastructure ([docs](https://www.better-auth.com/docs/plugins/sso)). [Bảng giá](https://www.better-auth.com/pricing):
  - Starter $0/tháng: không có self-service SSO.
  - Pro $20/tháng: 1 kết nối, sau đó $50/tháng mỗi kết nối. Directory Sync tính giá như vậy.
  - Enterprise: giá thoả thuận.

  Trang giá ghi rõ "The Better Auth framework is free and open source"; chỉ hạ tầng hosted mới tính phí. InconsisTable
  không bán cho tổ chức nên không cần self-service SSO.

### Auth.js (NextAuth)

Từ 2025-09-22, team Better Auth nắm dự án. Họ hứa "keep addressing security patches and urgent issues" và "strongly
recommend new projects to start with Better Auth"
([blog](https://www.better-auth.com/blog/authjs-joins-better-auth),
[thảo luận #13252](https://github.com/nextauthjs/next-auth/discussions/13252)). Bản ổn định là `next-auth@4.24.15`
(2026-07-20), còn v5 vẫn là `5.0.0-beta.32` ([npm](https://registry.npmjs.org/next-auth)). Lần push cuối lên repo là
ngày 2026-07-22. Không nên dùng cho dự án mới.

### Lucia

Trang chủ ghi "Lucia was deprecated in March 2025". Dự án giờ chỉ là tài liệu hướng dẫn tự viết session
([lucia-auth.com](https://lucia-auth.com/)). Gói npm dừng ở 3.2.2 (2024-10-20). Tuy vậy, mô hình `it_device` hiện tại
của dự án đã gần giống cách Lucia hướng dẫn: secret ngẫu nhiên, chỉ lưu hash.

### Supabase Auth

- Có hai cách dùng. Cách thứ nhất là SaaS: [50.000 MAU miễn phí; Pro gồm 100.000 MAU, sau đó $0,00325 mỗi MAU](https://supabase.com/pricing),
  và project miễn phí bị dừng sau 1 tuần không hoạt động. Cách thứ hai là tự host server Go
  [supabase/auth](https://github.com/supabase/auth) (MIT, v2.197.0 ngày 2026-09-09). README có phần quick start chạy
  server này với một Postgres riêng.
- **User ẩn danh:** `signInAnonymously()` cấp JWT có claim `is_anonymous`. Muốn nâng lên tài khoản thật thì gọi
  `updateUser` (email hoặc điện thoại) hoặc `linkIdentity` (OAuth). Tài liệu mô tả việc này là "liên kết danh tính" vào
  user hiện có, nên id có lẽ được giữ, nhưng tài liệu không nói thẳng. Supabase "strongly recommends" bật CAPTCHA hoặc
  Turnstile. Không có cơ chế tự dọn user ẩn danh
  ([docs](https://supabase.com/docs/guides/auth/auth-anonymous)).
- **Hợp với dự án:** đây là IdP thứ hai cần vận hành, với schema `auth` riêng, JWT riêng và SDK thiên về RLS của
  Supabase. Api NestJS sẽ kiểm tra JWT của nó.

### Clerk

- Gói Hobby: [50.000 MRU mỗi app](https://clerk.com/pricing). MRU là user quay lại ít nhất một ngày sau khi đăng ký.
  Gói Pro $25/tháng, vượt mức tính $0,02 mỗi MRU.
- Backend có thể kiểm tra JWT bằng JWKS mà không cần gọi mạng
  ([docs](https://clerk.com/docs/guides/sessions/manual-jwt-verification)).
- Không tìm thấy tài liệu chính thức về user ẩn danh hoặc khách. Kết quả tìm kiếm có nhắc tới một feature request
  "Guest Logins / Anonymous Users" trên feedback.clerk.com (thứ cấp, chưa mở được để xác minh).
- Dự án đã từng dùng Clerk rồi gỡ ra ở #46 vì tốn tiền. Phải đồng bộ user qua webhook (`webhook.controller.ts` đã bị
  xoá), và user nằm ở Clerk.

### WorkOS AuthKit

[1 triệu MAU miễn phí, sau đó $2.500 cho mỗi triệu MAU](https://workos.com/pricing). Gói `@workos-inc/authkit-nextjs`
bản 4.4.0 phát hành 2026-09-30. Chưa kiểm tra AuthKit có hỗ trợ user ẩn danh hay không. User nằm ở WorkOS.

### Auth0 (Okta)

[Miễn phí 25.000 MAU, có passwordless. Gói Essentials $35/tháng cho 500 MAU](https://auth0.com/pricing). Mức giá nhảy
mạnh ngay khi rời gói miễn phí. User nằm ở Okta.

### Firebase Auth

[Miễn phí tới 50.000 MAU](https://firebase.google.com/pricing). Có user ẩn danh, nâng lên tài khoản thật bằng
`linkWithCredential`. Nếu dùng Identity Platform thì bật được tự xoá tài khoản ẩn danh sau 30 ngày, và tài khoản ẩn danh
khi đó không bị tính vào hạn mức ([docs](https://firebase.google.com/docs/auth/web/anonymous-auth)). User nằm ở Google,
không tự host được.

### Stytch

[Twilio mua lại](https://stytch.com/docs/resources/changelog): công bố 2025-10-07, hoàn tất 2025-11-14. Gói Consumer
[miễn phí 10.000 MAU](https://stytch.com/pricing). Không có lý do để chọn cho một app TTRPG.

### Kinde, Descope

Kinde [miễn phí 10.500 MAU, Pro $25/tháng](https://kinde.com/pricing/). Descope
[miễn phí 7.500 MAU, Pro từ $249/tháng](https://www.descope.com/pricing). Cả hai là SaaS đóng, user nằm ở vendor.

### Logto

OSS giấy phép MPL-2.0, viết bằng TypeScript, chạy trên Node và Postgres. v1.45.0 phát hành 2026-10-13
([GitHub](https://github.com/logto-io/logto)). Bản cloud [miễn phí 50.000 MAU, Pro từ $24/tháng](https://logto.io/pricing).
Là một IdP OIDC riêng, nên hợp khi cần SSO cho nhiều app, còn InconsisTable chỉ có một app.

### SuperTokens

Core viết bằng Java, Apache-2.0 trừ thư mục `ee/` (file LICENSE). Tự host "free without any limits" cho phần open
source, nhưng **Account Linking ($0,005 mỗi MAU) và MFA là tính năng trả phí**
([pricing](https://supertokens.com/pricing)). Đúng tính năng dự án cần để nâng user ẩn danh lại phải trả tiền.

### Keycloak, Zitadel, Ory, Authentik

Đều là IdP đầy đủ, chạy như một service riêng.

- Keycloak: Java, Apache-2.0, CNCF incubating ([keycloak.org](https://www.keycloak.org/)), 26.8.1 phát hành 2026-10-13.
- Zitadel: Go, AGPL-3.0. Cloud miễn phí chỉ có 100 DAU, Pro $100/tháng ([pricing](https://zitadel.com/pricing)).
- Ory Kratos: Go, Apache-2.0. Bản phát hành gần nhất là v26.2.0 (2026-03-20). Trang giá ghi gói production của Ory
  Network là $770/năm, còn self-host có hỗ trợ thì dùng Ory Enterprise License, giá thoả thuận
  ([pricing](https://www.ory.com/pricing)).
- Authentik: Python, MIT trừ thư mục `enterprise/` (file LICENSE).

Với một app duy nhất, đội nhỏ, LAN hoặc VPS, cả bốn đều thêm một service và một bộ cấu hình nặng mà không đổi lại được
gì.

#### Authentik, chi tiết

- Bản mới nhất 2026.8.4, ngày 2026-10-14 ([GitHub API](https://api.github.com/repos/goauthentik/authentik/releases/latest)).
- [Giá](https://goauthentik.io/pricing/):
  - Open Source: miễn phí, không giới hạn số user.
  - Enterprise: $5/user/tháng, hoặc $0,02/user ngoài/tháng, trả theo năm.
  - Enterprise Plus: từ $20.000/năm.
- Bản miễn phí có provider OIDC, SAML, LDAP, SCIM, RADIUS, Proxy, đã chứng nhận OpenID. Bản Enterprise có thêm audit log
  nâng cao, Google Workspace/Entra ID, mTLS, device trust...
- Tự đăng ký: có flow "Enrollment", gồm các stage Email, Captcha và User Write
  ([docs](https://docs.goauthentik.io/docs/add-secure-apps/flows-stages/flow/)).
- Đăng nhập mạng xã hội: docs nêu Apple, Discord, Twitch, Twitter và "many others"
  ([docs](https://docs.goauthentik.io/docs/users-sources/sources/)). Trang này không ghi nguồn nào thuộc Enterprise.
- Passkey: stage "WebAuthn / FIDO2 / Passkeys", đăng nhập không mật khẩu được nếu đặt resident key
  ([docs](https://docs.goauthentik.io/docs/add-secure-apps/flows-stages/stages/authenticator_webauthn/)). Trang không
  ghi stage này miễn phí hay thuộc Enterprise.
- Vận hành: tối thiểu 2 CPU và 2 GB RAM, gồm container server và worker cùng Postgres riêng
  ([docs](https://docs.goauthentik.io/docs/install-config/install/docker-compose)).
- Không thấy tài liệu về user ẩn danh hoặc khách.
- Hợp InconsisTable? Miễn phí và đủ SSO, nhưng phải chạy thêm một IdP 2 GB RAM cạnh api. User nằm ở DB của Authentik
  nên phải nối với `app_user` qua OIDC. Luồng khách ẩn danh nâng lên tài khoản thật vẫn phải tự làm bằng `it_device`.
  Better Auth làm được những việc đó ngay trong api.

### Hanko, Pocket ID (ưu tiên passkey)

- Hanko: backend Go AGPL-3.0, phần elements MIT. Cloud [miễn phí 10.000 MAU, Pro $29/tháng](https://www.hanko.io/pricing),
  tự host được.
- Pocket ID: OIDC provider BSD-2-Clause, "only supports passkey authentication"
  ([GitHub](https://github.com/pocket-id/pocket-id)).

Người chơi cầm điện thoại tham gia qua link mời; nếu bắt passkey ngay từ đầu thì ma sát quá cao. Passkey nên là một tuỳ
chọn bên trong Better Auth, không phải toàn bộ hệ thống đăng nhập.

## Khuyến nghị cho InconsisTable

1. **Better Auth, nhúng trong `apps/api`, dùng chung Postgres 18 qua Drizzle.**
   - User, session và account là các bảng trong DB của dự án. Đúng quy tắc dữ liệu (cột và bảng, không phải vendor),
     không có webhook đồng bộ, không mất phí, tự host trên LAN hay VPS đều được.
   - Socket.IO và REST cùng đọc một session trong một tiến trình (`auth.api.getSession({ headers })`). Nếu sau này
     web cần tự kiểm tra session thì dùng JWKS của plugin JWT.
   - Nâng user ẩn danh: dự án đã có `app_user` và `device`. Có hai cách:
     - (a) Giữ `it_device` như hiện tại và thêm liên kết `app_user` với Better Auth user khi thiết bị đăng nhập lần
       đầu. Không phải chuyển dữ liệu nào.
     - (b) Dùng plugin anonymous. Khi đó `onLinkAccount` phải chuyển seat, nhân vật và quyền sở hữu sang user mới, có
       thể tận dụng luồng ownership transfer đã có trong `auth/`.

     Cách (a) nhỏ hơn và giữ nguyên `canInCampaign`.
   - Đăng nhập: email OTP hoặc magic link cho GM, passkey là tuỳ chọn, social login khi nào cần thì thêm.
   - Plugin admin hoặc role có thể thay `ADMIN_KEY` khi lên host công khai.
   - Rủi ro: gói NestJS là gói cộng đồng; có thể mount handler trực tiếp thay vì dùng gói này. Tương lai của dự án sau
     khi về Vercel vẫn cần theo dõi, nhưng giấy phép MIT và dữ liệu trong DB của dự án làm rủi ro này nhỏ.
2. **Supabase Auth (tự host `supabase/auth`).** Chọn nếu muốn một IdP tách hẳn ra, có sẵn user ẩn danh và linking giữ
   nguyên user, và chấp nhận vận hành thêm một server Go và JWT riêng.
3. **WorkOS AuthKit.** Chọn nếu ưu tiên không tự vận hành auth khi đưa lên host công khai, vì 1 triệu MAU miễn phí là
   rất rộng. Đổi lại, user nằm ở vendor và nhóm đã từng bỏ hướng đi này với Clerk.

Điều có thể làm đổi lựa chọn:

- Cần SSO cho nhiều app (ví dụ thêm `inconsistable-content` có giao diện web riêng): Better Auth tự làm IdP bằng
  `@better-auth/oauth-provider`. Chỉ khi cần các giao thức nó không có (LDAP, RADIUS, proxy auth cho homelab) mới đáng
  thêm Authentik, Keycloak, Logto hoặc Zitadel.
- Better Auth đổi giấy phép hoặc ngừng hỗ trợ dùng ngoài Vercel: khi đó chuyển sang Supabase Auth tự host.
- Chỉ cần passkey cho GM và admin trên mạng homelab: Pocket ID đứng trước proxy là đủ.

## Nguồn

Ngày đọc của mọi nguồn là 2026-10-19.

- Better Auth: [GitHub](https://github.com/better-auth/better-auth), [releases](https://github.com/better-auth/better-auth/releases),
  [anonymous](https://www.better-auth.com/docs/plugins/anonymous), [JWT](https://www.better-auth.com/docs/plugins/jwt),
  [Drizzle](https://www.better-auth.com/docs/adapters/drizzle), [Next.js](https://www.better-auth.com/docs/integrations/next),
  [NestJS](https://www.better-auth.com/docs/integrations/nestjs), [cài đặt](https://www.better-auth.com/docs/installation),
  [passkey](https://www.better-auth.com/docs/plugins/passkey), [email OTP](https://www.better-auth.com/docs/plugins/email-otp),
  [magic link](https://www.better-auth.com/docs/plugins/magic-link),
  [gia nhập Vercel](https://better-auth.com/blog/better-auth-joins-vercel)
- Auth.js: [blog Better Auth](https://www.better-auth.com/blog/authjs-joins-better-auth),
  [discussion #13252](https://github.com/nextauthjs/next-auth/discussions/13252),
  [releases](https://github.com/nextauthjs/next-auth/releases)
- Lucia: [lucia-auth.com](https://lucia-auth.com/)
- Supabase: [pricing](https://supabase.com/pricing), [anonymous](https://supabase.com/docs/guides/auth/auth-anonymous),
  [supabase/auth](https://github.com/supabase/auth)
- Clerk: [pricing](https://clerk.com/pricing), [manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification)
- WorkOS: [pricing](https://workos.com/pricing). Auth0: [pricing](https://auth0.com/pricing)
- Firebase: [pricing](https://firebase.google.com/pricing), [anonymous auth](https://firebase.google.com/docs/auth/web/anonymous-auth)
- Stytch: [pricing](https://stytch.com/pricing), [changelog](https://stytch.com/docs/resources/changelog)
- Kinde: [pricing](https://kinde.com/pricing/). Descope: [pricing](https://www.descope.com/pricing)
- Logto: [GitHub](https://github.com/logto-io/logto), [pricing](https://logto.io/pricing)
- SuperTokens: [pricing](https://supertokens.com/pricing), [supertokens-core](https://github.com/supertokens/supertokens-core)
- Keycloak: [keycloak.org](https://www.keycloak.org/), [GitHub](https://github.com/keycloak/keycloak)
- Zitadel: [pricing](https://zitadel.com/pricing), [GitHub](https://github.com/zitadel/zitadel)
- Ory: [pricing](https://www.ory.com/pricing), [Kratos](https://github.com/ory/kratos)
- Authentik: [GitHub](https://github.com/goauthentik/authentik)
- Hanko: [pricing](https://www.hanko.io/pricing), [GitHub](https://github.com/teamhanko/hanko)
- Pocket ID: [GitHub](https://github.com/pocket-id/pocket-id)
- Phiên bản npm: `https://registry.npmjs.org/<gói>` cho next-auth, better-auth, @clerk/nextjs, @supabase/auth-js,
  @stytch/nextjs, firebase, @logto/next, supertokens-node, @kinde-oss/kinde-auth-nextjs, @descope/nextjs-sdk,
  @workos-inc/authkit-nextjs, @teamhanko/hanko-elements, @ory/client, lucia, @auth0/nextjs-auth0
- License, sao, lần push và bản phát hành mới nhất: GitHub REST API (`/repos/{owner}/{repo}` và `/releases/latest`)
