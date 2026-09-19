# İlerleme Durumu / Devam Rehberi

> Bu dosya DESIGN.md'nin (mimari/tasarım) aksine, **neyin yapıldığını, projenin nasıl çalıştırılacağını ve sırada ne olduğunu** takip eder. Yeni bir oturuma başlarken önce bu dosyayı, sonra DESIGN.md'yi okuyun.

## Nasıl çalıştırılır

```bash
# Bağımlılıklar zaten kurulu (node_modules mevcut). Yeni bir makinede:
npm install

# Ana uygulama (chat bot + admin API) — http://localhost:3000
npm run dev:app

# MCP server (ayrı servis, henüz minimal iskelet)
npm run dev:mcp
```

**Gerekli `.env` dosyaları** (git'e dahil değil, `.env.example`'a bakın):
- `/.env` — `DATABASE_URL` (Neon Postgres), `PORT`, `ENCRYPTION_KEY`, `JWT_SECRET`
- `/packages/db/.env` — sadece `DATABASE_URL` (Prisma CLI + seed script için)

Bu iki dosya bu makinede zaten mevcut ve dolu. **Başka bir makineye geçilirse** yeniden oluşturulmaları gerekir — `ENCRYPTION_KEY` kaybolursa mevcut `ai_providers.apiKeyEncrypted`/`mcp_integrations.connection_config` şifreli alanları çözülemez hale gelir (yeniden şifrelemek gerekir); `JWT_SECRET` değişirse verilmiş tüm login token'ları geçersiz olur (zararsız, kullanıcılar tekrar login olur).

DB: Neon Postgres (`neondb`), migrationlar (`20260918234541_init`, `20260919082231_add_must_change_password`, `20260919102728_fix_rollup_null_skill_unique`) uygulanmış durumda.

**İlk kurulum / varsayılan admin**: `npm run db:seed` — `is_admin` sistem role'ünü ve `admin@company.local` kullanıcısını (geçici şifre konsola basılır, `mustChangePassword=true`) oluşturur. Zaten varsa dokunmaz. Bu makinede zaten çalıştırıldı; admin şifresi test sırasında `newpassword123` olarak değiştirildi (sadece bu dev DB'de, gerçek ortamda olmaz).

## Şu ana kadar tamamlananlar

1. **DESIGN.md** — tüm mimari/veri modeli tartışması ve kararları içeriyor (13 bölüm). Yeni bir talep geldiğinde önce oraya işlenir.
2. **Proje iskeleti** — npm workspaces monorepo: `app/` (Express+TS), `mcp-server/` (MCP SDK+TS, minimal), `packages/db/` (Prisma şeması, DESIGN.md'deki tüm tablolar).
3. **AI Sağlayıcı Yönetimi CRUD** (DESIGN.md 5.1) — `app/src/routes/admin/aiProviders.ts`
   - `GET/POST /api/admin/ai-providers`, `GET/PATCH/DELETE /api/admin/ai-providers/:id`, `POST /:id/test`
   - API key'ler AES-256-GCM ile şifreli (`app/src/lib/crypto.ts`), yanıtlarda sadece maskeli (`apiKeyPreview`) dönüyor
   - Anthropic/OpenAI için gerçek bağlantı testi; diğer provider tipleri için "desteklenmiyor" mesajı
   - Uçtan uca Neon DB'ye karşı test edildi (create/list/patch/test/delete)
4. **Global hata yönetimi** — `app/src/lib/asyncHandler.ts` + `index.ts`'deki error handler middleware (Express 4'te yakalanmayan async hatalar artık process'i çökertmiyor, 500 JSON dönüyor).
5. **MCP Entegrasyonları CRUD** (DESIGN.md 5.2) — `app/src/routes/admin/mcpIntegrations.ts`
   - `GET/POST /api/admin/mcp-integrations`, `GET/PATCH/DELETE /api/admin/mcp-integrations/:id`, `POST /:id/test`
   - `connection_config` (JSONB) içindeki hassas alanlar (adında `key`/`password`/`secret`/`token`/`connectionString` geçenler) AES-256-GCM ile şifrelenip DB'ye yazılıyor, yanıtlarda maskeli dönüyor (aiProviders'daki `apiKeyPreview` deseninin JSON'a genellenmiş hali)
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
   - `app/src/routes/auth.ts` — `POST /api/auth/login` (email+password, sadece `authSource=local`; `ldap` için 501 döner), `GET /api/auth/me`, `POST /api/auth/change-password` (mevcut şifre doğrulanır, `mustChangePassword` sıfırlanır)
   - `app/src/routes/admin.ts`'e `adminRouter.use(requireAdmin())` eklendi — tüm `/api/admin/*` artık `is_admin` role'üne sahip, aktif, şifresini değiştirmiş bir kullanıcı gerektiriyor
   - `packages/db/prisma/seed.ts` (+ `npm run db:seed`) — `is_admin` sistem role'ünü ve varsayılan admin kullanıcısını (`admin@company.local`, rastgele geçici şifre, `mustChangePassword=true`) oluşturur, idempotent
   - Uçtan uca test edildi: token'sız `/api/admin/*` → 401; yanlış şifre → 401; doğru login → token + `mustChangePassword:true`; şifre değişmeden admin erişimi → 403 `must_change_password`; `change-password` sonrası admin erişimi → 200
   - LDAP login **henüz uygulanmadı** (bkz. aşağıdaki eksikler)
   - Yan güvenlik düzeltmesi: `PUT /api/admin/users/:id/roles` ve `DELETE /api/admin/users/:id`, son `is_admin` kullanıcısını kaldırmayı/silmeyi engelliyor (`cannot_remove_last_admin` / `cannot_delete_last_admin`) — testler sırasında admin'in tek rolünü değiştirip kendimi kilitleyerek keşfettim, doğrudan Prisma script'iyle DB'den düzeltip sonra bu korumayı ekledim.
8. **Chat Bot temel akışı** (DESIGN.md Bölüm 6) — `app/src/routes/chat.ts` (tamamı `requireAuth()` ile korumalı)
   - `GET /api/chat/skills` — kullanıcının atanmış skill'leri; `GET /api/chat/ai-providers` — kullanıcının role'leri üzerinden erişebildiği AI sağlayıcılar (`role_ai_providers` distinct)
   - `POST /api/chat/sessions` — `skillId` kullanıcıya atanmış olmalı, `aiProviderId` verilmezse erişilebilir sağlayıcılardan (varsa `isActive`) otomatik seçilir
   - `GET /api/chat/sessions` — kullanıcının oturumları, skill'e göre gruplanmış (sol frame için)
   - `GET/PATCH/DELETE /api/chat/sessions/:id` — sahiplik kontrolü (başka kullanıcının oturumuna 404)
   - `POST /api/chat/sessions/:id/messages` — kullanıcı mesajını kaydeder, ilk mesajsa `title`'ı otomatik doldurur, `app/src/lib/aiClient.ts` ile seçili sağlayıcıya (Anthropic Messages API / OpenAI Chat Completions) tüm geçmişle birlikte gerçek istek atar, yanıtı `assistant` mesajı olarak kaydeder; sağlayıcı hata dönerse kullanıcı mesajı korunur, `502 ai_provider_error` döner
   - MCP tool çağrısı desteği (`role_mcp_permissions`/`get_filters` uygulanması) **henüz yok** — mcp-server dinamik tool yüklemesi tamamlanınca eklenecek
   - Token/maliyet kaydı (`ai_usage_records`) **henüz yok** — Bütçe modülüyle (Bölüm 12) birlikte eklenecek
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
10. Git deposu: https://github.com/tolgaisbir/entegrai.git — 2 commit push edildi (scaffold + AI providers CRUD); bu oturumdaki commit'ler henüz push edilmedi.

## Bilinen eksikler / ertelenen teknik notlar

- **LDAP login uygulanmadı** — `ldapjs` ile bind + login-time sync (DESIGN.md 8, karar 170) henüz yazılmadı; şu an sadece `authSource=local` kullanıcılar login olabiliyor, `ldap` kullanıcılar `POST /api/auth/login`'de 501 alır.
- **MCP tool çağrısı chat akışına henüz entegre değil** — chat bot şu an sadece düz metin AI sohbeti yapıyor, `mcp_integrations`/`role_mcp_permissions` üzerinden tool çağırma yok. Bütçe modülündeki "MCP tabanlı deterministik adımlar bütçeden etkilenmez" kuralı (12.5) henüz uygulanacak bir şey yok çünkü MCP çağrısı yok.
- Şablon (`templates`, Bölüm 10) hiç yazılmadı — `template_ai_transform` kaynaklı `ai_usage_records` şu an teorik, hiç üretilmiyor.
- `mcp-server/` sadece boş bir MCP server iskeleti; dinamik tool yükleme (mcp_integrations tablosundan) ve şablon yönetim tool'ları (10.6) henüz yazılmadı.
- Admin panelinin **frontend'i** (React) henüz yok — sadece backend API'leri var. Chat bot arayüzü de yok.
- `isActive=false` yapılan son admin kullanıcısı için bir koruma yok (sadece rol kaldırma/silme korunuyor) — düşük öncelikli, admin panelden dikkatli kullanım gerekiyor.
- `mcp-integrations`/`roles` silme uçlarında aynı FK-409 sağlamlaştırması yapılmadı (aiProviders/skills'te yapıldı) — şu an bu tablolara bağımlı veri üreten bir akış (template/mcp tool çağrısı) olmadığından pratikte tetiklenmiyor, ama template/MCP entegrasyonu yazılırken aynı `isForeignKeyRestrictError` deseniyle eklenmeli.

## Sırada ne var (bir sonraki oturumda buradan devam)

Auth + Kullanıcı/Skill/Role CRUD + Chat Bot temel akışı + Bütçe Yönetimi tamamlandı — DESIGN.md Bölüm 5, 6, 8 ve 12'nin backend'i bitti. Sırada, öncelik sırasına göre:
- **MCP tool çağrısı entegrasyonu** — `mcp-server`'da dinamik tool yükleme + chat akışının bu tool'ları çağırabilmesi (role_mcp_permissions/get_filters uygulanması); bu olmadan Bölüm 9'daki entegrasyon tipleri (`http_api`, `database`, `smtp_mail` vb.) fiilen kullanılamıyor.
- Ya da **LDAP login** — `ldapjs` ile bind + login-time sync.
- Ya da **Şablonlar (Template)** (DESIGN.md Bölüm 10) — MCP tool çağrısına bağımlı, muhtemelen ondan sonra gelmeli.
- Admin panel/chat bot **frontend'i (React)** henüz hiç başlanmadı — backend'in büyük kısmı bittiğine göre bir noktada gündeme gelmeli.
- Bu oturumdaki commit'ler henüz `git push` edilmedi — bir sonraki oturumda önce `git status`/`git log` ile kontrol edip push'u tamamlamak gerekebilir.
