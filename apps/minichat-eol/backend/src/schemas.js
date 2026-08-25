const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const SCHEMA_DIR = process.env.SCHEMAS_DIR || "/app/schemas";

function readSchema(fileName) {
  const filePath = path.join(SCHEMA_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Required schema file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});

addFormats(ajv);

const miniChatSipSchema = readSchema("minichat-sip.schema.json");
const submissionReceiptSchema = readSchema(
  "ais-submission-receipt.schema.json"
);
const deletionRecordSchema = readSchema("deletion-record.schema.json");
const eolMigrationStateSchema = readSchema(
  "eol-migration-state.schema.json"
);

ajv.addSchema(miniChatSipSchema);
ajv.addSchema(submissionReceiptSchema);
ajv.addSchema(deletionRecordSchema);
ajv.addSchema(eolMigrationStateSchema);

const validateMiniChatSip = ajv.getSchema(miniChatSipSchema.$id);
const validateSubmissionReceipt = ajv.getSchema(submissionReceiptSchema.$id);
const validateDeletionRecord = ajv.getSchema(deletionRecordSchema.$id);
const validateMigrationState = ajv.getSchema(eolMigrationStateSchema.$id);

function errorsFor(validate) {
  return (validate.errors || []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message,
    params: error.params
  }));
}

module.exports = {
  validateMiniChatSip,
  validateSubmissionReceipt,
  validateDeletionRecord,
  validateMigrationState,
  errorsFor
};