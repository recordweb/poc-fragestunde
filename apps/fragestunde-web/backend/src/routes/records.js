import express from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { validatePayload, schemaVersionHash, RECORD_TYPE_FRAGE } from "../schemas.js";
import { computeSnapshotHash, computePayloadHash } from "../crypto.js";

const router = express.Router();

const NAMESPACE_FRAGENMANAGEMENT = "a3f9e21c";

router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records ORDER BY created DESC");
  res.json(rows);
});

router.get("/:did(*)", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records WHERE did = $1", [req.params.did]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

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

router.put("/:did(*)/finalize", async (req, res) => {
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
    [finalized, snapshotHash, "z_PLACEHOLDER_PoC_signature", record.did]
  );

  const updated = await pool.query("SELECT * FROM records WHERE did = $1", [record.did]);
  res.json(updated.rows[0]);
});

export default router;