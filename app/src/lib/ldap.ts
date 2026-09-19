import ldap, { type Client, type SearchEntry } from "ldapjs";

// DESIGN.md Bölüm 8, karar 170 — LDAP entegrasyonu: ldapjs + login-time (just-in-time)
// senkronizasyon. Kullanıcı login olduğunda LDAP'a bind edilir, bilgiler doğrulanır ve
// yerel `users` tablosuna o an yazılır/güncellenir (bkz. app/src/routes/auth.ts).
//
// Gerekli env değişkenleri (.env.example'a bakın): LDAP_URL, LDAP_BASE_DN,
// LDAP_USER_SEARCH_FILTER (varsayılan "(mail={{input}})"), opsiyonel arama için servis
// hesabı LDAP_BIND_DN/LDAP_BIND_PASSWORD (yoksa anonim bind ile aranır),
// LDAP_FULLNAME_ATTR (varsayılan "displayName"), LDAP_EMAIL_ATTR (varsayılan "mail").

export interface LdapUserInfo {
  dn: string;
  email: string;
  fullName: string;
}

export function isLdapConfigured(): boolean {
  return Boolean(process.env.LDAP_URL && process.env.LDAP_BASE_DN);
}

function createClient(): Client {
  return ldap.createClient({ url: process.env.LDAP_URL!, connectTimeout: 5000, timeout: 5000 });
}

function bindAsync(client: Client, dn: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => (err ? reject(err) : resolve()));
  });
}

function searchAsync(client: Client, base: string, filter: string): Promise<SearchEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: SearchEntry[] = [];
    client.search(base, { scope: "sub", filter }, (err, res) => {
      if (err) return reject(err);
      res.on("searchEntry", (entry) => entries.push(entry));
      res.on("error", reject);
      res.on("end", () => resolve(entries));
    });
  });
}

// LDAP filter'a gömülecek kullanıcı girdisindeki özel karakterleri escape eder
// (RFC 4515) — arama filtresine enjeksiyonu önler.
function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function readAttr(entry: SearchEntry, name: string): string | undefined {
  return entry.pojo.attributes.find((a) => a.type.toLowerCase() === name.toLowerCase())?.values[0];
}

// Kullanıcıyı LDAP'a karşı doğrular: önce (servis hesabıyla, yoksa anonim) dizinde
// kullanıcıyı arayıp DN'ini ve temel bilgilerini bulur, sonra o DN'e kullanıcının
// verdiği şifreyle ayrı bir bağlantıdan bind ederek şifreyi doğrular. Başarısız olursa
// (kullanıcı yok, şifre yanlış, LDAP'a ulaşılamıyor) null döner — çağıran taraf bunu
// genel "invalid_credentials" olarak ele alır (kullanıcı numaralandırmasını önlemek için).
export async function authenticateLdapUser(
  loginInput: string,
  password: string,
): Promise<LdapUserInfo | null> {
  if (!isLdapConfigured() || !password) return null;

  const emailAttr = process.env.LDAP_EMAIL_ATTR ?? "mail";
  const fullNameAttr = process.env.LDAP_FULLNAME_ATTR ?? "displayName";

  const searchClient = createClient();
  let dn: string;
  let email: string;
  let fullName: string;
  try {
    const bindDn = process.env.LDAP_BIND_DN;
    const bindPassword = process.env.LDAP_BIND_PASSWORD;
    if (bindDn && bindPassword) {
      await bindAsync(searchClient, bindDn, bindPassword);
    }

    const filterTemplate = process.env.LDAP_USER_SEARCH_FILTER ?? "(mail={{input}})";
    const filter = filterTemplate.replace("{{input}}", escapeFilterValue(loginInput));
    // Attribute listesini sınırlamak yerine tümünü isteriz (bazı sunucular/istemci
    // sürümleri çoklu attribute filtresini beklenmedik şekilde ele alabiliyor) —
    // login başına tek bir arama olduğundan performans kaygısı yok.
    const entries = await searchAsync(searchClient, process.env.LDAP_BASE_DN!, filter);
    if (entries.length !== 1) return null;

    const entry = entries[0];
    // entry.objectName tipte string olsa da bazı sürümlerde bir DN nesnesi dönebiliyor
    // (bind()'a string verilmeli) — pojo.objectName her zaman düz string.
    const foundDn = entry.pojo.objectName;
    if (!foundDn) return null;
    dn = foundDn;
    email = readAttr(entry, emailAttr) || loginInput;
    fullName = readAttr(entry, fullNameAttr) || email;
  } catch {
    return null;
  } finally {
    searchClient.unbind();
  }

  const verifyClient = createClient();
  try {
    await bindAsync(verifyClient, dn, password);
  } catch {
    return null;
  } finally {
    verifyClient.unbind();
  }

  return { dn, email, fullName };
}
