import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Fragenmanagement API",
      version: "1.0.0",
      description: "RecordWeb PoC — Fragenmanagement der Parlamentsdienste. Records, DID-Resolver, Solid-Pod-Links."
    },
    servers: [
      { url: "https://vps.recordweb.dev/fragenmanagement", description: "Produktion (PoC)" }
    ],
    tags: [
      { name: "Records", description: "Fragestunde-Frage Records" },
      { name: "Solid", description: "Solid-Pod-Links" },
      { name: "DID", description: "DID-Resolver" },
      { name: "Settings", description: "Konfigurierbare Einstellungen (u.a. LDN-Inbox-Zustelladresse)" },
      { name: "Outbox", description: "LDN-Zustellversuche: Status, Retries, Dead Letters" }
    ]
  },
  apis: ["./src/routes/*.js"]
};

export const swaggerSpec = swaggerJsdoc(options);