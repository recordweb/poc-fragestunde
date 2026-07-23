import express from "express";
import pool from "../db.js";

const router = express.Router();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

/**
 * @openapi
 * /did/{did}:
 *   get:
 *     tags: [DID]
 *     summary: DID auflösen
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DID-Dokument
 *       404:
 *         description: DID unbekannt
 */
router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);

  const { rows } = await pool.query(
    `SELECT r.did, r.owner, r.created AS record_created, s.snapshot_hash, s.created AS snapshot_created
     FROM records r
     LEFT JOIN record_snapshots s ON s.id = r.current_snapshot_id
     WHERE r.did = $1`,
    [did]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "DID unbekannt" });
  }

  const record = rows[0];

  const didDocument = {
    "@context": "https://www.w3.org/ns/did/v1",
    id: record.did,
    recordEndpoint: `${PUBLIC_BASE_URL}/fragenmanagement/api/records/${encodeURIComponent(record.did)}`,
    created: record.record_created,
    updated: record.snapshot_created || record.record_created,
    currentVersion: record.snapshot_hash || null,
    controller: record.owner
  };

  res.json(didDocument);
});

export default router;