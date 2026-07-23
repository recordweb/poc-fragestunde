import express from "express";
import cors from "cors";
import pool from "./db.js";
import { initSchema } from "./db.js";
import recordsRouter from "./routes/records.js";
import didRouter from "./routes/did.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/notifications", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM ldn_notifications ORDER BY published DESC");
  res.json(rows);
});

app.get("/logs", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM server_logs ORDER BY created DESC LIMIT 100");
  res.json(rows);
});

app.use("/fragenmanagement/records", recordsRouter);

app.use("/fragenmanagement/did", didRouter);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => app.listen(PORT, () => console.log(`API listening on ${PORT}`)))
  .catch(err => {
    console.error("Schema init failed", err);
    process.exit(1);
  });