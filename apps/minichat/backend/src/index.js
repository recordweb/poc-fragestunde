require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { pool, initializeDatabase } = require("./db");

const app = express();
const port = Number(process.env.PORT || 3000);

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";
const SYSTEM_ENDPOINT =
  process.env.MINICHAT_SYSTEM_ENDPOINT || `${PUBLIC_BASE_URL}/minichat/`;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function mapConversation(row) {
  return {
    conversationId: row.conversation_id,
    recordDid: row.sox_record_did,
    submissionEndpoint: row.sox_submission_endpoint,
    title: row.title,
    caseReference: row.case_reference,
    messages: row.messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSubmittedAt: row.last_submitted_at,
    system: {
      type: "MiniChat",
      endpoint: SYSTEM_ENDPOINT
    }
  };
}

function createConversationId() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  return Array.from(
    { length: 3 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

async function createUniqueConversationId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const conversationId = createConversationId();

    const result = await pool.query(
      `
      SELECT 1
      FROM minichat_conversations
      WHERE conversation_id = $1
      `,
      [conversationId]
    );

    if (result.rowCount === 0) {
      return conversationId;
    }
  }

  throw new Error("Could not allocate a unique MiniChat conversation ID");
}

function buildSubmission(conversation) {
  return {
    messageType: "rwp.record-submission",
    messageVersion: "1.0",
    recordDid: conversation.recordDid,
    submittedAt: new Date().toISOString(),
    payloadFormat: "application/json",
    payload: {
      conversationId: conversation.conversationId,
      title: conversation.title,
      system: conversation.system,
      participants: [],
      messages: conversation.messages
    }
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "minichat"
  });
});

app.post("/api/work-orders", async (req, res, next) => {
  try {
    const workOrder = req.body || {};

    if (
      workOrder.messageType !== "rwp.record-work-order" ||
      workOrder.messageVersion !== "1.0" ||
      workOrder.operation !== "create"
    ) {
      return res.status(400).json({
        error: "Unsupported RecordWorkOrder"
      });
    }

    const recordDid = workOrder.record?.did;
    const title = workOrder.record?.title;
    const submissionEndpoint = workOrder.submission?.endpoint;
    const caseReference = workOrder.caseReference;

    if (
      typeof recordDid !== "string" ||
      typeof title !== "string" ||
      typeof submissionEndpoint !== "string" ||
      !caseReference ||
      typeof caseReference.caseId !== "string"
    ) {
      return res.status(400).json({
        error: "RecordWorkOrder is incomplete"
      });
    }

    const existing = await pool.query(
      `
      SELECT *
      FROM minichat_conversations
      WHERE sox_record_did = $1
      `,
      [recordDid]
    );

    if (existing.rowCount > 0) {
      const conversation = mapConversation(existing.rows[0]);

      return res.status(200).json({
        accepted: true,
        alreadyExists: true,
        conversationId: conversation.conversationId,
        systemEndpoint: SYSTEM_ENDPOINT
      });
    }

    const conversationId = await createUniqueConversationId();

    const result = await pool.query(
      `
      INSERT INTO minichat_conversations (
        conversation_id,
        sox_record_did,
        sox_submission_endpoint,
        title,
        case_reference
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING *
      `,
      [
        conversationId,
        recordDid,
        submissionEndpoint,
        title,
        JSON.stringify(caseReference)
      ]
    );

    const conversation = mapConversation(result.rows[0]);

    return res.status(201).json({
      accepted: true,
      conversationId: conversation.conversationId,
      systemEndpoint: SYSTEM_ENDPOINT
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/conversations", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM minichat_conversations
      ORDER BY updated_at DESC
    `);

    return res.json(result.rows.map(mapConversation));
  } catch (error) {
    next(error);
  }
});

app.get("/api/conversations/:conversationId", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM minichat_conversations
      WHERE conversation_id = $1
      `,
      [req.params.conversationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Conversation not found"
      });
    }

    return res.json(mapConversation(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/conversations/:conversationId/messages",
  async (req, res, next) => {
    try {
      const { authorName, text } = req.body || {};

      if (
        typeof authorName !== "string" ||
        authorName.trim().length === 0 ||
        typeof text !== "string" ||
        text.trim().length === 0
      ) {
        return res.status(400).json({
          error: "authorName and text are required"
        });
      }

      const current = await pool.query(
        `
        SELECT *
        FROM minichat_conversations
        WHERE conversation_id = $1
        `,
        [req.params.conversationId]
      );

      if (current.rowCount === 0) {
        return res.status(404).json({
          error: "Conversation not found"
        });
      }

      const conversation = mapConversation(current.rows[0]);
      const message = {
        id: `${conversation.conversationId}-${String(
          conversation.messages.length + 1
        ).padStart(3, "0")}`,
        createdAt: new Date().toISOString(),
        author: {
          id: `manual:${authorName.trim().toLowerCase().replace(/\s+/g, "-")}`,
          displayName: authorName.trim()
        },
        content: {
          format: "text/plain; charset=utf-8",
          text: text.trim()
        }
      };

      const messages = [...conversation.messages, message];

      const updated = await pool.query(
        `
        UPDATE minichat_conversations
        SET messages = $1::jsonb, updated_at = NOW()
        WHERE conversation_id = $2
        RETURNING *
        `,
        [JSON.stringify(messages), conversation.conversationId]
      );

      return res.status(201).json(mapConversation(updated.rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/conversations/:conversationId/finalize",
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `
        SELECT *
        FROM minichat_conversations
        WHERE conversation_id = $1
        `,
        [req.params.conversationId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Conversation not found"
        });
      }

      const conversation = mapConversation(result.rows[0]);

      const submissionResponse = await fetch(
        conversation.submissionEndpoint,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(buildSubmission(conversation))
        }
      );

      const submissionBody = await submissionResponse
        .json()
        .catch(() => ({}));

      if (!submissionResponse.ok) {
        return res.status(502).json({
          error:
            submissionBody.error ||
            "SoX rejected the RecordSubmission"
        });
      }

      const updated = await pool.query(
        `
        UPDATE minichat_conversations
        SET last_submitted_at = NOW(), updated_at = NOW()
        WHERE conversation_id = $1
        RETURNING *
        `,
        [conversation.conversationId]
      );

      return res.json({
        conversation: mapConversation(updated.rows[0]),
        submission: submissionBody
      });
    } catch (error) {
      next(error);
    }
  }
);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Internal server error"
  });
});

initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`MiniChat listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to initialize MiniChat database", error);
    process.exit(1);
  });