import fs from "fs";
import path from "path";
import crypto from "crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const antwortSchemaPath = path.resolve("/app/schemas/fragestunde-antwort.schema.json");
const antwortSchema = JSON.parse(fs.readFileSync(antwortSchemaPath, "utf-8"));
const validateAntwort = ajv.compile(antwortSchema);

const caseSchemaPath = path.resolve("/app/schemas/fragestunde-case.schema.json");
const caseSchema = JSON.parse(fs.readFileSync(caseSchemaPath, "utf-8"));
const validateCase = ajv.compile(caseSchema);

const RECORD_TYPE_ANTWORT = "did:rwp:b7d4c810:schema:fragestunde-antwort";
const RECORD_TYPE_CASE = "did:rwp:b7d4c810:schema:fragestunde-case";

export function validatePayload(recordType, payload) {
  if (recordType === RECORD_TYPE_ANTWORT) {
    const valid = validateAntwort(payload);
    return { valid, errors: validateAntwort.errors };
  }
  if (recordType === RECORD_TYPE_CASE) {
    const valid = validateCase(payload);
    return { valid, errors: validateCase.errors };
  }
  return { valid: false, errors: [{ message: "Unbekannter recordType" }] };
}

export function schemaVersionHash(recordType = RECORD_TYPE_ANTWORT) {
  const schema = recordType === RECORD_TYPE_CASE ? caseSchema : antwortSchema;
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

export { RECORD_TYPE_ANTWORT, RECORD_TYPE_CASE };
