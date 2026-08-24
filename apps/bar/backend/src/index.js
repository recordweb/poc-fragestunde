import crypto from "crypto";
import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";

import pool, { initSchema } from "./db.js";
import { persistFinalizedConformanceRecord } from "./conformanceStore.js";
import didRouter from "./routes/did.js";
import recordsRouter from "./routes/records.js";
import { swaggerSpec } from "./swagger.js";

const app = express();
const port = Number(process.env.PORT || 3000);

const DID_NAMESPACE = process.env.BAR_DID_NAMESPACE || "ba31d45f";

const BAR_IMPLEMENTATION_DID =
  `did:rwp:${DID_NAMESPACE}:systems:conformance-authority`;

const BAR_ATTESTER_DID =
  `did:rwp:${DID_NAMESPACE}:agents:bar-attester`;

const roles = ["bar-attester", "bar-auditor", "bar-viewer"];

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec)
);

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function newRecordDid() {
  return `did:rwp:${DID_NAMESPACE}:records:${crypto.randomUUID()}`;
}

function newUserDid(slug) {
  return `did:rwp:${DID_NAMESPACE}:agents:bar-user:${slug}:${crypto.randomUUID()}`;
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.header("x-rwp-role");
    const userDid = req.header("x-rwp-user-did");

    if (!roles.includes(role)) {
      return res.status(401).json({
        error: "missing_or_invalid_role",
        message: "A valid RWP BAR role is required."
      });
    }

    if (!userDid || !userDid.startsWith("did:rwp:")) {
      return res.status(401).json({
        error: "missing_or_invalid_user",
        message: "A valid RWP user DID is required."
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: "insufficient_role",
        message: `This action requires one of: ${allowedRoles.join(", ")}.`
      });
    }

    req.rwpUser = { did: userDid, role };
    next();
  };
}

function createDefaultTests() {
  return [
    {
      id: "did-resolution",
      title: "DID-Auflösung",
      requirement: "Die Anwendung erzeugt Records mit DID und stellt die Auflösung bereit.",
      positiveCase: "Bekannte Record-DID wird korrekt aufgelöst.",
      negativeCase: "Unbekannte DID führt zu HTTP 404.",
      result: "not-tested",
      evidence: "",
      testedAt: null,
      testedBy: null
    },
    {
      id: "schema-binding",
      title: "Schema-Bindung",
      requirement: "Jeder Record-Snapshot bindet recordType und schemaVersion.",
      positiveCase: "Finalisierter Record referenziert SchemaRecord und Schema-Hash.",
      negativeCase: "Finalisierung ohne schemaVersion wird abgewiesen.",
      result: "not-tested",
      evidence: "",
      testedAt: null,
      testedBy: null
    },
    {
      id: "payload-validation",
      title: "Payload-Validierung",
      requirement: "Payload wird vor Finalisierung gegen die Schema-Version validiert.",
      positiveCase: "Gültiger Payload kann finalisiert werden.",
      negativeCase: "Ungültiger Payload wird abgewiesen.",
      result: "not-tested",
      evidence: "",
      testedAt: null,
      testedBy: null
    },
    {
      id: "snapshot-integrity",
      title: "Snapshot-Integrität",
      requirement: "Payload- und Snapshot-Hash werden berechnet und geprüft.",
      positiveCase: "Hash eines unveränderten Snapshots ist gültig.",
      negativeCase: "Manipulierter Payload wird als Integritätsfehler erkannt.",
      result: "not-tested",
      evidence: "",
      testedAt: null,
      testedBy: null
    },
    {
      id: "immutable-finalisation",
      title: "Unveränderlichkeit",
      requirement: "Finalisierte Snapshots können nicht überschrieben werden.",
      positiveCase: "Finalisierter Snapshot bleibt unverändert abrufbar.",
      negativeCase: "Änderung eines finalisierten Snapshots wird abgewiesen.",
      result: "not-tested",
      evidence: "",
      testedAt: null,
      testedBy: null
    }
  ];
}

function publicAssessment(row) {
  return {
    id: row.id,
    status: row.status,
    subject: {
      implementationDid: row.implementation_did,
      productName: row.product_name,
      productVersion: row.product_version,
      deployment: row.deployment || "poc-local"
    },
    rwpVersion: row.rwp_version,
    claims: row.claims,
    evidence: row.evidence || "",
    expiresAt: row.expires_at,
    tests: row.tests,
    createdAt: row.created,
    updatedAt: row.updated,
    createdBy: row.created_by,
    finalizedAt: row.finalized_at,
    finalizedBy: row.finalized_by,
    conformanceRecordDid: row.conformance_record_did || null
  };
}

function validationErrors(assessment) {
  const errors = [];

  if (!assessment.subject?.implementationDid?.startsWith("did:rwp:")) {
    errors.push("subject.implementationDid fehlt oder ist keine RWP-DID.");
  }

  if (!assessment.subject?.productName?.trim()) {
    errors.push("subject.productName fehlt.");
  }

  if (!assessment.subject?.productVersion?.trim()) {
    errors.push("subject.productVersion fehlt.");
  }

  if (!assessment.rwpVersion?.trim()) {
    errors.push("rwpVersion fehlt.");
  }

  if (!Array.isArray(assessment.claims) || assessment.claims.length === 0) {
    errors.push("Mindestens ein Conformance Claim ist erforderlich.");
  }

  for (const claim of assessment.claims || []) {
    if (!Array.isArray(claim.roles) || claim.roles.length === 0) {
      errors.push("Jeder Claim benötigt mindestens eine Rolle.");
    }
  }

  if (!assessment.evidence?.trim()) {
    errors.push("Mindestens eine Evidenzreferenz ist erforderlich.");
  }

  const failedTests = assessment.tests.filter((test) => test.result === "failed");
  const openTests = assessment.tests.filter((test) => test.result !== "passed");

  if (failedTests.length > 0) {
    errors.push("Mindestens ein Pflichttest ist fehlgeschlagen.");
  }

  if (openTests.length > 0) {
    errors.push("Alle Pflichttests müssen bestanden sein.");
  }

  return errors;
}

function createConformanceRecord(assessment, userDid) {
  const issuedAt = now();

  const payload = {
    subject: assessment.subject,
    rwpVersion: assessment.rwpVersion,
    claims: assessment.claims,
    assessment: {
      method: "independently-assessed",
      assurance: "independently-assessed",
      testSuite: `did:rwp:${DID_NAMESPACE}:systems:bar-test-suite:0.1.0`,
      tool: "BAR Conformance Authority",
      toolVersion: "0.1.0",
      testedAt: assessment.updatedAt
    },
    attester: userDid,
    issuedAt,
    expiresAt: assessment.expiresAt || null,
    evidence: [
      {
        type: "assessment-report",
        content: assessment.evidence,
        hash: sha256(assessment.evidence)
      }
    ],
    assessmentResults: assessment.tests.map((test) => ({
      testId: test.id,
      result: test.result,
      testedAt: test.testedAt,
      testedBy: test.testedBy,
      evidence: test.evidence,
      evidenceHash: test.evidence ? sha256(test.evidence) : null
    })),
    supersedes: []
  };

  const did = newRecordDid();
  const payloadHash = sha256(canonicalize(payload));

  const metadataWithoutHash = {
    did,
    recordType: `did:rwp:${DID_NAMESPACE}:schemas:conformance-record`,
    schemaVersion: "sha256:poc-conformance-schema-0.1.0",
    state: "finalized",
    created: issuedAt,
    finalized: issuedAt,
    owner: userDid,
    parents: [],
    payloadHash,
    payloadFormat: "application/json"
  };

  const snapshotHash = sha256(
    `${canonicalize(metadataWithoutHash)}${canonicalize(payload)}`
  );

  return {
    did,
    type: "ConformanceRecord",
    payload,
    metadata: {
      ...metadataWithoutHash,
      snapshotHash,
      signature: `poc:${userDid}:${sha256(snapshotHash)}`
    }
  };
}

async function getAssessment(id) {
  const { rows } = await pool.query(
    `SELECT * FROM assessments WHERE id = $1`,
    [id]
  );

  return rows[0] || null;
}

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: BAR-Betriebsstatus abrufen
 *     description: Liefert den Status der BAR-Conformance-Anwendung, ihre System-DID und den verwalteten RWP-Namespace.
 *     responses:
 *       200:
 *         description: BAR-Anwendung ist erreichbar.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 service:
 *                   type: string
 *                   example: bar-conformance-authority
 *                 implementationDid:
 *                   type: string
 *                   example: did:rwp:ba31d45f:systems:conformance-authority
 *                 attesterDid:
 *                   type: string
 *                   example: did:rwp:ba31d45f:agents:bar-attester
 *                 didNamespace:
 *                   type: string
 *                   example: ba31d45f
 */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "bar-conformance-authority",
    implementationDid: BAR_IMPLEMENTATION_DID,
    attesterDid: BAR_ATTESTER_DID,
    didNamespace: DID_NAMESPACE
  });
});

app.use("/did", didRouter);
app.use("/api/records", recordsRouter);

/**
 * @openapi
 * /api/session:
 *   post:
 *     tags: [Session]
 *     summary: BAR-PoC-Session anlegen
 *     description: |
 *       Erzeugt eine temporäre BAR-User-DID und bindet sie an eine gewählte
 *       PoC-Rolle. Dies ist kein produktives IAM-Verfahren.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/BarSessionRequest"
 *     responses:
 *       201:
 *         description: BAR-User-DID und Rolle wurden erzeugt.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: "#/components/schemas/BarUser"
 *       400:
 *         description: Name oder BAR-Rolle fehlt bzw. ist ungültig.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 */
app.post("/api/session", (req, res) => {
  const displayName = String(req.body?.displayName || "").trim();
  const role = String(req.body?.role || "").trim();

  if (!displayName) {
    return res.status(400).json({ error: "display_name_required" });
  }

  if (!roles.includes(role)) {
    return res.status(400).json({ error: "invalid_role" });
  }

  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "bar-user";

  const userDid = newUserDid(slug);

  return res.status(201).json({
    user: {
      did: userDid,
      displayName,
      role,
      issuedBy: BAR_IMPLEMENTATION_DID,
      issuedAt: now()
    }
  });
});

/**
 * @openapi
 * /api/assessments:
 *   get:
 *     tags: [Assessments]
 *     summary: Conformance-Assessments auflisten
 *     description: Liefert alle BAR-Assessment-Akten, inklusive Drafts und finalisierten Assessments.
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester, bar-auditor, bar-viewer]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *           example: did:rwp:ba31d45f:agents:bar-user:nik:123e4567-e89b-12d3-a456-426614174000
 *     responses:
 *       200:
 *         description: Liste der Assessment-Akten.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assessments:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Assessment"
 *       401:
 *         description: Fehlende oder ungültige BAR-Rolle bzw. User-DID.
 *       403:
 *         description: Rolle darf Assessments nicht lesen.
 */
app.get(
  "/api/assessments",
  requireRole("bar-attester", "bar-auditor", "bar-viewer"),
  async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM assessments ORDER BY updated DESC`
      );

      return res.json({
        assessments: rows.map(publicAssessment)
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/assessments:
 *   post:
 *     tags: [Assessments]
 *     summary: Assessment-Draft anlegen
 *     description: |
 *       Erstellt eine neue BAR-Assessment-Akte im Status draft.
 *       Die Pflichttests werden mit dem initialen Status not-tested angelegt.
 *       Nur ein BAR Attester darf einen Assessment-Draft erstellen.
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AssessmentCreateRequest"
 *     responses:
 *       201:
 *         description: Assessment-Draft wurde erzeugt.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assessment:
 *                   $ref: "#/components/schemas/Assessment"
 *       401:
 *         description: Fehlende oder ungültige BAR-Identität.
 *       403:
 *         description: Nur bar-attester darf neue Assessments anlegen.
 */
app.post(
  "/api/assessments",
  requireRole("bar-attester"),
  async (req, res, next) => {
    try {
      const subject = req.body?.subject || {};
      const claims = Array.isArray(req.body?.claims) && req.body.claims.length
        ? req.body.claims
        : [{
          profiles: ["RWP Information Record Conformant"],
          roles: ["producer", "custodian"]
        }];

      const { rows } = await pool.query(
        `
        INSERT INTO assessments (
          status,
          implementation_did,
          product_name,
          product_version,
          deployment,
          rwp_version,
          claims,
          evidence,
          expires_at,
          tests,
          created_by
        )
        VALUES (
          'draft',
          $1, $2, $3, $4, $5,
          $6::jsonb, $7, $8,
          $9::jsonb, $10
        )
        RETURNING *
        `,
        [
          String(subject.implementationDid || ""),
          String(subject.productName || ""),
          String(subject.productVersion || ""),
          String(subject.deployment || "poc-local"),
          String(req.body?.rwpVersion || "0.0.5"),
          JSON.stringify(claims),
          String(req.body?.evidence || ""),
          req.body?.expiresAt || null,
          JSON.stringify(createDefaultTests()),
          req.rwpUser.did
        ]
      );

      return res.status(201).json({
        assessment: publicAssessment(rows[0])
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/assessments/{id}:
 *   get:
 *     tags: [Assessments]
 *     summary: Einzelnes Assessment lesen
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester, bar-auditor, bar-viewer]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assessment-Akte.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assessment:
 *                   $ref: "#/components/schemas/Assessment"
 *       404:
 *         description: Assessment nicht gefunden.
 */
app.get(
  "/api/assessments/:id",
  requireRole("bar-attester", "bar-auditor", "bar-viewer"),
  async (req, res, next) => {
    try {
      const assessment = await getAssessment(req.params.id);

      if (!assessment) {
        return res.status(404).json({ error: "assessment_not_found" });
      }

      return res.json({
        assessment: publicAssessment(assessment)
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/assessments/{id}:
 *   put:
 *     tags: [Assessments]
 *     summary: Assessment-Draft aktualisieren
 *     description: |
 *       Aktualisiert Stammdaten, Claims, Evidenz und Testergebnisse eines
 *       Draft-Assessments. Finalisierte Assessments sind unveränderlich.
 *       BAR Attester und BAR Auditor dürfen Drafts bearbeiten.
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester, bar-auditor]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: "#/components/schemas/AssessmentCreateRequest"
 *               - type: object
 *                 properties:
 *                   tests:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required: [id, result]
 *                       properties:
 *                         id:
 *                           type: string
 *                         result:
 *                           type: string
 *                           enum: [not-tested, passed, failed]
 *                         evidence:
 *                           type: string
 *     responses:
 *       200:
 *         description: Assessment-Draft wurde aktualisiert.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assessment:
 *                   $ref: "#/components/schemas/Assessment"
 *       404:
 *         description: Assessment nicht gefunden.
 *       409:
 *         description: Assessment ist bereits finalisiert.
 */
app.put(
  "/api/assessments/:id",
  requireRole("bar-attester", "bar-auditor"),
  async (req, res, next) => {
    try {
      const assessment = await getAssessment(req.params.id);

      if (!assessment) {
        return res.status(404).json({ error: "assessment_not_found" });
      }

      if (assessment.status !== "draft") {
        return res.status(409).json({
          error: "assessment_finalized",
          message: "A finalised assessment cannot be changed."
        });
      }

      const body = req.body || {};

      const subject = {
        implementationDid:
          body.subject?.implementationDid ?? assessment.implementation_did,
        productName:
          body.subject?.productName ?? assessment.product_name,
        productVersion:
          body.subject?.productVersion ?? assessment.product_version,
        deployment:
          body.subject?.deployment ?? assessment.deployment
      };

      const rwpVersion =
        typeof body.rwpVersion === "string"
          ? body.rwpVersion
          : assessment.rwp_version;

      const claims = Array.isArray(body.claims)
        ? body.claims
        : assessment.claims;

      const evidence =
        typeof body.evidence === "string"
          ? body.evidence
          : assessment.evidence;

      const expiresAt =
        "expiresAt" in body
          ? body.expiresAt || null
          : assessment.expires_at;

      const tests = Array.isArray(body.tests)
        ? assessment.tests.map((existingTest) => {
          const changed = body.tests.find(
            (test) => test.id === existingTest.id
          );

          if (!changed) {
            return existingTest;
          }

          const result = ["not-tested", "passed", "failed"].includes(changed.result)
            ? changed.result
            : existingTest.result;

          return {
            ...existingTest,
            result,
            evidence:
              typeof changed.evidence === "string"
                ? changed.evidence
                : existingTest.evidence,
            testedAt: result === "not-tested" ? null : now(),
            testedBy: result === "not-tested" ? null : req.rwpUser.did
          };
        })
        : assessment.tests;

      const { rows } = await pool.query(
        `
        UPDATE assessments
        SET
          implementation_did = $2,
          product_name = $3,
          product_version = $4,
          deployment = $5,
          rwp_version = $6,
          claims = $7::jsonb,
          evidence = $8,
          expires_at = $9,
          tests = $10::jsonb,
          updated = now()
        WHERE id = $1
          AND status = 'draft'
        RETURNING *
        `,
        [
          assessment.id,
          subject.implementationDid,
          subject.productName,
          subject.productVersion,
          subject.deployment,
          rwpVersion,
          JSON.stringify(claims),
          evidence,
          expiresAt,
          JSON.stringify(tests)
        ]
      );

      if (!rows.length) {
        return res.status(409).json({
          error: "assessment_finalized",
          message: "A finalised assessment cannot be changed."
        });
      }

      return res.json({
        assessment: publicAssessment(rows[0])
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/assessments/{id}/finalize:
 *   post:
 *     tags: [Assessments]
 *     summary: Assessment finalisieren und ConformanceRecord erstellen
 *     description: |
 *       Finalisiert ein Assessment und erzeugt in derselben Datenbanktransaktion
 *       einen persistenten RWP-ConformanceRecord im BAR-Namespace.
 *
 *       Die Finalisierung ist nur möglich, wenn alle Pflichttests bestanden
 *       sind, keine Tests fehlgeschlagen sind und die erforderlichen Claims
 *       sowie Evidenz vorhanden sind.
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Assessment finalisiert und ConformanceRecord erstellt.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assessment:
 *                   $ref: "#/components/schemas/Assessment"
 *                 conformanceRecord:
 *                   $ref: "#/components/schemas/ConformanceRecord"
 *       404:
 *         description: Assessment nicht gefunden.
 *       409:
 *         description: Assessment ist bereits finalisiert.
 *       422:
 *         description: Finalisierungsbedingungen sind nicht erfüllt.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: finalisation_requirements_not_met
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 */
app.post(
  "/api/assessments/:id/finalize",
  requireRole("bar-attester"),
  async (req, res, next) => {
    try {
      const row = await getAssessment(req.params.id);

      if (!row) {
        return res.status(404).json({ error: "assessment_not_found" });
      }

      if (row.status !== "draft") {
        return res.status(409).json({
          error: "assessment_already_finalized",
          conformanceRecordDid: row.conformance_record_did
        });
      }

      const assessment = publicAssessment(row);
      const errors = validationErrors(assessment);

      if (errors.length > 0) {
        return res.status(422).json({
          error: "finalisation_requirements_not_met",
          errors
        });
      }

      const record = createConformanceRecord(assessment, req.rwpUser.did);

      await persistFinalizedConformanceRecord(
        record,
        assessment,
        req.rwpUser.did
      );

      const finalizedAssessment = await getAssessment(assessment.id);

      return res.status(201).json({
        assessment: publicAssessment(finalizedAssessment),
        conformanceRecord: record
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/conformance-records:
 *   get:
 *     tags: [ConformanceRecords]
 *     summary: Finalisierte ConformanceRecords auflisten
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester, bar-auditor, bar-viewer]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Finalisierte BAR-ConformanceRecords.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conformanceRecords:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/ConformanceRecord"
 */
app.get(
  "/api/conformance-records",
  requireRole("bar-attester", "bar-auditor", "bar-viewer"),
  async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          r.did,
          s.snapshot_hash,
          s.parents,
          s.state,
          s.record_type,
          s.schema_version,
          s.owner,
          s.payload,
          s.payload_hash,
          s.payload_format,
          s.created,
          s.finalized,
          s.signature
        FROM records r
        JOIN record_snapshots s ON s.id = r.current_snapshot_id
        WHERE s.state = 'finalized'
        ORDER BY s.finalized DESC
        `
      );

      const conformanceRecords = rows.map((row) => ({
        did: row.did,
        type: "ConformanceRecord",
        payload: row.payload,
        metadata: {
          did: row.did,
          recordType: row.record_type,
          schemaVersion: row.schema_version,
          state: row.state,
          created: row.created,
          finalized: row.finalized,
          owner: row.owner,
          parents: row.parents,
          payloadHash: row.payload_hash,
          payloadFormat: row.payload_format,
          snapshotHash: row.snapshot_hash,
          signature: row.signature
        }
      }));

      return res.json({ conformanceRecords });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/conformance-records/{did}:
 *   get:
 *     tags: [ConformanceRecords]
 *     summary: Finalisierten ConformanceRecord lesen
 *     description: |
 *       Interner, rollenbasierter API-Zugriff auf einen finalisierten
 *       ConformanceRecord. Für die öffentliche, föderierte Auflösung
 *       stehen zusätzlich der BAR-DID-Resolver und /api/records/{did} bereit.
 *     security:
 *       - RwpRoleHeader: []
 *         RwpUserDidHeader: []
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *           example: did:rwp:ba31d45f:records:1bb42515-9fd8-4004-99ba-46637f7bba88
 *       - in: header
 *         name: x-rwp-role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bar-attester, bar-auditor, bar-viewer]
 *       - in: header
 *         name: x-rwp-user-did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: ConformanceRecord.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conformanceRecord:
 *                   $ref: "#/components/schemas/ConformanceRecord"
 *       404:
 *         description: ConformanceRecord nicht gefunden.
 */
app.get(
  "/api/conformance-records/:did",
  requireRole("bar-attester", "bar-auditor", "bar-viewer"),
  async (req, res, next) => {
    try {
      const did = decodeURIComponent(req.params.did);

      const { rows } = await pool.query(
        `
        SELECT
          r.did,
          s.snapshot_hash,
          s.parents,
          s.state,
          s.record_type,
          s.schema_version,
          s.owner,
          s.payload,
          s.payload_hash,
          s.payload_format,
          s.created,
          s.finalized,
          s.signature
        FROM records r
        JOIN record_snapshots s ON s.id = r.current_snapshot_id
        WHERE r.did = $1
          AND s.state = 'finalized'
        `,
        [did]
      );

      if (!rows.length) {
        return res.status(404).json({
          error: "conformance_record_not_found"
        });
      }

      const row = rows[0];

      return res.json({
        conformanceRecord: {
          did: row.did,
          type: "ConformanceRecord",
          payload: row.payload,
          metadata: {
            did: row.did,
            recordType: row.record_type,
            schemaVersion: row.schema_version,
            state: row.state,
            created: row.created,
            finalized: row.finalized,
            owner: row.owner,
            parents: row.parents,
            payloadHash: row.payload_hash,
            payloadFormat: row.payload_format,
            snapshotHash: row.snapshot_hash,
            signature: row.signature
          }
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.use((error, _req, res, _next) => {
  console.error("BAR API error:", error);

  res.status(500).json({
    error: "internal_server_error",
    message: "The BAR application could not process the request."
  });
});

async function start() {
  await initSchema();

  app.listen(port, () => {
    console.log(
      `BAR Conformance Authority listening on port ${port} ` +
      `for namespace ${DID_NAMESPACE}`
    );
  });
}

start().catch((error) => {
  console.error("BAR startup failed:", error);
  process.exit(1);
});