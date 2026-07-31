import express from "express";
import cors from "cors";
import pool from "./db.js";
import { initSchema } from "./db.js";
import recordsRouter from "./routes/records.js";
import didRouter from "./routes/did.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/antwortmanagement/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// W3C Linked Data Notifications (LDN) — Inbox-Discovery per Link-Header.
// Normativer Discovery-Mechanismus: rel="http://www.w3.org/ns/ldp#inbox"
// zeigt auf den POST-Endpunkt, über den Notifications entgegengenommen werden.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";
const INBOX_URL = `${PUBLIC_BASE_URL}/antwortmanagement/api/inbox`;

app.get("/health", (req, res) => {
  res.set("Link", `<${INBOX_URL}>; rel="http://www.w3.org/ns/ldp#inbox"`);
  res.json({ status: "ok" });
});

app.get("/antwortmanagement/api/logs", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM server_logs ORDER BY created DESC LIMIT 100");
  res.json(rows);
});

app.use("/antwortmanagement/api/records", recordsRouter);

app.use("/antwortmanagement/did", didRouter);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => app.listen(PORT, () => console.log(`API listening on ${PORT}`)))
  .catch(err => {
    console.error("Schema init failed", err);
    process.exit(1);
  });
