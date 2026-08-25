require("dotenv").config();

const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const { initializeDatabase } = require("./db");
const swaggerSpec = require("./swagger");
const migrationsRouter = require("./routes/migrations");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "minichat-eol"
  });
});

app.use("/api", migrationsRouter);
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
      console.log(`MiniChat EOL app listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to initialize MiniChat EOL database", error);
    process.exit(1);
  });