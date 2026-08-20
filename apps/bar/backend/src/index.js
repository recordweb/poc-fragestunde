const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const BAR_IMPLEMENTATION_DID = "did:rwp:poc-fragestunde:bar-conformance-authority";
const BAR_ATTESTER_DID = "did:rwp:poc-fragestunde:bar-attester";

const roles = ["bar-attester", "bar-auditor", "bar-viewer"];

const assessments = new Map();
const conformanceRecords = new Map();

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

function newDid(kind) {
  return `did:rwp:poc-fragestunde:bar-${kind}-${crypto.randomUUID()}`;
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

function publicAssessment(assessment) {
  return {
    ...assessment,
    conformanceRecordDid: assessment.conformanceRecordDid || null
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
      testSuite: "did:rwp:poc-fragestunde:bar-test-suite:0.1.0",
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

  const did = newDid("conformance");
  const payloadHash = sha256(canonicalize(payload));

  const metadataWithoutHash = {
    did,
    recordType: "did:rwp:recordweb:conformance-record",
    schemaVersion: "sha256:poc-conformance-schema-0.1.0",
    state: "finalized",
    created: issuedAt,
    finalized: issuedAt,
    owner: userDid,
    parents: [],
    payloadHash,
    payloadFormat: "application/json"
  };

  const snapshotHash = sha256(`${canonicalize(metadataWithoutHash)}${canonicalize(payload)}`);

  const metadata = {
    ...metadataWithoutHash,
    snapshotHash,
    signature: `poc:${userDid}:${sha256(snapshotHash)}`
  };

  return {
    did,
    type: "ConformanceRecord",
    payload,
    metadata
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "bar-conformance-authority",
    implementationDid: BAR_IMPLEMENTATION_DID
  });
});

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

  const userDid = `did:rwp:poc-fragestunde:bar-user-${slug}-${crypto.randomUUID()}`;

  res.status(201).json({
    user: {
      did: userDid,
      displayName,
      role,
      issuedBy: BAR_IMPLEMENTATION_DID,
      issuedAt: now()
    }
  });
});

app.get("/api/assessments", requireRole("bar-attester", "bar-auditor", "bar-viewer"), (_req, res) => {
  const values = [...assessments.values()]
    .map(publicAssessment)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  res.json({ assessments: values });
});

app.post("/api/assessments", requireRole("bar-attester"), (req, res) => {
  const subject = req.body?.subject || {};
  const claims = Array.isArray(req.body?.claims) && req.body.claims.length
    ? req.body.claims
    : [{
      profiles: ["RWP Information Record Conformant"],
      roles: ["producer", "custodian"]
    }];

  const createdAt = now();
  const id = crypto.randomUUID();

  const assessment = {
    id,
    status: "draft",
    subject: {
      implementationDid: String(subject.implementationDid || ""),
      productName: String(subject.productName || ""),
      productVersion: String(subject.productVersion || ""),
      deployment: String(subject.deployment || "poc-local")
    },
    rwpVersion: String(req.body?.rwpVersion || "0.0.4"),
    claims,
    evidence: String(req.body?.evidence || ""),
    expiresAt: req.body?.expiresAt || null,
    tests: createDefaultTests(),
    createdAt,
    updatedAt: createdAt,
    createdBy: req.rwpUser.did,
    conformanceRecordDid: null
  };

  assessments.set(id, assessment);
  res.status(201).json({ assessment: publicAssessment(assessment) });
});

app.get("/api/assessments/:id", requireRole("bar-attester", "bar-auditor", "bar-viewer"), (req, res) => {
  const assessment = assessments.get(req.params.id);

  if (!assessment) {
    return res.status(404).json({ error: "assessment_not_found" });
  }

  res.json({ assessment: publicAssessment(assessment) });
});

app.put("/api/assessments/:id", requireRole("bar-attester", "bar-auditor"), (req, res) => {
  const assessment = assessments.get(req.params.id);

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

  if (body.subject) {
    assessment.subject = {
      ...assessment.subject,
      ...body.subject
    };
  }

  if (typeof body.rwpVersion === "string") {
    assessment.rwpVersion = body.rwpVersion;
  }

  if (Array.isArray(body.claims)) {
    assessment.claims = body.claims;
  }

  if (typeof body.evidence === "string") {
    assessment.evidence = body.evidence;
  }

  if ("expiresAt" in body) {
    assessment.expiresAt = body.expiresAt || null;
  }

  if (Array.isArray(body.tests)) {
    assessment.tests = assessment.tests.map((existingTest) => {
      const changed = body.tests.find((test) => test.id === existingTest.id);

      if (!changed) {
        return existingTest;
      }

      const result = ["not-tested", "passed", "failed"].includes(changed.result)
        ? changed.result
        : existingTest.result;

      return {
        ...existingTest,
        result,
        evidence: typeof changed.evidence === "string" ? changed.evidence : existingTest.evidence,
        testedAt: result === "not-tested" ? null : now(),
        testedBy: result === "not-tested" ? null : req.rwpUser.did
      };
    });
  }

  assessment.updatedAt = now();
  res.json({ assessment: publicAssessment(assessment) });
});

app.post("/api/assessments/:id/finalize", requireRole("bar-attester"), (req, res) => {
  const assessment = assessments.get(req.params.id);

  if (!assessment) {
    return res.status(404).json({ error: "assessment_not_found" });
  }

  if (assessment.status !== "draft") {
    return res.status(409).json({
      error: "assessment_already_finalized",
      conformanceRecordDid: assessment.conformanceRecordDid
    });
  }

  const errors = validationErrors(assessment);

  if (errors.length > 0) {
    return res.status(422).json({
      error: "finalisation_requirements_not_met",
      errors
    });
  }

  const record = createConformanceRecord(assessment, req.rwpUser.did);

  conformanceRecords.set(record.did, record);
  assessment.status = "finalized";
  assessment.updatedAt = now();
  assessment.finalizedAt = record.metadata.finalized;
  assessment.finalizedBy = req.rwpUser.did;
  assessment.conformanceRecordDid = record.did;

  res.status(201).json({
    assessment: publicAssessment(assessment),
    conformanceRecord: record
  });
});

app.get("/api/conformance-records", requireRole("bar-attester", "bar-auditor", "bar-viewer"), (_req, res) => {
  const records = [...conformanceRecords.values()]
    .sort((a, b) => b.metadata.finalized.localeCompare(a.metadata.finalized));

  res.json({ conformanceRecords: records });
});

app.get("/api/conformance-records/:did", requireRole("bar-attester", "bar-auditor", "bar-viewer"), (req, res) => {
  const record = conformanceRecords.get(req.params.did);

  if (!record) {
    return res.status(404).json({ error: "conformance_record_not_found" });
  }

  res.json({ conformanceRecord: record });
});

app.listen(port, () => {
  console.log(`BAR Conformance Authority listening on port ${port}`);
});