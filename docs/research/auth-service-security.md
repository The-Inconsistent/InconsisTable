# Làm cứng bảo mật cho service xác thực và phân quyền (đọc ngày 2026-10-25)

Câu hỏi: làm sao bảo đảm an toàn cho service xác thực (authentication) và phân quyền (authorization) mà dự án đã quyết
định dựng? Đây là ghi chú làm cứng (hardening) và mô hình mối đe doạ cho một thiết kế **đã chốt**, không đánh giá lại
thiết kế.

Bối cảnh:

- Thiết kế đã chốt nằm ở [ADR 0005](../adr/0005-separate-oidc-idp.md), house decision #33–#35
  (`docs/house-decisions.md`) và mục Identity của `CONTEXT.md`. Nền tảng nằm ở [`self-built-auth.md`](self-built-auth.md)
  (§2–6, §8) và [`auth-providers.md`](auth-providers.md). Ghi chú này không nhắc lại hai file đó, chỉ đi sâu phần bảo mật.
- **Cập nhật topology từ chủ dự án (2026-10-25):** IdP không còn là `apps/auth` trong monorepo này. Nó là một service
  riêng, **repo git riêng, giao diện riêng**: trang đăng nhập, đăng ký passkey, mã khôi phục và quản lý tài khoản đều do
  IdP phục vụ ở `auth.<domain>`. InconsisTable (api + web) chỉ là **một client**. Mọi quyết định khác giữ nguyên:
  `oidc-provider` 9.x trên Node LTS, database `it_auth` với role riêng trên cùng server Postgres 18, api là confidential
  client và tự cấp session mờ (30 ngày idle, 90 ngày tối đa; admin 1 giờ idle, 24 giờ tối đa), back-channel logout kick
  socket, token chỉ mang vai trò platform (`admin`, `creator`), passkey + 10 mã khôi phục, không email, admin đầu tiên
  cấp bằng CLI, admin phải dùng passkey có user verification và không bao giờ dùng mã khôi phục, client tĩnh và bỏ
  consent cho client của mình, tài khoản chỉ có trên HTTPS (Caddy), HTTP LAN vẫn ẩn danh.
- Code hiện có đã đọc: `packages/auth/src/`, `apps/web/proxy.ts`, `apps/api/src/auth/`, `apps/api/src/core/`
  (`rate-limit.ts`, `env.ts`, `db.ts`), `apps/api/src/table/table.gateway.ts`, `canInCampaign` trong
  `packages/core-schema/src/permissions.ts`, `docs/deploy.md`, `deploy/compose.yaml`, `deploy/api.Containerfile`.
- Phiên bản và mặc định của thư viện được kiểm trên **source của đúng tag**, không theo trí nhớ: `oidc-provider` 9.13.0
  (2026-10-22), `@simplewebauthn/server` 14.0.3 (2026-09-25), `jose` 6.2.13 (2026-10-20), `openid-client` 6.8.8
  (2026-09-05), `oauth4webapi` 3.8.8 (npm registry và GitHub, đọc ngày 2026-10-25). Mọi nguồn đọc ngày 2026-10-25 trừ
  khi ghi khác. "(thứ cấp)" đánh dấu nguồn không phải chủ sở hữu thông tin. "(đề xuất)" đánh dấu con số của người viết,
  không có trong nguồn. "(ước tính)" đánh dấu công sức.

## Tóm tắt: 10 việc bắt buộc trước khi bật tài khoản

1. **Tách quyền Postgres thật sự.** `deploy/compose.yaml` hiện cho api chạy bằng `POSTGRES_USER`, mà image chính thức
   tạo user này "with superuser power" ([Docker Hub postgres](https://hub.docker.com/_/postgres)). Superuser đọc được
   `it_auth`, nên "role riêng" sẽ vô nghĩa. Mỗi service một role thường (không `SUPERUSER`, `CREATEROLE`, `CREATEDB`),
   `REVOKE CONNECT, TEMPORARY ON DATABASE it_auth FROM PUBLIC` vì PUBLIC mặc định có hai quyền này
   ([Postgres 18 §5.8](https://www.postgresql.org/docs/18/ddl-priv.html)), và `pg_hba.conf` chỉ cho mỗi role vào đúng
   database của nó bằng `scram-sha-256` (mục 10).
2. **Cấu hình `oidc-provider` theo kiểu fail-closed và kiểm khi khởi động.** Mặc định của 9.13.0 **không an toàn cho
   production**: `devInteractions` bật (nhận mọi username và mật khẩu), thiếu `jwks` thì dùng khoá dev công khai kèm một
   dòng cảnh báo, `pkce.required` chỉ bắt PKCE cho public client, `responseTypes` có cả `id_token`, `dPoP` và
   `pushedAuthorizationRequests` bật sẵn, `renderError` tải Google Fonts
   ([defaults.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/defaults.js),
   [initialize_keystore.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/initialize_keystore.js)).
   Cấu hình ở mục 3, cùng một test khởi động làm IdP từ chối chạy khi sai.
3. **Client `private_key_jwt`, chỉ `code`, không refresh token.** Api chỉ cần ID token lúc callback, vì nó tự cấp session
   của mình. Không xin `offline_access`, không giữ access token, nên không có token nào để trộm hay xoay vòng. Xác thực
   client bằng khoá bất đối xứng theo khuyến nghị của [RFC 9700 §2.5](https://www.rfc-editor.org/rfc/rfc9700.html):
   IdP chỉ giữ khoá công khai của client.
4. **Callback của api kiểm đủ:** `state` + `nonce` + PKCE S256 gắn với trình duyệt bằng cookie `__Host-`, `iss` trong
   response ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html)), ID token theo
   [OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), và chỉ dùng mỗi giao
   dịch một lần (mục 7).
5. **Chặn "gắn sẵn" khi nâng thiết bị ẩn danh lên tài khoản.** Khi tài khoản gắn vào user ẩn danh U, mọi cookie
   `it_device` khác của U phải mất hiệu lực và trình duyệt nhận một session mới. Nếu không, ai đang giữ secret thiết bị
   của U (máy dùng chung, cookie bị "ném" từ subdomain anh em) sẽ thành chủ tài khoản (mục 7.3).
6. **Passkey:** RP ID là đúng host của IdP, luôn truyền `expectedOrigin` **và** `expectedRPID` (thư viện để
   `expectedRPID` là tuỳ chọn và bỏ qua kiểm nếu thiếu), `userVerification: 'required'` ở cả hai đầu, credential ID là
   duy nhất, `@simplewebauthn/server` ≥ 14.0.3 vì có hai advisory sửa ở 14.0.2 (mục 5).
7. **Mã khôi phục 128 bit, băm, dùng một lần.** Đăng nhập bằng mã buộc đăng ký passkey mới, cấp lại bộ mã mới, đăng xuất
   mọi nơi và hiện thông báo trong app. Admin không có đường này. Cấp lại mã "gặp trực tiếp" thành một vé đăng ký dùng
   một lần, có audit (mục 6).
8. **Admin step-up có kiểm:** nâng quyền admin là một lượt xác thực mới với `max_age=0` và `acr` của passkey có UV. Api
   kiểm `acr` và `auth_time` (ASVS 6.8.4, 10.3.4). Đổi vai trò ở IdP phát back-channel logout. Tắt `ADMIN_KEY` trên bản
   HTTPS (mục 8).
9. **Giao diện IdP:** CSP nonce theo từng response, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`,
   Trusted Types, không script hay font bên thứ ba, ghi đè mọi trang mặc định của thư viện (mục 4).
10. **Repo IdP có kỷ luật riêng:** ruleset cho nhánh chính, action pin theo SHA, attestation cho image, deploy theo
    digest, Renovate với `minimumReleaseAge`, theo dõi advisory của `oidc-provider`/`jose`/`@simplewebauthn`, test hợp
    đồng client chạy trong CI của cả hai repo (mục 2, 13). Thư viện tự nói DoS và rate limit là việc của app
    ([SECURITY.md](https://github.com/panva/node-oidc-provider/blob/v9.13.0/SECURITY.md)), nên giới hạn tần suất phải nằm
    trong IdP (mục 11).

Thêm một phát hiện cần house decision: **Node 22 hết hỗ trợ ngày 2027-04-30**, tức sáu tháng nữa. Node 24 là LTS tới
2028-04-30, còn Node 26 lên LTS ngày 2026-10-28 ([lịch phát hành](https://github.com/nodejs/Release/blob/main/schedule.json)).
Cảnh báo runtime của `oidc-provider` ghi "Node.js v22.x LTS, or a later LTS release", nên house decision #34 nên đổi
thành "Node LTS đang được hỗ trợ, hiện là 24". Repo riêng làm việc nâng runtime rẻ hơn (mục 13).

## 1. Mô hình mối đe doạ

### 1.1 Topology và ranh giới tin cậy

```
                     Internet (TLS)                               mạng nội bộ của host
┌──────────┐   ┌───────────────────────────────┐   ┌─────────────────────────────────────────┐
│ Trình    │──▶│ Caddy: TLS, HSTS, header,     │──▶│ web (Next.js, :3000) ──rewrite──▶ api   │
│ duyệt    │   │ X-Forwarded-*                 │   │ (Bun, NestJS, Socket.IO) ── it ──▶ PG18 │
│ GM/admin │   │  <domain>      → web          │   │                                         │
│ người    │   │  auth.<domain> → IdP          │──▶│ IdP (Node LTS, oidc-provider, Koa)       │
│ chơi     │   │  app2.<domain> → app thứ hai  │   │   UI riêng ── it_auth ──▶ PG18 (cùng    │
└──────────┘   └───────────────────────────────┘   │   server, database và role khác)         │
                                                   └─────────────────────────────────────────┘
  Kênh back-channel: api ──token endpoint (private_key_jwt)──▶ IdP; IdP ──logout token──▶ api
```

| # | Ranh giới | Bên kém tin | Bên được bảo vệ | Điều kiện để ranh giới có ý nghĩa |
|---|---|---|---|---|
| B1 | Internet → Caddy | Mọi client | Mọi service | Chỉ Caddy mở cổng công khai; web, api, IdP, Postgres không bind ra ngoài |
| B2 | Caddy → IdP và Caddy → web | Header do client gửi | Quyết định theo IP, scheme | Caddy bỏ `X-Forwarded-*` từ client ([docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)); IdP và web chỉ nhận kết nối từ Caddy |
| B3 | Trình duyệt → trang của IdP | Script, frame, form lạ | Passkey ceremony, mã khôi phục, session của OP | CSP, `frame-ancestors`, cookie của OP, CSRF ở route interaction |
| B4 | IdP ↔ api (back-channel) | Mạng | Code, ID token, logout token | TLS, `private_key_jwt`, chữ ký ES256, `typ`, `jti` |
| B5 | Api → Postgres `it` / IdP → Postgres `it_auth` | Service kia, kẻ đọc được DB | Credential, session, dữ liệu game | Role riêng, không superuser, `REVOKE` PUBLIC, `pg_hba`, hash mọi secret |
| B6 | Repo IdP ↔ repo InconsisTable | Người có quyền ghi repo kia | Khoá ký, secret CI, cấu hình client | Secret CI không dùng chung; client đăng ký bằng PR có review ở repo IdP |
| B7 | `<domain>` ↔ `auth.<domain>` ↔ `app2.<domain>` | Subdomain anh em bị chiếm | Cookie, CSRF | Cùng site nên `SameSite` không chặn; dùng `__Host-` và `Sec-Fetch-Site: same-origin` ([RFC 10017 §6.1.3.3.1](https://www.rfc-editor.org/rfc/rfc10017.html)) |

### 1.2 Tài sản

| Tài sản | Nằm ở | Lộ thì sao |
|---|---|---|
| Khoá ký của IdP (ES256) | File secret của IdP | Giả ID token và logout token (xem mục 12.3 về phạm vi thật sự) |
| Khoá `private_key_jwt` của api | File secret của api | Đóng vai api ở token endpoint; vẫn cần code cộng PKCE verifier |
| Cookie keys của OP (keygrip) | Secret của IdP | Giả chữ ký cookie của OP; session id vẫn phải đúng |
| Session của OP, grant, interaction | `it_auth` | Chiếm SSO nếu id lưu dạng thô (mục 10.2) |
| Khoá công khai passkey, `signCount`, cờ BE/BS | `it_auth` | Không dùng để đăng nhập được; lộ quan hệ user–thiết bị |
| Hash mã khôi phục | `it_auth` | 128 bit nên không đảo được (mục 6) |
| Session mờ của api (`__Host-it_session`) | Cookie trình duyệt; hash ở `it` | Chiếm session tới khi hết hạn hoặc bị thu hồi |
| Vai trò `admin` | IdP (nguồn), api (bản sao theo session) | Toàn quyền mọi phòng (`canInCampaign` trả `true` cho seat admin) |
| `ADMIN_KEY` | Env của api | Như trên, không cần passkey; phải tắt trên HTTPS |
| Secret CI, quyền publish image | GitHub của repo IdP | Đẩy image độc vào deploy |

### 1.3 Các mối đe doạ chính (STRIDE)

| Mối đe doạ | STRIDE | Nơi | Chặn bằng | Mục | ASVS |
|---|---|---|---|---|---|
| Chiếm tài khoản bằng phishing | S | Trình duyệt | Passkey ràng buộc RP ID và origin; không có mật khẩu, không email | 5 | 6.3.3 |
| Chiếm tài khoản qua mã khôi phục | S | IdP | 128 bit, băm, rate limit, buộc passkey mới, thông báo | 6, 11 | 6.5.1–6.5.2 |
| Trộm session của api | S, I | Trình duyệt | `__Host-`, HttpOnly, Secure, không có token trong JS, thu hồi tức thì, kick socket | 7.4 | 7.2.x, 3.3.x |
| Phát lại code hoặc token | S | IdP, api | Code dùng một lần 60 giây, PKCE, `nonce`, `jti` của logout token | 3, 7 | 10.4.2–10.4.3, 10.5.1 |
| Mix-up | S | api | Một IdP; vẫn kiểm `iss` theo RFC 9207 | 7.2 | 10.2.2 |
| Open redirect | T | IdP, api | Redirect URI khớp chính xác; `return_to` của api chỉ là path tương đối | 3, 7.1 | 10.4.1 |
| CSRF, login CSRF | T | api, IdP | `state` gắn cookie, PKCE, Fetch Metadata, CSRF ở interaction | 4.3, 7.5 | 10.1.2, 10.2.1, 3.5.x |
| XSS trên trang đăng nhập | T, E | IdP | CSP nonce + `strict-dynamic`, Trusted Types, không bên thứ ba | 4 | 3.4.3 |
| Clickjacking trang consent hay passkey | T | IdP | `frame-ancestors 'none'` | 4 | 3.4.6 |
| Nâng quyền admin | E | IdP, api | Cấp bằng CLI hoặc admin khác có step-up; step-up kiểm `acr`/`auth_time`; đổi vai trò thì logout | 8 | 8.2.1, 6.8.4 |
| Gắn sẵn khi nâng thiết bị ẩn danh, fixation | S, E | api | Thu hồi mọi `device` của U, cấp session mới, xác nhận trên UI | 7.3 | 7.2.4 |
| Giả back-channel logout | S, D | api | Chữ ký, `typ: logout+jwt`, `events`, không `nonce`, `exp` ≤ 2 phút, cache `jti` | 7.6 | 10.5.5 |
| Chiếm socket | S | api | Handshake đọc session; room theo session; kiểm hạn ở mỗi action; `Origin` | 7.7 | 7.4.1 |
| Người trong cuộc, lộ DB | I | Postgres | Role tách, hash id và secret, mã hoá đĩa và backup | 10 | 13.3.2, 14.x |
| Chuỗi cung ứng | T, E | Cả hai repo | Lockfile đóng băng, không chạy script cài đặt, provenance, tuổi tối thiểu của bản phát hành | 13 | 15.1.x, 15.2.x |
| Lộ khoá | I | IdP, api | File secret, xoay vòng, playbook | 9, 12 | 13.3.x |
| DoS vào IdP | D | IdP | Rate limit ở app, giới hạn interaction, Caddy timeout | 11 | 15.2.2 |
| Đăng xuất cưỡng bức | D | IdP | Trang xác nhận đăng xuất | 7.6 | 10.6.2 |

## 2. IdP ở repo riêng: lợi ích và nghĩa vụ

### 2.1 Lợi ích bảo mật

- **Bán kính nổ nhỏ hơn.** Khoá ký, cookie keys và bảng credential không bao giờ nằm trong CI, image hay môi trường dev
  của InconsisTable. Một lỗ ở code game hoặc một dependency của Next.js không chạm tới process giữ khoá.
- **Ít người có quyền ghi hơn.** Repo IdP có danh sách người được merge và deploy riêng
  ([ASVS 13.3.2](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x22-V13-Configuration.md), least privilege cho secret).
- **Cây dependency nhỏ.** `oidc-provider` chỉ phụ thuộc trực tiếp `koa`, `jose`, `debug`; cộng `@simplewebauthn/server`
  và driver Postgres. Dễ đọc lockfile, dễ lập SBOM
  ([ASVS 15.1.2](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md)).
- **Nhịp phát hành riêng.** Vá advisory của IdP không phải chờ một bản phát hành của game, và ngược lại.
- **Runtime riêng.** IdP chạy Node LTS mà không làm lệch quy tắc Bun của monorepo (house decision #34).

### 2.2 Nghĩa vụ (checklist cho repo IdP)

- [ ] Nhánh chính có [ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets):
  bắt PR, ít nhất một review, status check xanh, cấm force push và xoá nhánh, `CODEOWNERS` cho `src/config/`,
  `clients/` và workflow.
- [ ] Secret scanning và push protection bật. Không có secret nào trong repo; `.env*` nằm trong `.gitignore`.
- [ ] GitHub Actions: `permissions: contents: read` mặc định, action pin theo commit SHA, không dùng `pull_request_target`
  kèm checkout code của PR, secret deploy chỉ có ở môi trường `production` có reviewer bắt buộc.
- [ ] Image build trong CI, có [artifact attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)
  (SLSA provenance) và SBOM. Deploy kéo image **theo digest** và kiểm attestation trước khi chạy (`gh attestation verify`).
- [ ] Phiên bản theo semver, mỗi bản có tag và changelog ghi rõ thay đổi hợp đồng client (mục 2.3). Rollback là deploy
  lại digest trước; migration của `it_auth` phải tiến được và lùi được trong một bản.
- [ ] Renovate hoặc [Dependabot security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates)
  bật; watch "Security advisories" của `panva/node-oidc-provider`, `panva/jose`, `panva/openid-client`,
  `MasterKale/SimpleWebAuthn` và `koajs/koa`. Thời hạn vá được ghi trong tài liệu (ASVS 15.1.1, L1): đề xuất 72 giờ cho
  critical và high của bốn gói này, 30 ngày cho phần còn lại (đề xuất).
- [ ] `SECURITY.md` riêng: kênh báo lỗi, phạm vi, ai trực.
- [ ] Test conformance và test âm chạy trong CI (mục 14).

### 2.3 Hợp đồng client

IdP công bố một file hợp đồng có phiên bản (ví dụ `docs/client-contract.md` ở repo IdP), và mỗi client ghi rõ nó cần
phiên bản nào. Nội dung tối thiểu:

| Mục | Giá trị cam kết | Đổi là breaking? |
|---|---|---|
| Issuer | `https://auth.<domain>` (không có path) | Có: `iss` đổi thì mọi liên kết (`iss`, `sub`) mất |
| `sub` | Chuỗi mờ, không tái sử dụng, không gán lại cho người khác (ASVS 10.5.2) | Có |
| Scope | `openid`, `roles` | Thêm scope mới: không. Bỏ: có |
| Claim trong ID token | `sub`, `sid`, `auth_time`, `acr`, `amr`, `roles` (mảng thuộc `admin`, `creator`) | Thêm giá trị vai trò mới: client phải bỏ qua giá trị lạ |
| `acr` | `urn:inconsistable:acr:passkey-uv`, `urn:inconsistable:acr:recovery` (đề xuất) | Có |
| Thuật toán | ES256 cho ID token và logout token; client ký `private_key_jwt` bằng ES256 | Có |
| Response type, mode | `code`, `query`; `iss` luôn có trong response | Có |
| PKCE | Bắt buộc, chỉ S256 | Có |
| Back-channel logout | `typ: logout+jwt`, `exp` 120 giây, có `jti`, `sid` khi client yêu cầu | Có |
| TTL | Code 60 giây, ID token 5 phút, session của OP (mục 3) | Rút ngắn: không |
| Discovery | `/.well-known/openid-configuration`, JWKS có ít nhất một khoá kế tiếp khi đang xoay | Không |

**Tương thích với InconsisTable.**

- Smoke test của InconsisTable (`apps/api/test/smoke.test.ts`) dựng IdP từ một image đã pin theo digest, đăng ký client
  thử và chạy luồng đầu cuối. Nâng phiên bản IdP là một PR đổi digest ở repo này.
- CI của repo IdP chạy một bộ "test hợp đồng" với một client giả: kiểm discovery, claim, thuật toán, `iss`, logout token.
  Đổi một mục breaking trong bảng trên thì test đỏ, buộc tăng major.
- Api đọc discovery khi khởi động và từ chối chạy nếu thiếu `authorization_response_iss_parameter_supported: true`, nếu
  `id_token_signing_alg_values_supported` không có ES256, hoặc nếu `issuer` khác cấu hình
  ([ASVS 10.5.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md)).

### 2.4 Đăng ký client (InconsisTable và app thứ hai)

- **Tĩnh, qua PR.** Mỗi client là một file trong repo IdP (ví dụ `clients/inconsistable.ts`), có review của
  `CODEOWNERS`. Không bật dynamic registration (`features.registration` mặc định đã tắt). ASVS 10.4.7 vì thế không áp
  dụng. Option `clients` của thư viện là danh sách tĩnh; muốn chắc không có client động thì `Client.find` của adapter
  luôn trả `undefined` ([defaults.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/defaults.js),
  mục `clients`).
- **Metadata chung cho mọi client của mình:** `token_endpoint_auth_method: 'private_key_jwt'`,
  `token_endpoint_auth_signing_alg: 'ES256'`, `jwks` (chỉ khoá công khai, hai khoá khi đang xoay),
  `grant_types: ['authorization_code']`, `response_types: ['code']`, `id_token_signed_response_alg: 'ES256'`,
  `scope: 'openid roles'`, `redirect_uris` và `post_logout_redirect_uris` là URL đầy đủ, mỗi môi trường một bộ,
  `backchannel_logout_uri`, `backchannel_logout_session_required: true`, và một cờ riêng `first_party: true` (qua
  `extraClientMetadata`) để bỏ consent.
- **InconsisTable:** `redirect_uris: ['https://<domain>/api/auth/callback']`,
  `backchannel_logout_uri: 'https://<domain>/api/auth/backchannel-logout'`. Cả hai đi qua rewrite `/api` của web tới api,
  nên api không cần mở cổng. Api dựng URL từ cấu hình, không bao giờ từ header `Host`.
- **App thứ hai:** cũng là confidential client theo mẫu BFF ([RFC 10017 §6.1](https://www.rfc-editor.org/rfc/rfc10017.html)).
  Nếu nó là SPA thuần thì vẫn phải có một backend nhỏ giữ token. Không đăng ký client `none`, để `clientAuthMethods` chỉ
  còn `private_key_jwt` và không cần đến các nhánh public client (rotation bắt buộc, DPoP).
- **Bỏ consent có điều kiện.** ASVS 10.7.1 (L2) cho phép bỏ hỏi khi danh tính client được bảo đảm; `private_key_jwt` và
  đăng ký tĩnh qua review là bảo đảm đó. Client nào không có `first_party: true` thì luôn hỏi consent. Đăng nhập vào app
  thứ hai phải do người dùng bấm "Đăng nhập", không gửi `prompt=none` tự động lúc tải trang
  ([ASVS 7.6.2](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md), L2).

## 3. Cấu hình `oidc-provider` 9.13.0

### 3.1 Mặc định đã kiểm và giá trị chọn

| Option | Mặc định 9.13.0 (source) | Chọn | Lý do |
|---|---|---|---|
| `features.devInteractions` | `enabled: true` | `false` | Nhận mọi username và mật khẩu; docs ghi MUST tắt |
| `jwks` | `undefined` → khoá dev công khai, chỉ cảnh báo | Bắt buộc, test khởi động từ chối nếu thiếu | [initialize_keystore.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/initialize_keystore.js) |
| `adapter` | Bộ nhớ | Adapter Postgres tự viết, hash id (mục 10.2) | Mất hết khi restart; SECURITY.md coi adapter là code của mình |
| `pkce.required` | Chỉ public client và FAPI 2.0 | `() => true` | RFC 9700 §2.1.1; ASVS 10.4.6 |
| PKCE method | Chỉ S256: discovery khai `code_challenge_methods_supported: ['S256']` và `pkce.js` chỉ có nhánh S256 | S256 | RFC 7636 §4.2; ASVS 10.4.6 cấm `plain` |
| `responseTypes` | `['code id_token', 'code', 'id_token', 'none']` | `['code']` | ASVS 10.4.4, 10.6.1 |
| `clientAuthMethods` | `client_secret_basic`, `client_secret_jwt`, `client_secret_post`, `private_key_jwt`, `none` | `['private_key_jwt']` | RFC 9700 §2.5; ASVS 10.4.16 |
| `enabledJWA.idTokenSigningAlgValues` | `RS256, PS256, ES256, Ed25519, EdDSA` | `['ES256']` | Một thuật toán, allowlist theo RFC 8725 §3.1 |
| `enabledJWA.clientAuthSigningAlgValues` | Danh sách dài, có HS256 | `['ES256']` | Không nhận HMAC bằng client secret |
| `clientDefaults.id_token_signed_response_alg` | `RS256` | `ES256` | Logout token cũng ký bằng thuật toán này ([id_token.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/models/id_token.js)) |
| `ttl.AuthorizationCode` | 60 giây | 60 giây | ASVS 10.4.3 (L3 đòi ≤ 1 phút); FAPI 2.0 cũng 60 giây |
| `ttl.IdToken` | 1 giờ | 300 giây | Chỉ dùng ngay ở callback |
| `ttl.AccessToken` | 1 giờ | 300 giây | Không client nào dùng; giữ ngắn |
| `ttl.Interaction` | 1 giờ | 600 giây | Đủ cho một lần đăng nhập; giảm số dòng tồn trong DB |
| `ttl.Session` | 14 ngày, gia hạn khi chạm | 14 ngày (giữ) | SSO cho app thứ hai; session của api độc lập (ASVS 7.6.1 phải ghi rõ) |
| `ttl.Grant` | 14 ngày | 14 ngày | Bằng session |
| `issueRefreshToken` | Chỉ khi có `offline_access` | `false` | Không client nào cần |
| `rotateRefreshToken` | Hàm: xoay khi qua 70% TTL, dừng sau 1 năm | `true` (phòng khi sau này bật refresh) | Dùng lại token đã tiêu thì thu hồi cả grant ([refresh_token.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/actions/grants/refresh_token.js)) |
| `scopes` | `openid`, `offline_access` | `['openid', 'roles']` | Không có `offline_access` |
| `claims` | `acr`, `sid`, `auth_time`, `iss`, `openid: ['sub']` | Thêm `amr: null`, `roles: ['roles']` | Vai trò platform trong ID token |
| `features.userinfo` | Bật | Tắt | Không client nào gọi; khi tắt, claim của scope vào thẳng ID token (`conformIdTokenClaims`) |
| `features.dPoP` | Bật | Tắt | Không có token rời khỏi server (mục 3.3) |
| `features.pushedAuthorizationRequests` | Bật, không bắt buộc | Bật và `requirePushedAuthorizationRequests: true` (lát cắt 2) | Mục 3.3 |
| `features.rpInitiatedLogout` | Bật, trang mặc định dùng Google Fonts | Bật, ghi đè `logoutSource` và `postLogoutSuccessSource` | Mục 4 |
| `features.backchannelLogout` | Tắt | Bật | ADR 0005 |
| `features.introspection`, `revocation`, `registration`, `clientCredentials`, `deviceFlow`, `ciba`, `requestObjects`, `claimsParameter`, `encryption` | Tắt | Giữ tắt | Bề mặt nhỏ nhất (ASVS 15.2.3) |
| `features.resourceIndicators` | Bật | Tắt | Không có resource server nhận access token |
| `clientBasedCORS` | Chỉ cho userinfo và client `none` | `() => false` | Không có lời gọi CORS hợp lệ nào; RFC 9700 §2.6 cấm CORS ở authorization endpoint |
| `allowOmittingSingleRegisteredRedirectUri` | `true` | `false` | Luôn gửi và luôn so khớp `redirect_uri` |
| `acceptQueryParamAccessTokens` | `false` | `false` | |
| `cookies.keys` | `[]`, và không còn cảnh báo khi thiếu ("no more warnings if cookie keys are missing", CHANGELOG); thiếu khoá thì Koa không ký cookie (suy luận) | Hai khoá 32 byte, xoay bằng cách thêm vào đầu | Chống sửa cookie; xoay giữ session ([defaults.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/defaults.js), `cookies.keys`) |
| `cookies.long` / `short` | `httpOnly: true`, `sameSite: 'lax'` | Giữ | Cookie `Secure` tự bật khi request là HTTPS, nên `proxy` phải đúng |
| `renderError` | HTML tối giản, `@import` Google Fonts | Ghi đè: trang riêng, thông báo chung, có mã sự cố | ASVS 16.5.1; không bên thứ ba |
| `provider.proxy` | `false` | `true`, cộng `provider.maxIpsCount = 1` | Docs "Trusting TLS offloading proxies"; `Provider extends Koa`, nên `maxIpsCount` của Koa áp dụng ([provider.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/provider.js), [Koa API](https://github.com/koajs/koa/blob/master/docs/api/index.md)) |

`iss` trong authorization response: thư viện luôn thêm `iss` khi response không chứa ID token và không dùng JARM, và
discovery báo `authorization_response_iss_parameter_supported: true`
([respond.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/actions/authorization/respond.js),
[discovery.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/actions/discovery.js)). Với `responseTypes:
['code']` thì điều kiện luôn đúng. Phía client, `oauth4webapi` (lõi của `openid-client`) báo lỗi khi metadata nói có hỗ
trợ mà response thiếu `iss` ([index.ts](https://github.com/panva/oauth4webapi/blob/v3.8.8/src/index.ts), `validateAuthResponse`).

Redirect URI: `redirectUriAllowed` so khớp chính xác chuỗi; chỉ client `native` được nới cổng loopback
([client.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/models/client.js)). Không đăng ký client
`native` nào, nên mọi redirect là khớp chính xác (RFC 9700 §4.1.3, ASVS 10.4.1).

### 3.2 Khung cấu hình (chưa chạy thử; tên option đã đối chiếu với source 9.13.0)

```js
// apps: repo IdP, src/provider.js. Node LTS. Mọi giá trị nhạy cảm đọc từ file secret, không từ env.
import Provider from "oidc-provider";
import { readSecretJson } from "./secrets.js"; // đọc /run/secrets/*, quyền 0400
import { PostgresAdapter } from "./adapter.js"; // hash mọi id trước khi lưu (mục 10.2)
import { clients } from "../clients/index.js"; // tĩnh, review qua CODEOWNERS
import { findAccount } from "./accounts.js";

const ISSUER = "https://auth.example.com"; // không path, không dấu / cuối

export const provider = new Provider(ISSUER, {
  adapter: PostgresAdapter,
  clients,
  findAccount, // trả claims(): { sub, roles } từ it_auth
  jwks: readSecretJson("op_jwks.json"), // ES256, khoá đầu tiên là khoá ký
  cookies: {
    keys: readSecretJson("op_cookie_keys.json"), // [mới, cũ]
    long: { httpOnly: true, sameSite: "lax" },
    short: { httpOnly: true, sameSite: "lax" },
  },
  pkce: { required: () => true },
  responseTypes: ["code"],
  clientAuthMethods: ["private_key_jwt"],
  enabledJWA: { idTokenSigningAlgValues: ["ES256"], clientAuthSigningAlgValues: ["ES256"] },
  clientDefaults: {
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "private_key_jwt",
    id_token_signed_response_alg: "ES256",
  },
  allowOmittingSingleRegisteredRedirectUri: false,
  clientBasedCORS: () => false,
  scopes: ["openid", "roles"],
  claims: { openid: ["sub"], roles: ["roles"], acr: null, amr: null, auth_time: null, sid: null },
  acrValues: ["urn:inconsistable:acr:passkey-uv", "urn:inconsistable:acr:recovery"],
  issueRefreshToken: async () => false,
  rotateRefreshToken: true,
  extraClientMetadata: { properties: ["first_party"] },
  ttl: {
    AuthorizationCode: 60,
    IdToken: 300,
    AccessToken: 300,
    Interaction: 600,
    Session: 14 * 24 * 3600,
    Grant: 14 * 24 * 3600,
  },
  features: {
    devInteractions: { enabled: false },
    userinfo: { enabled: false },
    dPoP: { enabled: false },
    resourceIndicators: { enabled: false },
    backchannelLogout: { enabled: true },
    rpInitiatedLogout: { enabled: true, logoutSource, postLogoutSuccessSource },
    pushedAuthorizationRequests: { enabled: true, requirePushedAuthorizationRequests: false }, // true ở lát cắt 2
  },
  interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
  loadExistingGrant, // tự cấp grant cho client first_party, xem 2.4
  renderError, // trang riêng, không chi tiết lỗi, có mã sự cố
});
provider.proxy = true; // chỉ đúng khi IdP chỉ nhận kết nối từ Caddy
provider.maxIpsCount = 1; // lấy đúng IP do Caddy ghi
```

**Test khởi động (fail-closed).** Một hàm `assertProductionConfig(provider)` chạy trước `listen` và ném lỗi khi: thiếu
`jwks` hoặc có `kid` trùng khoá dev; `cookies.keys` rỗng; `devInteractions` bật; `NODE_ENV !== 'production'`; issuer
không phải `https:`; có client với `token_endpoint_auth_method !== 'private_key_jwt'`, với `redirect_uris` không phải
`https:`, hoặc với `response_types` khác `['code']`. Mẫu này giống `assertAdminKey` hiện có (`apps/api/src/core/env.ts`).
Lý do: SECURITY.md của thư viện nói rõ cấu hình sai, adapter, khoá dev và `devInteractions` đều nằm ngoài phạm vi bảo
đảm của nó ([SECURITY.md](https://github.com/panva/node-oidc-provider/blob/v9.13.0/SECURITY.md), "What is NOT Considered
a Vulnerability").

### 3.3 PAR, JAR, DPoP, mTLS: có đáng không

| Cơ chế | Chống gì | Ở đây | Quyết định |
|---|---|---|---|
| PAR ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126.html)) | Tham số authorization bị sửa trên URL; client chưa xác thực trước khi user thấy trang | Client là backend, `openid-client` có sẵn PAR; chi phí là một lời gọi back-channel | **Nên, lát cắt 2.** Bật `require_pushed_authorization_requests` cho client của mình. ASVS 10.4.13 (L3), FAPI 2.0 §5.3.2.2 |
| JAR ([RFC 9101](https://www.rfc-editor.org/rfc/rfc9101.html)) | Như trên, bằng request object ký | PAR đã cho tính toàn vẹn qua kênh đã xác thực | **Không.** Thêm khoá và code mà không thêm gì khi đã có PAR |
| DPoP ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html)) | Dùng access hay refresh token bị trộm | Không có access hay refresh token rời khỏi server; api tự cấp session mờ | **Không.** Tắt feature cho bề mặt nhỏ hơn. RFC 9700 §2.2.1 chỉ là SHOULD; ASVS 10.3.5 và 10.4.14 là L3 |
| mTLS ([RFC 8705](https://www.rfc-editor.org/rfc/rfc8705.html)) | Như DPoP, và xác thực client | Cần CA và chứng chỉ client qua Caddy | **Không.** `private_key_jwt` đạt cùng mục tiêu xác thực client với ít hạ tầng hơn |

FAPI 2.0 Security Profile (Final, 2025-02-22) là thước đo tham khảo, không phải mục tiêu
([spec](https://openid.net/specs/fapi-security-profile-2_0-final.html)). Ta đạt các mục: PAR (lát cắt 2), PKCE S256,
`private_key_jwt`, code 60 giây, `iss` theo RFC 9207, ES256, không open redirect, không 307. Ta cố ý không đạt: token
sender-constrained (§5.3.2.1, không có token để ràng buộc).

## 4. Giao diện của IdP

Trang của IdP là nơi duy nhất người dùng làm ceremony passkey và nhập mã khôi phục, nên một XSS ở đây là chiếm tài
khoản. Quy tắc: server render, JS tối thiểu, không bên thứ ba.

### 4.1 Header cho mọi response của IdP

| Header | Giá trị | Ai đặt | Nguồn |
|---|---|---|---|
| `Content-Security-Policy` | Xem 4.2; nonce mới cho mỗi response | App (Koa middleware), vì Caddy không sinh nonce | [ASVS 3.4.3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x12-V3-Web-Frontend-Security.md) (L2; per-response nonce là L3) |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (preload để sau) | Caddy, directive [`header`](https://caddyserver.com/docs/caddyfile/directives/header) | ASVS 3.4.1 (L1) |
| `X-Content-Type-Options` | `nosniff` | Caddy | ASVS 3.4.4 |
| `Referrer-Policy` | `no-referrer` | Caddy | ASVS 3.4.5; URL interaction chứa `uid` |
| `Cache-Control` | `no-store` cho mọi trang interaction, trang mã khôi phục, trang tài khoản | App | ASVS 14.3.2; mã khôi phục không được nằm trong cache |
| `Cross-Origin-Opener-Policy` | `same-origin` | Caddy | Cô lập cửa sổ khỏi trang mở nó ([OWASP HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)) |
| `X-Frame-Options` | `DENY` | Caddy | Dự phòng cho trình duyệt cũ; RFC 9700 §4.16 |
| `Permissions-Policy` | `publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()` | Caddy | Chỉ chính origin gọi WebAuthn |
| `Server`, `X-Powered-By` | Bỏ | Caddy, Koa | ASVS 13.4.6 (L3) |

`includeSubDomains` ép HTTPS cho mọi subdomain của `auth.<domain>`; muốn phủ cả `<domain>` thì đặt ở host gốc. Caddy
không có trong danh sách giá trị HSTS mặc định đã đọc, nên đặt tường minh (chưa kiểm mặc định của Caddy).

### 4.2 CSP

```
default-src 'none';
script-src 'nonce-{N}' 'strict-dynamic';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src 'self';
form-action 'self';
frame-ancestors 'none';
base-uri 'none';
object-src 'none';
require-trusted-types-for 'script';
trusted-types 'none';
upgrade-insecure-requests
```

- Nonce + `strict-dynamic`, `object-src 'none'`, `base-uri 'none'` là "strict CSP" của
  [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html) và
  đúng mức tối thiểu ASVS 3.4.3 nêu tên. `frame-ancestors 'none'` là ASVS 3.4.6 và RFC 9700 §4.16 (AS MUST chống
  clickjacking, SHOULD dùng CSP).
- **Trusted Types:** API là "Baseline 2026" theo [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API)
  (chạy trên bản mới của các trình duyệt chính từ 2/2026). Code của IdP không dùng `innerHTML` nên `trusted-types 'none'`
  dùng được. Trình duyệt cũ bỏ qua directive và vẫn được CSP nonce bảo vệ.
- **JS tối thiểu:** một file `passkey.js` của chính IdP, bundle sẵn `@simplewebauthn/browser`, gọi
  `navigator.credentials.*` rồi POST kết quả. Không framework, không CDN, không inline handler (`onclick=`), không
  `eval`. Font tự host.
- **`form-action 'self'` và redirect:** trang interaction POST về IdP rồi nhận 303 sang `redirect_uri` của client. Có báo
  cáo (thứ cấp, chưa kiểm) rằng Chromium áp `form-action` cho cả redirect sau khi submit form; nếu đúng thì `'self'` sẽ
  chặn bước cuối. Phải chạy thử trên Chromium, Firefox và Safari; nếu bị chặn thì thêm đúng origin của các client đã
  đăng ký vào `form-action`, hoặc hoàn tất interaction bằng `fetch` rồi `location.assign` tới URL do server trả.
- Response mode `form_post` của thư viện tự thêm hash của script inline vào `script-src` khi có header CSP
  ([script_src_sha.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/script_src_sha.js)). Ta
  không dùng `form_post`, nhưng nếu sau này dùng thì CSP vẫn đúng.
- Ghi đè `renderError`, `logoutSource`, `postLogoutSuccessSource`: bản mặc định `@import` Google Fonts, sẽ bị CSP chặn và
  để lộ request ra bên thứ ba (ASVS 14.2.3).

### 4.3 Route interaction

- Mỗi route lấy trạng thái qua `provider.interactionDetails(req, res)`: thư viện gắn interaction với cookie `_interaction`
  ngắn hạn, nên `uid` trên URL không đủ để tiếp tục một interaction của người khác. Mọi POST còn phải qua kiểm
  `Sec-Fetch-Site: same-origin` (hoặc `Origin` đúng host IdP) như middleware ở `self-built-auth.md` §3.4.
- Kiểm `prompt.name` trước khi xử lý: route "login" không được hoàn tất một interaction đang ở prompt khác.
- Kết quả trả về `interactionFinished` chỉ chứa `accountId` đã xác minh ở server, `acr`, `amr`, `ts`; không lấy giá trị
  nào từ body của request.
- Thông báo lỗi chung cho người dùng, chi tiết chỉ vào log (ASVS 16.5.1).
- Đăng xuất: `logoutSource` hiện trang xác nhận có hai nút; không tự submit. Đây là cách chống đăng xuất cưỡng bức của
  ASVS 10.6.2 khi request không có `id_token_hint`.

## 5. Passkey (WebAuthn L3, `@simplewebauthn/server` 14.0.3)

### 5.1 Phiên bản và runtime

- 14.0.3 phát hành 2026-09-25, có provenance SLSA trên npm. `package.json` khai `node >= 20.0.0`, còn README hỗ trợ
  "Node LTS 22.x and higher" và Deno 2.4+ ([README](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/README.md)).
  Chạy trên Node LTS của IdP là đúng phạm vi hỗ trợ.
- Advisory ([GHSA](https://github.com/MasterKale/SimpleWebAuthn/security/advisories)): GHSA-j3h4-m3m2-7p7j (chứng chỉ
  attestation lạ làm server gửi HTTP request) và GHSA-2g3p-m8c9-hhwh (đăng ký bị từ chối làm bẩn cache CRL), cả hai ảnh
  hưởng 14.0.1 và đã sửa ở 14.0.2; GHSA-6hxq-p678-4hr2 (chuỗi chứng chỉ attestation) sửa ở 13.3.2. Cả ba nằm ở đường
  kiểm attestation. **Pin ≥ 14.0.3.**

### 5.2 Cấu hình

| Mục | Giá trị | Lý do và nguồn |
|---|---|---|
| RP ID | Đúng host `auth.<domain>`, không phải `<domain>` | Hẹp nhất: subdomain anh em không xin được assertion cho passkey này. Giá: đổi host IdP là mất passkey, trừ khi dùng Related Origins ([WebAuthn L3 §5.11](https://www.w3.org/TR/webauthn-3/#sctn-related-origins)) |
| `expectedOrigin` | `https://auth.<domain>` (một chuỗi) | So khớp chính xác ([verifyRegistrationResponse.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/registration/verifyRegistrationResponse.ts)) |
| `expectedRPID` | Luôn truyền | Thư viện để tuỳ chọn và chỉ kiểm hash RP ID khi có giá trị (cùng file) |
| `userVerification` khi sinh options | `'required'` | Mặc định là `'preferred'` ([generateRegistrationOptions.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/registration/generateRegistrationOptions.ts), [generateAuthenticationOptions.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/authentication/generateAuthenticationOptions.ts)) |
| `requireUserVerification` khi kiểm | `true` (mặc định, vẫn ghi tường minh) | Cả hai hàm verify mặc định `true` |
| `residentKey` | `'required'` | Đăng nhập không cần username: không có bề mặt dò tài khoản |
| `attestationType` | `'none'` | Không cần biết hãng thiết bị; cả ba advisory nằm ở đường attestation. NIST B.3 nói RP SHOULD dùng attestation khi có, đây là lệch có chủ ý vì riêng tư và đơn giản |
| `supportedAlgorithmIDs` | `[-8 (EdDSA), -7 (ES256)]`, bỏ RS256 | Mặc định có RS256 (-257); cùng giá trị ở options và verify |
| `timeout` | 120000 ms | Mặc định 60000; bàn chơi cần thêm thời gian |
| `user.id` | 32 byte ngẫu nhiên riêng cho mỗi tài khoản, không phải `sub`, không chứa dữ liệu cá nhân | |
| Credential ID | Unique trong DB, ≤ 1023 byte | WebAuthn L3 §7.1: SHOULD từ chối credential ID đã đăng ký cho bất kỳ user nào ([§7.1](https://www.w3.org/TR/webauthn-3/#sctn-registering-a-new-credential)) |

### 5.3 Challenge

- Sinh ở server, mỗi ceremony một challenge, lưu trong `it_auth` gắn với `uid` của interaction (hoặc với session của trang
  tài khoản), sống 120 giây, xoá ngay khi verify (thành công hay thất bại). WebAuthn L3 §13.4.3: challenge SHOULD dài ít
  nhất 16 byte ([§13.4.3](https://www.w3.org/TR/webauthn-3/#sctn-cryptographic-challenges)); độ dài mặc định của thư
  viện chưa đo, nên tự sinh 32 byte bằng `crypto.randomBytes` và truyền vào option `challenge`.
- Tối đa 5 challenge còn hạn mỗi interaction (đề xuất), để một trang không bơm dòng vào DB.

### 5.4 `signCount`, BE, BS

- Cờ trong authenticator data: bit 2 là UV, bit 3 là BE (backup eligible), bit 4 là BS (backup state)
  ([§6.1](https://www.w3.org/TR/webauthn-3/#sctn-authenticator-data)). Lưu `backupEligible` lúc đăng ký và `backupState`
  mới nhất, hiện trên trang "passkey của tôi" ("đồng bộ" hay "gắn với thiết bị").
- Không từ chối theo BS: NIST nói không SHOULD đặt điều kiện chấp nhận theo cờ này cho ứng dụng công cộng
  ([SP 800-63B-4 phụ lục B](https://pages.nist.gov/800-63-4/sp800-63b.html)). Có thể dùng BE cho chính sách admin (5.5).
- `signCount`: passkey đồng bộ thường báo 0. Khi số mới không lớn hơn số đã lưu (và một trong hai khác 0), WebAuthn coi
  đó là "a signal, but not proof" rằng authenticator bị nhân bản ([§7.2](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion)).
  `@simplewebauthn/server` ném lỗi trong trường hợp này. Với GM: ghi `auth_event`, cảnh báo, cho người dùng thấy trên
  trang tài khoản. Với admin: từ chối và cảnh báo.
- Credential đăng ký mà không có UV thì cờ UV về sau không được dùng làm yếu tố xác thực (`uvInitialized`, §4). Vì đăng
  ký luôn bắt UV nên điều này không xảy ra; vẫn lưu `uv_initialized` để kiểm.

### 5.5 Mức đảm bảo và chính sách admin

- Passkey có UV là authenticator mật mã đa yếu tố, đạt AAL2 ([SP 800-63B-4 §2.2.1, §3.1.7](https://pages.nist.gov/800-63-4/sp800-63b.html)),
  và đáp ứng ASVS 6.3.3 (L2: MFA để vào app). Đây là thay đổi so với `self-built-auth.md` §6, nơi L2 bị loại vì cần MFA
  cho mọi user: giờ chỉ GM và chủ phòng có tài khoản, và mọi tài khoản đăng nhập bằng passkey có UV.
- Passkey đồng bộ được chấp nhận ở AAL2 nhưng "SHALL NOT be used at AAL3" (§2.3.2). Không nhắm AAL3, nên chấp nhận.
- **Admin:** UV bắt buộc (đã chốt), cộng hai đề xuất: (a) đăng ký ít nhất hai passkey, vì admin không có mã khôi phục;
  (b) nên có ít nhất một khoá gắn thiết bị (BE = 0), ví dụ khoá bảo mật phần cứng. (b) là đề xuất, cần house decision
  nếu muốn bắt buộc.
- Mã khôi phục là lookup secret một yếu tố. Đường đăng nhập bằng mã là một "authentication pathway" phải ghi vào tài liệu
  (ASVS 6.1.3, 6.3.4, L2).

## 6. Mã khôi phục

### 6.1 Sinh, lưu, dùng

| Mục | Giá trị | Nguồn |
|---|---|---|
| Số lượng | 10 (đã chốt) | House decision #33 |
| Entropy | 128 bit mỗi mã, từ `crypto.randomBytes`; hiển thị base32 26 ký tự, chia nhóm | NIST §4.2: ≥ 64 bit; ASVS 6.5.2: ≥ 112 bit thì được băm nhanh |
| Lưu | `SHA-256(code)` làm khoá tra, `user_id`, `batch_id`, `used_at` | ASVS 6.5.2 (L2); NIST §4.2 "hashed form" |
| Dùng một lần | `UPDATE … SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING user_id` trong một câu, nên hai request đồng thời chỉ một bên thắng | ASVS 6.5.1 (L2) |
| Hiển thị | Một lần, trên trang của IdP, `Cache-Control: no-store`, nút in và tải file sinh ngay trong trình duyệt; không gửi lại được | ASVS 14.3.2 |
| Nhập | Bỏ khoảng trắng và gạch, chữ hoa; so khớp bằng tra hash (không so chuỗi) | |
| Trả lời khi sai | Một thông báo chung cho "không tồn tại", "đã dùng", "tài khoản admin" | Không lộ tài khoản (ASVS 6.3.8 là L3, rẻ nên vẫn làm) |

### 6.2 Đăng nhập bằng mã khôi phục buộc gì

1. Interaction không hoàn tất ngay. Người dùng **phải đăng ký một passkey mới** (UV) trước khi IdP gọi
   `interactionFinished`. NIST §4.2: sau khôi phục, người dùng gắn authenticator mới.
2. IdP vô hiệu **mọi mã còn lại** của bộ cũ và cấp bộ 10 mã mới, hiện một lần. NIST §4.2: sau khi dùng một saved
   recovery code, CSP SHALL vô hiệu mã đó và SHALL cấp mã mới.
3. IdP kết thúc mọi session OP khác của tài khoản và gửi back-channel logout tới mọi client. Nếu kẻ tấn công vừa khôi
   phục, chủ thật bị đăng xuất và nhận ra ngay; nếu chủ thật khôi phục, phiên trên thiết bị bị mất bị cắt.
4. `acr` của lần đăng nhập này là `urn:inconsistable:acr:recovery`. Api không cho nâng quyền hay thao tác nhạy cảm với
   `acr` này; người dùng phải đăng nhập lại bằng passkey mới.
5. **Thông báo:** NIST §4.2 nói "An account recovery event always causes one or more notifications" và §4.6 đòi ít nhất
   hai địa chỉ thông báo. Không có email thì không có kênh ngoài. Thay thế: banner trên trang tài khoản và trên app ở
   lần đăng nhập kế tiếp từ mọi thiết bị ("Mã khôi phục đã được dùng lúc … từ …"), cộng danh sách passkey có ngày thêm.
   **Đây là lệch NIST, cần ghi vào house decision.**
6. Mức đảm bảo: NIST §4.2 nói ở AAL2, một saved recovery code một mình không đủ để khôi phục (cần hai mã từ hai phương
   thức, hoặc mã cộng một authenticator một yếu tố). Thiết kế đã chốt chấp nhận một mã. **Lệch NIST thứ hai**, cũng ghi
   vào house decision cùng lý do: không có email, không có kênh thứ hai.

### 6.3 Admin cấp lại "gặp trực tiếp"

Đề xuất đổi nhẹ quyết định: admin không cấp mã, mà cấp **một vé đăng ký**. Như vậy admin không bao giờ thấy mã của người
khác.

1. Người cần cấp lại gặp admin trực tiếp. Admin xác minh bằng hiểu biết thực tế (người quen ở bàn chơi), không bằng câu
   hỏi bí mật (ASVS 6.4.2 cấm). ASVS 6.4.4 (L2) đòi kiểm danh tính khi mất yếu tố "at the same level as during
   enrollment"; lúc đăng ký không có kiểm danh tính nào, nên gặp mặt đã cao hơn mức đăng ký.
2. Admin step-up (passkey UV, `max_age` ≤ 5 phút), mở trang tài khoản người đó trên IdP, nhập lý do, bấm "Cấp vé".
3. IdP sinh vé 128 bit, dùng một lần, sống 15 phút (đề xuất), lưu hash, hiện dạng QR trên máy admin.
4. Người dùng quét bằng thiết bị của mình, đăng ký passkey mới, nhận bộ mã mới trên màn hình của mình. Bộ mã cũ bị vô
   hiệu; mọi session OP bị kết thúc và có back-channel logout. Passkey cũ giữ hay xoá do người dùng chọn trên trang tài
   khoản.
5. Audit: `admin_id`, `target_sub`, lý do, thời điểm, IP, kết quả dùng vé; không ghi vé. Admin không cấp vé cho chính
   mình. Nếu chỉ có một admin và admin mất passkey, đường thoát là CLI trên server (cũng ghi log), như cách cấp admin đầu
   tiên.

## 7. Phía client: api của InconsisTable

`openid-client` 6.8.8 trên Bun (đã chạy được, `self-built-auth.md` §2.6) với `private_key_jwt`.

### 7.1 Bắt đầu đăng nhập

- `POST /api/auth/login` (không phải GET, để link lạ không khởi động được luồng). Kiểm `Sec-Fetch-Site: same-origin`.
- Api sinh `state` (128 bit), `nonce` (128 bit), `code_verifier` (43–128 ký tự theo RFC 7636 §4.1; dùng hàm của
  `openid-client`), và một handle giao dịch 128 bit. Lưu một dòng `oidc_tx`: `handle_hash`, `state`, `nonce`,
  `code_verifier`, `device_user_id` (user ẩn danh lúc bắt đầu, có thể null), `purpose` (`signin` hay `admin_stepup`),
  `return_to`, `created_at`. Hạn 10 phút.
- Cookie `__Host-it_oidc_tx=<handle>`: `HttpOnly`, `Secure`, `Path=/`, `SameSite=Lax` (callback là điều hướng top-level
  từ `auth.<domain>`), `Max-Age=600`.
- `return_to` chỉ nhận path tương đối bắt đầu bằng một `/` đơn, không `//`, không `/\`, sau đó so với danh sách route
  của web (RFC 9700 §4.11.1: client không được thành open redirector).
- Lát cắt 2: gửi qua PAR rồi redirect với `request_uri`.

### 7.2 Callback (`GET /api/auth/callback`)

Thứ tự kiểm, dừng ở lỗi đầu tiên và trả một trang lỗi chung:

1. Đọc `__Host-it_oidc_tx`, `DELETE FROM oidc_tx WHERE handle_hash = $1 AND created_at > now() - interval '10 minutes'
   RETURNING *`. Không có dòng thì dừng: giao dịch là một lần, gắn với chính trình duyệt này (ASVS 10.1.2). Xoá cookie.
2. `state` trên URL bằng `state` đã lưu (`openid-client` kiểm khi truyền `expectedState`).
3. `iss` trên URL bằng issuer đã cấu hình (RFC 9207 §2.4; `oauth4webapi` bắt buộc khi discovery báo có hỗ trợ).
   Một IdP nên không có mix-up thật, nhưng kiểm này rẻ và thành bắt buộc khi có IdP thứ hai (ASVS 10.2.2).
4. Đổi code ở token endpoint với `code_verifier`, xác thực bằng `private_key_jwt` (ASVS 10.4.10).
5. ID token theo [OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation): chữ ký
   ES256 bằng JWKS của issuer (chỉ ES256, RFC 8725 §3.1), `iss` khớp chính xác, `aud` chứa `client_id` và nếu có nhiều
   `aud` thì `azp` bằng `client_id` (ASVS 10.5.4), `exp`, `iat` với độ lệch ≤ 30 giây, `nonce` bằng giá trị đã lưu
   (ASVS 10.5.1). `openid-client` làm các bước này; api thêm phần dưới.
6. `roles` được parse bằng zod theo tập đóng `PLATFORM_ROLES`; giá trị lạ bị bỏ, không lỗi.
7. Nếu `purpose = admin_stepup`: `acr === 'urn:inconsistable:acr:passkey-uv'` và `now - auth_time ≤ 300` giây
   (ASVS 6.8.4, 10.3.4). Request đã gửi `max_age=0` và `acr_values`; thư viện của OP kiểm `max_age` ở prompt login
   ([login.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/interaction_policy/prompts/login.js)),
   nhưng api vẫn kiểm lại vì không tin bên kia.
8. Liên kết danh tính (7.3), cấp session mới (7.4), lưu `op_sid` = claim `sid` vào dòng session, redirect 303 tới
   `return_to`.

Không lưu ID token sau bước này. RP-initiated logout gửi `client_id` thay cho `id_token_hint`, và IdP luôn hiện trang
xác nhận (mục 4.3).

### 7.3 Liên kết danh tính và các cuộc đua

Bảng `identity_link`: PK (`iss`, `sub`), `user_id` unique theo (`user_id`, `iss`), `created_at`. Thuật toán, trong **một
transaction**:

```
1. SELECT user_id FROM identity_link WHERE iss = $iss AND sub = $sub
2a. Có (user A):  session mới cho A. User ẩn danh U của thiết bị giữ nguyên, không đụng tới (ADR 0005).
2b. Không có:
    - Thiết bị có user ẩn danh U, và người dùng đã bấm "Gắn dữ liệu của thiết bị này vào tài khoản" trên trang
      xác nhận (hiện số phòng, ruleset, pack của U):
        SELECT … FROM app_user WHERE id = U FOR UPDATE
        U chưa có identity_link nào → INSERT identity_link (iss, sub, U) ON CONFLICT DO NOTHING RETURNING
        Không trả dòng (tab khác vừa thắng) → quay lại bước 1 và đi nhánh 2a
        Thắng → UPDATE device SET revoked_at = now() WHERE user_id = U   ← mọi secret thiết bị cũ của U chết
    - Ngược lại: tạo app_user mới A, INSERT identity_link (iss, sub, A)
3. Tạo dòng session mới (token 192 bit, lưu hash), xoá session cũ của trình duyệt nếu có
```

Vì sao từng bước:

- **Tấn công "gắn sẵn".** Kẻ tấn công biết secret `it_device` của U: máy tính bảng dùng chung ở quán, máy của một người
  chơi khác, hoặc cookie bị ném từ một subdomain anh em (cookie không có `__Host-` thì subdomain cùng site đặt được). Nạn
  nhân đăng nhập lần đầu trên máy đó, tài khoản gắn vào U. Nếu secret của U vẫn mở được session, kẻ tấn công thành chủ
  tài khoản. Bước `UPDATE device … revoked_at` và session mới (ASVS 7.2.4, L1) đóng lỗ này. Trên HTTPS, cookie thiết bị
  cũng đổi tên thành `__Host-it_device` để không bị ném.
- **Trang xác nhận.** Không tự gắn dữ liệu của một máy lạ vào tài khoản. Người dùng phải thấy và đồng ý; mặc định là
  không gắn.
- **Login CSRF.** Kẻ tấn công không gắn được thiết bị của nạn nhân vào tài khoản của mình, vì callback chỉ chạy với giao
  dịch do chính trình duyệt đó mở (7.2 bước 1) và code bị PKCE ràng buộc (RFC 9700 §4.7, §4.5.3.1).
- **Đua.** PK (`iss`, `sub`) chặn hai lần gắn; `FOR UPDATE` trên U chặn hai tab gắn U vào hai tài khoản khác nhau; unique
  (`user_id`, `iss`) chặn một user có hai `sub` của cùng issuer. `DELETE … RETURNING` ở 7.2 chặn dùng lại cùng một
  callback.

### 7.4 Session của api

| Thuộc tính | Giá trị | Nguồn |
|---|---|---|
| Tên | `__Host-it_session` | ASVS 3.3.3 (L2); RFC 10017 §6.1.3.2 gợi ý `__Host-Http-` cho BFF, đổi tên này là tuỳ chọn |
| Cờ | `HttpOnly; Secure; Path=/; SameSite=Lax`, không `Domain` | ASVS 3.3.1, 3.3.4; NIST §5.1 |
| Giá trị | 24 byte ngẫu nhiên, DB lưu SHA-256 | ASVS 7.2.3 |
| Hạn | 30 ngày idle, 90 ngày tối đa; elevation admin 1 giờ idle, 24 giờ tối đa (đã chốt) | ASVS 7.3.1–7.3.2 chỉ đòi ghi rõ. NIST AAL1 gợi ý ≤ 30 ngày tổng; 90 ngày là lệch đã chốt ở #33 |
| Xoay | Khi đăng nhập, khi elevation, khi gắn danh tính | ASVS 7.2.4 |
| Cột | `token_hash`, `user_id`, `op_sid`, `created_at`, `last_seen_at`, `elevated_until`, `elevated_idle_until`, `acr`, `revoked_at` | |

`SameSite=Lax` chứ không `Strict`: người chơi và GM thường mở app từ link trong chat hay QR, và với `Strict` lần điều
hướng đầu tiên sẽ trông như chưa đăng nhập. CSRF do 7.5 lo.

### 7.5 CSRF, Origin, Fetch Metadata

- Middleware toàn cục ở api (như `self-built-auth.md` §3.4): mọi method không phải GET, HEAD, OPTIONS cần
  `Sec-Fetch-Site: same-origin`; nếu không có header đó thì `Origin` phải bằng `WEB_ORIGIN`. `same-site` **không đủ**, vì
  `auth.<domain>` và `app2.<domain>` cùng site ([RFC 10017 §6.1.3.3.1](https://www.rfc-editor.org/rfc/rfc10017.html)).
- Ngoại lệ duy nhất: `POST /api/auth/backchannel-logout`, vì người gọi là IdP (server tới server, không có cookie). Nó
  được xác thực bằng logout token (7.6) và không đọc cookie nào.
- `GET` không đổi trạng thái (ASVS 3.5.3).

### 7.6 Đăng xuất và back-channel logout

- **Đăng xuất từ app:** xoá dòng session ở server (ASVS 7.4.1), kick socket, rồi redirect tới `end_session_endpoint`
  của IdP với `client_id` và `post_logout_redirect_uri` đã đăng ký.
- **Nhận logout token** ([Back-Channel Logout 1.0 §2.6](https://openid.net/specs/openid-connect-backchannel-1_0.html)),
  kiểm bằng `jose` `jwtVerify` vì `oauth4webapi` không có hàm riêng cho việc này:
  1. `typ` là `logout+jwt` (ASVS 10.5.5); `oidc-provider` đặt `typ` này và `exp` 120 giây
     ([id_token.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/models/id_token.js)).
  2. `algorithms: ['ES256']`, khoá từ JWKS của issuer đã cấu hình.
  3. `issuer`, `audience = client_id`, `maxTokenAge: '2m'`, độ lệch ≤ 30 giây.
  4. Có `sub` hoặc `sid`; `events` có khoá `http://schemas.openid.net/event/backchannel-logout`; **không** có `nonce`.
  5. `jti` chưa thấy: bảng `logout_jti` (`jti` PK, `exp`), `INSERT … ON CONFLICT DO NOTHING`; trùng thì 400. Dọn dòng
     quá `exp`. Đây là bước tuỳ chọn của spec (§2.6), rẻ nên làm.
  6. Có `sid`: xoá session có `op_sid = sid`. Chỉ có `sub`: xoá mọi session của user liên kết với (`iss`, `sub`).
  7. Kick socket của các session đó (7.7). Trả 200 với `Cache-Control: no-store`, lỗi trả 400 (§2.8).
- Rate limit endpoint này theo IP (mục 11). Thư viện của OP coi mọi status khác 200 và 204 là lỗi và ném ra
  ([client.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/models/client.js), `backchannelLogout`);
  không thấy cơ chế thử lại trong code đã đọc (suy luận). Vì vậy với các thu hồi theo tài khoản (mục 6, 8), IdP nên ghi
  vào một bảng outbox và thử lại tới khi nhận 200.

### 7.7 Socket

- Handshake đọc `__Host-it_session` (thay `it_device` trên HTTPS), cho socket join room `s:<token_hash>` và lưu
  `expires_at`, `elevated_until` vào `socket.data`.
- Thu hồi: `server.in('s:<hash>').disconnectSockets(true)`, cùng kiểu với `kicks` hiện có trong `table.gateway.ts`.
- Mỗi action kiểm `expires_at`; seat `admin` (OPEN AS ADMIN) kiểm thêm `elevated_until` và idle 1 giờ. Middleware chỉ
  chạy một lần mỗi kết nối, nên kiểm ở action là bắt buộc.
- `allowRequest` kiểm `Origin` bằng `WEB_ORIGIN`, như `self-built-auth.md` §3.5.
- Handshake `adminKey` bị tắt trên bản HTTPS (mục 8).

## 8. Phân quyền

- **Mặc định từ chối:** `APP_GUARD` toàn cục; mỗi route REST khai báo `@Public()`, `@Session()`, `@Creator()` hoặc
  `@AdminElevated()`; route không khai báo thì 403. Một test liệt kê mọi route và đỏ khi có route thiếu khai báo
  (ASVS 8.2.1, L1).
- **Một điểm quyết định:** `canInCampaign` vẫn là nơi duy nhất cho quyền trong phòng; seat `admin` của nó chỉ được tạo từ
  session đang elevation, không bao giờ từ `app_user.role` một mình, cũng không từ claim chưa kiểm.
- **Phạm vi tenant:** giữ quy tắc "mọi truy vấn theo `ctx.campaignId`, không tin id từ client" (ASVS 8.2.2 L1, 8.4.1 L2).
- **Vai trò từ token:** chỉ lấy từ ID token đã qua 7.2, lưu lên `app_user.role` ở mỗi lần đăng nhập. `creator` mở quyền
  import; `admin` chỉ mở quyền **xin** elevation.
- **Step-up admin:** luồng `purpose = admin_stepup` (7.1–7.2), `max_age=0`, `acr_values=urn:inconsistable:acr:passkey-uv`.
  Thành công thì xoay token session và đặt `elevated_until = now + 24h`, `elevated_idle_until = now + 1h`. Hết hạn thì seat
  admin biến mất ở action kế tiếp.
- **Đổi quyền thì thu hồi:** gỡ `admin` hay `creator` ở IdP phát back-channel logout cho `sub` (qua outbox). Api xoá mọi
  session của user đó và kick socket. Kể cả khi logout bị lỡ, lần elevation sau đọc lại vai trò mới, nên trần độ trễ là
  hạn của session thường; với admin là tối đa 1 giờ idle.
- **Cấp admin:** chỉ bằng CLI trên host của IdP (admin đầu tiên), hoặc bởi một admin khác đã step-up, có log và có banner
  cho người được cấp. Không có trang tự đăng ký admin, không có tài khoản mặc định (ASVS 6.3.2).
- **`ADMIN_KEY`:** trên bản HTTPS, api từ chối khởi động nếu `ADMIN_KEY` được đặt mà không có thêm cờ tường minh
  `ALLOW_ADMIN_KEY=1`. Smoke test và script giữ cách dùng hiện nay trên dev. ASVS 7.2.2 (L1) cấm secret tĩnh làm session.
- **Test phân quyền:** ma trận REST × chủ thể (ẩn danh, user khác, player, co-GM thiếu scope, GM, chủ phòng, admin chưa
  elevation, admin đã elevation, session đã thu hồi) với kết quả mong đợi; test IDOR đổi `campaignId`, `actorId`,
  `packId` sang tài nguyên của người khác; ma trận socket đã có ở `permissions.test.ts`, thêm trường hợp admin hết
  elevation. Test âm phải nhiều hơn test dương ([OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)).

## 9. Secret và khoá

| Secret | Sinh | Lưu | Xoay | Ghi chú |
|---|---|---|---|---|
| Khoá ký của IdP | ES256 (P-256) bằng `jose.generateKeyPair('ES256', { extractable: true })` rồi `exportJWK`, trên máy admin, có `kid` | File JWKS ở `/run/secrets/op_jwks.json` (Podman/Docker secret), quyền 0400, chủ là uid của IdP | 6 tháng (đề xuất). Thêm khoá mới vào **cuối** `keys`, deploy; ít nhất 1 ngày sau đưa lên **đầu**, deploy; giữ khoá cũ thêm 1 ngày rồi bỏ | Thứ tự theo docs ([defaults.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/defaults.js), `jwks`). Khoá cũ phải sống hơn TTL ID token (5 phút), logout token (2 phút) và cache JWKS của client (`jose` 10 phút) |
| Cookie keys của OP | 32 byte ngẫu nhiên mỗi khoá | Secret file | 3 tháng: thêm vào đầu, giữ 2 khoá | Docs khuyên "rotate regularly (by prepending new keys)" |
| Khoá `private_key_jwt` của api | ES256, sinh như trên | Secret file của api; IdP chỉ có khoá công khai trong file client | 12 tháng hoặc khi lộ: đăng ký hai khoá công khai, đổi khoá ở api, gỡ khoá cũ | Chọn `jwks` tĩnh thay `jwks_uri`: không có lời gọi IdP → api, không cần lo SSRF |
| Mật khẩu role Postgres | 32 byte ngẫu nhiên, SCRAM | Secret file; `DATABASE_URL` dựng lúc chạy | Khi có người rời đội hoặc khi lộ | Postgres 18 cảnh báo khi đặt mật khẩu MD5 ([release notes](https://www.postgresql.org/docs/18/release-18.html)) |
| `ADMIN_KEY` | Như hiện nay | Env của api | Bỏ trên HTTPS | Mục 8 |

- **Không KMS:** bản tự host không có HSM. Tối thiểu theo ASVS 13.3.1 (L2): secret không nằm trong source hay build
  artifact, có một nơi quản lý (Podman secrets là đủ cho một host), quyền đọc tối thiểu (13.3.2). HSM là L3, không nhắm.
- **File thay vì env:** env lộ qua `/proc/<pid>/environ`, crash dump và lệnh `inspect` của container
  ([OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)). Với
  Node, đừng dùng `--env-file` cho secret: nó đọc file trước khi permission model khởi động (mục 13.1).
- **Không secret trong image:** `.dockerignore` của repo này đã loại `**/.env*` và `deploy/*.env`. Phát hiện phụ:
  `.seed-device` ở gốc repo (secret thiết bị của GM mẫu, chưa nằm trong `.gitignore`) không có trong `.dockerignore`, nên
  `COPY . .` của `deploy/api.Containerfile` chép nó vào image. Chỉ là dữ liệu dev, nhưng nên thêm vào cả hai file.
- **Kiểm kê crypto:** một bảng trong repo IdP liệt kê khoá, thuật toán, nơi lưu, chủ sở hữu và lịch xoay
  ([ASVS 11.1.1–11.1.2](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x20-V11-Cryptography.md), L2).

## 10. Dữ liệu và DB

### 10.1 Role và quyền

```sql
-- chạy bằng superuser, một lần, trong một transaction cho mỗi database (docs khuyên REVOKE cùng transaction tạo)
CREATE ROLE it_api   LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE it_idp   LOGIN PASSWORD '…' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE it      OWNER it_api;
CREATE DATABASE it_auth OWNER it_idp;
REVOKE CONNECT, TEMPORARY ON DATABASE it      FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE it_auth FROM PUBLIC;
```

```
# pg_hba.conf: đúng role, đúng database, có TLS khi đi qua mạng; dòng cuối từ chối mọi thứ còn lại
hostssl  it       it_api  10.89.0.0/24  scram-sha-256
hostssl  it_auth  it_idp  10.89.0.0/24  scram-sha-256
host     all      all     0.0.0.0/0     reject
```

- Api là owner của `it` nên vẫn `CREATE EXTENSION pg_trgm` được (extension trusted, như ghi chú trong
  `apps/api/src/core/db.ts`) mà không cần superuser.
- `CONNECT` được kiểm lúc mở kết nối, cộng với `pg_hba` ([§5.8](https://www.postgresql.org/docs/18/ddl-priv.html),
  [pg_hba](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html)). Hai lớp này là cách "api không với tới `it_auth`".
- Mật khẩu superuser chỉ dùng để khởi tạo, không nằm trong env của service nào.
- TLS giữa service và Postgres ([§18.9](https://www.postgresql.org/docs/18/ssl-tcp.html)) khi chúng ở hai host; cùng một
  mạng container trên một host thì là tuỳ chọn (ASVS 13.2.x, L2).
- Row security không cần: mỗi database chỉ có một role ứng dụng.

### 10.2 Lưu trữ bên trong `it_auth`

- **Hash id trong adapter.** Adapter nhận `id` ở `upsert`, `find`, `destroy` và `uid` ở `findByUid`. Lưu `SHA-256(id)` và
  `SHA-256(uid)` thay cho giá trị thô, như repo đang làm với `device` và `access_token`. Lộ DB thì không có session OP
  hay interaction nào dùng lại được. `grantId` để thô vì nó không phải secret và cần cho `revokeByGrantId`. (Đề xuất,
  suy từ giao diện adapter trong docs; chưa chạy thử với mọi model.)
- Mã khôi phục: hash (mục 6). Vé đăng ký: hash. Challenge WebAuthn: thô nhưng sống 120 giây và bị xoá khi dùng.
- Passkey: khoá công khai, `counter`, `transports`, `backup_eligible`, `backup_state`, `uv_initialized`, tên do người
  dùng đặt, `created_at`, `last_used_at`.

### 10.3 Mã hoá lúc nghỉ, backup, giữ, xoá

- Postgres không có TDE. Dùng mã hoá đĩa của host (LUKS, BitLocker) cho volume `pgdata`, và mã hoá file backup trước khi
  đưa ra khỏi host (ví dụ `age`). `it` và `it_auth` backup riêng, khoá giải mã riêng.
- **Tối thiểu hoá PII:** IdP giữ `sub`, tên hiển thị, vai trò, passkey (khoá công khai và metadata), hash mã khôi phục,
  `auth_event`. Không email, không số điện thoại, không tên thật.
- **Giữ log:** `auth_event` có IP và user agent giữ 180 ngày rồi xoá cột IP và UA, giữ dòng sự kiện 1 năm (đề xuất).
  OWASP Logging coi IP là dữ liệu cá nhân.
- **Xoá tài khoản** (house decision #33: giao hết phòng có người khác trước): IdP xoá passkey, mã, session, grant, phát
  back-channel logout với `sub`, rồi xoá account; `auth_event` giữ `sub` dạng giả danh tới hết hạn giữ. Api xoá
  `identity_link`, session, và xử lý `app_user` theo quy tắc phòng hiện có. Hai phía xoá qua một endpoint nội bộ có xác
  thực, hoặc api làm theo khi nhận logout token kèm một sự kiện riêng (cần thiết kế; ngoài phạm vi ghi chú này).

## 11. Chống lạm dụng

`oidc-provider` không giới hạn tần suất: SECURITY.md xếp "Denial of service via resource exhaustion" vào mục không phải
lỗi của thư viện và nói app phải tự làm. `limiter()` của api không dùng được trong IdP, nên IdP có middleware Koa riêng,
đếm trong Postgres hoặc trong bộ nhớ khi chỉ có một instance (`ponytail:` như `rate-limit.ts`).

| Endpoint | Khoá đếm | Mức (đề xuất) | Khi vượt |
|---|---|---|---|
| `GET /auth` (tạo interaction, ghi một dòng DB) | IP | 30/phút | 429; cảnh báo nếu 10 IP cùng vượt trong 5 phút |
| Sinh options passkey | IP; interaction | 20/phút; 5 challenge còn hạn | 429 |
| Verify passkey | IP; credential ID | 10/phút; 20/giờ | 429; lỗi chữ ký lặp lại thì ghi `auth_event` |
| Nhập mã khôi phục | IP; toàn hệ thống | 5 lần/15 phút; 50 lần sai/giờ | Chờ tăng dần 2^n giây tới 1 giờ cho IP đó; vượt ngưỡng toàn hệ thống thì cảnh báo |
| Dùng vé đăng ký | IP | 5/15 phút | 429 |
| Token endpoint | `client_id` | 60/phút | 429 |
| Đăng ký passkey (đã đăng nhập) | tài khoản | 10/giờ | 429 |
| Step-up admin | tài khoản | 5/15 phút | 429, cảnh báo |
| `POST /api/auth/backchannel-logout` (api) | IP | 60/phút | 429 |

- **Khoá hay chỉ chậm lại:** NIST cho tối đa 100 lần sai liên tiếp mỗi authenticator rồi vô hiệu nó, và cho phép chờ tăng
  dần (§3.2.2). Passkey không đoán được nên không cần khoá theo tài khoản. Mã khôi phục được tra trực tiếp không kèm
  username, nên không đếm được "theo tài khoản"; 128 bit làm việc đoán vô vọng, nên đếm theo IP và toàn hệ thống chỉ để
  chặn ồn và phát hiện dò quét.
- **Không lộ tài khoản:** đăng nhập passkey không cần username; mã sai, mã đã dùng, mã của admin đều cùng một thông báo,
  cùng mã HTTP.
- **DoS với một bản tự host:** Caddy đặt timeout đọc header và giới hạn kích thước body; Koa giới hạn body của route
  interaction (vài KB); pool Postgres của IdP có trần riêng để IdP không làm cạn kết nối của api; job dọn interaction,
  challenge và `oidc_tx` hết hạn mỗi 10 phút. Plugin rate limit của Caddy không có trong bản build chuẩn (chưa kiểm), nên
  không dựa vào nó. Bot challenge (CAPTCHA) không đặt: NIST liệt kê nó là tuỳ chọn, và nó làm hỏng trải nghiệm ở bàn.
- **IP thật:** `limiter` của api hiện chỉ tin `CF-Connecting-IP` khi `TRUST_CF=1`. Sau Caddy → web → api, api thấy IP của
  web. Cần một chế độ `TRUST_PROXY` đọc phần tử cuối của `X-Forwarded-For` do Caddy ghi (ASVS 15.3.4, L2). Tương tự,
  `apps/web/proxy.ts` tin `x-forwarded-proto` vô điều kiện khi đặt `Secure`; an toàn chừng nào web chỉ nhận kết nối từ
  Caddy.

## 12. Log, giám sát, ứng cứu

### 12.1 Ghi gì và không ghi gì

| Ghi (ASVS [16.3.1–16.3.4](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md)) | Không bao giờ ghi (ASVS 16.2.5) |
|---|---|
| Đăng nhập thành công hay thất bại (phương thức, `acr`, credential ID dạng hash) | Code, ID token, logout token, `code_verifier`, `state`, `nonce` |
| Đăng ký hay xoá passkey, cờ BE/BS, `signCount` lùi | Mã khôi phục, vé đăng ký, challenge |
| Dùng mã khôi phục, cấp bộ mã mới, cấp vé (ai cấp cho ai, lý do) | Cookie, session id, token session của api (chỉ hash cắt ngắn nếu cần tương quan) |
| Cấp, gỡ vai trò; step-up admin; elevation hết hạn | Khoá riêng, cookie keys, client assertion |
| Back-channel logout gửi đi (client, kết quả) và nhận về (hợp lệ hay lý do từ chối) | Toàn bộ query string của `/auth` |
| Lỗi phân quyền ở api (route, chủ thể, tài nguyên) | Nội dung pack, ruleset hay trang sách |
| Sự kiện của `provider.on(...)`: `server_error`, `grant.revoked`, `backchannel.error`, `authorization.error` (tên sự kiện cần đối chiếu docs khi viết) | |

- Mỗi dòng có thời điểm UTC, service, `sub` hoặc `user_id`, IP, user agent, request id (ASVS 16.2.1–16.2.2). Mã hoá dữ
  liệu đưa vào log để chống log injection (16.4.1). Log ra stdout dạng JSON, thu về một nơi mà service không sửa được
  (16.4.2–16.4.3); với một host, journald hoặc file chỉ ghi thêm của host là đủ.

### 12.2 Tín hiệu cảnh báo

| Tín hiệu | Ngưỡng (đề xuất) | Vì sao |
|---|---|---|
| Refresh token bị dùng lại | Bất kỳ | Không client nào được cấp refresh token; có là có lỗi cấu hình hoặc tấn công |
| Code bị dùng lại (`invalid_grant` ở token endpoint) | Bất kỳ | ASVS 10.4.2: thư viện thu hồi token của code đó |
| Mã khôi phục sai | > 50/giờ toàn hệ thống, hoặc > 10/giờ một IP | Dò quét |
| Dùng mã khôi phục thành công | Mỗi lần (thông tin) | Hiếm, đáng xem |
| Cấp vai trò `admin`, cấp vé | Mỗi lần | Thay đổi đặc quyền |
| `signCount` lùi | Mỗi lần | Có thể là passkey bị nhân bản |
| Logout token bị từ chối ở api | > 5/giờ | Giả mạo hoặc lệch khoá |
| `backchannel.error` | Mỗi lần | Thu hồi chưa tới api |
| Khởi động IdP với cảnh báo của thư viện | Mỗi lần | Có thể đang chạy khoá dev |

### 12.3 Playbook

**Lộ khoá ký của IdP.**

1. Sinh khoá mới, đặt lên đầu `keys` và **bỏ ngay khoá lộ** (không giữ chồng lấn). ID token đang bay sẽ hỏng, người dùng
   chỉ phải đăng nhập lại.
2. Kết thúc mọi session OP và grant; api xoá mọi session có `iss` này và kick socket.
3. Xoay cookie keys của OP và khoá client nếu nằm cùng nơi.
4. Tìm nguyên nhân (secret file, backup, CI), đọc log từ thời điểm nghi lộ.

Phạm vi thật sự: api chỉ nhận ID token trong response của token endpoint qua TLS, nên kẻ có khoá ký vẫn phải giả được
token endpoint mới đăng nhập được vào api. Thứ giả được ngay là logout token (đăng xuất cưỡng bức). App thứ hai có thể
dùng token khác, nên không được hạ mức xử lý.

**Lộ khoá client của api.** Đăng ký khoá mới cùng khoá cũ trong file client ở repo IdP, đổi khoá ở api, gỡ khoá cũ. Kẻ
tấn công đóng vai api được ở token endpoint, nhưng vẫn cần code và `code_verifier` của một giao dịch thật.

**Passkey của admin bị mất hoặc bị trộm** (thiết bị mất, tài khoản đồng bộ bị chiếm):

1. Admin khác (hoặc CLI trên host IdP) gỡ passkey đó và tạm gỡ vai trò `admin`.
2. IdP kết thúc session, phát back-channel logout; api xoá session và kick socket.
3. Đọc `admin_event` và `auth_event` từ lần dùng hợp lệ cuối của passkey đó. Kiểm các thay đổi chủ phòng, kick, import.
4. Nếu passkey là loại đồng bộ: chủ tài khoản đổi mật khẩu và kiểm tài khoản đồng bộ trước khi đăng ký passkey mới.
5. Cấp lại vai trò sau khi có passkey mới; ghi một mục sự cố.

**Lộ DB `it_auth`.** Theo 10.2 thì không có secret dùng lại được. Vẫn kết thúc mọi session OP, xoay cookie keys, kiểm
bảng `account` và vai trò có bị sửa không (nếu kẻ tấn công có quyền ghi), và đối chiếu với backup.

## 13. Nền tảng và chuỗi cung ứng

### 13.1 Node (IdP)

- **Phiên bản:** Node 24 LTS (tới 2028-04-30), không phải 22 (tới 2027-04-30). Pin bản vá cụ thể trong image và theo dõi
  bản phát hành bảo mật của Node; bản mới nhất lúc đọc là 24.22.1 và 22.23.4, cùng ngày 2026-10-20
  ([nodejs.org/dist](https://nodejs.org/dist/index.json)).
- **Permission model:** ổn định từ v22.13.0 ([docs](https://nodejs.org/docs/latest-v22.x/api/permissions.html)). Chạy
  `node --permission --allow-fs-read=/app,/run/secrets` không có `--allow-fs-write`, `--allow-child-process`,
  `--allow-worker`, `--allow-addons`. Docs ghi rõ đây là "seat belt" cho code tin cậy, không phải ranh giới an ninh
  trước mã độc; symlink và file descriptor có sẵn đi vòng được; trang permission của v22 không nói gì về giới hạn mạng.
- **Cờ khác:** `--disallow-code-generation-from-strings` (chặn `eval` và `new Function`), `--disable-proto=throw`
  (SECURITY.md của `oidc-provider` đẩy prototype pollution sang phía app). Cả hai phải chạy thử với `koa`, `jose`,
  `@simplewebauthn/server` trước khi bật, vì chưa kiểm dependency nào dùng sinh code từ chuỗi.
- `NODE_ENV=production`; không bật `--inspect` trong production (ASVS 13.4.2).
- Theo [Node.js Security Best Practices](https://nodejs.org/en/learn/getting-started/security-best-practices) và
  [OWASP Node.js](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html): giới hạn kích thước
  body, timeout, không chặn event loop bằng crypto đồng bộ trong đường nóng.

### 13.2 Container

- Build bằng Bun (house decision #34: Bun vẫn là package manager), chạy bằng image Node tối thiểu: `node:24-slim` hoặc
  [distroless](https://github.com/GoogleContainerTools/distroless) Node (tên tag chưa kiểm), pin theo digest.
- `USER` không phải root, rootfs chỉ đọc, `tmpfs` cho `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges]`,
  giới hạn bộ nhớ và PID ([OWASP Docker](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)).
  Image api hiện có đã chạy bằng user `bun`; áp các mục còn lại cho cả api.
- IdP chỉ nhận kết nối từ Caddy (cùng mạng container, không publish cổng), vì `provider.proxy = true` tin
  `X-Forwarded-*` của bất kỳ ai nối vào được.

### 13.3 Caddy

```
auth.example.com {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        X-Frame-Options "DENY"
        Cross-Origin-Opener-Policy "same-origin"
        Permissions-Policy "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()"
        -Server
    }
    reverse_proxy idp:4100   # Caddy bỏ X-Forwarded-* của client và tự đặt lại
}
```

CSP do IdP đặt (nonce). Caddy tự cấp và gia hạn chứng chỉ ([Automatic HTTPS](https://caddyserver.com/docs/automatic-https)).
Không cấu hình `trusted_proxies` trừ khi có thêm một proxy đứng trước Caddy.

### 13.4 Dependency

- `bun install --frozen-lockfile` trong CI và image (đã làm ở `deploy/api.Containerfile`).
- Bun mặc định không chạy lifecycle script của dependency; `trustedDependencies: []` tắt luôn danh sách mặc định
  ([Bun lifecycle](https://bun.com/docs/pm/lifecycle)). IdP không có native addon, nên để mảng rỗng.
- `bunfig.toml`: `[install] minimumReleaseAge = 259200` (3 ngày), và `minimumReleaseAgeExcludes` thêm đúng
  `tên@phiên bản` khi phải vá gấp một advisory ([bunfig](https://bun.com/docs/runtime/bunfig)). Lớp này chống loại tấn
  công "bản độc sống vài giờ trên npm".
- Provenance: cả `oidc-provider` 9.13.0, `jose` 6.2.13, `openid-client` 6.8.8, `@simplewebauthn/server` 14.0.3 và
  `koa` 3.2.1 đều có attestation SLSA v1 trên npm registry (kiểm qua registry). Kiểm lại ở CI bằng
  `npm audit signatures` (công cụ của npm, chỉ đọc; [npm provenance](https://docs.npmjs.com/generating-provenance-statements)).
  Ghi chú: `oidc-provider`, `jose`, `openid-client` và `@simplewebauthn/server` mỗi gói chỉ có một maintainer trên npm.
- [Renovate](https://docs.renovatebot.com/) hoặc Dependabot cho cả hai repo; nhóm các gói auth vào một PR riêng có review
  bắt buộc.

## 14. Kiểm chứng

### 14.1 Mức ASVS mục tiêu

| Phần | Mức | Ghi chú |
|---|---|---|
| IdP: V10 (phía authorization server) | L2 đầy đủ, cộng 10.4.3 (code 60 giây) và 10.4.16 (`private_key_jwt`) của L3 | 10.4.13 (PAR) ở lát cắt 2. 10.4.14 và 10.3.5 (sender-constrained) cố ý không đạt |
| IdP: V6 | L2 | Passkey UV đạt 6.3.3. Hai lệch NIST ở mục 6.2 ghi vào house decision |
| IdP: V3 (trang của IdP) | L2, cộng CSP nonce theo response của L3 | |
| IdP: V7, V11, V13, V15, V16 | L2 | 13.3.3 (HSM) và 11.1.3 không nhắm |
| Api: V10 (phía client) | L2 | 10.1.2, 10.2.1, 10.2.2, 10.5.1–10.5.5 |
| Api: V7 | L2 | |
| Api: V8 | L1, cộng 8.4.1 (L2) | Như `self-built-auth.md` §6 |

### 14.2 OpenID conformance suite

- Bộ test của OpenID Foundation là mã nguồn mở, giấy phép MIT, chạy cục bộ được
  ([GitLab](https://gitlab.com/openid/conformance-suite), README trỏ tới hướng dẫn "Build & Run"). Bản host ở
  `certification.openid.net` có lẽ cần OP truy cập được từ internet (chưa kiểm). Chạy cục bộ là miễn phí; chứng nhận
  chính thức có phí theo [bảng phí](https://openid.net/certification/) (chưa đọc số tiền). Không cần chứng nhận chính thức.
- Kế hoạch test nên chạy: OP Basic (code flow), Config (discovery), và các test logout (RP-Initiated, Back-Channel). Cấu
  hình của ta tắt userinfo và chỉ có `private_key_jwt`, nên một số test của profile Basic sẽ phải bỏ qua hoặc chạy với
  một instance test bật userinfo. Mục tiêu là bắt hồi quy cấu hình, không phải lấy chứng nhận.
- Chạy mỗi khi đổi phiên bản `oidc-provider` hoặc cấu hình, trong CI của repo IdP (job thủ công hoặc hằng tuần, vì suite
  là một ứng dụng Java nặng).

### 14.3 Test tự động

**Repo IdP (test âm):**

- `redirect_uri` lệch một ký tự, thêm `/`, đổi hoa thường, thêm query, thêm fragment, scheme `http`, `javascript:` →
  không redirect, hiện trang lỗi. Fuzz bằng một danh sách biến thể sinh tự động.
- Thiếu `code_challenge`, `code_challenge_method=plain`, verifier sai, verifier khi không có challenge (RFC 9700 §4.8).
- Code dùng hai lần → lần hai `invalid_grant` và token của lần một bị thu hồi (ASVS 10.4.2). Code sau 61 giây.
- `response_type=id_token`, `token`, `code id_token` → bị từ chối.
- Client assertion: sai `aud`, hết hạn, `jti` dùng lại, ký HS256, `alg: none`.
- `prompt=none` khi chưa đăng nhập → `login_required`, không tạo session.
- Interaction: POST không có cookie interaction, `uid` của người khác, `Sec-Fetch-Site: cross-site`.
- WebAuthn: sai origin, sai RP ID, UV = 0, challenge đã dùng, challenge hết hạn, credential ID đã thuộc user khác.
- Mã khôi phục: dùng hai lần song song (một bên thắng), mã của admin bị từ chối với cùng thông báo.
- Header: mỗi trang có CSP với nonce khác nhau giữa hai request; có `frame-ancestors 'none'`.
- Khởi động với khoá dev, `devInteractions`, cookie keys rỗng → process thoát.

**Repo InconsisTable:**

- Callback: thiếu cookie giao dịch, `state` sai, `iss` sai hoặc thiếu, `nonce` sai, `aud` sai, ID token ký khoá khác,
  dùng lại callback.
- Liên kết: hai callback song song cho cùng (`iss`, `sub`) mới → một user; secret `it_device` cũ của U bị từ chối sau
  khi gắn; hai tab gắn U vào hai tài khoản → một bên thua.
- Logout token: `typ` sai, thiếu `events`, có `nonce`, hết hạn, `jti` lặp, `aud` của client khác → 400; hợp lệ → socket
  rớt trong một giây.
- Step-up: `acr` recovery, `auth_time` cũ → không có seat admin; elevation hết hạn giữa chừng → action admin bị từ chối.
- Ma trận phân quyền và IDOR (mục 8). POST với `Sec-Fetch-Site: same-site` bị từ chối.

### 14.4 Checklist trước khi mở tài khoản

- [ ] Postgres: api và IdP chạy bằng role thường; `REVOKE` PUBLIC; `pg_hba` có dòng `reject` cuối; `\l` cho thấy không
  còn `=Tc` của PUBLIC trên `it_auth`.
- [ ] IdP qua được test khởi động; discovery không có `userinfo_endpoint`, `registration_endpoint`, `introspection_endpoint`;
  `response_types_supported` chỉ có `code`; `token_endpoint_auth_methods_supported` chỉ có `private_key_jwt`.
- [ ] Khoá ký, cookie keys, khoá client nằm trong secret file, không có trong env, image hay repo.
- [ ] CSP, HSTS và các header của mục 4 có trên mọi trang IdP (kiểm bằng curl); trang không tải tài nguyên ngoài origin.
- [ ] Passkey UV bắt buộc; đăng ký và đăng nhập chạy được trên Chrome, Safari (iOS) và Firefox; RP ID đúng host IdP.
- [ ] Mã khôi phục: dùng một lần, buộc passkey mới, cấp bộ mới, banner hiện ở lần đăng nhập sau.
- [ ] Admin: CLI cấp admin đầu tiên chạy được; step-up kiểm `acr` và `auth_time`; `ADMIN_KEY` tắt.
- [ ] Back-channel logout làm socket rớt; logout token giả bị từ chối.
- [ ] Rate limit của mục 11 có hiệu lực (test bằng script).
- [ ] Log có đủ sự kiện của 12.1 và không có token hay mã (grep log sau một lượt test đầu cuối).
- [ ] Conformance suite chạy cục bộ, các test áp dụng được đều qua.
- [ ] Hai house decision về lệch NIST (mục 6.2) và một về Node 24 đã ghi.
- [ ] Backup của `it_auth` được mã hoá và đã thử khôi phục một lần.
- [ ] `docs/deploy.md` cập nhật: Caddy, mạng nội bộ, secret file, cảnh báo "không public" chỉ bỏ khi mọi mục trên xong.

## 15. Backlog làm cứng theo ưu tiên

Công sức là ước tính của người viết cho một người quen codebase (ước tính).

**Lát cắt 1: GM đăng nhập bằng passkey (bắt buộc trước khi bật).**

| # | Việc | Repo | Công sức (ước tính) |
|---|---|---|---|
| 1 | Role Postgres tách, `REVOKE`, `pg_hba`, cập nhật compose và `deploy.md` | InconsisTable (+ host) | 0,5–1 ngày |
| 2 | Cấu hình `oidc-provider` mục 3.2 và test khởi động fail-closed | IdP | 1 ngày |
| 3 | Adapter Postgres hash id, job dọn | IdP | 1–2 ngày |
| 4 | Header Caddy, CSP nonce, trang lỗi và logout riêng, Trusted Types | IdP | 1 ngày |
| 5 | Passkey: options và verify theo mục 5.2, challenge 120 giây, unique credential ID | IdP | 1–2 ngày |
| 6 | Mã khôi phục: sinh, hash, dùng một lần, luồng buộc passkey mới và bộ mới, banner | IdP | 1,5–2 ngày |
| 7 | Rate limit IdP (mục 11) | IdP | 0,5–1 ngày |
| 8 | Callback api: giao dịch `oidc_tx`, kiểm theo 7.2, `private_key_jwt` | InconsisTable | 1–1,5 ngày |
| 9 | Liên kết theo 7.3, thu hồi `device` của U, trang xác nhận | InconsisTable | 1–1,5 ngày |
| 10 | Session `__Host-it_session`, middleware Fetch Metadata, kick theo session | InconsisTable | 1 ngày |
| 11 | Back-channel logout: endpoint, `jti`, kick socket; outbox ở IdP | Cả hai | 1–1,5 ngày |
| 12 | Repo IdP: ruleset, secret scanning, action pin SHA, `trustedDependencies: []`, `minimumReleaseAge` | IdP | 0,5 ngày |
| 13 | Log `auth_event` theo 12.1, cảnh báo tối thiểu (in ra log mức `warn` có từ khoá để grep) | Cả hai | 1 ngày |
| 14 | Test âm của 14.3 cho các phần trên | Cả hai | 2–3 ngày |
| 15 | House decision: hai lệch NIST, Node 24 | InconsisTable | 0,5 ngày |
| | **Cộng** | | **khoảng 14–20 ngày** |

**Lát cắt 2: admin là tài khoản, bỏ `ADMIN_KEY`.**

| # | Việc | Công sức (ước tính) |
|---|---|---|
| 16 | CLI cấp admin đầu tiên, cấp và gỡ vai trò có log, back-channel khi đổi vai trò | 1–1,5 ngày |
| 17 | Step-up admin (`max_age=0`, `acr`), elevation 1 giờ / 24 giờ, kiểm ở socket action | 1–1,5 ngày |
| 18 | Vé cấp lại gặp trực tiếp (mục 6.3) | 1 ngày |
| 19 | Tắt `ADMIN_KEY` trên HTTPS, `APP_GUARD` mặc định từ chối, test liệt kê route | 1 ngày |
| 20 | Ma trận phân quyền và IDOR cho REST | 1,5–2 ngày |
| 21 | PAR bắt buộc cho client của mình | 0,5 ngày |

**Sau đó.**

| # | Việc | Công sức (ước tính) |
|---|---|---|
| 22 | Image distroless, rootfs chỉ đọc, permission model Node, cờ chặn sinh code (sau khi chạy thử) | 1 ngày |
| 23 | Attestation cho image và kiểm khi deploy theo digest | 0,5–1 ngày |
| 24 | Conformance suite cục bộ trong CI | 1–2 ngày |
| 25 | Test hợp đồng client ở cả hai repo; smoke test dựng IdP theo digest | 1–1,5 ngày |
| 26 | Đăng ký app thứ hai (BFF, `private_key_jwt`) | 0,5 ngày phía IdP |
| 27 | Mã hoá backup, chính sách giữ log, endpoint xoá tài khoản hai phía | 1–2 ngày |
| 28 | Xoay khoá ký và cookie keys theo lịch, có script | 0,5 ngày |
| 29 | `TRUST_PROXY` cho rate limit của api sau Caddy | 0,5 ngày |

## Những gì chưa kiểm

- Khung cấu hình ở 3.2 chưa chạy; tên option khớp source 9.13.0 nhưng tổ hợp chưa thử.
- `form-action 'self'` có chặn redirect sau submit trên Chromium hay không (mục 4.2): nguồn thứ cấp, phải thử.
- Hash id trong adapter cho mọi model của `oidc-provider` (mục 10.2): suy từ giao diện adapter, chưa thử.
- `backchannel_logout_session_required: true` khi IdP chủ động gửi logout theo `sub` (không có `sid`): chưa thử thư viện
  làm gì với `sid` rỗng.
- Tên sự kiện của `provider.on(...)` ở 12.1: chưa đối chiếu với docs.
- Cờ `--disallow-code-generation-from-strings` và `--disable-proto=throw` với các dependency của IdP.
- Độ dài challenge mặc định của `@simplewebauthn/server` (nên tự sinh 32 byte).
- Mặc định HSTS của Caddy; plugin rate limit của Caddy; tag distroless cho Node 24.
- Bản host của conformance suite có cần OP công khai không; phí chứng nhận.
- Đọc trang phụ lục B của NIST qua trích dẫn từng phần; số mục con (B.2, B.3) do bộ đọc suy ra.

## Nguồn

Ngày đọc của mọi nguồn là 2026-10-25.

- IETF: [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) (§2.1.1, §2.2, §2.5, §2.6, §4.1.3, §4.4, §4.7, §4.8,
  §4.11, §4.12, §4.13, §4.14.2, §4.16), [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html),
  [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html), [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html),
  [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html),
  [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), [RFC 8705](https://www.rfc-editor.org/rfc/rfc8705.html),
  [RFC 9126](https://www.rfc-editor.org/rfc/rfc9126.html), [RFC 9101](https://www.rfc-editor.org/rfc/rfc9101.html),
  [RFC 10017](https://www.rfc-editor.org/rfc/rfc10017.html)
- OpenID: [Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html),
  [Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html) (§2.4, §2.6–§2.8, §4),
  [RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html),
  [FAPI 2.0 Security Profile](https://openid.net/specs/fapi-security-profile-2_0-final.html) (Final, 2025-02-22),
  [conformance suite](https://gitlab.com/openid/conformance-suite) (MIT), [Certification](https://openid.net/certification/),
  [hướng dẫn test](https://openid.net/certification/instructions/)
- OWASP ASVS 5.0: [V3](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x12-V3-Web-Frontend-Security.md),
  [V6](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md),
  [V7](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md),
  [V8](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md),
  [V10](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x19-V10-OAuth-and-OIDC.md),
  [V11](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x20-V11-Cryptography.md),
  [V13](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x22-V13-Configuration.md),
  [V14](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x23-V14-Data-Protection.md),
  [V15](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md),
  [V16](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md); mã mục và mức
  lấy từ file markdown của nhánh `master`
- OWASP Cheat Sheets: [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html),
  [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html),
  [Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html),
  [Docker Security](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html),
  [Node.js Security](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html),
  [Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html),
  [Clickjacking Defense](https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html),
  [HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html); Authentication và
  Session Management đã dẫn ở `self-built-auth.md`
- NIST: [SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) (§2.2–§2.3, §3.1.2, §3.1.7, §3.2.2, §3.2.4,
  §3.2.5, §4.2, §4.6, §5.1–§5.2, phụ lục B)
- W3C: [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) (Recommendation 2026-08-25; §4 credential record, §5.11,
  §6.1, §7.1, §7.2, §13.4.3), [Trusted Types](https://www.w3.org/TR/trusted-types/);
  MDN [Trusted Types API](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API) (thứ cấp: trạng thái
  Baseline)
- `oidc-provider` 9.13.0, source của tag `v9.13.0`:
  [defaults.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/defaults.js),
  [provider.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/provider.js),
  [initialize_keystore.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/initialize_keystore.js),
  [respond.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/actions/authorization/respond.js),
  [discovery.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/actions/discovery.js),
  [refresh_token.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/actions/grants/refresh_token.js),
  [client.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/models/client.js),
  [id_token.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/models/id_token.js),
  [login.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/interaction_policy/prompts/login.js),
  [script_src_sha.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/script_src_sha.js),
  [pkce.js](https://github.com/panva/node-oidc-provider/blob/v9.13.0/lib/helpers/pkce.js),
  [docs/README.md](https://github.com/panva/node-oidc-provider/blob/v9.13.0/docs/README.md) ("Trusting TLS offloading
  proxies"), [SECURITY.md](https://github.com/panva/node-oidc-provider/blob/v9.13.0/SECURITY.md),
  [CHANGELOG](https://github.com/panva/node-oidc-provider/blob/v9.13.0/CHANGELOG.md); không có advisory công bố nào trên
  [GitHub](https://github.com/panva/node-oidc-provider/security/advisories) lúc đọc
- `@simplewebauthn/server` 14.0.3, source của tag `v14.0.3`:
  [verifyRegistrationResponse.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/registration/verifyRegistrationResponse.ts),
  [verifyAuthenticationResponse.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/authentication/verifyAuthenticationResponse.ts),
  [generateRegistrationOptions.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/registration/generateRegistrationOptions.ts),
  [generateAuthenticationOptions.ts](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/src/authentication/generateAuthenticationOptions.ts),
  [README](https://github.com/MasterKale/SimpleWebAuthn/blob/v14.0.3/packages/server/README.md),
  [advisories](https://github.com/MasterKale/SimpleWebAuthn/security/advisories) (đọc qua GitHub API)
- `oauth4webapi` 3.8.8: [src/index.ts](https://github.com/panva/oauth4webapi/blob/v3.8.8/src/index.ts);
  [`jose` advisories](https://github.com/panva/jose/security/advisories) (mới nhất 2024-03-07, về JWE, không áp dụng vì
  không dùng JWE); Koa [API docs](https://github.com/koajs/koa/blob/master/docs/api/index.md) (`proxy`, `maxIpsCount`)
- Phiên bản, ngày, maintainer và attestation lấy từ npm registry (`registry.npmjs.org`): `oidc-provider` 9.13.0,
  `@simplewebauthn/server` 14.0.3, `jose` 6.2.13, `openid-client` 6.8.8, `oauth4webapi` 3.8.8, `koa` 3.2.1
- Node.js: [lịch phát hành](https://github.com/nodejs/Release/blob/main/schedule.json),
  [danh sách bản](https://nodejs.org/dist/index.json),
  [Permissions (v22)](https://nodejs.org/docs/latest-v22.x/api/permissions.html),
  [CLI (v22)](https://nodejs.org/docs/latest-v22.x/api/cli.html),
  [Security Best Practices](https://nodejs.org/en/learn/getting-started/security-best-practices)
- PostgreSQL 18: [Privileges](https://www.postgresql.org/docs/18/ddl-priv.html),
  [pg_hba.conf](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html),
  [SSL](https://www.postgresql.org/docs/18/ssl-tcp.html), [release notes](https://www.postgresql.org/docs/18/release-18.html);
  [Docker Hub postgres](https://hub.docker.com/_/postgres) (`POSTGRES_USER` là superuser)
- Caddy: [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
  [header](https://caddyserver.com/docs/caddyfile/directives/header),
  [Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- Chuỗi cung ứng: [Bun lifecycle scripts](https://bun.com/docs/pm/lifecycle), [bunfig](https://bun.com/docs/runtime/bunfig),
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  [GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds),
  [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
  [Dependabot security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates),
  [Renovate](https://docs.renovatebot.com/), [distroless](https://github.com/GoogleContainerTools/distroless)
- Code của repo đã đọc: `packages/auth/src/api.ts`, `role.ts`; `apps/web/proxy.ts`; `apps/api/src/auth/auth.service.ts`;
  `apps/api/src/core/rate-limit.ts`, `env.ts`, `db.ts`; `apps/api/src/table/table.gateway.ts`;
  `packages/core-schema/src/permissions.ts`; `deploy/compose.yaml`, `deploy/api.Containerfile`, `.dockerignore`
