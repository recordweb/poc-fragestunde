import fs from "fs";
import path from "path";
import crypto from "crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});

addFormats(ajv);

const antwortSchemaPath = path.resolve(
  "/app/schemas/fragestunde-antwort.schema.json"
);

const caseSchemaPath = path.resolve(
  "/app/schemas/fragestunde-case.schema.json"
);

const antwortSchema = JSON.parse(
  fs.readFileSync(antwortSchemaPath, "utf-8")
);

const caseSchema = JSON.parse(
  fs.readFileSync(caseSchemaPath, "utf-8")
);

const validateAntwort = ajv.compile(antwortSchema);
const validateCase = ajv.compile(caseSchema);

const RECORD_TYPE_ANTWORT =
  "did:rwp:b7d4c810:schema:fragestunde-antwort";

const RECORD_TYPE_CASE =
  "did:rwp:b7d4c810:schema:fragestunde-case";

const SCHEMA_FILE_ANTWORT =
  "schemas/fragestunde-antwort.schema.json";

const SCHEMA_FILE_CASE =
  "schemas/fragestunde-case.schema.json";

function sha256(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

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

export function validatePayload(recordType, payload) {
  if (recordType === RECORD_TYPE_ANTWORT) {
    const valid = validateAntwort(payload);

    return {
      valid,
      errors: validateAntwort.errors
    };
  }

  if (recordType === RECORD_TYPE_CASE) {
    const valid = validateCase(payload);

    return {
      valid,
      errors: validateCase.errors
    };
  }

  return {
    valid: false,
    errors: [{ message: "Unbekannter recordType" }]
  };
}

export function getSchema(recordType = RECORD_TYPE_ANTWORT) {
  if (recordType === RECORD_TYPE_ANTWORT) {
    return antwortSchema;
  }

  if (recordType === RECORD_TYPE_CASE) {
    return caseSchema;
  }

  return null;
}

export function getSchemaFile(recordType = RECORD_TYPE_ANTWORT) {
  if (recordType === RECORD_TYPE_ANTWORT) {
    return SCHEMA_FILE_ANTWORT;
  }

  if (recordType === RECORD_TYPE_CASE) {
    return SCHEMA_FILE_CASE;
  }

  return null;
}

export function schemaVersionHash(recordType = RECORD_TYPE_ANTWORT) {
  const schema = getSchema(recordType);

  if (!schema) {
    throw new Error(`Unbekannter recordType: ${recordType}`);
  }

  return sha256(canonicalize(schema));
}

export {
  RECORD_TYPE_ANTWORT,
  RECORD_TYPE_CASE
};