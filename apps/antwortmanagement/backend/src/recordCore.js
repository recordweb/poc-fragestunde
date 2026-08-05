// Generische Record-Grundoperationen -- unabhaengig vom konkreten record_type.
// Wird sowohl von den Antwort-Routen (records.js) als auch von den Case-Routen
// (routes/cases.js) verwendet, da beide Typen dieselben `records`/
// `record_snapshots`-Tabellen im antwortmanagement-Schema teilen (RWP: ein
// Case ist "a Record of type CaseRecord", unterliegt also denselben
// Grundregeln wie jeder andere Record).
import pool from "./db.js";
import { computeSnapshotHash, computePayloadHash } from "./crypto.js";

export async function getFullRecord(did) {
  const { rows } = await pool.query(
    `SELECT r.did, r.record_type, r.owner, r.created AS record_created,
            s.*
     FROM records r JOIN record_snapshots s ON s.id = r.current_snapshot_id
     WHERE r.did = $1`,
    [did]
  );
  return rows[0] || null;
}

export async function listRecordsByType(recordType) {
  const { rows } = await pool.query(
    `SELECT r.did, r.record_type, r.owner, r.created AS record_created, s.*
     FROM records r JOIN record_snapshots s ON s.id = r.current_snapshot_id
     WHERE r.record_type = $1
     ORDER BY r.created DESC`,
    [recordType]
  );
  return rows;
}

export async function createSnapshot({
  did, parents, state, recordType, schemaVersion, owner, payload,
  payloadFormat, correctionReason = null
}) {
  const payloadHash = computePayloadHash(payload);
  const finalized = state === "finalized" ? new Date().toISOString() : null;

  const metadataWithoutHash = {
    did, recordType, schemaVersion, state, parents,
    owner, payloadHash, payloadFormat,
    ...(finalized ? { finalized } : {})
  };
  const snapshotHash = computeSnapshotHash(metadataWithoutHash, payload);

  const { rows } = await pool.query(
    `INSERT INTO record_snapshots
       (did, snapshot_hash, parents, state, record_type, schema_version, owner,
        payload, payload_hash, payload_format, correction_reason, finalized, signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      did, snapshotHash, JSON.stringify(parents), state, recordType, schemaVersion, owner,
      payload, payloadHash, payloadFormat,
      correctionReason, finalized, state === "finalized" ? "z_PLACEHOLDER_PoC_signature" : null
    ]
  );
  return rows[0];
}

export async function insertRecord({ did, recordType, schemaVersion, owner, snapshotId }) {
  await pool.query(
    `INSERT INTO records (did, record_type, schema_version, owner, current_snapshot_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [did, recordType, schemaVersion, owner, snapshotId]
  );
}

export async function setCurrentSnapshot(did, snapshotId) {
  await pool.query(`UPDATE records SET current_snapshot_id=$1 WHERE did=$2`, [snapshotId, did]);
}

// In-place-Update des Payloads eines Draft-Snapshots -- kein neuer
// Versionsknoten (analog zum bestehenden PUT /records/:did-Verhalten).
// Wird u.a. verwendet, um den Case-Payload bei Antwort-Finalisierung
// nachzufuehren (workingLinks -> result, Merkle-Root neu berechnen).
export async function updateDraftPayloadInPlace(snapshotRowId, payload) {
  await pool.query(
    `UPDATE record_snapshots SET payload=$1, payload_hash=$2 WHERE id=$3`,
    [payload, computePayloadHash(payload), snapshotRowId]
  );
}
