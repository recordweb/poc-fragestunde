import { v4 as uuidv4 } from "uuid";
import { enqueueAndAttempt } from "./outbox.js";

const ACTOR = "did:rwp:a3f9e21c:system/rwp-node";
const TARGET = "did:rwp:b7d4c810:system/rwp-node"; // Antwortmanagement, laut README

// Die Notification trägt bewusst keinen Inhalt (kein Fragetext, keine Session,
// kein Owner, kein Hash) — sie ist nur ein Hinweis "hey, da ist was Neues",
// kein Inhaltskanal. Jedes empfangende System (hier: Antwortmanagement) löst
// die DID selbst auf und lädt den Record direkt beim Fragenmanagement nach
// (siehe apps/antwortmanagement/backend/src/resolveRecord.js). Das entspricht
// dem RWC-Grundsatz "Vollständigkeit wird nicht vertraut, sondern bewiesen"
// und der Diskussion zu RWP-Issue #6 (Notifications sind nicht-autoritativ).
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
      type: "rwp:FinalizedRecord"
    }
  };
}

// Baut die Notification und übergibt sie an die Outbox (outbox.js), die den
// ersten Zustellversuch sofort unternimmt und bei Fehlschlag automatisch mit
// Backoff wiederholt (Etappe 4). Die tatsächliche Zustelladresse ist über das
// Admin-Panel konfigurierbar (settingsStore.js), nicht mehr fest verdrahtet.
export async function sendLdnNotification(record) {
  const notification = buildLdnNotification(record);
  await enqueueAndAttempt(record.did, notification);
  return notification;
}
