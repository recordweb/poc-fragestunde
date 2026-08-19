const swaggerJsdoc = require("swagger-jsdoc");

const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "SoX API",
    version: "0.1.0",
    description: "API des System of X im RecordWeb-PoC Fragestunde."
  },
  servers: [
    {
      url: "https://vps.recordweb.dev/sox",
      description: "PoC deployment"
    }
  ],
  tags: [
    {
      name: "Records",
      description: "Erzeugung und Abfrage von SoX-RWP-Records"
    }
  ]
};

const swaggerSpec = swaggerJsdoc({
  definition: swaggerDefinition,
  apis: ["./src/routes/*.js"]
});

module.exports = swaggerSpec;