const express = require("express");

const { pool } = require("../db");
const { canonicalHash } = require("../hash");
const {
  validateDeletionRecord,
  errorsFor
} = require("../schemas");

const router = express.Router();

const SYSTEM_RECORD_NAMESPACE =
  process.env.SYSTEM_RECORD_DID_NAMESPACE || "a1b2c3d4";

function invalidDeletionRecord(res, message, details = []) {
  return res.status(422).json({
    error: "invalid-deletion-record",
    message,
    details
  });
}

function mapDeletionRecord(row) {
  return {
    deletionRecordDid: row.deletion_record_did,
    deletionRecordSnapshotHash: row.deletion_record_snapshot_hash,
    targetRecordDid: row.target_record_did,
    targetSnapshotHash: row.target_snapshot_hash,
    submittedAt: row.submitted_at,
    deletionPerformedAt: row.deletion_performed_at,
    payload: row.deletion_record
  };
}

function isSystemRecordDid(did) {
  const prefix = `did:rwp:${SYSTEM_RECORD_NAMESPACE}:records:`;

  return typeof did === "string" && did.startsWith(prefix);
}

async function verifyDeletionRecord(client, envelope) {
  const { deletionRecordDid, deletionRecordSnapshotHash, payload } = envelope;

  if (!isSystemRecordDid(deletionRecordDid)) {
    return {
      ok: false,
      message:
        `deletionRecordDid must use namespace ${SYSTEM_RECORD_NAMESPACE}`
    };
  }

  if (
    typeof deletionRecordSnapshotHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(deletionRecordSnapshotHash)
  ) {
    return {
      ok: false,
      message: "deletionRecordSnapshotHash must be a sha256 value"
    };
  }

  if (!validateDeletionRecord(payload)) {
    return {
      ok: false,
      message: "DeletionRecord payload schema validation failed",
      details: errorsFor(validateDeletionRecord)
    };
  }

  const targetResult = await client.query(
    `
      SELECT
        r.id,
        r.did,
        a.aip_id,
        a.sip_package_hash,
        sr.receipt_hash,
        (
          SELECT snapshot_hash
          FROM ais_record_snapshots
          WHERE record_id = r.id
          ORDER BY version DESC
          LIMIT 1
        ) AS current_snapshot_hash
      FROM ais_records r
      JOIN ais_aips a ON a.aip_id = r.aip_id
      JOIN ais_submission_receipts sr ON sr.aip_id = a.aip_id
      WHERE r.did = $1
      FOR UPDATE OF r, a, sr
    `,
    [payload.targetRecord.did]
  );

  if (targetResult.rowCount === 0) {
    return {
      ok: false,
      status: 404,
      message: "The target MiniChat Record is not available in AIS"
    };
  }

  const target = targetResult.rows[0];

  if (
    payload.targetRecord.finalizedSnapshotHash !==
    target.current_snapshot_hash
  ) {
    return {
      ok: false,
      message:
        "targetRecord.finalizedSnapshotHash does not match the archived current snapshot"
    };
  }

  if (payload.archivalHandover.aipId !== target.aip_id) {
    return {
      ok: false,
      message: "archivalHandover.aipId does not match the archived AIP"
    };
  }

  if (
    payload.archivalHandover.sipPackageHash !==
    target.sip_package_hash
  ) {
    return {
      ok: false,
      message: "archivalHandover.sipPackageHash does not match the AIP"
    };
  }

  if (
    payload.archivalHandover.aisReceiptHash !==
    target.receipt_hash
  ) {
    return {
      ok: false,
      message:
        "archivalHandover.aisReceiptHash does not match the stored AIS receipt"
    };
  }

  return {
    ok: true,
    target
  };
}

/**
 * @openapi
 * /api/deletion-records:
 *   post:
 *     tags: [DeletionRecords]
 *     summary: Übernimmt ein Löschprotokoll nach lokaler SoX-Payload-Löschung
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeletionRecordEnvelope'
 *     responses:
 *       201:
 *         description: Löschprotokoll übernommen
 *       200:
 *         description: Idempotente Wiederholung eines Löschprotokolls
 *       404:
 *         description: Zielrecord ist nicht im AIS vorhanden
 *       409:
 *         description: Widersprüchliches Löschprotokoll
 *       422:
 *         description: Ungültiges Löschprotokoll
 */
router.post("/", async (req, res, next) => {
  const envelope = req.body || {};
  const client = await pool.connect();

  try {
    if (
      typeof envelope.deletionRecordDid !== "string" ||
      typeof envelope.deletionRecordSnapshotHash !== "string" ||
      !envelope.payload ||
      typeof envelope.payload !== "object"
    ) {
      return invalidDeletionRecord(
        res,
        "deletionRecordDid, deletionRecordSnapshotHash and payload are required"
      );
    }

    await client.query("BEGIN");

    const validation = await verifyDeletionRecord(client, envelope);

    if (!validation.ok) {
      await client.query("ROLLBACK");

      return res.status(validation.status || 422).json({
        error:
          validation.status === 404
            ? "not-found"
            : "invalid-deletion-record",
        message: validation.message,
        details: validation.details || []
      });
    }

    const existing = await client.query(
      `
        SELECT *
        FROM ais_deletion_records
        WHERE target_record_did = $1
           OR deletion_record_did = $2
        FOR UPDATE
      `,
      [
        envelope.payload.targetRecord.did,
        envelope.deletionRecordDid
      ]
    );

    if (existing.rowCount > 0) {
      const stored = existing.rows[0];

      const identical =
        stored.deletion_record_did === envelope.deletionRecordDid &&
        stored.deletion_record_snapshot_hash ===
          envelope.deletionRecordSnapshotHash &&
        canonicalHash(stored.deletion_record) ===
          canonicalHash(envelope.payload);

      if (!identical) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          error: "conflicting-transfer",
          message:
            "A different DeletionRecord already exists for this target Record",
          details: []
        });
      }

      await client.query("COMMIT");

      return res.status(200).json({
        ...mapDeletionRecord(stored),
        idempotent: true
      });
    }

    const submittedAt = new Date().toISOString();
    const deletionPerformedAt =
      envelope.payload.sourceDeletion.deletedAt;

    const insertResult = await client.query(
      `
        INSERT INTO ais_deletion_records (
          deletion_record_did,
          target_record_did,
          target_snapshot_hash,
          deletion_record,
          submitted_at,
          deletion_performed_at,
          deletion_record_snapshot_hash
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
        RETURNING *
      `,
      [
        envelope.deletionRecordDid,
        envelope.payload.targetRecord.did,
        envelope.payload.targetRecord.finalizedSnapshotHash,
        JSON.stringify(envelope.payload),
        submittedAt,
        deletionPerformedAt,
        envelope.deletionRecordSnapshotHash
      ]
    );

    await client.query("COMMIT");

    return res
      .status(201)
      .location(
        `/ais/api/deletion-records/${encodeURIComponent(
          envelope.deletionRecordDid
        )}`
      )
      .json(mapDeletionRecord(insertResult.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /api/deletion-records:
 *   get:
 *     tags: [DeletionRecords]
 *     summary: Listet alle im AIS hinterlegten Löschprotokolle
 *     responses:
 *       200:
 *         description: Liste der Löschprotokolle
 */
router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM ais_deletion_records
      ORDER BY submitted_at DESC
    `);

    return res.json(result.rows.map(mapDeletionRecord));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/deletion-records/{did}:
 *   get:
 *     tags: [DeletionRecords]
 *     summary: Liefert ein Löschprotokoll über dessen SystemRecord-DID
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Löschprotokoll gefunden
 *       404:
 *         description: Löschprotokoll nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:did", async (req, res, next) => {
  try {
    const did = decodeURIComponent(req.params.did);

    const result = await pool.query(
      `
        SELECT *
        FROM ais_deletion_records
        WHERE deletion_record_did = $1
      `,
      [did]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "DeletionRecord not found",
        details: []
      });
    }

    return res.json(mapDeletionRecord(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

module.exports = router;