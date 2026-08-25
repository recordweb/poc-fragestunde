const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

function mapAip(row) {
  return {
    aipId: row.aip_id,
    recordDid: row.record_did,
    recordId: row.record_id,
    acceptedAt: row.accepted_at,
    sip: {
      profile: row.sip_profile,
      profileVersion: row.sip_profile_version,
      packageHash: row.sip_package_hash,
      createdAt: row.sip_created_at
    },
    recordEndpoint:
      `${PUBLIC_BASE_URL}/ais/api/records/${encodeURIComponent(row.record_id)}`,
    deletionProtocol: row.deletion_record_did
      ? {
          deletionRecordDid: row.deletion_record_did,
          deletionPerformedAt: row.deletion_performed_at,
          submittedAt: row.deletion_submitted_at
        }
      : null
  };
}

/**
 * @openapi
 * /api/aips:
 *   get:
 *     tags: [AIPs]
 *     summary: Listet archivische Aufbewahrungseinheiten
 *     responses:
 *       200:
 *         description: Liste der AIPs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Aip'
 */
router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        a.*,
        d.deletion_record_did,
        d.deletion_performed_at,
        d.submitted_at AS deletion_submitted_at
      FROM ais_aips a
      LEFT JOIN ais_deletion_records d
        ON d.target_record_did = a.record_did
      ORDER BY a.accepted_at DESC
    `);

    return res.json(result.rows.map(mapAip));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/aips/{aipId}:
 *   get:
 *     tags: [AIPs]
 *     summary: Liefert die Verwaltungsansicht eines AIP
 *     parameters:
 *       - in: path
 *         name: aipId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: AIP gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Aip'
 *       404:
 *         description: AIP nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:aipId", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        SELECT
          a.*,
          d.deletion_record_did,
          d.deletion_performed_at,
          d.submitted_at AS deletion_submitted_at
        FROM ais_aips a
        LEFT JOIN ais_deletion_records d
          ON d.target_record_did = a.record_did
        WHERE a.aip_id = $1
      `,
      [req.params.aipId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "AIP not found",
        details: []
      });
    }

    return res.json(mapAip(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/aips/{aipId}/receipt:
 *   get:
 *     tags: [AIPs]
 *     summary: Liefert die AIS-Übernahmequittung eines AIP
 *     parameters:
 *       - in: path
 *         name: aipId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Submission Receipt gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AisSubmissionReceipt'
 *       404:
 *         description: AIP oder Receipt nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:aipId/receipt", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        SELECT receipt
        FROM ais_submission_receipts
        WHERE aip_id = $1
      `,
      [req.params.aipId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "AIP submission receipt not found",
        details: []
      });
    }

    return res.json(result.rows[0].receipt);
  } catch (error) {
    next(error);
  }
});

module.exports = router;