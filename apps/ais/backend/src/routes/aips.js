const express = require("express");
const { pool } = require("../db");
const crypto = require("crypto");

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

function sha256(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function makePackageEntry(path, content) {
  return {
    path,
    hash: sha256(content),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

function toIsoString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}

function normalizeJsonDates(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonDates);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeJsonDates(nestedValue)
      ])
    );
  }

  return value;
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
 * /api/aips/{aipId}/package:
 *   get:
 *     tags: [AIPs]
 *     summary: Liefert ein archivnahes AIP-Exportpaket als JSON
 *     description: |
 *       Das PoC liefert ein logisch strukturiertes AIP als JSON-Repräsentation.
 *       Es enthält die ursprünglichen SIP-Inhalte, die AIS-Übernahmequittung,
 *       archivische Verwaltungsinformationen und optional den DeletionRecord.
 *     parameters:
 *       - in: path
 *         name: aipId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/AipExportPackage'
 *     responses:
 *       200:
 *         description: AIP-Exportpaket
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: AIP nicht gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/:aipId/package", async (req, res, next) => {
  try {
    const aipResult = await pool.query(
      `
        SELECT
          a.*,
          r.id AS record_id,
          r.did AS record_did,
          r.record_type,
          r.status,
          r.version,
          r.title,
          r.payload_metadata,
          r.primary_data,
          r.created_at AS record_created_at,
          r.updated_at AS record_updated_at,
          sr.receipt,
          sr.receipt_hash,
          d.deletion_record_did,
          d.deletion_record_snapshot_hash,
          d.deletion_record,
          d.submitted_at AS deletion_submitted_at,
          d.deletion_performed_at
        FROM ais_aips a
        JOIN ais_records r ON r.aip_id = a.aip_id
        JOIN ais_submission_receipts sr ON sr.aip_id = a.aip_id
        LEFT JOIN ais_deletion_records d
          ON d.target_record_did = r.did
        WHERE a.aip_id = $1
      `,
      [req.params.aipId]
    );

    if (aipResult.rowCount === 0) {
      return res.status(404).json({
        error: "not-found",
        message: "AIP not found",
        details: []
      });
    }

    const aip = aipResult.rows[0];

    const snapshotsResult = await pool.query(
      `
        SELECT *
        FROM ais_record_snapshots
        WHERE record_id = $1
        ORDER BY version ASC
      `,
      [aip.record_id]
    );

    const snapshots = snapshotsResult.rows.map((snapshot) => ({
      snapshotHash: snapshot.snapshot_hash,
      did: snapshot.did,
      version: snapshot.version,
      state: snapshot.state,
      parents: snapshot.parents,
      payload: normalizeJsonDates(snapshot.payload),
      payloadHash: snapshot.payload_hash,
      payloadFormat: snapshot.payload_format,
      createdAt: toIsoString(snapshot.created_at),
      finalizedAt: toIsoString(snapshot.finalized_at)
    }));

    const recordMetadata = {
      id: aip.record_id,
      did: aip.record_did,
      recordType: aip.record_type,
      status: aip.status,
      version: aip.version,
      title: aip.title,
      payloadMetadata: normalizeJsonDates(aip.payload_metadata),
      createdAt: toIsoString(aip.record_created_at),
      updatedAt: toIsoString(aip.record_updated_at)
    };

    const packageHeader = {
      packageType: "RWP-OAIS-AIP",
      profile: aip.sip_profile,
      profileVersion: aip.sip_profile_version,
      aipId: aip.aip_id,
      acceptedAt: toIsoString(aip.accepted_at),
      sourceSip: {
        packageHash: aip.sip_package_hash,
        createdAt: toIsoString(aip.sip_created_at)
      },
      record: {
        id: aip.record_id,
        did: aip.record_did,
        recordType: aip.record_type,
        state: aip.status,
        version: aip.version
      },
      contents: {
        recordMetadata: "metadata/rwp-record.json",
        snapshots: "metadata/rwp-snapshots.json",
        primaryData: "content/conversation.json",
        preservationMetadata: "metadata/preservation-metadata.json",
        submissionReceipt: "metadata/submission-receipt.json",
        deletionRecord: aip.deletion_record
          ? "metadata/deletion-record.json"
          : null,
        manifest: "manifest-sha256.json"
      }
    };

    const deletionRecord = aip.deletion_record
      ? {
          deletionRecordDid: aip.deletion_record_did,
          deletionRecordSnapshotHash:
            aip.deletion_record_snapshot_hash,
          submittedAt: toIsoString(aip.deletion_submitted_at),
          deletionPerformedAt: toIsoString(aip.deletion_performed_at),
          payload: normalizeJsonDates(aip.deletion_record)
        }
      : null;

    const packageFiles = [
      {
        path: "aip.json",
        content: canonicalJson(packageHeader)
      },
      {
        path: "metadata/rwp-record.json",
        content: canonicalJson(recordMetadata)
      },
      {
        path: "metadata/rwp-snapshots.json",
        content: canonicalJson(snapshots)
      },
      {
        path: "content/conversation.json",
        content: canonicalJson(normalizeJsonDates(aip.primary_data))
      },
      {
        path: "metadata/preservation-metadata.json",
        content: canonicalJson(
          normalizeJsonDates(aip.preservation_metadata)
        )
      },
      {
        path: "metadata/submission-receipt.json",
        content: canonicalJson(normalizeJsonDates(aip.receipt))
      }
    ];

    if (deletionRecord) {
      packageFiles.push({
        path: "metadata/deletion-record.json",
        content: canonicalJson(deletionRecord)
      });
    }

    const manifestEntries = packageFiles.map((file) =>
      makePackageEntry(file.path, file.content)
    );

    const manifest = {
      algorithm: "sha256",
      generatedAt: new Date().toISOString(),
      entries: manifestEntries
    };

    const manifestContent = canonicalJson(manifest);

    const packageHash = sha256(
      `${canonicalJson(packageHeader)}${manifestContent}`
    );

    const archivePackage = {
      ...packageHeader,
      manifest: {
        path: "manifest-sha256.json",
        hash: sha256(manifestContent),
        packageHash
      },
      files: Object.fromEntries(
        packageFiles.map((file) => [
          file.path,
          JSON.parse(file.content)
        ])
      ),
      manifestDocument: manifest
    };

    return res
      .status(200)
      .type("application/json")
      .attachment(`aip-${aip.aip_id.replace(":", "-")}.json`)
      .json(archivePackage);
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