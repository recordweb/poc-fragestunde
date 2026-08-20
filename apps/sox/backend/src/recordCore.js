const { v4: uuidv4 } = require("uuid");

const DID_NAMESPACE = process.env.SOX_DID_NAMESPACE || "s73f42a3";

function createDid(recordId) {
  return `did:rwp:${DID_NAMESPACE}:records:${recordId}`;
}

function createDraftRecord({ recordType, title, caseReference, chatEndpoint }) {
  const id = uuidv4();
  const did = createDid(id);
  const now = new Date().toISOString();

  const payload = {
    title,
    source: {
      system: recordType,
      conversationId: id,
      chatEndpoint: chatEndpoint || null
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