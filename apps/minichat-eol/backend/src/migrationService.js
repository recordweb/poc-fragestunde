const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const { pool } = require("./db");
const { canonicalHash, canonicalJson } = require("./hash");
const {
  validateMiniChatSip,
  validateSubmissionReceipt,
  validateDeletionRecord,
  validateMigrationState,
  errorsFor
} = require("./schemas");

const AIS_API_BASE_URL =
  process.env.AIS_API_BASE_URL || "http://ais:3000/api";

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

const MINICHAT_DID_NAMESPACE =
  process.env.MINICHAT_DID_NAMESPACE || "s73f42a3";

const SYSTEM_RECORD_DID_NAMESPACE =
  process.env.SYSTEM_RECORD_DID_NAMESPACE || "a1b2c3d4";

const MINICHAT_RESOLVER_ENDPOINT =
  process.env.MINICHAT_RESOLVER_ENDPOINT ||
  "https://vps.recordweb.dev/sox/did";

const TERMINAL_STATES = new Set([
  "completed",
  "validation-failed",
  "rejected",
  "resolver-not-confirmed",
  "source-deletion-failed",
  "deletion-protocol-failed"
]);

function sha256(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

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

function mapMigration(row) {
  if (!row) return null;

  return {
    migrationId: row.migration_id,
    recordId: row.record_id,
    recordDid: row.record_did,
    currentSnapshotHash: row.current_snapshot_hash,
    state: row.state,
    sip: row.sip
      ? {
          packageHash: row.sip_package_hash,
          createdAt: toIsoString(row.sip_created_at),
          package: row.sip
        }
      : null,
    ais: row.aip_id
      ? {
          aipId: row.aip_id,
          recordEndpoint: row.ais_record_endpoint,
          receiptHash: row.ais_receipt_hash,
          receipt: row.ais_receipt,
          acceptedAt: toIsoString(row.ais_accepted_at)
        }
      : null,
    resolverVerification: row.resolver_verified_at
      ? {
          verifiedAt: toIsoString(row.resolver_verified_at),
          resolvedRecordEndpoint: row.resolver_record_endpoint,
          resolvedCurrentSnapshotHash: row.resolver_current_snapshot_hash
        }
      : null,
    deletion: row.source_deleted_at
      ? {
          deletedAt: toIsoString(row.source_deleted_at),
          deletionRecordDid: row.deletion_record_did,
          deletionRecordSnapshotHash: row.deletion_record_snapshot_hash,
          deletionRecord: row.deletion_record,
          acceptedAt: toIsoString(row.deletion_record_accepted_at)
        }
      : null,
    error: row.error_code
      ? {
          code: row.error_code,
          message: row.error_message,
          occurredAt: toIsoString(row.error_occurred_at)
        }
      : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function makeError(code, message, status = 422, details = []) {
  const error = new Error(message);

  error.code = code;
  error.status = status;
  error.details = details;

  return error;
}

async function getSoXRecord(recordId, client = pool) {
  const result = await client.query(
    `
      SELECT
        r.*,
        latest.snapshot_hash,
        latest.finalized_at
      FROM sox_records r
      LEFT JOIN LATERAL (
        SELECT snapshot_hash, finalized_at
        FROM sox_record_snapshots
        WHERE record_id = r.id
        ORDER BY version DESC
        LIMIT 1
      ) latest ON true
      WHERE r.id = $1
    `,
    [recordId]
  );

  if (result.rowCount === 0) {
    throw makeError("not-found", "SoX Record not found", 404);
  }

  return result.rows[0];
}

async function getSoXSnapshots(recordId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM sox_record_snapshots
      WHERE record_id = $1
      ORDER BY version ASC
    `,
    [recordId]
  );

  return result.rows.map(mapSnapshot);
}

function hasPrimaryData(record) {
  const conversation = record.payload?.conversation;

  return (
    conversation &&
    typeof conversation === "object" &&
    Array.isArray(conversation.messages) &&
    conversation.messages.length > 0
  );
}

function verifySoXSnapshotHashes(recordType, snapshots) {
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];

    if (snapshot.version !== index + 1) {
      throw makeError(
        "invalid-source-record",
        "SoX snapshot versions are not contiguous"
      );
    }

    if (index === 0 && snapshot.parents.length !== 0) {
      throw makeError(
        "invalid-source-record",
        "First SoX snapshot has unexpected parents"
      );
    }

    if (
      index > 0 &&
      (snapshot.parents.length !== 1 ||
        snapshot.parents[0] !== snapshots[index - 1].snapshotHash)
    ) {
      throw makeError(
        "invalid-source-record",
        "SoX snapshot parent chain is inconsistent"
      );
    }

    const calculatedPayloadHash = canonicalHash(snapshot.payload);

    if (calculatedPayloadHash !== snapshot.payloadHash) {
      throw makeError(
        "invalid-source-record",
        `Payload hash mismatch for SoX snapshot version ${snapshot.version}`
      );
    }

    if (
      typeof snapshot.snapshotHash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(snapshot.snapshotHash)
    ) {
      throw makeError(
        "invalid-source-record",
        `Invalid stored snapshot hash for SoX snapshot version ${snapshot.version}`
      );
    }
  }
}

function createManifestEntries({
  recordMetadata,
  snapshots,
  primaryData,
  preservationMetadata
}) {
  return [
    {
      path: "header/sip.json",
      hash: "sha256:pending"
    },
    {
      path: "metadata/rwp-record.json",
      hash: canonicalHash(recordMetadata)
    },
    {
      path: "metadata/rwp-snapshots.json",
      hash: canonicalHash(snapshots)
    },
    {
      path: "content/conversation.json",
      hash: canonicalHash(primaryData)
    },
    {
      path: "header/preservation-metadata.json",
      hash: canonicalHash(preservationMetadata)
    },
    {
      path: "header/manifest-sha256.json",
      hash: "sha256:pending"
    }
  ];
}

function buildSip(record, snapshots) {
  if (record.record_type !== "MiniChat") {
    throw makeError(
      "invalid-source-record",
      "Only MiniChat Records are eligible for EOL migration"
    );
  }

  if (record.status !== "finalized") {
    throw makeError(
      "invalid-source-record",
      "Only finalized MiniChat Records are eligible for EOL migration"
    );
  }

  if (!record.did.startsWith(`did:rwp:${MINICHAT_DID_NAMESPACE}:records:`)) {
    throw makeError(
      "invalid-source-record",
      `Record DID does not use MiniChat namespace ${MINICHAT_DID_NAMESPACE}`
    );
  }

  if (!hasPrimaryData(record)) {
    throw makeError(
      "source-payload-missing",
      "MiniChat Record has no primary conversation payload"
    );
  }

  if (snapshots.length === 0) {
    throw makeError(
      "invalid-source-record",
      "Finalized MiniChat Record has no snapshots"
    );
  }

  verifySoXSnapshotHashes(record.record_type, snapshots);

  const latestSnapshot = snapshots[snapshots.length - 1];

  if (
    latestSnapshot.snapshotHash !== record.snapshot_hash ||
    latestSnapshot.version !== record.version
  ) {
    throw makeError(
      "invalid-source-record",
      "SoX Record current version does not match the latest snapshot"
    );
  }

  if (
    canonicalJson(record.payload.conversation) !==
    canonicalJson(latestSnapshot.payload)
  ) {
    throw makeError(
      "invalid-source-record",
      "SoX current conversation does not match the latest snapshot payload"
    );
  }

  const createdAt = new Date().toISOString();

  const recordMetadata = {
    id: record.id,
    did: record.did,
    recordType: record.record_type,
    status: record.status,
    version: record.version,
    title: record.title,
    payloadMetadata: {
      source: record.payload.source,
      caseReference: record.payload.caseReference
    },
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };

  const primaryData = record.payload.conversation;

  const preservationMetadata = {
    preservationLevel: "AIP",
    custodyTransfer: {
      mode: "end-of-life",
      sourceSystem: "SoX",
      targetSystem: "AIS"
    }
  };

  const manifestEntries = createManifestEntries({
    recordMetadata,
    snapshots,
    primaryData,
    preservationMetadata
  });

  const sip = {
    packageType: "RWP-OAIS-SIP",
    profile: "MiniChat",
    profileVersion: "0.1",
    createdAt,
    producer: {
      application: "MiniChat-EOL-App",
      sourceSystem: "SoX",
      sourceNamespace: MINICHAT_DID_NAMESPACE,
      sourceResolverEndpoint: MINICHAT_RESOLVER_ENDPOINT
    },
    submission: {
      mode: "end-of-life",
      reason: "source-system-end-of-life",
      recordType: "MiniChat",
      primaryDataDeletionRequired: true
    },
    record: {
      did: record.did,
      id: record.id,
      recordType: "MiniChat",
      state: "finalized",
      version: record.version,
      title: record.title,
      currentSnapshotHash: latestSnapshot.snapshotHash,
      createdAt: record.created_at,
      updatedAt: record.updated_at
    },
    contents: {
      recordMetadata: "metadata/rwp-record.json",
      snapshots: "metadata/rwp-snapshots.json",
      primaryData: "content/conversation.json",
      preservationMetadata: "header/preservation-metadata.json",
      manifest: "header/manifest-sha256.json"
    },
    recordMetadata,
    snapshots,
    primaryData,
    preservationMetadata,
    manifest: {
      algorithm: "sha256",
      packageHash: "",
      entries: manifestEntries
    }
  };

  const sipHeader = {
    packageType: sip.packageType,
    profile: sip.profile,
    profileVersion: sip.profileVersion,
    createdAt: sip.createdAt,
    producer: sip.producer,
    submission: sip.submission,
    record: sip.record,
    contents: sip.contents
  };

  sip.manifest.entries[0].hash = canonicalHash(sipHeader);

  const manifestForEntryHash = {
    algorithm: sip.manifest.algorithm,
    packageHash: "",
    entries: sip.manifest.entries
  };

  sip.manifest.entries[5].hash = canonicalHash(manifestForEntryHash);

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

  sip.manifest.packageHash = canonicalHash(packageForHash);

  if (!validateMiniChatSip(sip)) {
    throw makeError(
      "invalid-sip",
      "Generated SIP violates minichat-sip.schema.json",
      500,
      errorsFor(validateMiniChatSip)
    );
  }

  return sip;
}

async function getMigration(recordId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM eol_migrations
      WHERE record_id = $1
    `,
    [recordId]
  );

  return result.rowCount > 0 ? result.rows[0] : null;
}

async function getOrCreateMigration(record) {
  const existing = await getMigration(record.id);

  if (existing) {
    return existing;
  }

  const migrationId = uuidv4();

  const result = await pool.query(
    `
      INSERT INTO eol_migrations (
        migration_id,
        record_id,
        record_did,
        current_snapshot_hash,
        state
      )
      VALUES ($1, $2, $3, $4, 'candidate')
      RETURNING *
    `,
    [
      migrationId,
      record.id,
      record.did,
      record.snapshot_hash
    ]
  );

  return result.rows[0];
}

async function setError(recordId, code, message, state = null) {
  await pool.query(
    `
      UPDATE eol_migrations
      SET
        state = COALESCE($1, state),
        error_code = $2,
        error_message = $3,
        error_occurred_at = NOW(),
        updated_at = NOW()
      WHERE record_id = $4
    `,
    [state, code, message, recordId]
  );
}

function assertState(migration, allowedStates, action) {
  if (!allowedStates.includes(migration.state)) {
    throw makeError(
      "invalid-state",
      `${action} is not allowed while migration is in state ${migration.state}`,
      409
    );
  }
}

function ensureMigrationSchema(row) {
  const migration = mapMigration(row);

  const schemaState = {
    migrationId: migration.migrationId,
    recordDid: migration.recordDid,
    recordId: migration.recordId,
    currentSnapshotHash: migration.currentSnapshotHash,
    state: migration.state,
    createdAt: migration.createdAt,
    updatedAt: migration.updatedAt
  };

  if (migration.sip) {
    schemaState.sip = {
      packageHash: migration.sip.packageHash,
      createdAt: migration.sip.createdAt
    };
  }

  if (migration.ais) {
    schemaState.ais = {
      aipId: migration.ais.aipId,
      recordEndpoint: migration.ais.recordEndpoint,
      receiptHash: migration.ais.receiptHash,
      acceptedAt: migration.ais.acceptedAt
    };
  }

  if (migration.resolverVerification) {
    schemaState.resolverVerification = migration.resolverVerification;
  }

  if (migration.deletion) {
    schemaState.deletion = {
      deletedAt: migration.deletion.deletedAt,
      deletionRecordDid: migration.deletion.deletionRecordDid,
      deletionRecordSnapshotHash:
        migration.deletion.deletionRecordSnapshotHash,
      acceptedAt: migration.deletion.acceptedAt
    };
  }

  if (migration.error) {
    schemaState.error = migration.error;
  }

  if (!validateMigrationState(schemaState)) {
    throw makeError(
      "invalid-migration-state",
      "Persisted EOL migration state violates its schema",
      500,
      errorsFor(validateMigrationState)
    );
  }

  return migration;
}

async function createSipForMigration(recordId) {
  const record = await getSoXRecord(recordId);
  const snapshots = await getSoXSnapshots(recordId);
  const currentMigration = await getOrCreateMigration(record);

  assertState(
    currentMigration,
    ["candidate", "sip-created", "validation-failed"],
    "SIP creation"
  );

  try {
    const sip = buildSip(record, snapshots);

    const result = await pool.query(
      `
        UPDATE eol_migrations
        SET
          current_snapshot_hash = $1,
          state = 'sip-created',
          sip = $2::jsonb,
          sip_package_hash = $3,
          sip_created_at = $4,
          error_code = NULL,
          error_message = NULL,
          error_occurred_at = NULL,
          updated_at = NOW()
        WHERE record_id = $5
        RETURNING *
      `,
      [
        sip.record.currentSnapshotHash,
        JSON.stringify(sip),
        sip.manifest.packageHash,
        sip.createdAt,
        recordId
      ]
    );

    return ensureMigrationSchema(result.rows[0]);
  } catch (error) {
    await setError(
      recordId,
      error.code || "validation-failed",
      error.message,
      "validation-failed"
    );

    throw error;
  }
}

async function submitSip(recordId) {
  const migration = await getMigration(recordId);

  if (!migration) {
    throw makeError(
      "not-found",
      "Migration does not exist. Create the SIP first.",
      404
    );
  }

  assertState(
    migration,
    ["sip-created", "submitted", "rejected"],
    "SIP submission"
  );

  if (!migration.sip) {
    throw makeError(
      "invalid-state",
      "Migration has no persisted SIP",
      409
    );
  }

  await pool.query(
    `
      UPDATE eol_migrations
      SET
        state = 'submitted',
        updated_at = NOW()
      WHERE record_id = $1
    `,
    [recordId]
  );

  let response;
  let body;

  try {
    response = await fetch(`${AIS_API_BASE_URL}/sips`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(migration.sip)
    });

    body = await response.json().catch(() => ({}));
  } catch (error) {
    await setError(recordId, "ais-unavailable", error.message);
    throw makeError(
      "ais-unavailable",
      `Unable to submit SIP to AIS: ${error.message}`,
      502
    );
  }

  if (!response.ok) {
    const code = response.status === 409 ? "rejected" : "ais-rejected";

    await pool.query(
      `
        UPDATE eol_migrations
        SET
          state = 'rejected',
          error_code = $1,
          error_message = $2,
          error_occurred_at = NOW(),
          updated_at = NOW()
        WHERE record_id = $3
      `,
      [
        code,
        body.message || `AIS returned HTTP ${response.status}`,
        recordId
      ]
    );

    throw makeError(
      code,
      body.message || `AIS returned HTTP ${response.status}`,
      response.status,
      body.details || []
    );
  }

  if (!validateSubmissionReceipt(body)) {
    await setError(
      recordId,
      "invalid-ais-receipt",
      "AIS returned a receipt that violates its schema"
    );

    throw makeError(
      "invalid-ais-receipt",
      "AIS returned a receipt that violates its schema",
      502,
      errorsFor(validateSubmissionReceipt)
    );
  }

  const expectedDid = migration.record_did;
  const expectedHash = migration.current_snapshot_hash;

  if (
    body.aip.recordDid !== expectedDid ||
    body.aip.currentSnapshotHash !== expectedHash
  ) {
    await setError(
      recordId,
      "invalid-ais-receipt",
      "AIS receipt does not match the submitted Record"
    );

    throw makeError(
      "invalid-ais-receipt",
      "AIS receipt does not match the submitted Record",
      502
    );
  }

  const receiptHash = canonicalHash(body);

  const result = await pool.query(
    `
      UPDATE eol_migrations
      SET
        state = 'accepted',
        aip_id = $1,
        ais_record_endpoint = $2,
        ais_receipt = $3::jsonb,
        ais_receipt_hash = $4,
        ais_accepted_at = $5,
        error_code = NULL,
        error_message = NULL,
        error_occurred_at = NULL,
        updated_at = NOW()
      WHERE record_id = $6
      RETURNING *
    `,
    [
      body.aip.aipId,
      body.aip.recordEndpoint,
      JSON.stringify(body),
      receiptHash,
      body.receivedAt,
      recordId
    ]
  );

  return ensureMigrationSchema(result.rows[0]);
}

async function verifyResolver(recordId) {
  const migration = await getMigration(recordId);

  if (!migration) {
    throw makeError("not-found", "Migration not found", 404);
  }

  assertState(
    migration,
    ["accepted", "resolver-not-confirmed", "resolver-confirmed"],
    "Resolver verification"
  );

  const resolverUrl =
    `${MINICHAT_RESOLVER_ENDPOINT.replace(/\/$/, "")}/` +
    encodeURIComponent(migration.record_did);

  let didDocument;

  try {
    const response = await fetch(resolverUrl);

    if (!response.ok) {
      throw new Error(`Resolver returned HTTP ${response.status}`);
    }

    didDocument = await response.json();
  } catch (error) {
    await pool.query(
      `
        UPDATE eol_migrations
        SET
          state = 'resolver-not-confirmed',
          error_code = 'resolver-not-confirmed',
          error_message = $1,
          error_occurred_at = NOW(),
          updated_at = NOW()
        WHERE record_id = $2
      `,
      [error.message, recordId]
    );

    throw makeError(
      "resolver-not-confirmed",
      `Resolver verification failed: ${error.message}`,
      422
    );
  }

  const expectedEndpoint =
    `${PUBLIC_BASE_URL}/ais/api/records/${encodeURIComponent(recordId)}`;

  if (
    didDocument.id !== migration.record_did ||
    didDocument.recordEndpoint !== expectedEndpoint ||
    didDocument.currentVersion !== migration.current_snapshot_hash
  ) {
    const message =
      "Resolved DID document does not point to the expected AIS Record";

    await pool.query(
      `
        UPDATE eol_migrations
        SET
          state = 'resolver-not-confirmed',
          error_code = 'resolver-not-confirmed',
          error_message = $1,
          error_occurred_at = NOW(),
          updated_at = NOW()
        WHERE record_id = $2
      `,
      [message, recordId]
    );

    throw makeError("resolver-not-confirmed", message, 422, [
      {
        expectedDid: migration.record_did,
        expectedEndpoint,
        expectedCurrentVersion: migration.current_snapshot_hash,
        resolvedDid: didDocument.id,
        resolvedEndpoint: didDocument.recordEndpoint,
        resolvedCurrentVersion: didDocument.currentVersion
      }
    ]);
  }

  let archivedRecord;

  try {
    const response = await fetch(didDocument.recordEndpoint);

    if (!response.ok) {
      throw new Error(`AIS Record endpoint returned HTTP ${response.status}`);
    }

    archivedRecord = await response.json();
  } catch (error) {
    throw makeError(
      "resolver-not-confirmed",
      `AIS Record retrieval failed: ${error.message}`,
      422
    );
  }

  if (
    archivedRecord.did !== migration.record_did ||
    archivedRecord.snapshotHash !== migration.current_snapshot_hash
  ) {
    throw makeError(
      "resolver-not-confirmed",
      "AIS Record does not match the expected DID or final snapshot hash",
      422
    );
  }

  const verifiedAt = new Date().toISOString();

  const result = await pool.query(
    `
      UPDATE eol_migrations
      SET
        state = 'resolver-confirmed',
        resolver_verified_at = $1,
        resolver_record_endpoint = $2,
        resolver_current_snapshot_hash = $3,
        error_code = NULL,
        error_message = NULL,
        error_occurred_at = NULL,
        updated_at = NOW()
      WHERE record_id = $4
      RETURNING *
    `,
    [
      verifiedAt,
      didDocument.recordEndpoint,
      didDocument.currentVersion,
      recordId
    ]
  );

  return ensureMigrationSchema(result.rows[0]);
}

async function deleteSourcePayload(recordId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const migrationResult = await client.query(
      `
        SELECT *
        FROM eol_migrations
        WHERE record_id = $1
        FOR UPDATE
      `,
      [recordId]
    );

    if (migrationResult.rowCount === 0) {
      throw makeError("not-found", "Migration not found", 404);
    }

    const migration = migrationResult.rows[0];

    assertState(
      migration,
      ["resolver-confirmed", "source-deletion-pending"],
      "Source payload deletion"
    );

    await client.query(
      `
        UPDATE eol_migrations
        SET
          state = 'source-deletion-pending',
          updated_at = NOW()
        WHERE record_id = $1
      `,
      [recordId]
    );

    const recordResult = await client.query(
      `
        SELECT *
        FROM sox_records
        WHERE id = $1
        FOR UPDATE
      `,
      [recordId]
    );

    if (recordResult.rowCount === 0) {
      throw makeError("not-found", "SoX Record not found", 404);
    }

    const record = recordResult.rows[0];

    if (!hasPrimaryData(record)) {
      throw makeError(
        "source-payload-missing",
        "SoX Record has no primary payload left to delete",
        409
      );
    }

    const snapshotsResult = await client.query(
      `
        SELECT *
        FROM sox_record_snapshots
        WHERE record_id = $1
        ORDER BY version ASC
        FOR UPDATE
      `,
      [recordId]
    );

    if (snapshotsResult.rowCount === 0) {
      throw makeError(
        "invalid-source-record",
        "SoX Record has no snapshots to clean",
        409
      );
    }

    const deletedAt = new Date().toISOString();

    const retainedPayload = {
      ...record.payload,
      conversation: {
        deleted: true,
        deletionState: "payload-only",
        deletedAt,
        retainedAt: "SoX",
        archivedAt: migration.ais_accepted_at,
        archiveEndpoint: migration.ais_record_endpoint,
        aipId: migration.aip_id
      }
    };

    await client.query(
      `
        UPDATE sox_records
        SET
          payload = $1::jsonb,
          updated_at = $2
        WHERE id = $3
      `,
      [
        JSON.stringify(retainedPayload),
        deletedAt,
        recordId
      ]
    );

    for (const snapshot of snapshotsResult.rows) {
      const retainedSnapshotPayload = {
        deleted: true,
        deletionState: "payload-only",
        deletedAt,
        retainedAt: "SoX",
        archiveEndpoint: migration.ais_record_endpoint,
        aipId: migration.aip_id
      };

      await client.query(
        `
          UPDATE sox_record_snapshots
          SET payload = $1::jsonb
          WHERE snapshot_hash = $2
        `,
        [
          JSON.stringify(retainedSnapshotPayload),
          snapshot.snapshot_hash
        ]
      );
    }

    const deletionRecordDid =
      `did:rwp:${SYSTEM_RECORD_DID_NAMESPACE}:records:${uuidv4()}`;

    const deletionRecordSnapshotHash = canonicalHash({
      deletionRecordDid,
      targetRecordDid: migration.record_did,
      targetSnapshotHash: migration.current_snapshot_hash,
      deletedAt
    });

    const deletionPayload = {
      deletionRegime: "payload-only",
      targetRecord: {
        did: migration.record_did,
        sourceSystem: "SoX",
        recordType: "MiniChat",
        finalizedSnapshotHash: migration.current_snapshot_hash
      },
      archivalHandover: {
        submissionMode: "end-of-life",
        sipPackageHash: migration.sip_package_hash,
        aipId: migration.aip_id,
        aisEndpoint: migration.ais_record_endpoint,
        aisReceiptHash: migration.ais_receipt_hash,
        acceptedAt: migration.ais_accepted_at
      },
      sourceDeletion: {
        deletedAt,
        executor: {
          system: "MiniChat-EOL-App"
        },
        deletedComponents: [
          "sox_records.payload.conversation",
          "sox_record_snapshots.payload",
          "temporary-sip-files"
        ],
        retainedComponents: [
          "record-did",
          "record-title",
          "record-type",
          "record-status",
          "record-version",
          "case-reference",
          "snapshot-hashes",
          "payload-hashes",
          "snapshot-parent-graph"
        ]
      },
      verification: {
        aisRetrievalVerified: true,
        resolverEndpointVerified: true,
        sourcePayloadAbsentAfterDeletion: true
      }
    };

    if (!validateDeletionRecord(deletionPayload)) {
      throw makeError(
        "invalid-deletion-record",
        "Generated DeletionRecord violates deletion-record.schema.json",
        500,
        errorsFor(validateDeletionRecord)
      );
    }

    const updatedMigration = await client.query(
      `
        UPDATE eol_migrations
        SET
          state = 'source-deleted',
          deletion_record_did = $1,
          deletion_record_snapshot_hash = $2,
          deletion_record = $3::jsonb,
          source_deleted_at = $4,
          error_code = NULL,
          error_message = NULL,
          error_occurred_at = NULL,
          updated_at = NOW()
        WHERE record_id = $5
        RETURNING *
      `,
      [
        deletionRecordDid,
        deletionRecordSnapshotHash,
        JSON.stringify(deletionPayload),
        deletedAt,
        recordId
      ]
    );

    await client.query("COMMIT");

    return ensureMigrationSchema(updatedMigration.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");

    await setError(
      recordId,
      error.code || "source-deletion-failed",
      error.message
    );

    throw error;
  } finally {
    client.release();
  }
}

async function submitDeletionRecord(recordId) {
  const migration = await getMigration(recordId);

  if (!migration) {
    throw makeError("not-found", "Migration not found", 404);
  }

  assertState(
    migration,
    [
      "source-deleted",
      "deletion-record-submitted",
      "deletion-protocol-failed"
    ],
    "DeletionRecord submission"
  );

  if (
    !migration.deletion_record_did ||
    !migration.deletion_record_snapshot_hash ||
    !migration.deletion_record
  ) {
    throw makeError(
      "invalid-state",
      "Migration has no generated DeletionRecord",
      409
    );
  }

  const envelope = {
    deletionRecordDid: migration.deletion_record_did,
    deletionRecordSnapshotHash:
      migration.deletion_record_snapshot_hash,
    payload: migration.deletion_record
  };

  let response;
  let body;

  try {
    response = await fetch(`${AIS_API_BASE_URL}/deletion-records`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(envelope)
    });

    body = await response.json().catch(() => ({}));
  } catch (error) {
    await pool.query(
      `
        UPDATE eol_migrations
        SET
          state = 'deletion-protocol-failed',
          error_code = 'ais-unavailable',
          error_message = $1,
          error_occurred_at = NOW(),
          updated_at = NOW()
        WHERE record_id = $2
      `,
      [error.message, recordId]
    );

    throw makeError(
      "ais-unavailable",
      `Unable to submit DeletionRecord to AIS: ${error.message}`,
      502
    );
  }

  if (!response.ok) {
    await pool.query(
      `
        UPDATE eol_migrations
        SET
          state = 'deletion-protocol-failed',
          error_code = 'deletion-protocol-failed',
          error_message = $1,
          error_occurred_at = NOW(),
          updated_at = NOW()
        WHERE record_id = $2
      `,
      [
        body.message || `AIS returned HTTP ${response.status}`,
        recordId
      ]
    );

    throw makeError(
      "deletion-protocol-failed",
      body.message || `AIS returned HTTP ${response.status}`,
      response.status,
      body.details || []
    );
  }

  const acceptedAt = new Date().toISOString();

  const result = await pool.query(
    `
      UPDATE eol_migrations
      SET
        state = 'completed',
        deletion_record_accepted_at = $1,
        error_code = NULL,
        error_message = NULL,
        error_occurred_at = NULL,
        updated_at = NOW()
      WHERE record_id = $2
      RETURNING *
    `,
    [acceptedAt, recordId]
  );

  return ensureMigrationSchema(result.rows[0]);
}

module.exports = {
  AIS_API_BASE_URL,
  PUBLIC_BASE_URL,
  getSoXRecord,
  getSoXSnapshots,
  getMigration,
  getOrCreateMigration,
  mapMigration,
  ensureMigrationSchema,
  createSipForMigration,
  submitSip,
  verifyResolver,
  deleteSourcePayload,
  submitDeletionRecord,
  makeError
};