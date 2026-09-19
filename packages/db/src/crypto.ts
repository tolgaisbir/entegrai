import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// DESIGN.md 4.1 / 7 — API key'ler ve mcp_integrations.connection_config'teki hassas
// alanlar DB'de şifreli tutulur (AES-256-GCM). ENCRYPTION_KEY: 32 byte'lık hex string
// (64 karakter). Hem app/ hem mcp-server/ bu paketten import eder, aynı anahtarla
// şifreleyip çözebilmeleri için.

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY tanımlı değil veya 32 byte (64 hex karakter) uzunluğunda değil",
    );
  }
  return Buffer.from(hex, "hex");
}

// Format: <iv:hex>:<authTag:hex>:<ciphertext:hex>
export function encryptSecret(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = payload.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Geçersiz şifreli veri formatı");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function maskSecret(plainText: string): string {
  if (plainText.length <= 4) return "****";
  return `${"*".repeat(plainText.length - 4)}${plainText.slice(-4)}`;
}
