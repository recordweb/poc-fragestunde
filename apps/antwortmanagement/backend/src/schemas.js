import fs from "fs";
import path from "path";
import crypto from "crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = path.resolve("/app/schemas/fragestunde-antwort.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const validateAntwort = ajv.compile(schema);

const RECORD_TYPE_ANTWORT = "did:rwp:b7d4c810:schema:fragestunde-antwort";

export function validatePayload(recordType, payload) {
  if (recordType === RECORD_TYPE_ANTWORT) {
    const valid = validateAntwort(payload);
    return { valid, errors: validateAntwort.errors };
  }
  return { valid: false, errors: [{ message: "Unbekannter recordType" }] };
}

export function schemaVersionHash() {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

export { RECORD_TYPE_ANTWORT };
