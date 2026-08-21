const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

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
        latest.snapshot_hash AS current_version
      FROM sox_records r
      LEFT JOIN LATERAL (
        SELECT snapshot_hash
        FROM sox_record_snapshots
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
        error: "DID not found"
      });
    }

    const record = result.rows[0];

    return res.json({
      "@context": [
        "https://www.w3.org/ns/did/v1"
      ],
      id: record.did,
      recordEndpoint:
        `${PUBLIC_BASE_URL}/sox/api/records/${record.id}`,
      created: record.created_at,
      updated: record.updated_at,
      currentVersion: record.current_version || "",
      controller:
        `did:rwp:${process.env.SOX_DID_NAMESPACE || "s73f42a3"}`,
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