import express from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { validatePayload, schemaVersionHash, RECORD_TYPE_FRAGE } from "../schemas.js";
import { computeSnapshotHash, computePayloadHash } from "../crypto.js";
import { sendLdnNotification } from "../ldn.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();
const NAMESPACE_FRAGENMANAGEMENT = "a3f9e21c";

// Interne Liste (zeigt auch Drafts) — für die eigene UI
router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records ORDER BY created DESC");
  res.json(rows);
});

// Draft anlegen
router.post("/", async (req, res) => {
  const { recordType, owner, payload } = req.body;

  if (recordType !== RECORD_TYPE_FRAGE) {
    return res.status(400).json({ error: "Unbekannter recordType" });
  }

  const { valid, errors } = validatePayload(recordType, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  const did = `did:rwp:${NAMESPACE_FRAGENMANAGEMENT}:records:${uuidv4()}`;

  await pool.query(
    `INSERT INTO records (did, record_type, schema_version, state, owner, parents, payload_hash, payload_format, payload)
     VALUES ($1,$2,$3,'draft',$4,'[]',$5,'application/json',$6)`,
    [did, recordType, schemaVersionHash(), owner, computePayloadHash(payload), payload]
  );

  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  res.status(201).json(rows[0]);
});

// Finalisieren — unwiderruflich, generiert snapshotHash, versendet LDN
router.put(/^\/(.+)\/finalize$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const record = rows[0];
  if (record.state === "finalized") {
    return res.status(409).json({ error: "Record bereits finalisiert" });
  }

  const finalized = new Date().toISOString();
  const metadataWithoutHash = {
    did: record.did,
    recordType: record.record_type,
    schemaVersion: record.schema_version,
    state: "finalized",
    created: record.created,
    finalized,
    owner: record.owner,
    parents: record.parents,
    payloadHash: record.payload_hash,
    payloadFormat: record.payload_format
  };

  const snapshotHash = computeSnapshotHash(metadataWithoutHash, record.payload);

  await pool.query(
    `UPDATE records SET state='finalized', finalized=$1, snapshot_hash=$2, signature=$3 WHERE did=$4`,
    [finalized, snapshotHash, "z_PLACEHOLDER_PoC_signature", record.did]
  );

  const updated = await pool.query("SELECT * FROM records WHERE did = $1", [record.did]);
  const updatedRecord = updated.rows[0];

  const notification = await sendLdnNotification(updatedRecord);

  await pool.query(
    `INSERT INTO ldn_notifications (id, record_did, target, published, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [notification.id, updatedRecord.did, notification.target, notification.published, notification]
  );

  res.json(updatedRecord);
});

// Draft bearbeiten — nur solange state='draft'
router.put(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  if (did.endsWith("/finalize")) return res.status(404).json({ error: "Not found" });

  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const record = rows[0];
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Drafts können bearbeitet werden" });
  }

  const { payload } = req.body;
  const { valid, errors } = validatePayload(record.record_type, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  await pool.query(
    `UPDATE records SET payload=$1, payload_hash=$2 WHERE did=$3`,
    [payload, computePayloadHash(payload), did]
  );

  const updated = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  res.json(updated.rows[0]);
});

// Extern lesbar — NUR finalisierte Records (muss NACH /finalize stehen wegen Pfad-Überlappung)
router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const record = rows[0];
  if (record.state !== "finalized") {
    return res.status(403).json({ error: "Record ist nicht finalisiert und daher nicht extern sichtbar" });
  }
  res.json(record);
});

router.post("/:did(*)/solid-link", async (req, res) => {
  const did = req.params.did;
  const { podUrl, linkedBy } = req.body;

  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const record = rows[0];
  if (record.state !== "finalized") {
    return res.status(409).json({ error: "Nur finalisierte Records können ins Solid Pod verlinkt werden" });
  }

  const linkId = uuidv4();
  await pool.query(
    `INSERT INTO solid_links (id, record_did, snapshot_hash, pod_url, linked_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [linkId, did, record.snapshot_hash, podUrl, linkedBy]
  );

  console.log(`Solid-Pod-Link (simuliert): ${podUrl} → ${did} (Hash: ${record.snapshot_hash})`);

  res.status(201).json({
    id: linkId,
    recordDid: did,
    snapshotHash: record.snapshot_hash,
    podUrl,
    linkedBy,
    linkedAt: new Date().toISOString(),
    note: "Simulierter Solid-Pod-Link — keine Inhaltskopie, nur kryptographischer Pointer"
  });
});

router.get("/:did(*)/solid-links", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM solid_links WHERE record_did = $1 ORDER BY linked_at DESC",
    [req.params.did]
  );
  res.json(rows);
});

export default router;