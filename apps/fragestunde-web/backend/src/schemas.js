import fs from "fs";
import path from "path";
import crypto from "crypto";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = path.resolve("/app/schemas/fragestunde-frage.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const validateFrage = ajv.compile(schema);

const RECORD_TYPE_FRAGE = "did:rwp:a3f9e21c:schema:fragestunde-frage";

export function validatePayload(recordType, payload) {
  if (recordType === RECORD_TYPE_FRAGE) {
    const valid = validateFrage(payload);
    return { valid, errors: validateFrage.errors };
  }
  return { valid: false, errors: [{ message: "Unbekannter recordType" }] };
}

export function schemaVersionHash() {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

export { RECORD_TYPE_FRAGE };