import express from "express";
import pool from "../db.js";

const router = express.Router();

/**
 * @openapi
 * /api/records/{did}:
 *   get:
 *     tags: [ConformanceRecords]
 *     summary: Finalisierten BAR-ConformanceRecord öffentlich abrufen
 *     description: |
 *       Öffentlicher, föderierter RWP-Record-Endpoint. Liefert ausschliesslich
 *       finalisierte ConformanceRecords. Dieser Endpoint wird über das
 *       `recordEndpoint`-Feld eines BAR-DID-Dokuments referenziert.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         example: did:rwp:ba31d45f:records:1bb42515-9fd8-4004-99ba-46637f7bba88
 *     responses:
 *       200:
 *         description: Finalisierter ConformanceRecord.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ConformanceRecord"
 *       404:
 *         description: ConformanceRecord ist unbekannt oder nicht finalisiert.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 */
router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);

  const { rows } = await pool.query(
    `
    SELECT
      r.did,
      s.snapshot_hash,
      s.parents,
      s.state,
      s.record_type,
      s.schema_version,
      s.owner,
      s.payload,
      s.payload_hash,
      s.payload_format,
      s.created,
      s.finalized,
      s.signature
    FROM records r
    JOIN record_snapshots s ON s.id = r.current_snapshot_id
    WHERE r.did = $1
      AND s.state = 'finalized'
    `,
    [did]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "ConformanceRecord unbekannt" });
  }

  const row = rows[0];

  return res.json({
    did: row.did,
    type: "ConformanceRecord",
    payload: row.payload,
    metadata: {
      did: row.did,
      recordType: row.record_type,
      schemaVersion: row.schema_version,
      state: row.state,
      created: row.created,
      finalized: row.finalized,
      owner: row.owner,
      parents: row.parents,
      payloadHash: row.payload_hash,
      payloadFormat: row.payload_format,
      snapshotHash: row.snapshot_hash,
      signature: row.signature
    }
  });
});

export default router;