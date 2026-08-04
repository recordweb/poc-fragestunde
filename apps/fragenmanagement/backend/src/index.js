import express from "express";
import cors from "cors";
import pool from "./db.js";
import { initSchema } from "./db.js";
import recordsRouter from "./routes/records.js";
import didRouter from "./routes/did.js";
import settingsRouter from "./routes/settings.js";
import outboxRouter from "./routes/outbox.js";
import { startOutboxWorker } from "./outbox.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/fragenmanagement/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/fragenmanagement/api/notifications", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM ldn_notifications ORDER BY published DESC");
  res.json(rows);
});

app.get("/fragenmanagement/api/logs", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM server_logs ORDER BY created DESC LIMIT 100");
  res.json(rows);
});

app.use("/fragenmanagement/api/records", recordsRouter);
app.use("/fragenmanagement/api/settings", settingsRouter);
app.use("/fragenmanagement/api/outbox", outboxRouter);

app.use("/fragenmanagement/did", didRouter);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
    // Etappe 4: prüft periodisch fällige Retries fehlgeschlagener LDN-Zustellungen.
    startOutboxWorker();
  })
  .catch(err => {
    console.error("Schema init failed", err);
    process.exit(1);
  });