const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const { createDraftRecord } = require("../recordCore");

const router = express.Router();

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

const supportedRecordTypes = new Set([
  "MiniChat",
  "TeamsChat"
]);

function mapRecord(row) {
  return {
    id: row.id,
    did: row.did,
    recordType: row.record_type,
    status: row.status,
    version: row.version,
    title: row.title,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSnapshot(row) {
  return {
    did: row.did,
    snapshotHash: row.snapshot_hash,
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

async function getChatEndpoint(recordType) {
  const settingKey =
    recordType === "MiniChat"
      ? "miniChatEndpoint"
      : "teamsChatEndpoint";

  const result = await pool.query(
    `
    SELECT setting_value
    FROM sox_settings
    WHERE setting_key = $1
    `,
    [settingKey]
  );

  return result.rows[0]?.setting_value || "";
}

function buildWorkOrder(record) {
  return {
    messageType: "rwp.record-work-order",
    messageVersion: "1.0",
    operation: "create",
    issuedAt: new Date().toISOString(),
    record: {
      did: record.did,
      recordType: record.recordType,
      title: record.title
    },
    caseReference: record.payload.caseReference,
    submission: {
      endpoint:
        `${PUBLIC_BASE_URL}/sox/api/records/${encodeURIComponent(
          record.id
        )}/submissions`,
      method: "PUT",
      contentType: "application/json"
    }
  };
}

async function tryDeliverWorkOrder(record) {
  const chatEndpoint = record.payload.source?.chatEndpoint;

  if (!chatEndpoint) {
    return {
      status: "failed",
      error: "No chat endpoint configured",
      conversationId: null,
      deliveredAt: null
    };
  }

  try {
    const response = await fetch(`${chatEndpoint.replace(/\/$/, "")}/work-orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildWorkOrder(record))
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.accepted || !body.conversationId) {
      return {
        status: "failed",
        error: body.error || `HTTP ${response.status}`,
        conversationId: null,
        deliveredAt: null
      };
    }

    return {
      status: "delivered",
      error: null,
      conversationId: body.conversationId,
      deliveredAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      conversationId: null,
      deliveredAt: null
    };
  }
}

async function updateWorkOrderStatus(recordId, delivery) {
  const result = await pool.query(
    `
    UPDATE sox_records
    SET
      payload = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              payload,
              '{source,workOrderStatus}',
              to_jsonb($1::text),
              true
            ),
            '{source,workOrderError}',
            to_jsonb($2::text),
            true
          ),
          '{source,conversationId}',
          to_jsonb($3::text),
          true
        ),
        '{source,workOrderDeliveredAt}',
        to_jsonb($4::text),
        true
      ),
      updated_at = NOW()
    WHERE id = $5
    RETURNING *
    `,
    [
      delivery.status,
      delivery.error,
      delivery.conversationId,
      delivery.deliveredAt,
      recordId
    ]
  );

  return mapRecord(result.rows[0]);
}

function isValidSubmission(body, record) {
  return (
    body &&
    body.messageType === "rwp.record-submission" &&
    body.messageVersion === "1.0" &&
    body.recordDid === record.did &&
    body.payloadFormat === "application/json" &&
    body.payload &&
    typeof body.payload === "object" &&
    Array.isArray(body.payload.messages)
  );
}

function validateConversationPayload(payload, recordType) {
  if (
    typeof payload.conversationId !== "string" ||
    payload.conversationId.length === 0
  ) {
    return "payload.conversationId is required";
  }

  if (
    !payload.system ||
    payload.system.type !== recordType ||
    typeof payload.system.endpoint !== "string"
  ) {
    return "payload.system must identify the submitting system";
  }

  for (const message of payload.messages) {
    if (
      !message ||
      typeof message.id !== "string" ||
      typeof message.createdAt !== "string" ||
      typeof message.author?.displayName !== "string" ||
      typeof message.content?.text !== "string" ||
      message.content.format !== "text/plain; charset=utf-8"
    ) {
      return "Every message must contain id, createdAt, author and plain-text content";
    }
  }

  return null;
}

router.post("/", async (req, res, next) => {
  try {
    const { recordType, title, caseReference } = req.body || {};

    if (!supportedRecordTypes.has(recordType)) {
      return res.status(400).json({
        error: "recordType must be MiniChat or TeamsChat"
      });
    }

    if (typeof title !== "string" || title.trim().length === 0) {
      return res.status(400).json({
        error: "title is required"
      });
    }

    if (
      !caseReference ||
      typeof caseReference.system !== "string" ||
      typeof caseReference.caseId !== "string"
    ) {
      return res.status(400).json({
        error: "caseReference.system and caseReference.caseId are required"
      });
    }

    const chatEndpoint = await getChatEndpoint(recordType);

    if (!chatEndpoint) {
      return res.status(409).json({
        error: `Für ${recordType} ist in SoX noch kein Chat-Endpunkt konfiguriert`
      });
    }

    const draft = createDraftRecord({
      recordType,
      title: title.trim(),
      caseReference,
      chatEndpoint
    });

    const insertResult = await pool.query(
      `
      INSERT INTO sox_records (
        id,
        did,
        record_type,
        status,
        version,
        title,
        payload,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      RETURNING *
      `,
      [
        draft.id,
        draft.did,
        draft.recordType,
        draft.status,
        draft.version,
        draft.title,
        JSON.stringify(draft.payload),
        draft.createdAt,
        draft.updatedAt
      ]
    );

    const createdRecord = mapRecord(insertResult.rows[0]);

    res
      .status(201)
      .location(`/sox/api/records/${createdRecord.id}`)
      .json(createdRecord);

    const delivery = await tryDeliverWorkOrder(createdRecord);
    await updateWorkOrderStatus(createdRecord.id, delivery);
  } catch (error) {
    next(error);
  }
});

router.put("/:id/submissions", async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const recordResult = await client.query(
      `
      SELECT *
      FROM sox_records
      WHERE id = $1
      FOR UPDATE
      `,
      [req.params.id]
    );

    if (recordResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Record not found"
      });
    }

    const record = mapRecord(recordResult.rows[0]);

    if (!isValidSubmission(req.body, record)) {
      await client.query("ROLLBACK");
      return res.status(422).json({
        error: "Invalid RecordSubmission"
      });
    }

    const payloadError = validateConversationPayload(
      req.body.payload,
      record.recordType
    );

    if (payloadError) {
      await client.query("ROLLBACK");
      return res.status(422).json({
        error: payloadError
      });
    }

    const submittedConversationId = req.body.payload.conversationId;
    const knownConversationId = record.payload.source?.conversationId;

    if (
      knownConversationId &&
      knownConversationId !== submittedConversationId
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "RecordSubmission conversationId does not match the WorkOrder"
      });
    }

    const previousSnapshot = await client.query(
      `
      SELECT snapshot_hash
      FROM sox_record_snapshots
      WHERE record_id = $1
      ORDER BY version DESC
      LIMIT 1
      `,
      [record.id]
    );

    const nextVersion = record.version + 1;
    const parents =
      previousSnapshot.rowCount > 0
        ? [previousSnapshot.rows[0].snapshot_hash]
        : [];

    const finalizedAt = new Date().toISOString();
    const payload = req.body.payload;
    const payloadHash = sha256(canonicalJson(payload));

    const snapshotMetadata = {
      did: record.did,
      recordType: record.recordType,
      state: "finalized",
      version: nextVersion,
      parents,
      payloadHash,
      payloadFormat: req.body.payloadFormat,
      createdAt: finalizedAt,
      finalizedAt
    };

    const snapshotHash = sha256(
      `${canonicalJson(snapshotMetadata)}${canonicalJson(payload)}`
    );

    await client.query(
      `
      INSERT INTO sox_record_snapshots (
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
        $1, $2, $3, $4, 'finalized', $5::jsonb, $6::jsonb, $7, $8, $9, $10
      )
      `,
      [
        snapshotHash,
        record.id,
        record.did,
        nextVersion,
        JSON.stringify(parents),
        JSON.stringify(payload),
        payloadHash,
        req.body.payloadFormat,
        finalizedAt,
        finalizedAt
      ]
    );

    const updatedPayload = {
      ...record.payload,
      source: {
        ...record.payload.source,
        conversationId: submittedConversationId,
        workOrderStatus: "delivered",
        workOrderError: null
      },
      conversation: payload
    };

    const updatedRecord = await client.query(
      `
      UPDATE sox_records
      SET
        status = 'finalized',
        version = $1,
        payload = $2::jsonb,
        updated_at = $3
      WHERE id = $4
      RETURNING *
      `,
      [
        nextVersion,
        JSON.stringify(updatedPayload),
        finalizedAt,
        record.id
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      ...mapRecord(updatedRecord.rows[0]),
      snapshotHash,
      payloadHash,
      parents,
      finalizedAt
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM sox_records
      ORDER BY created_at DESC
    `);

    return res.json(result.rows.map(mapRecord));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/history", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM sox_record_snapshots
      WHERE record_id = $1
      ORDER BY version ASC
      `,
      [req.params.id]
    );

    return res.json(result.rows.map(mapSnapshot));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM sox_records
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Record not found"
      });
    }

    return res.json(mapRecord(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

module.exports = router;