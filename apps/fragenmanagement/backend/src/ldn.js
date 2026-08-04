import { v4 as uuidv4 } from "uuid";
import { logEvent } from "./logger.js";

const ACTOR = "did:rwp:a3f9e21c:system/rwp-node";
const TARGET = "did:rwp:b7d4c810:system/rwp-node"; // Antwortmanagement, laut README

// Echte Zustellungsadresse (HTTP) — bewusst getrennt von den DIDs oben (ACTOR/
// TARGET sind Metadatenfelder im Notification-Body, keine Transportadresse).
// Default: interner Docker-Netzwerkname des Antwortmanagement-Containers, damit
// die Zustellung nicht über nginx/Cloudflare laufen muss (schneller, robuster,
// funktioniert auch wenn der Public-Hostname mal nicht erreichbar ist). Die per
// Link-Header auf GET /antwortmanagement/api/health beworbene Adresse bleibt die
// öffentlich gültige, LDN-konforme Inbox-URL für externe Discovery.
const LDN_INBOX_URL =
  process.env.LDN_INBOX_URL || "http://antwort-api:3000/antwortmanagement/api/inbox";

export function buildLdnNotification(record) {
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://recordweb.org/ns/rwp"
    ],
    id: `did:rwp:a3f9e21c:notifications:${uuidv4()}`,
    type: "Announce",
    actor: ACTOR,
    published: new Date().toISOString(),
    target: TARGET,
    object: {
      id: record.did,
      type: "rwp:FinalizedRecord",
      "rwp:snapshotHash": record.snapshot_hash,
      "rwp:recordType": record.record_type,
      "rwp:state": "finalized",
      "rwp:owner": record.owner,
      summary: `Neue finalisierte Fragestunde-Frage von ${record.owner} — ${record.payload.session}`
    }
  };
}

// Sendet die Notification per echtem HTTP POST an die LDN-Inbox des
// Antwortmanagements (statt sie nur zu simulieren). Etappe 3: der Aufruf
// bleibt synchron zur Finalisierung — Retry/Dead-Letter folgt in Etappe 4,
// darum wird ein Zustellfehler hier nur protokolliert, nicht erneut versucht.
export async function sendLdnNotification(record) {
  const notification = buildLdnNotification(record);
  let delivered = false;
  let deliveryError = null;

  try {
    const res = await fetch(LDN_INBOX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/ld+json" },
      body: JSON.stringify(notification)
    });

    if (res.ok) {
      delivered = true;
      await logEvent(
        `LDN-Notification zugestellt an ${LDN_INBOX_URL} für ${record.did} (HTTP ${res.status})`
      );
    } else {
      const bodyText = await res.text().catch(() => "");
      deliveryError = `HTTP ${res.status}: ${bodyText.slice(0, 300)}`;
      await logEvent(
        `LDN-Zustellung fehlgeschlagen für ${record.did} an ${LDN_INBOX_URL}: ${deliveryError}`,
        "error"
      );
    }
  } catch (err) {
    deliveryError = err.message;
    await logEvent(
      `LDN-Zustellung fehlgeschlagen für ${record.did} an ${LDN_INBOX_URL}: ${err.message}`,
      "error"
    );
  }

  return { notification, delivered, deliveryError };
}
