import crypto from "crypto";
import express from "express";

import pool from "../db.js";
import {
  getSchema,
  getSchemaFile,
  RECORD_TYPE_ANTWORT,
  schemaVersionHash
} from "../schemas.js";

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

const RUNNING_PRODUCT_VERSION =
  process.env.ANTWORTMANAGEMENT_VERSION || "0.1.0";

const RESPONSE_SCHEMA_ID = RECORD_TYPE_ANTWORT;

function sha256(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function createSchemaRecord(bindings) {
  const schema = getSchema(RESPONSE_SCHEMA_ID);
  const schemaHash = schemaVersionHash(RESPONSE_SCHEMA_ID);

  return {
    did: RESPONSE_SCHEMA_ID,
    type: "SchemaRecord",
    payload: {
      ...schema,

      conformanceRecords: bindings.map((binding) => ({
        type: "hard",
        recordDid: binding.conformance_record_did,
        snapshotHash: binding.conformance_snapshot_hash,
        resolverEndpoint: binding.conformance_resolver_url,
        boundAt: binding.bound_at,
        boundBy: binding.bound_by
      }))
    },
    metadata: {
      did: RESPONSE_SCHEMA_ID,
      recordType: "did:rwp:b7d4c810:schema:schema-record",
      schemaVersion: schemaHash,
      state: "finalized",
      created: null,
      finalized: null,
      owner: "did:rwp:b7d4c810:antwortmanagement",
      parents: [],
      payloadHash: sha256(JSON.stringify(schema)),
      payloadFormat: "application/json",
      schemaFile: getSchemaFile(RESPONSE_SCHEMA_ID),
      schemaHash
    }
  };
}

function normalizeResolverEndpoint(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

async function resolveBarConformanceRecord(
  conformanceRecordDid,
  resolverEndpoint
) {
  const didUrl =
    `${resolverEndpoint}/${encodeURIComponent(conformanceRecordDid)}`;

  const didResponse = await fetch(didUrl, {
    headers: {
      accept: "application/json"
    }
  });

  if (!didResponse.ok) {
    throw new Error(
      `BAR-Resolver konnte DID nicht auflösen (HTTP ${didResponse.status}).`
    );
  }

  const didDocument = await didResponse.json();

  if (didDocument.id !== conformanceRecordDid) {
    throw new Error(
      "DID-Dokument stimmt nicht mit der eingegebenen Conformance-DID überein."
    );
  }

  if (!didDocument.recordEndpoint) {
    throw new Error(
      "DID-Dokument enthält keinen recordEndpoint."
    );
  }

  const recordResponse = await fetch(didDocument.recordEndpoint, {
    headers: {
      accept: "application/json"
    }
  });

  if (!recordResponse.ok) {
    throw new Error(
      `BAR-ConformanceRecord konnte nicht geladen werden (HTTP ${recordResponse.status}).`
    );
  }

  const record = await recordResponse.json();

  return {
    didDocument,
    record
  };
}

function validateConformanceRecord(
  record,
  conformanceRecordDid,
  conformanceSnapshotHash
) {
  const errors = [];

  if (record.did !== conformanceRecordDid) {
    errors.push(
      "Der geladene Record stimmt nicht mit der eingegebenen Conformance-DID überein."
    );
  }

  if (record.type !== "ConformanceRecord") {
    errors.push("Der geladene Record ist kein ConformanceRecord.");
  }

  if (record.metadata?.state !== "finalized") {
    errors.push("Der ConformanceRecord ist nicht finalisiert.");
  }

  if (
    record.metadata?.snapshotHash !== conformanceSnapshotHash
  ) {
    errors.push(
      "Der Snapshot-Hash stimmt nicht mit dem eingegebenen Hash überein."
    );
  }

  if (
    record.payload?.subject?.implementationDid !==
    "did:rwp:b7d4c810:antwortmanagement"
  ) {
    errors.push(
      "Der ConformanceRecord attestiert nicht die Implementation Antwortmanagement."
    );
  }

  if (
    record.payload?.subject?.productVersion !==
    RUNNING_PRODUCT_VERSION
  ) {
    errors.push(
      `Die attestierte Produktversion entspricht nicht der laufenden Version ${RUNNING_PRODUCT_VERSION}.`
    );
  }

  const claims = Array.isArray(record.payload?.claims)
    ? record.payload.claims
    : [];

  const profilePresent = claims.some((claim) =>
    Array.isArray(claim.profiles) &&
    claim.profiles.includes("RWP Information Record Conformant")
  );

  const producerPresent = claims.some((claim) =>
    Array.isArray(claim.roles) &&
    claim.roles.includes("producer")
  );

  const custodianPresent = claims.some((claim) =>
    Array.isArray(claim.roles) &&
    claim.roles.includes("custodian")
  );

  if (!profilePresent) {
    errors.push(
      "Der Claim RWP Information Record Conformant fehlt."
    );
  }

  if (!producerPresent) {
    errors.push("Die attestierte Rolle producer fehlt.");
  }

  if (!custodianPresent) {
    errors.push("Die attestierte Rolle custodian fehlt.");
  }

  if (record.payload?.expiresAt) {
    const expiry = new Date(record.payload.expiresAt);

    if (Number.isNaN(expiry.getTime())) {
      errors.push("expiresAt im ConformanceRecord ist ungültig.");
    } else if (expiry.getTime() < Date.now()) {
      errors.push(
        `Der ConformanceRecord ist seit ${record.payload.expiresAt} abgelaufen.`
      );
    }
  }

  return errors;
}

async function getActiveBindings() {
  const schemaHash = schemaVersionHash(RESPONSE_SCHEMA_ID);

  const { rows } = await pool.query(
    `
    SELECT *
    FROM schema_conformance_bindings
    WHERE schema_id = $1
      AND schema_hash = $2
      AND status = 'active'
    ORDER BY bound_at DESC
    `,
    [RESPONSE_SCHEMA_ID, schemaHash]
  );

  return rows;
}

router.get("/fragestunde-antwort", async (_req, res, next) => {
  try {
    const bindings = await getActiveBindings();

    return res.json(
      createSchemaRecord(bindings)
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/fragestunde-antwort/admin", async (_req, res, next) => {
  try {
    const bindings = await getActiveBindings();

    return res.json({
      schema: getSchema(RESPONSE_SCHEMA_ID),
      schemaId: RESPONSE_SCHEMA_ID,
      schemaFile: getSchemaFile(RESPONSE_SCHEMA_ID),
      schemaHash: schemaVersionHash(RESPONSE_SCHEMA_ID),
      bindings,
      schemaRecord: createSchemaRecord(bindings)
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/fragestunde-antwort/conformance-bindings",
  async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT *
        FROM schema_conformance_bindings
        WHERE schema_id = $1
        ORDER BY bound_at DESC
        `,
        [RESPONSE_SCHEMA_ID]
      );

      return res.json({
        schemaId: RESPONSE_SCHEMA_ID,
        schemaHash: schemaVersionHash(RESPONSE_SCHEMA_ID),
        bindings: rows
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/fragestunde-antwort/conformance-bindings/validate",
  async (req, res, next) => {
    try {
      const conformanceRecordDid = String(
        req.body?.conformanceRecordDid || ""
      ).trim();

      const conformanceSnapshotHash = String(
        req.body?.conformanceSnapshotHash || ""
      ).trim();

      const resolverEndpoint = normalizeResolverEndpoint(
        req.body?.resolverEndpoint
      );

      if (!conformanceRecordDid.startsWith("did:rwp:")) {
        return res.status(400).json({
          error: "invalid_conformance_record_did",
          message: "conformanceRecordDid muss eine RWP-DID sein."
        });
      }

      if (!conformanceSnapshotHash.startsWith("sha256:")) {
        return res.status(400).json({
          error: "invalid_conformance_snapshot_hash",
          message: "conformanceSnapshotHash muss mit sha256: beginnen."
        });
      }

      if (!resolverEndpoint.startsWith("http://") &&
          !resolverEndpoint.startsWith("https://")) {
        return res.status(400).json({
          error: "invalid_resolver_endpoint",
          message: "resolverEndpoint muss mit http:// oder https:// beginnen."
        });
      }

      const { didDocument, record } =
        await resolveBarConformanceRecord(
          conformanceRecordDid,
          resolverEndpoint
        );

      const errors = validateConformanceRecord(
        record,
        conformanceRecordDid,
        conformanceSnapshotHash
      );

      return res.json({
        valid: errors.length === 0,
        errors,
        didDocument,
        conformanceRecord: record
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/fragestunde-antwort/conformance-bindings",
  async (req, res, next) => {
    try {
      const conformanceRecordDid = String(
        req.body?.conformanceRecordDid || ""
      ).trim();

      const conformanceSnapshotHash = String(
        req.body?.conformanceSnapshotHash || ""
      ).trim();

      const resolverEndpoint = normalizeResolverEndpoint(
        req.body?.resolverEndpoint
      );

      const boundBy = String(
        req.body?.boundBy || "did:rwp:b7d4c810:antwortmanagement-admin"
      ).trim();

      if (!conformanceRecordDid.startsWith("did:rwp:")) {
        return res.status(400).json({
          error: "invalid_conformance_record_did"
        });
      }

      if (!conformanceSnapshotHash.startsWith("sha256:")) {
        return res.status(400).json({
          error: "invalid_conformance_snapshot_hash"
        });
      }

      if (!resolverEndpoint.startsWith("http://") &&
          !resolverEndpoint.startsWith("https://")) {
        return res.status(400).json({
          error: "invalid_resolver_endpoint"
        });
      }

      const { record } = await resolveBarConformanceRecord(
        conformanceRecordDid,
        resolverEndpoint
      );

      const errors = validateConformanceRecord(
        record,
        conformanceRecordDid,
        conformanceSnapshotHash
      );

      if (errors.length > 0) {
        return res.status(422).json({
          error: "conformance_record_not_acceptable",
          errors
        });
      }

      const schemaHash = schemaVersionHash(RESPONSE_SCHEMA_ID);

      const { rows } = await pool.query(
        `
        INSERT INTO schema_conformance_bindings (
          schema_id,
          schema_file,
          schema_hash,
          conformance_record_did,
          conformance_snapshot_hash,
          conformance_resolver_url,
          bound_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (
          schema_id,
          schema_hash,
          conformance_record_did,
          conformance_snapshot_hash
        )
        DO UPDATE SET
          status = 'active',
          conformance_resolver_url = EXCLUDED.conformance_resolver_url,
          bound_by = EXCLUDED.bound_by
        RETURNING *
        `,
        [
          RESPONSE_SCHEMA_ID,
          getSchemaFile(RESPONSE_SCHEMA_ID),
          schemaHash,
          conformanceRecordDid,
          conformanceSnapshotHash,
          resolverEndpoint,
          boundBy
        ]
      );

      return res.status(201).json({
        binding: rows[0],
        schemaRecord: createSchemaRecord(await getActiveBindings())
      });
    } catch (error) {
      return next(error);
    }
  }
);

export {
  createSchemaRecord,
  getActiveBindings
};

export default router;