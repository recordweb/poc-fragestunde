import express from "express";
import cors from "cors";
import { initSchema } from "./db.js";
import recordsRouter from "./routes/records.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/records", recordsRouter);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => app.listen(PORT, () => console.log(`API listening on ${PORT}`)))
  .catch(err => {
    console.error("Schema init failed", err);
    process.exit(1);
  });