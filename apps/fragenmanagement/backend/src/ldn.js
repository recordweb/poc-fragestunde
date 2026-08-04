import { v4 as uuidv4 } from "uuid";
import { enqueueAndAttempt } from "./outbox.js";

const ACTOR = "did:rwp:a3f9e21c:system/rwp-node";
const TARGET = "did:rwp:b7d4c810:system/rwp-node"; // Antwortmanagement, laut README

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
      // Fragetext/Session werden mitgeschickt, damit das Antwortmanagement
      // seine Auswahlliste rein aus der Inbox aufbauen kann, ohne die
      // Frage per direktem API-Call beim Fragenmanagement nachzuladen
      // (siehe Etappe "Antwortmanagement liest nur noch aus der Inbox").
      "rwp:fragetext": record.payload.fragetext,
      "rwp:session": record.payload.session,
      summary: `Neue finalisierte Fragestunde-Frage von ${record.owner} — ${record.payload.session}`
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
