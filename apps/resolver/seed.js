const db = require('./db');
const fs = require('fs');
const path = require('path');

const org = JSON.parse(fs.readFileSync(path.join(__dirname, 'org.json'), 'utf-8'));

function buildDid(person, org) {
  if (person.type === "independent") {
    return `did:rwp:${person.personalNamespace}:self`;
  }
  return `did:rwp:${org.namespace}:users/${person.slug}`;
}

function buildDidDocument(did, controller) {
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

function seed() {
  const count = db.prepare("SELECT COUNT(*) as c FROM persons").get().c;
  if (count > 0) {
    console.log(`Seed skipped: ${count} persons already present.`);
    return;
  }

  const testPersons = org.testPersons || [];

  const insert = db.prepare(`
    INSERT INTO persons (did, name, role, kuerzel, created, updated, didDocument)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  for (const p of testPersons) {
    const did = buildDid(p, org);
    const doc = buildDidDocument(did, org.controller);
    insert.run(did, p.name, p.role, p.kuerzel, now, now, JSON.stringify(doc));
    console.log(`Seeded [${p.kuerzel}]: ${p.name} -> ${did}`);
  }
}

module.exports = seed;
