# Kurumsal Chat Bot + MCP Server — Temel Tasarım

> Durum: TASLAK — bu doküman tartışma zemini olarak güncellenmeye devam ediyor. Aşağıdaki tüm bölümler değiştirilebilir/silinebilir/genişletilebilir.

## 1. Amaç

Şirket içinde kullanılacak, piyasadaki API tabanlı yapay zeka sağlayıcılarına (OpenAI, Anthropic, Google, Azure OpenAI vb.) bağlanabilen bir chat bot uygulaması kurmak. Sistem şu ana bileşenleri içerir:

1. **AI Sağlayıcı Yönetimi** — Chat bot'un hangi yapay zeka servisini/servislerini, hangi ayarlarla (API key, model, parametreler) kullanacağının tanımlandığı admin ekranı.
2. **MCP Entegrasyon Yönetimi** — MCP server üzerinden dışarıya açılan entegrasyonların (araçlar/tools, bağlantı bilgileri vb.) tanımlandığı ve yönetildiği admin ekranı.
3. **Kullanıcı & Yetkilendirme Yönetimi** — Kullanıcıların manuel veya LDAP üzerinden tanımlandığı, kendilerine **skill** (departman/görev/yetkinlik) ve **role** (MCP API erişim yetkisi) atandığı admin ekranı.

## 2. Kapsam Dışı (şimdilik)

- Çoklu şirket/tenant desteği (ileride değerlendirilebilir)
- Mesaj geçmişinin uzun vadeli analitiği/raporlama (dashboard/istatistik ileride eklenebilir)

## 3. Genel Mimari

```
┌──────────────────────────────────────────────────────────┐
│                     Uygulama (tek servis)                  │
│  ┌───────────────────┐        ┌──────────────────────┐    │
│  │  Chat Bot Arayüzü   │◄──────►│  Admin Panel (route)  │    │
│  │  (sol frame: skill  │        │  - AI Ayarları         │    │
│  │   bazlı chat history)│       │  - MCP Entegrasyonları │    │
│  │                     │        │  - Kullanıcı/Rol/Skill│    │
│  └──────────┬──────────┘        └──────────┬────────────┘    │
└─────────────┼────────────────────────────────┼───────────────┘
              │                                │
              ▼                                ▼
       ┌────────────────────────────────────────┐
       │              PostgreSQL                  │
       │  - ai_providers                          │
       │  - users / roles / skills (n:n tablolar) │
       │  - mcp_integrations                      │
       │  - chat_sessions / chat_messages         │
       │    (1 yıl saklama, sonrası temizlik job) │
       └──────────────────┬───────────────────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │   MCP Server        │
                 │  (ayrı servis)      │
                 │  - role bazlı API   │
                 │    erişimi + GET    │
                 │    filtreleri       │
                 └────────────────────┘
```

Bileşenler:

- **Uygulama (Node.js)**: Chat bot arayüzü ve admin panel aynı uygulama içinde, farklı route'lar olarak sunulur.
- **Chat Bot**: Kullanıcının kendisine atanmış **skill**'lerden birini seçerek o bağlamda sohbet etmesini sağlar; aktif AI sağlayıcı ayarına göre ilgili API'ye istek atar, gerekirse kullanıcının **role**'üne göre MCP server üzerindeki tool'ları çağırır. Sol frame'de chat geçmişi skill'lere göre gruplanarak listelenir.
- **Admin Panel**: AI sağlayıcı ayarları, MCP entegrasyon tanımları ve kullanıcı/rol/skill yönetimini kapsayan tek arayüz.
- **MCP Server**: Ayrı bir servis olarak çalışır; `mcp_integrations` tablosundaki kayıtlara göre dinamik tool tanımları oluşturur ve çağıran kullanıcının rolüne göre erişim/filtre uygular.
- **PostgreSQL**: Tüm konfigürasyon + kullanıcı/yetki + chat geçmişinin tutulduğu veritabanı (SQLite yerine, chat history hacmi ve ileri seviye sorgu ihtiyacı nedeniyle tercih edildi).

## 4. Veri Modeli (taslak)

### 4.1 `ai_providers` (AI sağlayıcı tanımları)

| Alan | Tip | Açıklama |
|---|---|---|
| id | PK | |
| name | TEXT | Görünen ad (ör. "Şirket İçi GPT-4o") |
| provider_type | TEXT | `openai` \| `anthropic` \| `azure_openai` \| `google` \| ... |
| api_base_url | TEXT | Opsiyonel, özel endpoint |
| api_key_encrypted | TEXT | Şifrelenmiş API anahtarı |
| model | TEXT | ör. `gpt-4o`, `claude-sonnet-5` |
| default_params | JSONB | temperature, max_tokens, system_prompt vb. **+ fiyatlandırma** (`price_per_1k_input_usd`, `price_per_1k_output_usd`) — bkz. 12.1, ayrı bir `ai_provider_pricing` tablosu yerine burada tutulur |
| is_active | BOOLEAN | Chat bot'un şu an kullandığı sağlayıcı mı |
| created_at / updated_at | TIMESTAMP | |

### 4.2 `mcp_integrations` (MCP entegrasyon tanımları)

| Alan | Tip | Açıklama |
|---|---|---|
| id | PK | |
| name | TEXT | Entegrasyon adı |
| type | TEXT | ör. `http_api`, `database`, `internal_tool` |
| connection_config | JSONB | URL, auth bilgisi, headers vb. (hassas alanlar şifreli) |
| tool_schema | JSONB | MCP tool tanımı (input/output şeması) |
| is_enabled | BOOLEAN | |
| created_at / updated_at | TIMESTAMP | |

### 4.3 Kullanıcı & Yetkilendirme

- **`users`**: id, full_name, email, auth_source (`local` \| `ldap`), password_hash (local ise), ldap_dn (ldap ise), is_active, must_change_password (BOOLEAN, varsayılan false — ilk kurulumda seed edilen admin için true), created_at.
- **`skills`**: id, name, description — kullanıcının departman/görev/yetkinlik tanımı (ör. "Muhasebe", "Satış Sonrası Destek"). Bir kullanıcıya birden fazla skill atanabilir (`user_skills` n:n tablosu).
- **`roles`**: id, name, description — MCP server üzerinden erişilebilecek API'leri ve bu API'lere özel GET request filtrelerini tanımlar. Bir kullanıcıya birden fazla role atanabilir (`user_roles` n:n tablosu).
- **`role_mcp_permissions`**: role_id, mcp_integration_id, allowed_operations (JSONB — hangi tool/endpoint'lere izinli), get_filters (**serbest JSONB** — o role için zorunlu query filtreleri, ör. sadece kendi bölgesindeki kayıtlar; standart bir filtre DSL'i uygulanmayacak).
- **`role_ai_providers`**: role_id, ai_provider_id — bir role'e hangi AI sağlayıcılarının kullanım izni verildiğini tanımlar. Kullanıcı, sahip olduğu role(lar) üzerinden erişebildiği AI sağlayıcılar arasından seçim yapar (sağlayıcı ataması doğrudan kullanıcıya değil, role'e yapılır).
- **`user_skills`**: user_id, skill_id.
- **`user_roles`**: user_id, role_id.
- **`is_admin` role'ü**: Özel bir sistem role'ü (`roles` tablosunda `is_system = true` gibi bir bayrakla işaretlenebilir) — admin panele erişim bu role üzerinden kontrol edilir. İlk kurulumda (migration/seed script) bu role'e sahip bir varsayılan admin kullanıcısı otomatik oluşturulur (ör. `admin@company.local`, ilk girişte şifre değişikliği zorunlu).

> Not: Skill = "hangi bağlamda chat yapıyor / hangi departman-görev kimliğiyle" ; Role = "hangi MCP API'lere, hangi AI sağlayıcılara ve hangi filtrelerle erişebilir + admin paneline erişimi var mı". İkisi birbirinden bağımsız ama birlikte kullanıcının chat bot deneyimini şekillendirir.

### 4.4 `chat_sessions` / `chat_messages`

| Alan (chat_sessions) | Tip | Açıklama |
|---|---|---|
| id | PK | |
| user_id | FK → users | |
| skill_id | FK → skills | Sohbetin hangi skill bağlamında başlatıldığı (sol frame gruplaması bu alana göre yapılır) |
| ai_provider_id | FK → ai_providers | |
| title | TEXT | Otomatik/özet başlık |
| created_at / updated_at | TIMESTAMP | |

| Alan (chat_messages) | Tip | Açıklama |
|---|---|---|
| id | PK | |
| session_id | FK → chat_sessions | |
| role | TEXT | `user` \| `assistant` \| `tool` |
| content | TEXT | |
| tool_call_data | JSONB | MCP tool çağrısı yapıldıysa detayları |
| created_at | TIMESTAMP | |

**Saklama politikası**: Chat geçmişi saklama süresi admin panelinden parametrik olarak ayarlanabilir (ör. `system_settings` tablosunda `chat_retention_days`, varsayılan 365). Süresi dolan kayıtlar periyodik bir temizlik job'u (cron) ile **kalıcı olarak silinir** (arşivleme yapılmaz).

## 5. Admin Panel Ekranları (taslak)

1. **AI Ayarları**
   - Sağlayıcı listesi (CRUD), aktif sağlayıcı seçimi, API key girişi (maskeli), model/parametre düzenleme, bağlantı testi.

2. **MCP Entegrasyonları**
   - Entegrasyon listesi (CRUD), bağlantı bilgisi/auth formu, tool şeması düzenleme, aktif/pasif toggle, bağlantı testi.

3. **Kullanıcı Yönetimi**
   - Kullanıcı listesi (manuel ekleme veya LDAP senkronizasyonu)
   - Kullanıcıya skill(ler) atama (çoklu seçim)
   - Kullanıcıya role(ler) atama (çoklu seçim)

4. **Skill Yönetimi**
   - Skill CRUD (departman/görev/yetkinlik tanımları).

5. **Role Yönetimi**
   - Role CRUD
   - Role başına: hangi MCP entegrasyonlarına/tool'larına erişim izni var, GET isteklerinde uygulanacak filtreler

## 6. Chat Bot Deneyimi

- Kullanıcı giriş yaptığında kendisine atanmış skill'ler arasından birini seçer (veya varsayılan skill otomatik seçilir).
- Sol frame'de chat geçmişi, skill'lere göre gruplanmış şekilde listelenir (her skill bir klasör/grup gibi davranır).
- Chat sırasında MCP tool çağrısı gerektiğinde, kullanıcının sahip olduğu role'lere tanımlı izinler ve GET filtreleri uygulanır — kullanıcı yetkisi olmayan API'lere erişemez, yetkili olduğu API'lerde de sadece izin verilen filtre kapsamındaki veriyi görebilir.

## 7. Teknoloji Kararları

- **Backend**: Node.js (Express/Fastify)
- **DB**: PostgreSQL
- **Admin Panel Frontend**: React + basit bir UI kit (ör. shadcn/ui, MUI); admin panel, chat bot ile aynı uygulama içinde ayrı route'lar olarak sunulur. **Uygulama notu**: "basit bir UI kit" yerine bağımlılık/kurulum yükünü azaltmak için custom, minimal CSS (`web/src/styles.css`) tercih edildi — shadcn/MUI gibi bir kit ileride görsel olgunlaştırma ihtiyacı olursa eklenebilir. Frontend, `web/` adında ayrı bir workspace (Vite + React 19 + TypeScript + react-router + @tanstack/react-query); prod build'i `app/`'nin static olarak servis ettiği `web/dist/`'e çıkar (dev'de Vite kendi portunda çalışıp `/api`'yi `app/`'ye proxy'ler) — böylece "aynı uygulama içinde ayrı route'lar" tek bir Express sunucusu + istemci taraflı routing ile sağlanmış olur.
- **Kullanıcı Kaynağı**: Manuel eklenen kullanıcılar + LDAP entegrasyonu (şirketin mevcut dizin servisiyle senkronizasyon).
- **MCP Server**: Ayrı bir servis (`mcp-server/`) olarak çalışır; `mcp_integrations` tablosundaki kayıtlara göre dinamik tool tanımları oluşturur, çağıran kullanıcının role'üne göre erişim/filtre uygular. **Uygulama notu (bkz. 8. Kararlaştırılan Noktalar)**: ilk sürümde resmi MCP SDK'nın transport katmanı yerine, sadece localhost'ta çalışan, paylaşılan bir sırla korunan basit bir internal HTTP JSON API kullanılıyor — SDK bağımlılığı ileride harici MCP istemci desteği (ör. doğrudan Claude Desktop bağlantısı) gerektiğinde devreye alınmak üzere projede duruyor.
- **Güvenlik**: API key'ler ve bağlantı bilgileri DB'de şifreli (ör. AES-256) tutulur; admin paneline erişim kimlik doğrulama ile korunur.

## 8. Kararlaştırılan Noktalar

- [x] Backend: Node.js
- [x] DB: PostgreSQL (SQLite yerine, chat history hacmi nedeniyle)
- [x] Admin paneli, chat bot ile aynı uygulama içinde bir route
- [x] Kullanıcılara birden fazla skill ve role atanabilir (çoklu)
- [x] Rol bazlı: kullanıcı, kendisine atanan AI sağlayıcılar arasından seçim yapabilir
- [x] MCP server, ayrı bir servis olarak çalışır
- [x] Kullanıcı tanımlama: manuel + LDAP entegrasyonu desteklenecek
- [x] Chat geçmişi saklama süresi admin panelinden parametrik olarak ayarlanabilecek; süresi dolan kayıtlar kalıcı olarak silinecek (arşivleme yok)
- [x] Role bazlı AI sağlayıcı ataması ayrı bir tablo (`role_ai_providers`) ile yönetilecek
- [x] `role_mcp_permissions.get_filters` serbest JSONB olacak (standart DSL yok)
- [x] Admin paneline erişim ayrı bir sistem role'ü (`is_admin`/`is_system` işaretli role) ile kontrol edilecek; ilk kurulumda otomatik bir admin kullanıcısı seed edilecek
- [x] **LDAP entegrasyonu**: `ldapjs` kütüphanesi + **login-time (just-in-time) senkronizasyon** ile ilerlenecek. Kullanıcı login olduğunda LDAP'a bind edilir, bilgiler doğrulanır ve yerel `users` tablosuna o an yazılır/güncellenir. (İleride ihtiyaç görülürse ayrıca periyodik bir "pasifleştirme" job'u eklenebilir — şimdilik kapsam dışı.) **Not (uygulandı)**: `ldapjs`'in bakımı 2024'te maintainer tarafından bırakıldı ("decommissioned") ama paket hâlâ çalışıyor ve halihazırda ekosistemdeki standart seçenek; bilinen bir risk olarak kabul edilip yine de kullanıldı (bkz. PROGRESS.md). Kimlik doğrulama iki adımlı: (1) servis hesabıyla (veya `LDAP_BIND_DN` tanımlı değilse anonim) `LDAP_USER_SEARCH_FILTER`'a göre kullanıcı aranır ve DN'i bulunur, (2) o DN'e kullanıcının girdiği şifreyle ayrı bir bağlantıdan bind denenir — başarılıysa kimlik doğrulanmış sayılır. `POST /api/auth/login`'e giren email hem local hem ldap kullanıcıları için tek giriş noktası: önce yerel `users` tablosunda `authSource=local` bir eşleşme aranır (varsa bcrypt), yoksa (veya kayıt `authSource=ldap` ise) LDAP denenir. Deaktive edilmiş (`is_active=false`) bir kullanıcı, LDAP şifresi doğru olsa bile login olamaz.
- [x] Şablon onay ekranı: basit bir **adım listesi** yeterli (ayrı bir akış diyagramı gerekmiyor)
- [x] `result_html_template`: AI, chat'teki son görsel çıktıdan bir HTML taslağı **önerecek**; kullanıcı onaylar/düzenler
- [x] Zamanlanmış şablon çalıştırma: **ayrı bir worker servis** olarak çalışacak
- [x] `shared` şablonların MCP çağrıları, **çalıştıran kullanıcının** role/skill yetkisiyle çalışacak (şablon sahibinin değil)
- [x] `file_share` entegrasyonları: cache yok, **her seferinde dosya yeniden okunacak**
- [x] Zamanlanmış `ai_transform` adımları da aynı prensiple **çalıştıran kullanıcının** (zamanlanmış çalıştırmada: şablonun son çalıştırılmasını tetikleyen/sahibi olan kullanıcının) yetkisi ve bütçesi üzerinden işler
- [x] AI kullanımı için **bütçe (budget) yönetimi** eklenecek — global + skill bazlı + kullanıcı bazlı, kullanım/kalan görünürlüğü ile (bkz. yeni Bölüm 13)
- [x] **Auth mekanizması**: `local` kullanıcılar için `POST /api/auth/login` (email+password) ile imzalanmış **JWT bearer token** (henüz frontend olmadığından cookie/session yerine basit `Authorization: Bearer` başlığı tercih edildi). Tüm `/api/admin/*` uçları `is_admin` role'üne sahip, aktif ve `must_change_password=false` bir kullanıcı gerektirir. `ldap` kullanıcılar aynı uç noktadan, `ldapjs` ile bind + login-time (just-in-time) senkronizasyon üzerinden login olur (bkz. PROGRESS.md ve karar 170).
- [x] **Bütçe kontrolü zamanlaması**: Kalan bütçe, AI sağlayıcıya istek atılmadan **önce** (bir önceki duruma göre) kontrol edilir — isteğin gerçek maliyeti ancak yanıt döndükten sonra bilinebildiğinden, bütçeyi dolduran mesajın kendisi yine de gönderilir; bir sonraki mesaj engellenir. `daily` period için ayrı bir rollup tablosu yok, `ai_usage_records` üzerinden canlı sorgu ile hesaplanır (veri hacmi günlük pencerede küçük); `monthly` period `ai_usage_monthly_rollup`'tan okunur (bkz. 12.4).
- [x] **MCP Server, ilk sürümde resmi MCP SDK transport'u yerine internal HTTP API**: `mcp-server/`'ın tek tüketicisi app/'nin chat akışı ve tek dağıtım hedefi kendi ağımız olduğundan; SDK'nın stdio transport'u tek istemci/tek kullanıcı senaryosu için tasarlanmış, HTTP transport'u ise multi-user + role bazlı yetkilendirme için ekstra oturum/kimlik plumbing'i gerektiriyordu. Bunun yerine `mcp-server`, sadece `127.0.0.1`'e bind olan, `MCP_INTERNAL_SECRET` paylaşılan sırrıyla korunan düz bir Express JSON API sunar (`GET /tools?userId=`, `POST /tools/call`). `@modelcontextprotocol/sdk` bağımlılığı, ileride harici MCP istemcilerine (ör. Claude Desktop) doğrudan bağlanma desteği gerekirse kullanılmak üzere projede tutuluyor.
- [x] **Tool çağrısı kapsamı (ilk sürüm)**: Sadece `http_api` tipi `mcp_integrations` desteklenir; her entegrasyon, AI'ye tek, genel bir "HTTP çağrısı yap" tool'u (`{method, path, query, body}`) olarak sunulur — admin panelindeki `tool_schema` alanı şu an kullanılmıyor (ileride entegrasyona özel şema üretmek için devreye alınabilir). `role_mcp_permissions.allowed_operations`, izinli HTTP metodlarının listesi (ör. `["get"]`) olarak yorumlanır; `get_filters`, AI'nin gönderdiği query parametrelerini **ezerek** zorunlu kılınır. Bir kullanıcının birden fazla role'ü aynı entegrasyona farklı izin veriyorsa, `allowedOperations` birleşimi (union), `getFilters` merge edilir (çakışan anahtarda hangi role'ün kazanacağı tanımsızdır — pratik varsayım: son işlenenin değeri kazanır).

## 9. MCP Entegrasyon Tipleri (genişletme)

`mcp_integrations.type` alanı en az şu tipleri kapsayacak:

| Tip | Açıklama |
|---|---|
| `file_share` | Şirket içi ortak alanlardaki Excel/CSV dosyalarına erişim (ör. bir ağ paylaşımı/SharePoint yolu okuma) |
| `database` | Kullanılan yazılımların veritabanlarına salt-okunur bağlantı (connection string, izinli sorgular) |
| `http_api` | Şirket içi veya dışı özel API'ler |
| `internal_tool` | Diğer dahili araçlar/servisler |
| `smtp_mail` | Şirket SMTP sunucusu üzerinden mail gönderme (kullanıcı adına) — bkz. 9.1 |

Her tip için `connection_config` şeması farklılaşır (ör. `file_share` → dosya yolu + okuma sıklığı; `database` → connection string + izinli tablo/view listesi; `http_api` → base URL + auth).

### 9.1 `smtp_mail` — Kullanıcı adına mail gönderme

Evet, teknik olarak eklenebilir; ancak "kullanıcı adına gönderme" iki farklı yaklaşımla yapılabilir ve güvenlik/uyum açısından farkları önemli:

| Yaklaşım | Açıklama | Artı | Eksi |
|---|---|---|---|
| **A. Tek şirket SMTP relay + `From` başlığı kullanıcının adresi** | Uygulama tek bir servis hesabıyla şirket SMTP/relay sunucusuna (ör. Exchange relay, Postfix relay) bağlanır; giden mailin `From:` alanına isteği yapan kullanıcının mail adresi yazılır. | Kurulumu basit, tek kimlik bilgisi yönetimi yeterli | Relay sunucusu "From" spoofing'e izin vermelidir (genelde sadece iç ağdan/iç domain için açılır); dış SMTP sağlayıcılarında (Gmail/O365 doğrudan) bu genelde engellenir/SPF-DKIM uyumsuzluğu yaratır |
| **B. Kullanıcı bazlı OAuth ("send as") — ör. Microsoft Graph `sendMail` / Google Workspace API** | Her kullanıcı ilk kullanımda kendi hesabıyla OAuth izni verir; mail o kullanıcının gerçek hesabından, kendi yetkisiyle gönderilir. | Gerçek anlamda "kullanıcı adına", spoofing yok, SPF/DKIM sorunu yok, gönderilen mail kullanıcının "Sent Items" klasöründe de görünür | Ek OAuth entegrasyonu gerekir (Microsoft/Google), her kullanıcının en az bir kez izin vermesi gerekir |

**Öneri**: Şirket Microsoft 365 veya Google Workspace kullanıyorsa **B (OAuth send-as)** tercih edilmeli — daha güvenli ve denetlenebilir. Sadece dahili bir SMTP relay varsa ve dış dünyaya mail çıkmıyorsa **A** kabul edilebilir bir kısayoldur.

**Güvenlik notları** (yaklaşım fark etmeksizin):
- Mail gönderme, hassasiyeti yüksek bir işlem olduğundan `role_mcp_permissions` üzerinden **ayrı ve açık bir izin** gerektirmeli (varsayılan kapalı).
- Her gönderim `chat_messages.tool_call_data` ve/veya ayrı bir `mail_send_log` tablosunda (kime, ne zaman, hangi kullanıcı adına, konu) **audit log** olarak tutulmalı.
- Şablon (Template) akışında otomatik/zamanlanmış mail gönderimi için ek bir onay adımı (ör. ilk birkaç çalıştırmada kullanıcı onayı) değerlendirilmeli — yanlışlıkla toplu/yanlış alıcıya mail gitmesini önlemek için.
- Alıcı domain'i kısıtlaması (ör. sadece şirket içi domain'e gönderime izin, dışa gönderim için ayrı bir izin) admin panelinden yapılandırılabilir olmalı.

## 10. Şablonlar (Template) — Token harcamadan tekrarlanabilir veri sorguları

**Problem**: Kullanıcı chat bot üzerinden bir MCP entegrasyonundan (Excel, DB, API) veri çekebiliyor; ama bu sorguyu **günlük/periyodik olarak tekrar** çalıştırmak isteyebilir. Her tekrarda yapay zekaya (AI provider'a) istek atıp token harcamak yerine, sıralı MCP çağrılarını **AI'siz, deterministik bir "mini uygulama" gibi** tekrar çalıştırabilmek gerekiyor.

**Çözüm — Şablon (Template) yapısı**:

1. Kullanıcı, bir chat çıktısına yol açan MCP çağrı zincirini (bir veya birden çok sıralı çağrı) **şablon olarak kaydeder**.
2. Şablon kaydedilirken, çağrılardaki hangi alanların **parametrik** (her çalıştırmada kullanıcıdan alınacak) olduğu işaretlenir.
3. Sonuç ekranı **HTML** olarak saklanır; şablon her tetiklendiğinde HTML içindeki ilgili yerler güncel verilerle yeniden doldurulur (AI çağrısı yapılmadan, doğrudan MCP çağrı sonuçlarıyla).
4. Şablonlar **görünürlük** açısından `private` (sadece sahibi) veya `shared` (tüm kullanıcılar) olarak işaretlenebilir.
5. Opsiyonel: şablon bir **zamanlamaya** (`schedule_cron`) bağlanarak günlük/periyodik otomatik çalıştırılabilir (ör. her sabah 09:00'da güncellenmiş rapor).
6. Opsiyonel: zincire, ham veriyi işleyip istenen formatta çıktı üretmesi için bir **AI İşleme Adımı** eklenebilir (bkz. 10.4) — bu durumda şablon tamamen token'sız olmaktan çıkar, sadece o adım için token harcanır.

### 10.1 Veri Modeli (taslak)

| Tablo | Alanlar | Açıklama |
|---|---|---|
| `templates` | id, name, description, owner_user_id (FK→users), visibility (`private`\|`shared`), source_session_id (FK→chat_sessions, nullable), result_html_template (TEXT — placeholder'lı HTML iskeleti), schedule_cron (TEXT, nullable), is_schedule_enabled (BOOLEAN), created_at, updated_at | Şablonun tanımı |
| `template_steps` | id, template_id, step_order, **step_key** (TEXT — bu adıma sonraki adımlardan referans vermek için kısa isim, ör. `step_1`), step_type (`mcp_call`\|`ai_transform`), mcp_integration_id (FK, `mcp_call` ise), operation (tool/endpoint adı, `mcp_call` ise), ai_prompt_template_id (FK→ai_prompt_templates, `ai_transform` ise), **input_mapping** (JSONB — her input alanının kaynağını tanımlar: sabit değer \| `param.<key>` \| `step.<step_key>.output.<jsonpath>`), output_placeholder (TEXT — sonucun `result_html_template` içindeki hangi placeholder'a yazılacağı) | Sıralı adımlar — deterministik MCP çağrısı veya AI işleme; bir adımın çıktısı sonraki adımların girdisi olabilir |
| `template_parameters` | id, template_id, param_key, label, type (`text`\|`number`\|`date`\|`select`), default_value, required (BOOLEAN) | Kullanıcıdan her çalıştırmada istenecek parametreler |
| `template_runs` | id, template_id, triggered_by_user_id (nullable — zamanlanmış çalıştırmada null/system), parameter_values (JSONB), status (`success`\|`failed`\|`running`), started_at, finished_at | Her çalıştırma kaydı |
| `template_run_steps` | id, template_run_id, step_id (FK→template_steps), raw_result (JSONB), **token_usage** (JSONB, nullable — `ai_transform` adımlarında prompt/completion token sayısı), error (TEXT, nullable) | Adım bazlı ham sonuçlar |
| `template_run_results` | id, template_run_id, rendered_html (TEXT) | O çalıştırmaya ait, placeholder'ları doldurulmuş final HTML |
| `ai_prompt_templates` | id, name, description, ai_provider_id (FK→ai_providers), system_prompt (TEXT), user_prompt_template (TEXT — `{{step_1.output}}`, `{{param.x}}` gibi placeholder destekli), output_format (`text`\|`json`\|`html`), output_schema (JSONB, nullable — `json` ise beklenen şema), owner_user_id, visibility (`private`\|`shared`), created_at | Yeniden kullanılabilir AI işleme tanımları |

### 10.2 Çalışma Akışı

1. Kullanıcı (veya zamanlayıcı) şablonu tetikler, gerekiyorsa `template_parameters`'a karşılık gelen değerleri girer.
2. Backend, `template_steps`'i `step_order`'a göre sırayla çalıştırır; her adımdan önce, o adımın `input_mapping`'i çözülür (bkz. 10.5) — yani adımın gerçek girdileri sabit değerlerden, kullanıcı parametrelerinden ve/veya **önceki adımların çıktılarından** derlenir:
   - `mcp_call` adımında, çözülen girdilerle ilgili `mcp_integration`'a istek atılır (AI provider'a hiç istek gitmez).
   - `ai_transform` adımında (bkz. 10.4), çözülen girdiler ilgili `ai_prompt_template`'in `user_prompt_template`'ine yerleştirilir ve tanımlı `ai_provider`'a **tek, kontrollü bir istek** atılır.
3. Her adımın sonucu, `step_key`'i ile birlikte hem `template_run_steps`'e kaydedilir (AI adımı ise token kullanımıyla birlikte) hem de sonraki adımların `input_mapping`'i tarafından referans verilebilecek şekilde çalışma anındaki "run context"e eklenir; `result_html_template` içindeki `output_placeholder`'lar bu sonuçlarla doldurularak final HTML üretilir ve `template_run_results`'a yazılır.
4. Bir adım başarısız olursa (`error` dolarsa), ona bağımlı sonraki adımlar çalıştırılmaz; çalışma `failed` olarak işaretlenir ve o ana kadar üretilen kısmi sonuç saklanır.
5. Kullanıcı arayüzünde en son (veya geçmiş) çalıştırmanın HTML sonucu gösterilir.

### 10.3 Admin Panel Etkisi

- **Şablon İzleme** ekranı (admin): tüm şablonları (özellikle `shared` olanları), çalıştırma geçmişini, zamanlanmış şablonları ve **AI adımı içeren şablonların token/maliyet tüketimini** görüntüleme/denetleme — oluşturma/düzenleme kullanıcı arayüzünden (chat ekranı üzerinden) yapılır, admin panel burada gözetim/denetim amaçlıdır.
- Zamanlanmış şablonlar için arka planda bir **scheduler/worker** süreci gerekir (ör. `node-cron` veya ayrı bir worker servis) — bu, mimariye yeni bir bileşen olarak eklenir.

### 10.4 AI İşleme Adımı (`ai_transform`) — İstenen formatta çıktı üretme

**Problem**: Bazı adımlarda ham veri (Excel satırları, API'den dönen JSON, DB sorgu sonucu) doğrudan HTML'e basılamayacak kadar "ham" olabilir — özetlenmesi, yorumlanması, belirli bir formata (ör. Türkçe rapor cümlesi, belirli bir JSON şeması, tablo özeti) dönüştürülmesi gerekebilir. Bunun için zincire, tamamen deterministik `mcp_call` adımlarının yanına, **açıkça işaretlenmiş** bir AI adımı eklenebilir.

**Nasıl çalışır**:
- Şablon sahibi, chat üzerinde zaten kullanmış olduğu bir dönüşümü ("bu tabloyu özetle", "şu alanları şu formatta düzenle") bir **`ai_prompt_template`** olarak kaydeder — sistem prompt'u, kullanıcı prompt şablonunu (önceki adım çıktılarına ve parametrelere referans veren placeholder'larla) ve hangi `ai_provider`'ın kullanılacağını içerir.
- İstenirse çıktı **yapılandırılmış** (`output_format: json` + `output_schema`) istenebilir; bu durumda backend, AI'nin yanıtını şemaya karşı doğrular (uymazsa adım `failed` olarak işaretlenir).
- Bu adım, şablonun geri kalanının aksine **her çalıştırmada gerçek bir AI isteği** anlamına gelir — bu nedenle:
  - UI'da bu adım açıkça "AI kullanır, token harcar" etiketiyle gösterilmeli.
  - `template_run_steps.token_usage` üzerinden maliyet takip edilebilmeli.
  - Zamanlanmış (`schedule_cron`) şablonlarda AI adımı varsa, admin panelinden bu şablonlar için (istenirse) ayrı bir üst limit/uyarı eşiği tanımlanabilir (ör. günlük maksimum AI adımı çalıştırma sayısı).
- Yetkilendirme: `ai_transform` adımı, o adımda seçilen `ai_provider`'a, çalıştıran kullanıcının **role**'ü üzerinden erişimi olup olmadığı kontrol edilerek çalışır (bkz. `role_ai_providers`, 4.3).

**Örnek kullanım**: Bir `mcp_call` adımı DB'den haftalık satış verisini JSON olarak çeker → bir `ai_transform` adımı bu JSON'u alıp "yönetici özeti" formatında 3 paragraflık Türkçe metne çevirir → sonuç HTML'deki ilgili placeholder'a yazılır.

### 10.5 Adımlar Arası Veri Akışı (Step Chaining)

Bir adımın sonucu, bir sonraki adımın girdisi olarak kullanılabilir — yani şablonlar tek çağrılık değil, **çok adımlı bir veri hattı (pipeline)** olarak tasarlanabilir.

**`input_mapping` çözümleme kuralları** — her adımın her girdi alanı için üç kaynaktan biri seçilir:

| Kaynak | Söz dizimi | Açıklama |
|---|---|---|
| Sabit değer | `"İstanbul"`, `42` | Şablon tasarlanırken sabitlenmiş değer |
| Kullanıcı parametresi | `param.<param_key>` | `template_parameters`'da tanımlı, her çalıştırmada kullanıcıdan/zamanlayıcıdan alınan değer |
| Önceki adım çıktısı | `step.<step_key>.output.<jsonpath>` | Daha önce çalışmış bir adımın (`step_key` ile referans verilen) `raw_result`'ından JSONPath ile alınan alan, ör. `step.step_1.output.rows[0].total` |

**Örnek**: 2 adımlı bir şablon —
1. `step_1` (`mcp_call`, `database` entegrasyonu): `input_mapping = { "customer_id": "param.customer_id" }` → müşteri kaydını getirir.
2. `step_2` (`mcp_call`, `http_api` entegrasyonu): `input_mapping = { "region": "step.step_1.output.region", "date": "param.report_date" }` → `step_1`'den dönen bölge bilgisini kullanarak ikinci bir API'yi sorgular.

Bir adım, kendisinden **sonra** gelen bir adıma referans veremez (döngüsel bağımlılık engellenir); backend, şablon kaydedilirken `step_order` ve `step_key` referanslarının tutarlılığını (yalnızca önceki adımlara referans verildiğini) doğrular.

### 10.6 MCP Üzerinden Şablon Oluşturma (AI Destekli)

Şablon oluşturma, sadece elle bir form doldurarak değil, **MCP server'ın kendi tool'ları aracılığıyla, sohbet içindeki AI tarafından da** yapılabilir. Bunun için MCP server, admin panelindeki `mcp_integrations` gibi dışarıya açık entegrasyonlardan ayrı, sistemin kendi iç yönetim tool'larını da sunar:

| Tool | Açıklama |
|---|---|
| `template.create_from_session` | Verilen bir `chat_session_id`'deki tool çağrı geçmişini analiz ederek bir şablon **taslağı** üretir: adımlar (`step_key`, hangi `mcp_integration`/`operation`), her adımın gözlemlenen girdi/çıktı değerleri, ve hangi girdilerin sabit/parametrik/zincirlenmiş olabileceğine dair **öneri**. |
| `template.save` | Kullanıcı tarafından onaylanmış/düzenlenmiş şablon tanımını (steps + input_mapping + parameters + result_html_template) kalıcı olarak kaydeder. |
| `template.update_step` / `template.delete_step` | Var olan bir şablonun adımlarını güncellemek/silmek için. |

**Akış**:
1. Kullanıcı chat'te normal şekilde MCP çağrıları yaptırır (ör. "müşteri X'in son 3 ayki siparişlerini getir, sonra bölgesine göre stok durumunu sorgula").
2. Kullanıcı "bunu şablon olarak kaydet" dediğinde, AI `template.create_from_session` tool'unu çağırır.
3. **AI, gerçekleşmiş çağrıların parametre ve sonuçlarını inceleyerek eşlemeyi kendisi çıkarabilir**: örneğin ikinci çağrıdaki "bölge" değeri birebir ilk çağrının sonucundan geldiyse, bunu `step.step_1.output.region` olarak zincirlenmiş bir girdi olarak; kullanıcının doğrudan yazdığı "müşteri X" gibi bir değeri ise parametrik aday (`param.customer_id`) olarak önerir.
4. Bu **öneri kullanıcıya gösterilir ve onay istenir** — AI'nin çıkarımı yanlış olabileceğinden (ör. tesadüfen aynı olan iki değeri yanlışlıkla zincirleme sanması), şablon **AI'nin önerisiyle otomatik kaydedilmez**; kullanıcı adım listesini, parametre adaylarını ve zincirleme eşlemelerini gözden geçirip düzenleyebildiği bir ekranda onaylar.
5. Onay sonrası `template.save` çağrılır ve şablon `templates`/`template_steps`/`template_parameters` tablolarına yazılır.

> Kısacası: **Evet**, yapay zeka sıralı MCP çağrılarının input/output eşlemesini kendisi çıkarıp önerebilir — ama bu öneri, veri bütünlüğü ve güvenlik açısından (yanlış zincirleme, yanlış parametre tahmini) **kullanıcı onayından geçmeden kalıcı hale gelmez**.

## 11. Mimariye Etkisi (güncelleme)

Şablon çalıştırma motoru, chat bot'tan bağımsız, MCP server'a doğrudan istek atabilen hafif bir **Template Execution Engine** olarak tasarlanır (aynı Node.js uygulaması içinde bir modül olabilir, zamanlanmış görevler için ayrı bir worker process önerilir). Bu bileşen `ai_providers`'a hiç ihtiyaç duymaz; sadece `mcp_integrations` ile konuşur.

## 12. Bütçe (Budget) Yönetimi

**Amaç**: Yalnızca şablon içindeki `ai_transform` adımları değil, chat bot üzerindeki **tüm AI kullanımı** (normal sohbet + şablon AI adımları) için token/maliyet bazlı bir bütçe sistemi kurmak; aşırı kullanımı önlemek ve şeffaf bir kullanım/kalan görünürlüğü sağlamak.

### 12.1 Bütçe Birimi ve Boyutları

- **Birim: USD (tutar bazlı), token değil.** Farklı AI sağlayıcılarının token fiyatları birbirinden çok farklı olabildiğinden (ör. GPT-4o vs. Claude vs. Gemini), tek bir ortak birimde (USD) karşılaştırılabilir/toplanabilir bir bütçe daha doğru sonuç verir. Her `ai_usage_records` kaydında token sayısının yanında, o sağlayıcının o modelin **o anki birim fiyatına göre** hesaplanmış `cost_usd` alanı da tutulur (fiyat tablosu `ai_providers` veya ayrı bir `ai_provider_pricing` tablosunda saklanabilir).
- **Bütçe, AI sağlayıcı bazında tanımlanır.** Admin bir bütçe kaydı oluştururken önce **hangi `ai_provider`'a** ait olduğunu seçer, sonra o provider için global/skill/user seviyesinde USD limiti girer. Yani aynı kullanıcı için "GPT-4o'da ayda 20 USD, Claude'da ayda 10 USD" gibi farklı bütçeler tanımlanabilir.
- **Skill bazlı bütçeler birbirinden bağımsız değerlendirilir** (birleştirilmez/toplanmaz/maksimumu alınmaz). Bu doğal olarak zaten mümkündür çünkü her chat oturumu bir skill bağlamında başlatılıyor (`chat_sessions.skill_id`, bkz. Bölüm 6) — bir kullanıcının "Muhasebe" skill'i altındaki kullanımı ile "Satış" skill'i altındaki kullanımı, o skill'e tanımlı bütçeden **ayrı ayrı** düşülür. Kullanıcı override tanımlıysa, override tüm skill'lerin yerine geçer (skill ayrımı olmadan tek havuz).

### 12.2 Etkin Bütçe Belirleme

Bir AI isteği yapılacağı an, **(kullanıcı, ai_provider, ilgili skill)** üçlüsü için etkin limit şu sırayla belirlenir:

1. O kullanıcı + o ai_provider için tanımlı bir **kullanıcı override**'ı varsa, kullanılır (skill ayrımı yapılmaz, tek havuz).
2. Yoksa, isteğin bağlı olduğu skill için (chat oturumunun `skill_id`'si üzerinden) o ai_provider'a tanımlı bir **skill bazlı bütçe** varsa, kullanılır — her skill kendi bağımsız havuzuyla takip edilir.
3. Yoksa, o ai_provider için **global varsayılan** bütçe kullanılır.

Şablon `ai_transform` adımlarında skill bağlamı, şablonun oluşturulduğu oturumun skill'i (`templates.source_session_id` → `chat_sessions.skill_id`) üzerinden belirlenir; yoksa doğrudan global/kullanıcı seviyesine düşülür.

**Uygulama notu (kullanım havuzlama)**: Etkin bütçe kaynağı `skill` ise, o skill'in kullanımı `ai_usage_records`/`ai_usage_monthly_rollup`'ta sadece o `skill_id`'ye ait satırlar toplanarak hesaplanır. Kaynak `user` (override) veya `global` ise — ikisi de tanım gereği skill ayrımı yapmadığından — kullanım, o kullanıcının o ai_provider'daki **tüm skill'lerdeki toplam** kullanımı olarak hesaplanır (skill_id filtresi uygulanmadan toplanır).

### 12.3 Veri Modeli (taslak)

| Tablo | Alanlar | Açıklama |
|---|---|---|
| `budget_policies` | id, ai_provider_id (FK→ai_providers, **zorunlu**), scope_type (`global`\|`skill`\|`user`), scope_id (nullable — `global` için null, `skill` için skill_id, `user` için user_id), period (`daily`\|`monthly`), limit_usd (NUMERIC), created_at/updated_at | Provider + global/skill/user kombinasyonu bazında bütçe tanımları (unique: ai_provider_id + scope_type + scope_id + period) |
| `ai_usage_records` | id, user_id (FK), ai_provider_id (FK), skill_id (FK→skills, nullable — istek hangi skill bağlamında yapıldıysa), source (`chat`\|`template_ai_transform`), reference_id (chat_message_id veya template_run_step_id), tokens_prompt, tokens_completion, **cost_usd** (NUMERIC), created_at | Her AI isteğinin token + USD maliyet kaydı |
| `ai_usage_monthly_rollup` | id, user_id, ai_provider_id, skill_id (nullable), year_month, total_cost_usd, total_tokens, updated_at | Performans için önceden toplanmış aylık özet (bkz. 13.4) |

### 12.4 Kullanım Hesaplama Stratejisi

Pratik/dengeli bir yaklaşım: **yazma anında canlı güncellenen aylık rollup + gerekirse mevcut ayın son birkaç saatlik detayı canlı sorgu ile tamamlama**. Yani her `ai_usage_records` eklendiğinde aynı transaction içinde `ai_usage_monthly_rollup` ilgili satırı da `UPSERT` ile güncellenir (`total_cost_usd += cost_usd`). Böylece:
- Kalan bütçe kontrolü tek bir satır okuma ile yapılır (rollup tablosundan) — her istekte tüm `ai_usage_records`'u toplamaya gerek kalmaz, performanslıdır.
- Ham `ai_usage_records` detay/denetim/raporlama için ayrıca saklanır.

**Saklama**: `ai_usage_records` (ham detay kayıtları) ve `ai_usage_monthly_rollup` (aylık özetler) **silinmez, kalıcı olarak saklanır** — genel chat geçmişi saklama politikasından (Bölüm 4.4, parametrik/1 yıl) bağımsız, ayrı bir retention'a tabidir (raporlama/denetim amacıyla aylık bazda uzun vadeli tutulur).

### 12.5 Limit Aşımı Davranışı

Bir kullanıcının, ilgili (provider, skill) kombinasyonu için etkin bütçesi dolduğunda:
- Yeni sohbet mesajları o AI provider'a gönderilmez; kullanıcıya "bu sağlayıcıdaki bütçeniz doldu, periyot yenilenene kadar bekleyin, farklı bir sağlayıcı seçin veya yöneticinizle iletişime geçin" mesajı gösterilir (kullanıcının erişimi olan başka bir AI provider varsa ona geçiş önerilir).
- Zamanlanmış şablonlardaki `ai_transform` adımları da aynı şekilde engellenir; adım `failed` olarak işaretlenir ve nedeni (`budget_exceeded`) kaydedilir.
- MCP tabanlı deterministik (`mcp_call`) adımlar bütçeden etkilenmez — sadece gerçek AI isteği yapan adımlar/sohbetler kısıtlanır.

### 12.6 Kullanıcı Görünürlüğü

- Chat arayüzünde, kullanıcı **her bir AI provider için ayrı ayrı** kendi dönem içi kullanımını ve kalan bütçesini görebilir (ör. "GPT-4o — Bu ay: 12,40 / 20,00 USD", "Claude Sonnet — Bu ay: 3,10 / 10,00 USD"), ve aktif olarak hangi skill bağlamında olduğuna göre ilgili skill'in bütçesi gösterilir.
- AI provider seçim ekranında (kullanıcının erişebildiği provider'lar arasından seçim yaptığı yer, bkz. Bölüm 6) her provider'ın yanında kalan bütçe özeti gösterilebilir.

### 12.7 Admin Panel Ekranı — Bütçe & Kullanım Yönetimi

- Ekran önce **AI provider seçimi** ister; seçilen provider için global varsayılan, skill bazlı ve kullanıcı bazlı override bütçeleri o provider özelinde tanımlanır/listelenir.
- **Kullanıcı listesi**: her kullanıcı için (seçilen provider'da, varsa skill kırılımıyla) etkin limit, dönem içi kullanım (USD), kalan miktar ve limitin hangi kaynaktan geldiği (global/skill/override) tek bakışta görülebilecek bir tablo.

## 13. Sonraki Adım

Bütçe/kullanım tasarımı da netleşti; bir sonraki adımda, onaylanan tasarıma göre proje iskeleti (klasör yapısı, Postgres migration'ları, admin panel ilk ekranları, MCP server iskeleti, template execution engine, bütçe/kullanım modülü) oluşturulacak.
