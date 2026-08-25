const express = require("express");
const { v4: uuidv4 } = require("uuid");

const { pool } = require("../db");
const { canonicalHash, canonicalJson } = require("../hash");
const {
  validateMiniChatSip,
  validateSubmissionReceipt,
  errorsFor
} = require("../schemas");

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

function mapSnapshot(row) {
  return {
    snapshotHash: row.snapshot_hash,
    did: row.did,
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

function makeReceipt({
  aipId,
  recordDid,
  recordId,
  currentSnapshotHash,
  sipPackageHash,
  acceptedAt,
  idempotent = false
}) {
  const receipt = {
    receiptType: "RWP-AIS-Submission-Receipt",
    receiptVersion: "0.1",
    receivedAt: acceptedAt,
    aip: {
      aipId,
      recordDid,
      recordEndpoint:
        `${PUBLIC_BASE_URL}/ais/api/records/${encodeURIComponent(recordId)}`,
      currentSnapshotHash,
      sipPackageHash
    },
    validation: {
      sipComplete: true,
      recordFinalized: true,
      namespaceValid: true,
      snapshotGraphValid: true,
      payloadHashesValid: true,
      snapshotHashesValid: true
    },
    sourceDeletion: {
      permitted: true,
      requiresResolverVerification: true
    }
  };

  if (idempotent) {
    receipt.idempotent = true;
  }

  return receipt;
}

function invalidSip(res, message, details = []) {
  return res.status(422).json({
    error: "invalid-sip",
    message,
    details
  });
}

function verifyGraphAndHashes(sip) {
  const snapshots = [...sip.snapshots].sort((a, b) => a.version - b.version);
  const expectedVersions = snapshots.map((snapshot) => snapshot.version);

  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];

    if (snapshot.version !== index + 1) {
      return {
        ok: false,
        message: "Snapshot versions must begin with 1 and be contiguous"
      };
    }

    if (index === 0 && snapshot.parents.length !== 0) {
      return {
        ok: false,
        message: "The first snapshot must not have parents"
      };
    }

    if (
      index > 0 &&
      (snapshot.parents.length !== 1 ||
        snapshot.parents[0] !== snapshots[index - 1].snapshotHash)
    ) {
      return {
        ok: false,
        message:
          "Each successor snapshot must reference exactly its direct predecessor"
      };
    }

    const calculatedPayloadHash = canonicalHash(snapshot.payload);

    if (calculatedPayloadHash !== snapshot.payloadHash) {
      return {
        ok: false,
        message: `Payload hash mismatch for snapshot version ${snapshot.version}`
      };
    }

    if (
      typeof snapshot.snapshotHash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(snapshot.snapshotHash)
    ) {
      return {
        ok: false,
        message: `Invalid stored snapshot hash for snapshot version ${snapshot.version}`
      };
    }
  }

  const latestSnapshot = snapshots[snapshots.length - 1];

  if (
    sip.record.version !== latestSnapshot.version ||
    sip.record.currentSnapshotHash !== latestSnapshot.snapshotHash
  ) {
    return {
      ok: false,
      message:
        "Record current version must match the final snapshot version and hash"
    };
  }

  if (
    canonicalJson(sip.primaryData) !== canonicalJson(latestSnapshot.payload)
  ) {
    return {
      ok: false,
      message:
        "primaryData must be identical to the payload of the final snapshot"
    };
  }

  if (
    sip.record.id !== sip.recordMetadata.id ||
    sip.record.did !== sip.recordMetadata.did ||
    sip.record.recordType !== sip.recordMetadata.recordType ||
    sip.record.version !== sip.recordMetadata.version
  ) {
    return {
      ok: false,
      message: "Record and recordMetadata are inconsistent"
    };
  }

  return {
    ok: true,
    snapshots,
    expectedVersions
  };
}

function verifyManifest(sip) {
  const manifestPaths = new Set(
    sip.manifest.entries.map((entry) => entry.path)
  );

  const requiredPaths = Object.values(sip.contents);

  for (const requiredPath of requiredPaths) {
    if (!manifestPaths.has(requiredPath)) {
      return {
        ok: false,
        message: `Manifest does not contain required entry: ${requiredPath}`
      };
    }
  }

  const packageForHash = {
    packageType: sip.packageType,
    profile: sip.profile,
    profileVersion: sip.profileVersion,
    createdAt: sip.createdAt,
    producer: sip.producer,
    submission: sip.submission,
    record: sip.record,
    contents: sip.contents,
    recordMetadata: sip.recordMetadata,
    snapshots: sip.snapshots,
    primaryData: sip.primaryData,
    preservationMetadata: sip.preservationMetadata,
    manifestEntries: sip.manifest.entries
  };

  const calculatedPackageHash = canonicalHash(packageForHash);

  if (calculatedPackageHash !== sip.manifest.packageHash) {
    return {
      ok: false,
      message: "SIP package hash mismatch"
    };
  }

  return {
    ok: true
  };
}

/**
 * @openapi
 * /api/sips:
 *   post:
 *     tags: [SIPs]
 *     summary: Übernimmt ein validiertes MiniChat-SIP und erzeugt ein AIP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: SIP wurde übernommen
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AisSubmissionReceipt'
 *       200:
 *         description: Idempotente Wiederholung einer bereits übernommenen SIP
 *       409:
 *         description: DID ist bereits mit abweichender finaler Version bekannt
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       422:
 *         description: SIP verletzt Schema- oder Integritätsregeln
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post("/", async (req, res, next) => {
  const sip = req.body;

  try {
    if (!validateMiniChatSip(sip)) {
      return invalidSip(res, "SIP schema validation failed", errorsFor(validateMiniChatSip));
    }

    const integrity = verifyGraphAndHashes(sip);

    if (!integrity.ok) {
      return invalidSip(res, integrity.message);
    }

    const manifest = verifyManifest(sip);

    if (!manifest.ok) {
      return invalidSip(res, manifest.message);
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `
          SELECT
            a.aip_id,
            a.record_id,
            a.record_did,
            a.sip_package_hash,
            a.accepted_at,
            (
              SELECT snapshot_hash
              FROM ais_record_snapshots
              WHERE record_id = ar.id
              ORDER BY version DESC
              LIMIT 1
            ) AS snapshot_hash,
            sr.receipt
          FROM ais_aips a
          JOIN ais_records ar ON ar.aip_id = a.aip_id
          LEFT JOIN ais_submission_receipts sr ON sr.aip_id = a.aip_id
          WHERE a.record_did = $1
          FOR UPDATE OF a, ar
        `,
        [sip.record.did]
      );

      if (existing.rowCount > 0) {
        const stored = existing.rows[0];

        if (stored.snapshot_hash !== sip.record.currentSnapshotHash) {
          await client.query("ROLLBACK");

          return res.status(409).json({
            error: "conflicting-transfer",
            message:
              "The Record DID already exists in AIS with a different final snapshot hash",
            details: []
          });
        }

        const receipt = {
          ...stored.receipt,
          idempotent: true
        };

        await client.query("COMMIT");

        return res.status(200).json(receipt);
      }

      const aipId = `aip:${uuidv4()}`;
      const acceptedAt = new Date().toISOString();
      const receiptId = uuidv4();

      const receipt = makeReceipt({
        aipId,
        recordDid: sip.record.did,
        recordId: sip.record.id,
        currentSnapshotHash: sip.record.currentSnapshotHash,
        sipPackageHash: sip.manifest.packageHash,
        acceptedAt
      });

      if (!validateSubmissionReceipt(receipt)) {
        throw new Error(
          `Generated submission receipt violates its schema: ${JSON.stringify(
            errorsFor(validateSubmissionReceipt)
          )}`
        );
      }

      const receiptHash = canonicalHash(receipt);

      await client.query(
        `
          INSERT INTO ais_aips (
            aip_id,
            record_id,
            record_did,
            sip_package_hash,
            sip_profile,
            sip_profile_version,
            sip_created_at,
            accepted_at,
            preservation_metadata,
            manifest
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
        `,
        [
          aipId,
          sip.record.id,
          sip.record.did,
          sip.manifest.packageHash,
          sip.profile,
          sip.profileVersion,
          sip.createdAt,
          acceptedAt,
          JSON.stringify(sip.preservationMetadata),
          JSON.stringify(sip.manifest)
        ]
      );

      await client.query(
        `
          INSERT INTO ais_records (
            id,
            did,
            record_type,
            status,
            version,
            title,
            payload_metadata,
            primary_data,
            created_at,
            updated_at,
            aip_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
        `,
        [
          sip.record.id,
          sip.record.did,
          sip.record.recordType,
          sip.record.state,
          sip.record.version,
          sip.recordMetadata.title,
          JSON.stringify(sip.recordMetadata.payloadMetadata),
          JSON.stringify(sip.primaryData),
          sip.record.createdAt,
          sip.record.updatedAt,
          aipId
        ]
      );

      for (const snapshot of integrity.snapshots) {
        await client.query(
          `
            INSERT INTO ais_record_snapshots (
              snapshot_hash,
              record_id,
              did,
              version,
              state,
              parents,
              payload,
              payload_hash,
              payload_format,
              created_at,
              finalized_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11
            )
          `,
          [
            snapshot.snapshotHash,
            sip.record.id,
            snapshot.did,
            snapshot.version,
            snapshot.state,
            JSON.stringify(snapshot.parents),
            JSON.stringify(snapshot.payload),
            snapshot.payloadHash,
            snapshot.payloadFormat,
            snapshot.createdAt,
            snapshot.finalizedAt
          ]
        );
      }

      await client.query(
        `
          INSERT INTO ais_submission_receipts (
            receipt_id,
            aip_id,
            receipt,
            receipt_hash,
            received_at
          )
          VALUES ($1, $2, $3::jsonb, $4, $5)
        `,
        [
          receiptId,
          aipId,
          JSON.stringify(receipt),
          receiptHash,
          acceptedAt
        ]
      );

      await client.query("COMMIT");

      return res
        .status(201)
        .location(`/ais/api/aips/${encodeURIComponent(aipId)}`)
        .json(receipt);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;