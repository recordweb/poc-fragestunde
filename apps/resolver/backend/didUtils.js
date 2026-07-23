const crypto = require('crypto');

function generatePersonalNamespace() {
  return crypto.randomBytes(4).toString('hex');
}

function buildDid(person, org) {
  if (person.type === "independent") {
    return `did:rwp:${person.personalNamespace}:self`;
  }
  return `did:rwp:${org.namespace}:users/${person.slug}`;
}

function buildDidDocument(did, controller, org) {
  const now = new Date().toISOString();
  const suffix = did.includes('users/') ? did.split('users/').pop() : did.split(':').pop();
  return {
    "@context": "https://www.w3.org/ns/did/v1",
    id: did,
    recordEndpoint: `${org.baseEndpoint}/${suffix}`,
    created: now,
    updated: now,
    currentVersion: "",
    controller: controller,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: controller,
        publicKeyMultibase: "z6MkPLACEHOLDERkeyPoC"
      }
    ]
  };
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

module.exports = { generatePersonalNamespace, buildDid, buildDidDocument, slugify };