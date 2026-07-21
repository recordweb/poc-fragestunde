import fs from "fs";
import path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = path.resolve("/app/schemas/fragestunde-frage.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const validateFrage = ajv.compile(schema);

export function validatePayload(recordType, payload) {
  if (recordType === "did:rwp:parlament.ch/schema/fragestunde-frage") {
    const valid = validateFrage(payload);
    return { valid, errors: validateFrage.errors };
  }
  return { valid: false, errors: [{ message: "Unbekannter recordType" }] };
}

export function schemaVersionHash() {
  return "sha256:" + require("crypto")
    .createHash("sha256")
    .update(JSON.stringify(schema))
    .digest("hex");
}