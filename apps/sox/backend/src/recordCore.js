const crypto = require("crypto");

const DID_NAMESPACE = process.env.SOX_DID_NAMESPACE || "s73f42a3";

function createOpaqueId() {
  return crypto.randomBytes(16).toString("hex");
}

function createDid(recordId) {
  return `did:recordweb:${DID_NAMESPACE}:${recordId}`;
}

function createDraftRecord({ recordType, title, caseReference }) {
  const id = createOpaqueId();
  const did = createDid(id);
  const now = new Date().toISOString();

  const payload = {
    title,
    source: {
      system: recordType,
      conversationId: id
    },
    caseReference,
    conversation: {
      participants: [],
      messages: []
    }
  };

  return {
    id,
    did,
    recordType,
    status: "draft",
    version: 1,
    title,
    payload,
    createdAt: now,
    updatedAt: now
  };
}

module.exports = {
  createDraftRecord,
  createDid
};