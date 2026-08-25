const swaggerJsdoc = require("swagger-jsdoc");

const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "AIS API",
    version: "0.1.0",
    description:
      "API des ArchivInformationsSystems im RecordWeb-PoC Fragestunde."
  },
  servers: [
    {
      url: "https://vps.recordweb.dev/ais",
      description: "PoC deployment"
    }
  ],
  tags: [
    {
      name: "SIPs",
      description: "Übernahme und Validierung von MiniChat-SIPs"
    },
    {
      name: "AIPs",
      description: "Archivische Aufbewahrungseinheiten"
    },
    {
      name: "Records",
      description: "Read-only Zugriff auf archivierte MiniChat-Records"
    },
    {
      name: "DeletionRecords",
      description: "Löschprotokolle für die lokale SoX-Payload-Löschung"
    },
    {
      name: "DID",
      description: "DID-Dokumente für im AIS verfügbare MiniChat-Records"
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
            example: "invalid-sip"
          },
          message: {
            type: "string",
            example: "SIP validation failed"
          },
          details: {
            type: "array",
            items: {
              type: "object"
            }
          }
        }
      },
      AisSubmissionReceipt: {
        type: "object",
        required: [
          "receiptType",
          "receiptVersion",
          "receivedAt",
          "aip",
          "validation",
          "sourceDeletion"
        ],
        properties: {
          receiptType: {
            type: "string",
            example: "RWP-AIS-Submission-Receipt"
          },
          receiptVersion: {
            type: "string",
            example: "0.1"
          },
          receivedAt: {
            type: "string",
            format: "date-time"
          },
          aip: {
            type: "object",
            properties: {
              aipId: {
                type: "string",
                example: "aip:8fe6f638-5975-426f-8a31-f7e8027d9d4e"
              },
              recordDid: {
                type: "string",
                example:
                  "did:rwp:s73f42a3:records:8fe6f638-5975-426f-8a31-f7e8027d9d4e"
              },
              recordEndpoint: {
                type: "string",
                format: "uri"
              },
              currentSnapshotHash: {
                type: "string",
                example: "sha256:..."
              },
              sipPackageHash: {
                type: "string",
                example: "sha256:..."
              }
            }
          },
          validation: {
            type: "object",
            additionalProperties: {
              type: "boolean"
            }
          },
          sourceDeletion: {
            type: "object",
            properties: {
              permitted: {
                type: "boolean"
              },
              requiresResolverVerification: {
                type: "boolean"
              }
            }
          },
          idempotent: {
            type: "boolean"
          }
        }
      },
      Snapshot: {
        type: "object",
        properties: {
          snapshotHash: {
            type: "string"
          },
          did: {
            type: "string"
          },
          version: {
            type: "integer"
          },
          state: {
            type: "string",
            example: "finalized"
          },
          parents: {
            type: "array",
            items: {
              type: "string"
            }
          },
          payload: {
            type: "object"
          },
          payloadHash: {
            type: "string"
          },
          payloadFormat: {
            type: "string",
            example: "application/json"
          },
          createdAt: {
            type: "string",
            format: "date-time"
          },
          finalizedAt: {
            type: "string",
            format: "date-time"
          }
        }
      },
      ArchivedRecord: {
        type: "object",
        properties: {
          id: {
            type: "string"
          },
          did: {
            type: "string"
          },
          recordType: {
            type: "string",
            example: "MiniChat"
          },
          status: {
            type: "string",
            example: "finalized"
          },
          version: {
            type: "integer"
          },
          title: {
            type: "string"
          },
          payload: {
            type: "object"
          },
          snapshotHash: {
            type: "string"
          },
          createdAt: {
            type: "string",
            format: "date-time"
          },
          updatedAt: {
            type: "string",
            format: "date-time"
          },
          aip: {
            type: "object"
          }
        }
      },
      Aip: {
        type: "object",
        properties: {
          aipId: {
            type: "string"
          },
          recordDid: {
            type: "string"
          },
          recordId: {
            type: "string"
          },
          acceptedAt: {
            type: "string",
            format: "date-time"
          },
          sip: {
            type: "object"
          },
          recordEndpoint: {
            type: "string",
            format: "uri"
          },
          deletionProtocol: {
            nullable: true,
            type: "object"
          }
        }
      },
      AipExportPackage: {
        type: "object",
        required: [
          "packageType",
          "profile",
          "profileVersion",
          "aipId",
          "acceptedAt",
          "record",
          "contents",
          "manifest",
          "files",
          "manifestDocument"
        ],
        properties: {
          packageType: {
            type: "string",
            example: "RWP-OAIS-AIP"
          },
          profile: {
            type: "string",
            example: "MiniChat"
          },
          profileVersion: {
            type: "string",
            example: "0.1"
          },
          aipId: {
            type: "string",
            example: "aip:8fe6f638-5975-426f-8a31-f7e8027d9d4e"
          },
          acceptedAt: {
            type: "string",
            format: "date-time"
          },
          sourceSip: {
            type: "object"
          },
          record: {
            type: "object"
          },
          contents: {
            type: "object"
          },
          manifest: {
            type: "object"
          },
          files: {
            type: "object",
            description:
              "Logische Dateien des archivischen Exportpakets."
          },
          manifestDocument: {
            type: "object",
            description:
              "Manifest mit Einzeldatei-Hashes."
          }
        }
      },      
      DeletionRecordEnvelope: {
        type: "object",
        required: [
          "deletionRecordDid",
          "deletionRecordSnapshotHash",
          "payload"
        ],
        properties: {
          deletionRecordDid: {
            type: "string",
            example:
              "did:rwp:a1b2c3d4:records:8fe6f638-5975-426f-8a31-f7e8027d9d4e"
          },
          deletionRecordSnapshotHash: {
            type: "string",
            example: "sha256:..."
          },
          payload: {
            type: "object",
            description:
              "Payload gemäss deletion-record.schema.json"
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