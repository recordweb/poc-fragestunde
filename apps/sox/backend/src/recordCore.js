const { v4: uuidv4 } = require("uuid");

const DID_NAMESPACE = process.env.SOX_DID_NAMESPACE || "s73f42a3";

function createDid(recordId) {
  return `did:rwp:${DID_NAMESPACE}:records:${recordId}`;
}

function createDraftRecord({ recordType, title, caseReference, chatEndpoint }) {
  const id = uuidv4();
  const did = createDid(id);
  const now = new Date().toISOString();

  return {
    id,
    did,
    recordType,
    status: "draft",
    version: 0,
    title,
    payload: {
      title,
      source: {
        system: recordType,
        chatEndpoint,
        conversationId: null,
        workOrderStatus: "pending",
        workOrderError: null
      },
      caseReference,
      conversation: {
        participants: [],
        messages: []
      }
    },
    createdAt: now,
    updatedAt: now
  };
}

module.exports = {
  createDraftRecord,
  createDid
};