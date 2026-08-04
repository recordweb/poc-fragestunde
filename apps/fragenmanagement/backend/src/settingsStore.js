import pool from "./db.js";

// Fallback, falls in app_settings noch kein Wert hinterlegt ist (z.B. direkt
// nach einem frischen Deployment). Kommt aus der Docker-Compose-Umgebungsvariable.
export const DEFAULT_LDN_INBOX_URL =
  process.env.LDN_INBOX_URL || "http://antwort-api:3000/antwortmanagement/api/inbox";

const LDN_INBOX_URL_KEY = "ldn_inbox_url";

export async function getConfiguredInboxUrl() {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [LDN_INBOX_URL_KEY]
  );
  return rows[0]?.value || DEFAULT_LDN_INBOX_URL;
}

export async function setConfiguredInboxUrl(value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()`,
    [LDN_INBOX_URL_KEY, value]
  );
  return value;
}
