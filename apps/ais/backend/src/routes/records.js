const express = require("express");
const { pool } = require("../db");

const router = express.Router();

function mapSnapshot(row) {
  return {
    did: row.did,
    snapshotHash: row.snapshot_hash,
    version: row.version,
    state: row.state,
    parents: row.parents,
    payload: row.payload,
    payloadHash: row.payload_hash,
    payloadFormat: row.payload_format,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at
  };
}

function mapRecord(row) {
  return {
    id: row.id,
    did: row.did,
    recordType: row.record_type,
    status: row.status,
    version: row.version,
    title: row.title,
    payload: {
      ...row.payload_metadata,
      conversation: row.primary_data
    },
    snapshotHash: row.snapshot_hash || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    aip: {
      aipId: row.aip_id,
      acceptedAt: row.accepted_at
    }
  };
}

/**
 * @openapi
 * /api/records:
 *   get:
 *     tags: [Records]
 *     summary: Listet archivierte MiniChat-Records
 *     responses:
 *       200:
 *         description: Liste archivierter Records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ArchivedRecord'
 */
router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        r.*,
        a.accepted_at,
        latest.snapshot_hash
      FROM ais_records r
      JOIN ais_aips a ON a.aip_id = r.aip_id
      LEFT JOIN LATERAL (
        SELECT snapshot_hash
        FROM ais_record_snapshots
        WHERE record_id = r.id
        ORDER BY version DESC
        LIMIT 1
      ) latest ON true
      ORDER BY r.created_at DESC
    `);

    return res.json(result.rows.map(mapRecord));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/records/{id}:
 *   get:
 *     tags: [Records]
 *     summary: Liefert einen archivierten MiniChat-Record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Archivierter Record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ArchivedRecord'
 *       404:
 *         description: Record nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        SELECT
          r.*,
          a.accepted_at,
          latest.snapshot_hash
        FROM ais_records r
        JOIN ais_aips a ON a.aip_id = r.aip_id
        LEFT JOIN LATERAL (
          SELECT snapshot_hash
          FROM ais_record_snapshots
          WHERE record_id = r.id
          ORDER BY version DESC
          LIMIT 1
        ) latest ON true
        WHERE r.id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "Archived Record not found",
        details: []
      });
    }

    return res.json(mapRecord(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/records/{id}/history:
 *   get:
 *     tags: [Records]
 *     summary: Liefert die unveränderte Snapshot-Historie eines archivierten Records
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Snapshot-Historie
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Snapshot'
 *       404:
 *         description: Record nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id/history", async (req, res, next) => {
  try {
    const record = await pool.query(
      `
        SELECT id
        FROM ais_records
        WHERE id = $1
      `,
      [req.params.id]
    );

    if (record.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "Archived Record not found",
        details: []
      });
    }

    const result = await pool.query(
      `
        SELECT *
        FROM ais_record_snapshots
        WHERE record_id = $1
        ORDER BY version ASC
      `,
      [req.params.id]
    );

    return res.json(result.rows.map(mapSnapshot));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/records/{id}/deletion-record:
 *   get:
 *     tags: [DeletionRecords]
 *     summary: Liefert das Löschprotokoll zur lokalen SoX-Payload-Löschung
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Löschprotokoll gefunden
 *       404:
 *         description: Record oder Löschprotokoll nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id/deletion-record", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        SELECT d.*
        FROM ais_deletion_records d
        JOIN ais_records r ON r.did = d.target_record_did
        WHERE r.id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "DeletionRecord not found for this Archived Record",
        details: []
      });
    }

    const row = result.rows[0];

    return res.json({
      deletionRecordDid: row.deletion_record_did,
      deletionRecordSnapshotHash: row.deletion_record_snapshot_hash,
      targetRecordDid: row.target_record_did,
      targetSnapshotHash: row.target_snapshot_hash,
      submittedAt: row.submitted_at,
      deletionPerformedAt: row.deletion_performed_at,
      payload: row.deletion_record
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;