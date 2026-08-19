const express = require("express");
const { pool } = require("../db");

const router = express.Router();

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
        SELECT id, did, record_type, status, version, title, created_at, updated_at
        FROM sox_records
        WHERE id = $1
      `,
      [req.params.id]
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
      controller: `did:rwp:${process.env.SOX_DID_NAMESPACE || "s73f42a3"}`,
      alsoKnownAs: [
        `https://vps.recordweb.dev/sox/api/records/${record.id}`
      ],
      service: [
        {
          id: `${record.did}#record`,
          type: "RecordWebRecord",
          serviceEndpoint: `https://vps.recordweb.dev/sox/api/records/${record.id}`
        }
      ],
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