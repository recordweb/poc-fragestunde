const express = require("express");
const { pool } = require("../db");
const { createDraftRecord } = require("../recordCore");

const router = express.Router();

const supportedRecordTypes = new Set([
  "MiniChat",
  "TeamsChat"
]);

function mapRecord(row) {
  return {
    id: row.id,
    did: row.did,
    recordType: row.record_type,
    status: row.status,
    version: row.version,
    title: row.title,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * @openapi
 * /api/records:
 *   post:
 *     summary: Erstellt einen neuen RWP-Draft-Record in SoX
 *     tags: [Records]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recordType, title, caseReference]
 *             properties:
 *               recordType:
 *                 type: string
 *                 enum: [MiniChat, TeamsChat]
 *               title:
 *                 type: string
 *               caseReference:
 *                 type: object
 *                 required: [system, caseId]
 *                 properties:
 *                   system:
 *                     type: string
 *                   caseId:
 *                     type: string
 *                   uri:
 *                     type: string
 *                     format: uri
 *     responses:
 *       201:
 *         description: Draft-Record wurde erstellt
 *       400:
 *         description: Ungültige Anfrage
 */
router.post("/", async (req, res, next) => {
  try {
    const { recordType, title, caseReference } = req.body || {};

    if (!supportedRecordTypes.has(recordType)) {
      return res.status(400).json({
        error: "recordType must be MiniChat or TeamsChat"
      });
    }

    if (typeof title !== "string" || title.trim().length === 0) {
      return res.status(400).json({
        error: "title is required"
      });
    }

    if (
      !caseReference ||
      typeof caseReference.system !== "string" ||
      typeof caseReference.caseId !== "string"
    ) {
      return res.status(400).json({
        error: "caseReference.system and caseReference.caseId are required"
      });
    }

    const record = createDraftRecord({
      recordType,
      title: title.trim(),
      caseReference
    });

    const result = await pool.query(
      `
        INSERT INTO sox_records (
          id,
          did,
          record_type,
          status,
          version,
          title,
          payload,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        RETURNING *
      `,
      [
        record.id,
        record.did,
        record.recordType,
        record.status,
        record.version,
        record.title,
        JSON.stringify(record.payload),
        record.createdAt,
        record.updatedAt
      ]
    );

    const createdRecord = mapRecord(result.rows[0]);

    return res
      .status(201)
      .location(`/sox/api/records/${createdRecord.id}`)
      .json(createdRecord);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/records:
 *   get:
 *     summary: Liefert alle durch SoX verwalteten Records
 *     tags: [Records]
 *     responses:
 *       200:
 *         description: Liste der Records
 */
router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM sox_records
      ORDER BY created_at DESC
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
 *     summary: Liefert einen SoX-Record einschliesslich Payload
 *     tags: [Records]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Record
 *       404:
 *         description: Record nicht gefunden
 */
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM sox_records WHERE id = $1",
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Record not found"
      });
    }

    return res.json(mapRecord(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

module.exports = router;