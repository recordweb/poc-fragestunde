import { v4 as uuidv4 } from "uuid";

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
      summary: `Neue finalisierte Fragestunde-Frage von ${record.owner} — ${record.payload.session}`
    }
  };
}

export async function sendLdnNotification(record) {
  const notification = buildLdnNotification(record);

  // PoC-Simulation: Da das Antwortmanagement noch nicht existiert,
  // wird die Notification nur geloggt und in der DB abgelegt.
  console.log("LDN-Notification (simuliert):", JSON.stringify(notification, null, 2));
  return notification;
}