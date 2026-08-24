import express from "express";
import pool from "../db.js";

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);

  const { rows } = await pool.query(
    `
    SELECT
      r.did,
      r.owner,
      r.created AS record_created,
      s.snapshot_hash,
      s.created AS snapshot_created,
      s.finalized
    FROM records r
    JOIN record_snapshots s ON s.id = r.current_snapshot_id
    WHERE r.did = $1
      AND s.state = 'finalized'
    `,
    [did]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "DID unbekannt" });
  }

  const record = rows[0];

  return res.json({
    "@context": "https://www.w3.org/ns/did/v1",
    id: record.did,
    recordEndpoint:
      `${PUBLIC_BASE_URL}/bar/api/records/${encodeURIComponent(record.did)}`,
    created: record.record_created,
    updated: record.finalized || record.snapshot_created,
    currentVersion: record.snapshot_hash,
    controller: record.owner
  });
});

export default router;