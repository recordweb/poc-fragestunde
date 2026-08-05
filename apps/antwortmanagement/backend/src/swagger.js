import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Antwortmanagement API",
      version: "1.0.0",
      description: "RecordWeb PoC — Antwortmanagement der Bundeskanzlei. Antwort-Records und DID-Resolver."
    },
    servers: [
      { url: "https://vps.recordweb.dev/antwortmanagement", description: "Produktion (PoC)" }
    ],
    tags: [
      { name: "Records", description: "Fragestunde-Antwort Records" },
      { name: "Cases", description: "Fragestunde-Case Records (RWP CaseRecord, Kapitel 8) — verlinken Frage und Antwort" },
      { name: "DID", description: "DID-Resolver" },
      { name: "LDN", description: "W3C Linked Data Notifications Inbox" }
    ]
  },
  apis: ["./src/routes/*.js"]
};

export const swaggerSpec = swaggerJsdoc(options);
