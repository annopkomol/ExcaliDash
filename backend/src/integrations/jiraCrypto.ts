import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for third-party tokens stored in the database.
 * The key is derived from JIRA_TOKEN_ENCRYPTION_KEY, falling back to JWT_SECRET,
 * so a database leak alone does not expose stored tokens.
 */
const deriveKey = (secret: string): Buffer =>
  createHash("sha256").update(`excalidash:jira-token:v1:${secret}`).digest();

export const encryptSecret = (plaintext: string, secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

/** Returns null when the payload is malformed or the key no longer matches. */
export const decryptSecret = (payload: string, secret: string): string | null => {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};
