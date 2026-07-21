import express from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { validatePayload } from "../schemas.js";
import { computeSnapshotHash, computePayloadHash } from "../crypto.js";

const router = express.Router();

const RECORD_TYPE_FRAGE = "did:rwp:parlament.ch/schema/fragestunde-frage";
const SCHEMA_VERSION_FRAGE = "sha256:a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";

router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records ORDER BY created DESC");
  res.json(rows);
});

router.get("/:did", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [req.params.did]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// Draft anlegen — DID wird sofort und dauerhaft vergeben
router.post("/", async (req, res) => {
  const { recordType, owner, payload } = req.body;

  if (recordType !== RECORD_TYPE_FRAGE) {
    return res.status(400).json({ error: "Unbekannter recordType" });
  }

  const { valid, errors } = validatePayload(recordType, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  const sessionSlug = (payload.session || "session").toLowerCase().replace(/\s+/g, "").slice(0, 20);
  const did = `did:rwp:parlament.ch/records/frage-${uuidv4().slice(0, 8)}-${sessionSlug}`;

  await pool.query(
    `INSERT INTO records (did, record_type, schema_version, state, owner, parents, payload_hash, payload_format, payload)
     VALUES ($1,$2,$3,'draft',$4,'[]',$5,'application/json',$6)`,
    [did, recordType, SCHEMA_VERSION_FRAGE, owner, computePayloadHash(payload), payload]
  );

  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [did]);
  res.status(201).json(rows[0]);
});

// Finalisieren — unwiderruflich, generiert snapshotHash
router.put("/:did/finalize", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [req.params.did]);
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
    [finalized, snapshotHash, "z_PLACEHOLDER_PoC_signature", req.params.did]
  );

  const updated = await pool.query("SELECT * FROM records WHERE did = $1", [req.params.did]);
  res.json(updated.rows[0]);
});

export default router;