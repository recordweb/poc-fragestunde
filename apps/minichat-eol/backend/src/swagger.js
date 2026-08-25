const swaggerJsdoc = require("swagger-jsdoc");

const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "MiniChat EOL API",
    version: "0.1.0",
    description:
      "API der MiniChat-End-of-Life-Migrations-App im RecordWeb-PoC Fragestunde."
  },
  servers: [
    {
      url: "https://vps.recordweb.dev/minichat-eol",
      description: "PoC deployment"
    }
  ],
  tags: [
    {
      name: "Candidates",
      description: "Archivierungsfähige MiniChat-Records im SoX"
    },
    {
      name: "Migrations",
      description: "Kontrollierte EOL-Migrationen nach AIS"
    }
  ],
  components: {
    schemas: {
      ApiError: {
        type: "object",
        required: ["error", "message"],
        properties: {
          error: {
            type: "string",
            example: "invalid-state"
          },
          message: {
            type: "string",
            example: "Migration must be accepted before resolver verification"
          },
          details: {
            type: "array",
            items: {
              type: "object"
            }
          }
        }
      },
      Migration: {
        type: "object",
        properties: {
          migrationId: {
            type: "string",
            example: "8fe6f638-5975-426f-8a31-f7e8027d9d4e"
          },
          recordId: {
            type: "string"
          },
          recordDid: {
            type: "string"
          },
          currentSnapshotHash: {
            type: "string",
            example: "sha256:..."
          },
          state: {
            type: "string",
            example: "accepted"
          },
          sip: {
            type: "object",
            nullable: true
          },
          ais: {
            type: "object",
            nullable: true
          },
          resolverVerification: {
            type: "object",
            nullable: true
          },
          deletion: {
            type: "object",
            nullable: true
          },
          error: {
            type: "object",
            nullable: true
          },
          createdAt: {
            type: "string",
            format: "date-time"
          },
          updatedAt: {
            type: "string",
            format: "date-time"
          }
        }
      },
      Candidate: {
        type: "object",
        properties: {
          id: {
            type: "string"
          },
          did: {
            type: "string"
          },
          title: {
            type: "string"
          },
          version: {
            type: "integer"
          },
          snapshotHash: {
            type: "string"
          },
          caseReference: {
            type: "object"
          },
          messageCount: {
            type: "integer"
          },
          createdAt: {
            type: "string",
            format: "date-time"
          },
          finalizedAt: {
            type: "string",
            format: "date-time"
          },
          migration: {
            nullable: true,
            allOf: [
              {
                $ref: "#/components/schemas/Migration"
              }
            ]
          }
        }
      }
    }
  }
};

const swaggerSpec = swaggerJsdoc({
  definition: swaggerDefinition,
  apis: ["./src/routes/*.js"]
});

module.exports = swaggerSpec;