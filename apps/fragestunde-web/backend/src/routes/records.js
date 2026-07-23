import express from "express";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { validatePayload, schemaVersionHash, RECORD_TYPE_FRAGE } from "../schemas.js";
import { computeSnapshotHash, computePayloadHash } from "../crypto.js";
import { sendLdnNotification } from "../ldn.js";
import { logEvent } from "../logger.js";
import { generateSimplePdf } from "../pdf.js";

const router = express.Router();
const NAMESPACE_FRAGENMANAGEMENT = "a3f9e21c";

// ---------- Helper ----------

async function getFullRecord(did) {
  const { rows } = await pool.query(
    `SELECT r.did, r.record_type, r.owner, r.created AS record_created,
            s.*
     FROM records r JOIN record_snapshots s ON s.id = r.current_snapshot_id
     WHERE r.did = $1`,
    [did]
  );
  return rows[0] || null;
}

async function createSnapshot({
  did, parents, state, recordType, schemaVersion, owner, payload,
  payloadFormat, payloadRepresentations = null, correctionReason = null
}) {
  const payloadHash = computePayloadHash(payload);
  const finalized = state === "finalized" ? new Date().toISOString() : null;

  const metadataWithoutHash = {
    did, recordType, schemaVersion, state, parents,
    owner, payloadHash, payloadFormat,
    ...(finalized ? { finalized } : {})
  };
  const snapshotHash = computeSnapshotHash(metadataWithoutHash, payload);
  const payloadRepresentationsJson = payloadRepresentations ? JSON.stringify(payloadRepresentations) : null;

  const { rows } = await pool.query(
    `INSERT INTO record_snapshots
       (did, snapshot_hash, parents, state, record_type, schema_version, owner,
        payload, payload_hash, payload_format, payload_representations,
        correction_reason, finalized, signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      did, snapshotHash, JSON.stringify(parents), state, recordType, schemaVersion, owner,
      payload, payloadHash, payloadFormat, payloadRepresentationsJson,
      correctionReason, finalized, state === "finalized" ? "z_PLACEHOLDER_PoC_signature" : null
    ]
  );
  return rows[0];
}

async function finalizeCommon(did, finalizedSnapshot) {
  await pool.query(`UPDATE records SET current_snapshot_id=$1 WHERE did=$2`, [finalizedSnapshot.id, did]);
  const updated = await getFullRecord(did);
  const notification = await sendLdnNotification(updated);
  await pool.query(
    `INSERT INTO ldn_notifications (id, record_did, target, published, payload) VALUES ($1,$2,$3,$4,$5)`,
    [notification.id, did, notification.target, notification.published, notification]
  );
  return updated;
}

// ---------- Interne Liste (zeigt auch Drafts) ----------

router.get("/", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.did, r.record_type, r.owner, r.created AS record_created, s.*
    FROM records r JOIN record_snapshots s ON s.id = r.current_snapshot_id
    ORDER BY r.created DESC
  `);
  res.json(rows);
});

// ---------- Draft anlegen ----------

router.post("/", async (req, res) => {
  const { recordType, owner, payload } = req.body;
  if (recordType !== RECORD_TYPE_FRAGE) {
    return res.status(400).json({ error: "Unbekannter recordType" });
  }

  const { valid, errors } = validatePayload(recordType, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  const did = `did:rwp:${NAMESPACE_FRAGENMANAGEMENT}:records:${uuidv4()}`;

  const snapshot = await createSnapshot({
    did, parents: [], state: "draft",
    recordType, schemaVersion: schemaVersionHash(), owner,
    payload, payloadFormat: "application/json"
  });

  await pool.query(
    `INSERT INTO records (did, record_type, schema_version, owner, current_snapshot_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [did, recordType, snapshot.schema_version, owner, snapshot.id]
  );

  res.status(201).json(await getFullRecord(did));
});

// ---------- Draft bearbeiten (in-place, kein neuer Knoten) ----------

router.put(/^\/(.+)$/, async (req, res, next) => {
  const did = decodeURIComponent(req.params[0]);
  if (["/finalize", "/finalize-pdf", "/new-version"].some(s => did.endsWith(s))) {
    return next();
  }

  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Drafts können bearbeitet werden" });
  }

  const { payload } = req.body;
  const { valid, errors } = validatePayload(record.record_type, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  await pool.query(
    `UPDATE record_snapshots SET payload=$1, payload_hash=$2 WHERE id=$3`,
    [payload, computePayloadHash(payload), record.current_snapshot_id || record.id]
  );

  res.json(await getFullRecord(did));
});

// ---------- Finalisieren (JSON) ----------

router.put(/^\/(.+)\/finalize$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Drafts können finalisiert werden" });
  }

  const finalizedSnapshot = await createSnapshot({
    did, parents: [record.snapshot_hash].filter(Boolean),
    state: "finalized", recordType: record.record_type,
    schemaVersion: record.schema_version, owner: record.owner,
    payload: record.payload, payloadFormat: "application/json"
  });

  await finalizeCommon(did, finalizedSnapshot);
  res.json(await getFullRecord(did));
});

// ---------- Finalisieren als PDF (Multi-Representation) ----------

router.put(/^\/(.+)\/finalize-pdf$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Drafts können finalisiert werden" });
  }

  const pdfBuffer = await generateSimplePdf(record);
  const pdfBase64 = pdfBuffer.toString("base64");
  const pdfHash = "sha256:" + crypto.createHash("sha256").update(pdfBuffer).digest("hex");
  const jsonHash = computePayloadHash(record.payload);

  const representations = [
    { format: "application/json", hash: jsonHash, primary: false, role: "source" },
    { format: "application/pdf", hash: pdfHash, primary: true, role: "publication" }
  ];

  const finalizedSnapshot = await createSnapshot({
    did, parents: [record.snapshot_hash].filter(Boolean),
    state: "finalized", recordType: record.record_type,
    schemaVersion: record.schema_version, owner: record.owner,
    payload: { ...record.payload, _pdfBase64: pdfBase64 },
    payloadFormat: "application/pdf",
    payloadRepresentations: representations
  });

  await finalizeCommon(did, finalizedSnapshot);
  res.json(await getFullRecord(did));
});

// ---------- Neue Version starten (nur ab finalisiertem Snapshot) ----------

router.post(/^\/(.+)\/new-version$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "finalized") {
    return res.status(409).json({ error: "Neue Version nur ab finalisiertem Record möglich" });
  }

  const { correctionReason } = req.body;
  const sourcePayload = { ...record.payload };
  delete sourcePayload._pdfBase64;

  const draftSnapshot = await createSnapshot({
    did, parents: [record.snapshot_hash],
    state: "draft", recordType: record.record_type,
    schemaVersion: record.schema_version, owner: record.owner,
    payload: sourcePayload, payloadFormat: "application/json",
    correctionReason: correctionReason || null
  });

  await pool.query(`UPDATE records SET current_snapshot_id=$1 WHERE did=$2`, [draftSnapshot.id, did]);
  res.status(201).json(await getFullRecord(did));
});

// ---------- Vollständige Historie eines Records ----------

router.get(/^\/(.+)\/history$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const { rows } = await pool.query(
    `SELECT * FROM record_snapshots WHERE did=$1 ORDER BY created ASC`,
    [did]
  );
  res.json(rows);
});

// ---------- Solid-Pod-Link ----------

router.post("/:did(*)/solid-link", async (req, res) => {
  const did = req.params.did;
  const { podUrl, linkedBy } = req.body;

  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "finalized") {
    return res.status(409).json({ error: "Nur finalisierte Records können ins Solid Pod verlinkt werden" });
  }

  const linkId = uuidv4();
  await pool.query(
    `INSERT INTO solid_links (id, record_did, snapshot_hash, pod_url, linked_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [linkId, did, record.snapshot_hash, podUrl, linkedBy]
  );

  await logEvent(`Solid-Pod-Link erstellt: ${podUrl} → ${did} (Hash: ${record.snapshot_hash})`);

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

// ---------- Extern lesbar — NUR finalisierte Records ----------
// Muss NACH allen spezifischen Routen stehen (Pfad-Überlappung)

router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });

  if (record.state !== "finalized") {
    return res.status(403).json({ error: "Record ist nicht finalisiert und daher nicht extern sichtbar" });
  }
  res.json(record);
});

export default router;