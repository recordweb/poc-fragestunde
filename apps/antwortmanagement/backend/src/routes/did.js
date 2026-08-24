import express from "express";

import pool from "../db.js";
import {
  RECORD_TYPE_ANTWORT,
  schemaVersionHash
} from "../schemas.js";

import {
  createSchemaRecord,
  getActiveBindings
} from "./schemas.js";

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

router.get(/^\/(.+)$/, async (req, res, next) => {
  try {
    const did = decodeURIComponent(req.params[0]);

    if (did === RECORD_TYPE_ANTWORT) {
      const bindings = await getActiveBindings();
      const schemaRecord = createSchemaRecord(bindings);

      return res.json({
        "@context": "https://www.w3.org/ns/did/v1",
        id: RECORD_TYPE_ANTWORT,
        recordEndpoint:
          `${PUBLIC_BASE_URL}/antwortmanagement/api/schemas/fragestunde-antwort`,
        created: null,
        updated: null,
        currentVersion: schemaVersionHash(RECORD_TYPE_ANTWORT),
        controller: schemaRecord.metadata.owner
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        r.did,
        r.owner,
        r.created AS record_created,
        s.snapshot_hash,
        s.created AS snapshot_created
      FROM records r
      LEFT JOIN record_snapshots s
        ON s.id = r.current_snapshot_id
      WHERE r.did = $1
      `,
      [did]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "DID unbekannt"
      });
    }

    const record = rows[0];

    return res.json({
      "@context": "https://www.w3.org/ns/did/v1",
      id: record.did,
      recordEndpoint:
        `${PUBLIC_BASE_URL}/antwortmanagement/api/records/${encodeURIComponent(record.did)}`,
      created: record.record_created,
      updated: record.snapshot_created || record.record_created,
      currentVersion: record.snapshot_hash || null,
      controller: record.owner
    });
  } catch (error) {
    return next(error);
  }
});

export default router;