import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",

    info: {
      title: "BAR Conformance Authority API",
      version: "0.1.0",
      description: `
RecordWeb Fragestunde PoC — BAR Conformance Authority.

Die Anwendung des Schweizerischen Bundesarchivs (BAR) führt
Conformance-Assessments für identifizierbare Implementierungsversionen.
Sie erzeugt finalisierte RWP-ConformanceRecords, verwahrt diese im
BAR-Namespace ba31d45f und stellt sie über den BAR-DID-Resolver bereit.
      `.trim()
    },

    servers: [
      {
        url: "https://vps.recordweb.dev/bar",
        description: "Produktion (PoC)"
      }
    ],

    tags: [
      {
        name: "Health",
        description: "Betriebs- und Namespace-Informationen"
      },
      {
        name: "Session",
        description: "Primitive PoC-Anmeldung und Ausgabe einer BAR-User-DID"
      },
      {
        name: "Assessments",
        description: "Conformance-Assessments als Draft oder finalisierte Akte"
      },
      {
        name: "ConformanceRecords",
        description: "Finalisierte RWP-ConformanceRecords"
      },
      {
        name: "DID",
        description: "BAR-DID-Resolver für finalisierte ConformanceRecords"
      }
    ],

    components: {
      securitySchemes: {
        RwpRoleHeader: {
          type: "apiKey",
          in: "header",
          name: "x-rwp-role",
          description: `
BAR-PoC-Rolle. Zulässige Werte:

- bar-attester
- bar-auditor
- bar-viewer
          `.trim()
        },

        RwpUserDidHeader: {
          type: "apiKey",
          in: "header",
          name: "x-rwp-user-did",
          description: "DID der handelnden BAR-Person."
        }
      },

      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              example: "assessment_not_found"
            },
            message: {
              type: "string",
              example: "The requested assessment does not exist."
            }
          }
        },

        BarSessionRequest: {
          type: "object",
          required: [
            "displayName",
            "role"
          ],
          properties: {
            displayName: {
              type: "string",
              example: "Nik Archivarin"
            },
            role: {
              type: "string",
              enum: [
                "bar-attester",
                "bar-auditor",
                "bar-viewer"
              ],
              example: "bar-attester"
            }
          }
        },

        BarUser: {
          type: "object",
          properties: {
            did: {
              type: "string",
              example: "did:rwp:ba31d45f:agents:bar-user:nik:123e4567-e89b-12d3-a456-426614174000"
            },
            displayName: {
              type: "string",
              example: "Nik Archivarin"
            },
            role: {
              type: "string",
              enum: [
                "bar-attester",
                "bar-auditor",
                "bar-viewer"
              ]
            },
            issuedBy: {
              type: "string",
              example: "did:rwp:ba31d45f:systems:conformance-authority"
            },
            issuedAt: {
              type: "string",
              format: "date-time"
            }
          }
        },

        Claim: {
          type: "object",
          required: [
            "roles"
          ],
          properties: {
            profiles: {
              type: "array",
              items: {
                type: "string"
              },
              example: [
                "RWP Information Record Conformant"
              ]
            },
            roles: {
              type: "array",
              minItems: 1,
              items: {
                type: "string",
                enum: [
                  "producer",
                  "custodian",
                  "consumer",
                  "resolver",
                  "source-adapter",
                  "attester"
                ]
              },
              example: [
                "producer",
                "custodian"
              ]
            }
          }
        },

        AssessmentSubject: {
          type: "object",
          required: [
            "implementationDid",
            "productName",
            "productVersion"
          ],
          properties: {
            implementationDid: {
              type: "string",
              example: "did:rwp:b7d4c810:antwortmanagement"
            },
            productName: {
              type: "string",
              example: "Antwortmanagement"
            },
            productVersion: {
              type: "string",
              example: "1.1.1"
            },
            deployment: {
              type: "string",
              example: "poc-vps"
            }
          }
        },

        AssessmentTest: {
          type: "object",
          properties: {
            id: {
              type: "string",
              example: "did-resolution"
            },
            title: {
              type: "string",
              example: "DID-Auflösung"
            },
            requirement: {
              type: "string"
            },
            positiveCase: {
              type: "string"
            },
            negativeCase: {
              type: "string"
            },
            result: {
              type: "string",
              enum: [
                "not-tested",
                "passed",
                "failed"
              ]
            },
            evidence: {
              type: "string"
            },
            testedAt: {
              type: "string",
              format: "date-time",
              nullable: true
            },
            testedBy: {
              type: "string",
              nullable: true
            }
          }
        },

        AssessmentCreateRequest: {
          type: "object",
          properties: {
            subject: {
              $ref: "#/components/schemas/AssessmentSubject"
            },
            rwpVersion: {
              type: "string",
              example: "0.0.5"
            },
            claims: {
              type: "array",
              items: {
                $ref: "#/components/schemas/Claim"
              }
            },
            evidence: {
              type: "string",
              example: "Assessment-Bericht und Testartefakte."
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              nullable: true
            }
          }
        },

        Assessment: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid"
            },
            status: {
              type: "string",
              enum: [
                "draft",
                "finalized"
              ]
            },
            subject: {
              $ref: "#/components/schemas/AssessmentSubject"
            },
            rwpVersion: {
              type: "string"
            },
            claims: {
              type: "array",
              items: {
                $ref: "#/components/schemas/Claim"
              }
            },
            evidence: {
              type: "string"
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              nullable: true
            },
            tests: {
              type: "array",
              items: {
                $ref: "#/components/schemas/AssessmentTest"
              }
            },
            createdAt: {
              type: "string",
              format: "date-time"
            },
            updatedAt: {
              type: "string",
              format: "date-time"
            },
            createdBy: {
              type: "string"
            },
            finalizedAt: {
              type: "string",
              format: "date-time",
              nullable: true
            },
            finalizedBy: {
              type: "string",
              nullable: true
            },
            conformanceRecordDid: {
              type: "string",
              nullable: true
            }
          }
        },

        ConformanceRecord: {
          type: "object",
          properties: {
            did: {
              type: "string",
              example: "did:rwp:ba31d45f:records:1bb42515-9fd8-4004-99ba-46637f7bba88"
            },
            type: {
              type: "string",
              example: "ConformanceRecord"
            },
            payload: {
              type: "object",
              description: "RWP-ConformanceRecord-Payload."
            },
            metadata: {
              type: "object",
              properties: {
                did: {
                  type: "string"
                },
                recordType: {
                  type: "string"
                },
                schemaVersion: {
                  type: "string"
                },
                state: {
                  type: "string",
                  example: "finalized"
                },
                snapshotHash: {
                  type: "string",
                  example: "sha256:f3c76fd2bca4fd308cfe8c5af7d8436184ee0fef5a5f746ea68079f63df48301"
                },
                payloadHash: {
                  type: "string"
                },
                owner: {
                  type: "string"
                },
                created: {
                  type: "string",
                  format: "date-time"
                },
                finalized: {
                  type: "string",
                  format: "date-time"
                },
                signature: {
                  type: "string"
                }
              }
            }
          }
        },

        DidDocument: {
          type: "object",
          properties: {
            "@context": {
              type: "string",
              example: "https://www.w3.org/ns/did/v1"
            },
            id: {
              type: "string"
            },
            recordEndpoint: {
              type: "string",
              format: "uri"
            },
            created: {
              type: "string",
              format: "date-time"
            },
            updated: {
              type: "string",
              format: "date-time"
            },
            currentVersion: {
              type: "string",
              example: "sha256:f3c76fd2bca4fd308cfe8c5af7d8436184ee0fef5a5f746ea68079f63df48301"
            },
            controller: {
              type: "string"
            }
          }
        }
      }
    }
  },

  apis: [
    "./src/index.js",
    "./src/routes/*.js"
  ]
};

export const swaggerSpec = swaggerJsdoc(options);