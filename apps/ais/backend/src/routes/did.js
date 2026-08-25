const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

const MINI_CHAT_NAMESPACE =
  process.env.MINICHAT_DID_NAMESPACE || "s73f42a3";

/**
 * @openapi
 * /did/{id}:
 *   get:
 *     tags: [DID]
 *     summary: Liefert ein DID-Dokument für einen im AIS verfügbaren MiniChat-Record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Lokale Record-ID oder URL-kodierte MiniChat-DID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DID-Dokument
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: DID nicht bekannt
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:id", async (req, res, next) => {
  try {
    const requestedIdentifier = decodeURIComponent(req.params.id);

    const result = await pool.query(
      `
        SELECT
          r.id,
          r.did,
          r.record_type,
          r.status,
          r.version,
          r.title,
          r.created_at,
          r.updated_at,
          a.accepted_at,
          latest.snapshot_hash AS current_version
        FROM ais_records r
        JOIN ais_aips a ON a.aip_id = r.aip_id
        LEFT JOIN LATERAL (
          SELECT snapshot_hash
          FROM ais_record_snapshots
          WHERE record_id = r.id
          ORDER BY version DESC
          LIMIT 1
        ) latest ON true
        WHERE r.id = $1 OR r.did = $1
      `,
      [requestedIdentifier]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "DID not found in AIS",
        details: []
      });
    }

    const record = result.rows[0];

    return res.json({
      "@context": [
        "https://www.w3.org/ns/did/v1"
      ],
      id: record.did,
      recordEndpoint:
        `${PUBLIC_BASE_URL}/ais/api/records/${encodeURIComponent(record.id)}`,
      created: record.created_at,
      updated: record.accepted_at,
      currentVersion: record.current_version || "",
      controller: `did:rwp:${MINI_CHAT_NAMESPACE}`,
      record: {
        recordType: record.record_type,
        status: record.status,
        version: record.version,
        title: record.title,
        createdAt: record.created_at,
        updatedAt: record.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;