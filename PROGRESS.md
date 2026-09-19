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
- `/.env` — `DATABASE_URL` (Neon Postgres), `PORT`, `ENCRYPTION_KEY`
- `/packages/db/.env` — sadece `DATABASE_URL` (Prisma CLI için)

Bu iki dosya bu makinede zaten mevcut ve dolu. **Başka bir makineye geçilirse** yeniden oluşturulmaları gerekir — `ENCRYPTION_KEY` kaybolursa mevcut `ai_providers.apiKeyEncrypted` alanları çözülemez hale gelir (yeniden şifrelemek gerekir).

DB: Neon Postgres (`neondb`), ilk migration (`20260918234541_init`) uygulanmış durumda.

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
7. Git deposu: https://github.com/tolgaisbir/entegrai.git — 2 commit push edildi (scaffold + AI providers CRUD); bu oturumdaki commit'ler henüz push edilmedi.

## Bilinen eksikler / ertelenen teknik notlar

- `packages/db/prisma/schema.prisma` içindeki `ai_usage_monthly_rollup` tablosunda bir yorum var: Postgres'te NULL `skill_id` değerleri unique kısıtlamayı düzgün uygulamıyor. Bütçe modülünü (Bölüm 12) kodlarken bir partial unique index (COALESCE ile) eklenerek düzeltilecek.
- Henüz kimlik doğrulama (auth) yok — tüm admin API'leri şu an açık/korumasız. `users.passwordHash` artık hashleniyor ama login/session akışı yazılmadı.
- İlk kurulumda otomatik oluşturulması gereken varsayılan admin kullanıcısı + `is_admin` sistem role'ü için seed script henüz yazılmadı (DESIGN.md 4.3 son not).
- `mcp-server/` sadece boş bir MCP server iskeleti; dinamik tool yükleme (mcp_integrations tablosundan) ve şablon yönetim tool'ları (10.6) henüz yazılmadı.
- Admin panelinin **frontend'i** (React) henüz yok — sadece backend API'leri var.

## Sırada ne var (bir sonraki oturumda buradan devam)

Kullanıcı/Skill/Role CRUD tamamlandı — DESIGN.md Bölüm 5'teki tüm admin panel ekranlarının backend'i (12.7 Bütçe hariç) bitti. Sırada, öncelik sırasına göre:
- **Auth (login/session)** — artık `users.passwordHash` hazır olduğuna göre mantıklı sıradaki adım: login endpoint'i, session/JWT, admin API'lerini `is_admin` role'üne göre koruma.
- Ya da **Bütçe (Budget) Yönetimi** (DESIGN.md Bölüm 12) — `role_mcp_permissions`/`role_ai_providers` artık var, bütçe modülü bunların üstüne kurulabilir; NULL `skill_id` unique kısıtlama düzeltmesi de bu sırada yapılmalı.
- Bu oturumdaki commit'ler henüz `git push` edilmedi — bir sonraki oturumda önce `git status`/`git log` ile kontrol edip push'u tamamlamak gerekebilir.
