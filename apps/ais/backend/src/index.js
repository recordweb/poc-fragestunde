require("dotenv").config();

const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const { initializeDatabase } = require("./db");
const swaggerSpec = require("./swagger");
const sipsRouter = require("./routes/sips");
const aipsRouter = require("./routes/aips");
const recordsRouter = require("./routes/records");
const deletionRecordsRouter = require("./routes/deletionRecords");
const didRouter = require("./routes/did");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "ais"
  });
});

app.use("/api/sips", sipsRouter);
app.use("/api/aips", aipsRouter);
app.use("/api/records", recordsRouter);
app.use("/api/deletion-records", deletionRecordsRouter);
app.use("/did", didRouter);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use((error, _req, res, _next) => {
  console.error(error);

  res.status(500).json({
    error: "internal-error",
    message: "Internal server error",
    details: []
  });
});

initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`AIS listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to initialize AIS database", error);
    process.exit(1);
  });