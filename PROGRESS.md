# İlerleme Durumu / Devam Rehberi

> Bu dosya DESIGN.md'nin (mimari/tasarım) aksine, **neyin yapıldığını, projenin nasıl çalıştırılacağını ve sırada ne olduğunu** takip eder. Yeni bir oturuma başlarken önce bu dosyayı, sonra DESIGN.md'yi okuyun.

## Nasıl çalıştırılır

```bash
# Bağımlılıklar zaten kurulu (node_modules mevcut). Yeni bir makinede:
npm install

# Ana uygulama (chat bot + admin API) — http://localhost:3000
npm run dev:app

# MCP server — internal HTTP API, sadece 127.0.0.1:3100'de dinler (bkz. DESIGN.md 8).
# Chat akışında tool çağrısının çalışması için bu servisin de ayakta olması gerekir;
# ayakta değilse chat.ts sessizce "tool yok" varsayıp düz metin sohbete devam eder.
npm run dev:mcp
```

**Gerekli `.env` dosyaları** (git'e dahil değil, `.env.example`'a bakın):
- `/.env` — `DATABASE_URL` (Neon Postgres), `PORT`, `ENCRYPTION_KEY`, `JWT_SECRET`, `MCP_PORT`, `MCP_INTERNAL_SECRET`
- `/packages/db/.env` — sadece `DATABASE_URL` (Prisma CLI + seed script için)

Bu iki dosya bu makinede zaten mevcut ve dolu. **Başka bir makineye geçilirse** yeniden oluşturulmaları gerekir — `ENCRYPTION_KEY` kaybolursa mevcut `ai_providers.apiKeyEncrypted`/`mcp_integrations.connection_config` şifreli alanları çözülemez hale gelir (yeniden şifrelemek gerekir); `JWT_SECRET` değişirse verilmiş tüm login token'ları geçersiz olur (zararsız, kullanıcılar tekrar login olur); `MCP_INTERNAL_SECRET` app/ ile mcp-server/ arasında paylaşılan, sadece bu iki servisin birbirini kimliklendirmesi için kullanılan bir sır (dışa açık değil).

DB: Neon Postgres (`neondb`), migrationlar (`20260918234541_init`, `20260919082231_add_must_change_password`, `20260919102728_fix_rollup_null_skill_unique`) uygulanmış durumda.

**İlk kurulum / varsayılan admin**: `npm run db:seed` — `is_admin` sistem role'ünü ve `admin@company.local` kullanıcısını (geçici şifre konsola basılır, `mustChangePassword=true`) oluşturur. Zaten varsa dokunmaz. Bu makinede zaten çalıştırıldı; admin şifresi test sırasında `newpassword123` olarak değiştirildi (sadece bu dev DB'de, gerçek ortamda olmaz).

## Şu ana kadar tamamlananlar

1. **DESIGN.md** — tüm mimari/veri modeli tartışması ve kararları içeriyor (13 bölüm). Yeni bir talep geldiğinde önce oraya işlenir.
2. **Proje iskeleti** — npm workspaces monorepo: `app/` (Express+TS), `mcp-server/` (Express+TS, internal HTTP API — bkz. madde 10), `packages/db/` (Prisma şeması, DESIGN.md'deki tüm tablolar, + paylaşılan `crypto`/`mcpConnectionConfig` yardımcıları).
3. **AI Sağlayıcı Yönetimi CRUD** (DESIGN.md 5.1) — `app/src/routes/admin/aiProviders.ts`
   - `GET/POST /api/admin/ai-providers`, `GET/PATCH/DELETE /api/admin/ai-providers/:id`, `POST /:id/test`
   - API key'ler AES-256-GCM ile şifreli (`packages/db/src/crypto.ts` — sonradan mcp-server ile paylaşmak için buraya taşındı, bkz. madde 10), yanıtlarda sadece maskeli (`apiKeyPreview`) dönüyor
   - Anthropic/OpenAI için gerçek bağlantı testi; diğer provider tipleri için "desteklenmiyor" mesajı
   - Uçtan uca Neon DB'ye karşı test edildi (create/list/patch/test/delete)
4. **Global hata yönetimi** — `app/src/lib/asyncHandler.ts` + `index.ts`'deki error handler middleware (Express 4'te yakalanmayan async hatalar artık process'i çökertmiyor, 500 JSON dönüyor).
5. **MCP Entegrasyonları CRUD** (DESIGN.md 5.2) — `app/src/routes/admin/mcpIntegrations.ts`
   - `GET/POST /api/admin/mcp-integrations`, `GET/PATCH/DELETE /api/admin/mcp-integrations/:id`, `POST /:id/test`
   - `connection_config` (JSONB) içindeki hassas alanlar (adında `key`/`password`/`secret`/`token`/`connectionString` geçenler) AES-256-GCM ile şifrelenip DB'ye yazılıyor, yanıtlarda maskeli dönüyor (aiProviders'daki `apiKeyPreview` deseninin JSON'a genellenmiş hali; mantık sonradan `packages/db/src/mcpConnectionConfig.ts`'e taşındı, bkz. madde 10)
   - `http_api` tipi için `baseUrl`/`url` + opsiyonel `apiKey`/`token` ile gerçek bağlantı testi; diğer tipler için "desteklenmiyor" mesajı
   - Uçtan uca Neon DB'ye karşı test edildi (create/list/patch/test/delete)
   - Yan düzeltme: `app/src/index.ts`'de `.env` yükleme, `dotenv/config` yerine repo köküne göre açık `path` ile yapılacak şekilde değiştirildi — npm workspace script'leri cwd'yi `app/`'a taşıdığı için önceki hâliyle `ENCRYPTION_KEY` hiç okunmuyordu (bu, aiProviders için de sorunluydu, şimdi ikisi de düzgün çalışıyor). Not: proje CommonJS'e derleniyor (package.json'da `"type":"module"` yok) — `import.meta` kullanılamaz, `__dirname` global olarak zaten mevcut.
6. **Kullanıcı/Skill/Role CRUD** (DESIGN.md 5.3-5.5) —
   - `app/src/routes/admin/skills.ts` — basit CRUD (`name`, `description`)
   - `app/src/routes/admin/roles.ts` — Role CRUD + `PUT /:id/mcp-permissions` ve `PUT /:id/ai-providers` (replace semantics, `role_mcp_permissions`/`role_ai_providers` n:n tablolarını yönetir); `isSystem=true` role'lerin silinmesi engellendi
   - `app/src/routes/admin/users.ts` — User CRUD; local kullanıcılarda şifre `bcryptjs` (12 round) ile hashleniyor, yanıtlarda `passwordHash` asla dönmüyor; `authSource=local` için `password`, `ldap` için `ldapDn` zorunlu (zod `superRefine`); `PUT /:id/skills` ve `PUT /:id/roles` ile atama (replace semantics)
   - Hepsi `/api/admin/{skills,roles,users}` altında mount edildi, uçtan uca Neon DB'ye karşı test edildi (skill/role/kullanıcı oluşturma, role'e mcp-permission + ai-provider atama, kullanıcıya skill+role atama, cascade delete)
7. **Auth** (DESIGN.md 8) —
   - `users.mustChangePassword` alanı eklendi (migration `20260919082231_add_must_change_password`)
   - `app/src/lib/jwt.ts` — `signAuthToken`/`verifyAuthToken` (HS256, 12 saat geçerli, `JWT_SECRET` ile)
   - `app/src/middleware/auth.ts` — `requireAuth()` (herhangi bir login olmuş kullanıcı) ve `requireAdmin()` (+ `is_admin` role kontrolü + `mustChangePassword` engeli), `req.user` tipini genişletir
   - `app/src/routes/auth.ts` — `POST /api/auth/login` (email+password; hem `local` hem `ldap` kullanıcıları destekler, bkz. madde 11), `GET /api/auth/me`, `POST /api/auth/change-password` (mevcut şifre doğrulanır, `mustChangePassword` sıfırlanır)
   - `app/src/routes/admin.ts`'e `adminRouter.use(requireAdmin())` eklendi — tüm `/api/admin/*` artık `is_admin` role'üne sahip, aktif, şifresini değiştirmiş bir kullanıcı gerektiriyor
   - `packages/db/prisma/seed.ts` (+ `npm run db:seed`) — `is_admin` sistem role'ünü ve varsayılan admin kullanıcısını (`admin@company.local`, rastgele geçici şifre, `mustChangePassword=true`) oluşturur, idempotent
   - Uçtan uca test edildi: token'sız `/api/admin/*` → 401; yanlış şifre → 401; doğru login → token + `mustChangePassword:true`; şifre değişmeden admin erişimi → 403 `must_change_password`; `change-password` sonrası admin erişimi → 200
   - Yan güvenlik düzeltmesi: `PUT /api/admin/users/:id/roles` ve `DELETE /api/admin/users/:id`, son `is_admin` kullanıcısını kaldırmayı/silmeyi engelliyor (`cannot_remove_last_admin` / `cannot_delete_last_admin`) — testler sırasında admin'in tek rolünü değiştirip kendimi kilitleyerek keşfettim, doğrudan Prisma script'iyle DB'den düzeltip sonra bu korumayı ekledim.
8. **Chat Bot temel akışı** (DESIGN.md Bölüm 6) — `app/src/routes/chat.ts` (tamamı `requireAuth()` ile korumalı)
   - `GET /api/chat/skills` — kullanıcının atanmış skill'leri; `GET /api/chat/ai-providers` — kullanıcının role'leri üzerinden erişebildiği AI sağlayıcılar (`role_ai_providers` distinct)
   - `POST /api/chat/sessions` — `skillId` kullanıcıya atanmış olmalı, `aiProviderId` verilmezse erişilebilir sağlayıcılardan (varsa `isActive`) otomatik seçilir
   - `GET /api/chat/sessions` — kullanıcının oturumları, skill'e göre gruplanmış (sol frame için)
   - `GET/PATCH/DELETE /api/chat/sessions/:id` — sahiplik kontrolü (başka kullanıcının oturumuna 404)
   - `POST /api/chat/sessions/:id/messages` — kullanıcı mesajını kaydeder, ilk mesajsa `title`'ı otomatik doldurur, `app/src/lib/aiClient.ts` ile seçili sağlayıcıya (Anthropic Messages API / OpenAI Chat Completions) tüm geçmişle birlikte gerçek istek atar, yanıtı `assistant` mesajı olarak kaydeder; sağlayıcı hata dönerse kullanıcı mesajı korunur, `502 ai_provider_error` döner; tool çağrısı gerekiyorsa max 5 turluk döngü çalışır (bkz. madde 10; token/maliyet kaydı madde 9'da)
   - Uçtan uca gerçek Anthropic API'sine karşı test edildi (sahte API key ile 401 → düzgün `502` hata sarmalama; session grouping/rename/delete/skill-yetkisi kontrolleri çalışıyor)
9. **Bütçe (Budget) Yönetimi** (DESIGN.md Bölüm 12) —
   - `packages/db/prisma/migrations/20260919102728_fix_rollup_null_skill_unique` — bilinen tech-debt'i kapattı: `ai_usage_monthly_rollup`'taki normal `@@unique` (skill_id dahil), Postgres'te NULL'ları farklı saydığından skill'siz kullanım satırlarını tekilleştiremiyordu. Düzeltme, biri `skill_id IS NULL` diğeri `skill_id IS NOT NULL` için olmak üzere iki **partial unique index** ekliyor (Prisma şema dili partial index ifade edemediğinden schema.prisma'da temsil edilmiyor, sadece sorgu için normal bir `@@index` bırakıldı)
   - `default_params` JSONB'sine fiyatlandırma alanları eklendi: `price_per_1k_input_usd`, `price_per_1k_output_usd` (ayrı bir `ai_provider_pricing` tablosu yerine, DESIGN.md 12.1 notu) — tanımlı değilse `cost_usd` 0 kaydedilir, token sayıları yine tutulur
   - `app/src/lib/budget.ts` — çekirdek mantık: `resolvePolicy` (user override → skill → global sırasıyla `budget_policies`'ten etkin limiti bulur, `daily`/`monthly` için ayrı ayrı), `getUsageUsd` (kaynak `skill` ise sadece o skill'in, `user`/`global` ise kullanıcının o provider'daki **tüm skill'lerdeki toplam** kullanımı — bkz. DESIGN.md 12.2 "Uygulama notu"; `monthly` rollup'tan, `daily` `ai_usage_records`'tan canlı sorgu), `getBudgetStatuses`/`isBudgetExceeded`, `recordUsage` (ham kayıt + rollup upsert'i tek transaction'da, partial index'lere karşı `$executeRaw` ile `ON CONFLICT`)
   - `app/src/lib/aiClient.ts` güncellendi — Anthropic/OpenAI yanıtlarından `tokensPrompt`/`tokensCompletion` da dönüyor
   - `app/src/routes/chat.ts` — mesaj göndermeden **önce** `isBudgetExceeded` kontrolü (aşılmışsa kullanıcı mesajı hiç kaydedilmeden `403 budget_exceeded` + erişilebilir alternatif sağlayıcı listesi döner); başarılı yanıttan **sonra** `recordUsage` çağrılır (maliyet ancak yanıt dönünce bilinebildiğinden, bütçeyi dolduran mesajın kendisi yine de gönderilir — bkz. DESIGN.md 8 kararı); `GET /ai-providers?skillId=` ve `GET /sessions/:id` artık `budget` alanı da dönüyor (DESIGN.md 12.6)
   - `app/src/routes/admin/budgetPolicies.ts` (`/api/admin/budget-policies`) — CRUD + scope validasyonu (skill/user scope_id'nin gerçekten var olduğu kontrol edilir; `global` scope Postgres'te NULL scope_id yüzünden DB unique'i tarafından korunmadığından tekrarlar uygulama katmanında engelleniyor) + `GET /usage-overview?aiProviderId=` (DESIGN.md 12.7 — provider'a erişimi olan her kullanıcı için, atanmış her skill'de etkin limit/kullanım/kalan/kaynak)
   - Yan sağlamlaştırma: `DELETE /api/admin/ai-providers/:id` ve `DELETE /api/admin/skills/:id`, kullanım geçmişi (RESTRICT FK) yüzünden düz bir 500 fırlatıyordu — testte yakalandı, artık `app/src/lib/prismaErrors.ts`'teki `isForeignKeyRestrictError` ile tespit edilip düzgün `409` dönüyor (not: bu ihlal Prisma'da `P2003` değil, `.code`'suz bir `PrismaClientUnknownRequestError` olarak geliyor — mesaj içeriğine bakmak gerekti)
   - Uçtan uca Neon DB'ye karşı test edildi: policy CRUD + duplicate/scope validasyonu, `GET /ai-providers?skillId=`/`GET /sessions/:id` bütçe alanı, rollup upsert'in hem skill'li hem skill'siz (partial index) yolda doğru topladığı (aynı satırı iki kez arttırıp tekilliği doğrulayarak), gerçek bir aşım senaryosunda mesajın engellenip hiç persist edilmediği, usage-overview, ve FK-409 düzeltmesi
10. **MCP tool çağrısı entegrasyonu** (DESIGN.md Bölüm 9, karar: bkz. Bölüm 8 "MCP Server internal HTTP API") —
    - **Mimari sapma (bilinçli)**: `mcp-server/` artık resmi MCP SDK'nın stdio/HTTP transport'unu kullanmıyor; bunun yerine sadece `127.0.0.1`'e bind olan, `x-internal-secret` header'ıyla korunan düz bir Express JSON API (`GET /tools?userId=`, `POST /tools/call`). Gerekçe: SDK'nın transport'u tekil istemci/oturum varsayıyor, bizim tek tüketicimiz (app/'nin chat akışı) ve multi-user + role bazlı yetkilendirme ihtiyacımız var. `@modelcontextprotocol/sdk` bağımlılığı ileride harici istemci desteği için projede duruyor, kullanılmıyor. Detay: DESIGN.md 7/8.
    - Paylaşılan kod: `app/src/lib/crypto.ts` → `packages/db/src/crypto.ts`'e taşındı; yeni `packages/db/src/mcpConnectionConfig.ts` (encrypt/mask/read connection_config), her ikisi `@tegrai/db`'den export ediliyor — hem app/ hem mcp-server/ aynı `ENCRYPTION_KEY` ile şifreleyip çözebiliyor. `app/src/routes/admin/{aiProviders,mcpIntegrations}.ts` bu paylaşılan yardımcıları kullanacak şekilde güncellendi (davranış aynı, sadece kod tekilleşti).
    - `mcp-server/src/toolProvider.ts` — **sadece `http_api`** tipi, `isEnabled=true` entegrasyonlar desteklenir (database/file_share/smtp_mail/internal_tool listeye hiç girmez). Her entegrasyon, AI'ye tek genel bir "HTTP çağrısı yap" tool'u olarak sunulur (`{method, path, query, body}` — admin panelindeki serbest `tool_schema` alanı şu an kullanılmıyor). Kullanıcının role'lerinden gelen `role_mcp_permissions.allowedOperations` (izinli HTTP metodları, union) ve `getFilters` (AI'nin query'sini **ezen** zorunlu parametreler, merge) uygulanır.
    - `mcp-server/src/index.ts` — Express app, `MCP_PORT` (varsayılan 3100), `MCP_INTERNAL_SECRET` ile korunuyor.
    - `app/src/lib/mcpClient.ts` — chat.ts'in mcp-server'a bağlanan ince istemcisi; mcp-server'a ulaşılamazsa (henüz başlamamış, ağ hatası) hatayı yutup boş tool listesi döner — chat bot tool'suz, düz metin modunda çalışmaya devam eder.
    - `app/src/lib/aiClient.ts` yeniden yazıldı — `ChatTurn` yerine `HistoryMessage` (role user/assistant/tool + toolCallData), `generateReply` artık `tools: ToolSpec[]` alıyor ve `GenerateTurnResult` (`content`, `toolCalls`, token sayıları) dönüyor. Anthropic tarafında `tool_use`/`tool_result` blokları doğru inşa ediliyor (ardışık `tool` mesajları tek bir `user` turuna gruplanıyor); OpenAI tarafında `tool_calls`/`role:"tool"` formatı kullanılıyor.
    - `app/src/routes/chat.ts`'teki mesaj handler'ı bir **döngüye** dönüştürüldü (max 5 tur): her turda `generateReply` çağrılır, `assistant` mesajı (varsa `toolCallData` ile) kaydedilir; `toolCalls` varsa her biri `mcpClient.callTool` ile çalıştırılır ve sonuç `role:"tool"` mesajı olarak kaydedilip bir sonraki tura eklenir; `toolCalls` boşsa o turun içeriği nihai yanıt olur. Bütçe kontrolü hâlâ döngü başlamadan **önce** tek seferde yapılıyor (tool turları bütçeden düşülmüyor, sadece tüm turların token toplamı tek bir `recordUsage` çağrısıyla kaydediliyor — DESIGN.md 12.5 ile tutarlı). Yanıt şekli değişti: `{userMessage, assistantMessage}` yerine `{userMessage, messages: [...]}` (döngüdeki tüm assistant+tool mesajları).
    - **Test kapsamı**: `mcp-server`'ın `/tools` ve `/tools/call`'ı gerçek bir httpbin.org entegrasyonuna karşı uçtan uca test edildi (izinli/izinsiz metod, `getFilters`'ın AI'nin query'sini ezdiği, bilinmeyen tool, rolsüz kullanıcı — hepsi doğru). `aiClient.ts`'in Anthropic/OpenAI istek gövdesi üretimi, `fetch` mock'lanarak doğrulandı.
    - **Gerçek Anthropic key ile uçtan uca doğrulandı (2026-09-19, kullanıcı kendi API key'ini verdi)**: Gerçek bir `claude-sonnet-5` sağlayıcısı + httpbin.org entegrasyonu + `allowedOperations:["get"]`/`getFilters:{"forced_by_role":"yes"}` izniyle canlı bir sohbet oturumu açıldı. "Elindeki HTTP API tool'unu kullanarak /get yoluna GET isteği at" mesajına karşı model gerçekten `tool_use` döndürdü, mcp-server isteği httpbin'e attı (role'ün zorunlu filtresi query'de göründü), model sonucu (origin IP) doğru şekilde özetledi — tüm döngü (assistant→tool→assistant, 2 mesaj + final) beklendiği gibi çalıştı ve tek bir `ai_usage_records` satırında iki turun token toplamı (1636 prompt + 139 completion) doğru şekilde kaydedildi. Ayrıca tool gerektirmeyen düz bir soru da (tek turda, toolCalls olmadan) doğru cevaplandı. Test sonrası gerçek key'i içeren provider ve tüm test verileri silindi — DB'de kalıcı iz bırakılmadı. **Bu, önceki "sadece mock/regresyon test edildi" notunu geçersiz kılar — tool-calling artık gerçek bir modelle uçtan uca doğrulanmış durumda.**
11. **LDAP login** (DESIGN.md 8, karar 170) —
    - `app/src/lib/ldap.ts` — `authenticateLdapUser(email, password)`: (1) servis hesabıyla (`LDAP_BIND_DN`/`LDAP_BIND_PASSWORD` tanımlıysa, yoksa anonim) `LDAP_USER_SEARCH_FILTER` (`{{input}}` placeholder'lı, varsayılan `(mail={{input}})`) ile kullanıcıyı arayıp DN'ini bulur, (2) o DN'e kullanıcının verdiği şifreyle **ayrı bir bağlantıdan** bind ederek doğrular. Arama filtresine gömülen kullanıcı girdisi RFC 4515'e göre escape ediliyor (filter injection'a karşı). Attribute isteğini `mail`/`displayName` gibi belirli alanlarla sınırlamak yerine tüm attribute'lar isteniyor — bazı LDAP istemci/sunucu kombinasyonlarında çoklu attribute filtresi beklenmedik şekilde davranabiliyor (test sırasında karşılaşıldı, bkz. aşağıdaki not).
    - `app/src/routes/auth.ts`'teki `POST /api/auth/login` artık tek giriş noktası: email yerel `users` tablosunda `authSource=local` bir kayıtla eşleşiyorsa eskisi gibi bcrypt; eşleşme yoksa (veya kayıt `authSource=ldap` ise) LDAP denenir, başarılıysa `prisma.user.upsert` ile yerel kayıt login anında oluşturulur/güncellenir (just-in-time sync: `fullName`, `ldapDn` LDAP'tan, `passwordHash` hep `null`). Deaktive edilmiş (`isActive=false`) bir kullanıcı — local ya da ldap fark etmez — şifre doğru olsa bile 401 alır (bu kontrol authSource dallanmasından önce yapılıyor).
    - Env değişkenleri (`.env.example`'a eklendi, hepsi opsiyonel — tanımlı değilse LDAP login tamamen kapalı): `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_SEARCH_FILTER`, `LDAP_EMAIL_ATTR`, `LDAP_FULLNAME_ATTR`.
    - **Bilinen risk**: `ldapjs` paketinin bakımı maintainer tarafından 2024'te resmen bırakıldı ("decommissioned" — kişisel/etik nedenlerle, teknik bir kusur değil). Paket hâlâ çalışıyor ve Node ekosisteminde bu iş için en yaygın kütüphane olmaya devam ediyor; DESIGN.md'nin zaten kararlaştırdığı kütüphane olduğu için değiştirilmedi, ama uzun vadede alternatif değerlendirmesi (fork, farklı paket, ya da maintainer'ın önerdiği gibi ayrı bir gateway) gündeme gelebilir.
    - **Uçtan uca gerçek şekilde test edildi**: `ldapjs`'in kendi `createServer()` API'siyle geçici, tek kullanıcılı bir test LDAP sunucusu (localhost:1389) kurulup gerçek bir bind+search akışına karşı doğrulandı — doğru şifre → başarılı login + DB'de yeni `ldap` kullanıcısı oluşturuluyor (`passwordHash=null`, `ldapDn` dolu); yanlış şifre → 401; bilinmeyen kullanıcı → 401; filter injection denemesi (`*)(mail=*`) → 401 (escape çalışıyor); tekrar login aynı kullanıcı id'sini kullanıyor (upsert doğru); admin panelinden `isActive=false` yapılan bir ldap kullanıcısı, doğru LDAP şifresiyle bile login olamıyor. Test verileri (DB kaydı, `.env`'e eklenen geçici `LDAP_*` değişkenleri, test sunucusu scripti) temizlendi.
12. Git deposu: https://github.com/tolgaisbir/entegrai.git — 2 commit push edildi (scaffold + AI providers CRUD); bu oturumdaki commit'ler henüz push edilmedi.

## Bilinen eksikler / ertelenen teknik notlar

- **MCP tool çağrısı sadece `http_api` tipini destekliyor** — `database`/`file_share`/`smtp_mail`/`internal_tool` entegrasyonları hiç tool olarak sunulmuyor (bkz. madde 10). `smtp_mail` için DESIGN.md 9.1'deki ekstra onay/audit-log gereksinimleri de henüz yok.
- **OpenAI tarafı gerçek bir key ile hiç test edilmedi** — sadece Anthropic ile canlı doğrulandı (bkz. madde 10); OpenAI'nin `tool_calls`/`role:"tool"` serileştirmesi sadece mock fetch ile doğrulandı.
- Şablon (`templates`, Bölüm 10) hiç yazılmadı — `template_ai_transform` kaynaklı `ai_usage_records` şu an teorik, hiç üretilmiyor. `template.create_from_session` gibi MCP üzerinden şablon oluşturma tool'ları (10.6) da yok.
- Admin panelinin **frontend'i** (React) henüz yok — sadece backend API'leri var. Chat bot arayüzü de yok.
- `isActive=false` yapılan son admin kullanıcısı için bir koruma yok (sadece rol kaldırma/silme korunuyor) — düşük öncelikli, admin panelden dikkatli kullanım gerekiyor.
- `mcp-integrations`/`roles` silme uçlarında aynı FK-409 sağlamlaştırması yapılmadı (aiProviders/skills'te yapıldı) — artık mcp_integrations'a bağımlı gerçek veri (role_mcp_permissions zaten cascade, ama ileride mail_send_logs/template_steps RESTRICT olabilir) üretilebileceğinden, bu tabloya dokunan bir sonraki özellik bu deseni de eklemeli.

## Sırada ne var (bir sonraki oturumda buradan devam)

Auth (local + LDAP) + Kullanıcı/Skill/Role CRUD + Chat Bot temel akışı + Bütçe Yönetimi + MCP tool çağrısı (http_api, gerçek Anthropic key ile uçtan uca doğrulandı) tamamlandı. Sırada, öncelik sırasına göre:
- **Şablonlar (Template)** (DESIGN.md Bölüm 10) — MCP tool çağrısı artık var, üzerine kurulabilir.
- Admin panel/chat bot **frontend'i (React)** henüz hiç başlanmadı — backend'in büyük kısmı bittiğine göre bir noktada gündeme gelmeli.
- Bu oturumdaki commit'ler henüz `git push` edilmedi — bir sonraki oturumda önce `git status`/`git log` ile kontrol edip push'u tamamlamak gerekebilir.
