require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const { initializeDatabase } = require("./db");
const recordsRouter = require("./routes/records");
const didRouter = require("./routes/did");
const swaggerSpec = require("./swagger");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "sox"
  });
});

app.use("/api/records", recordsRouter);
app.use("/did", didRouter);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Internal server error"
  });
});

initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`SoX listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to initialize SoX database", error);
    process.exit(1);
  });