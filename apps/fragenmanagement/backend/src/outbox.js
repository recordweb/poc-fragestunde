import pool from "./db.js";
import { logEvent } from "./logger.js";
import { getConfiguredInboxUrl } from "./settingsStore.js";

// Etappe 4: Fehlerbehandlung für die LDN-Zustellung.
// Statt eines separaten "Outbox"-Tabellenobjekts wird der Zustellstatus direkt
// auf der jeweiligen Zeile in ldn_notifications gepflegt (status/attempts/
// next_attempt_at/target_url) — eine Notification *ist* hier ihr eigener
// Outbox-Eintrag, das hält das Datenmodell einfach.

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30 * 1000; // 30s
const MAX_BACKOFF_MS = 10 * 60 * 1000; // 10min

function backoffFor(attempts) {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

// Wird direkt bei der Finalisierung aufgerufen: legt die Notification an und
// unternimmt sofort einen ersten Zustellversuch (wie bisher in Etappe 3),
// hängt bei Fehlschlag aber jetzt automatisch Retries mit Backoff an, statt
// den Fehler nur zu protokollieren.
export async function enqueueAndAttempt(recordDid, notification) {
  await pool.query(
    `INSERT INTO ldn_notifications (id, record_did, target, published, payload, status, attempts)
     VALUES ($1,$2,$3,$4,$5,'pending',0)`,
    [notification.id, recordDid, notification.target, notification.published, notification]
  );
  return attemptDelivery(notification.id);
}

// Ein einzelner Zustellversuch für eine bestehende Notification — verwendet
// von enqueueAndAttempt() (erster Versuch), vom Retry-Worker (automatische
// Wiederholung) und von der manuellen "Jetzt erneut versuchen"-Route.
export async function attemptDelivery(notificationId) {
  const { rows } = await pool.query(`SELECT * FROM ldn_notifications WHERE id = $1`, [notificationId]);
  const row = rows[0];
  if (!row) throw new Error(`Notification ${notificationId} nicht gefunden`);
  if (row.status === "delivered") return row;

  const inboxUrl = await getConfiguredInboxUrl();
  const attempts = row.attempts + 1;
  let status;
  let deliveryError = null;

  try {
    const res = await fetch(inboxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/ld+json" },
      body: JSON.stringify(row.payload)
    });
    if (res.ok) {
      status = "delivered";
      await logEvent(
        `LDN-Notification zugestellt an ${inboxUrl} für ${row.record_did} (HTTP ${res.status}, Versuch ${attempts})`
      );
    } else {
      const bodyText = await res.text().catch(() => "");
      deliveryError = `HTTP ${res.status}: ${bodyText.slice(0, 300)}`;
    }
  } catch (err) {
    deliveryError = err.message;
  }

  if (deliveryError) {
    status = attempts >= MAX_ATTEMPTS ? "dead_letter" : "failed";
    const suffix = status === "dead_letter" ? " — als Dead Letter markiert, keine weiteren automatischen Versuche" : "";
    await logEvent(
      `LDN-Zustellung fehlgeschlagen (Versuch ${attempts}/${MAX_ATTEMPTS}) für ${row.record_did} an ${inboxUrl}: ${deliveryError}${suffix}`,
      "error"
    );
  }

  const nextAttemptAt = status === "failed" ? new Date(Date.now() + backoffFor(attempts)) : null;

  const { rows: updated } = await pool.query(
    `UPDATE ldn_notifications
     SET status=$1, attempts=$2, delivery_error=$3, delivered=$4, next_attempt_at=$5, target_url=$6
     WHERE id=$7
     RETURNING *`,
    [status, attempts, deliveryError, status === "delivered", nextAttemptAt, inboxUrl, notificationId]
  );
  return updated[0];
}

// Läuft periodisch: holt alle fälligen "failed"-Notifications und versucht
// erneut zuzustellen. dead_letter-Einträge werden NICHT automatisch erneut
// versucht — dafür gibt es die manuelle Retry-Route (siehe routes/outbox.js).
export async function runDueRetries() {
  const { rows } = await pool.query(
    `SELECT id FROM ldn_notifications
     WHERE status = 'failed' AND next_attempt_at <= now()
     ORDER BY next_attempt_at ASC
     LIMIT 20`
  );
  for (const r of rows) {
    await attemptDelivery(r.id);
  }
}

export function startOutboxWorker(intervalMs = 15000) {
  setInterval(() => {
    runDueRetries().catch(err => console.error("Outbox-Worker Fehler:", err));
  }, intervalMs);
}
