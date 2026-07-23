const db = require('./db');
const fs = require('fs');
const path = require('path');
const { buildDid, buildDidDocument } = require('./didUtils');

const org = JSON.parse(fs.readFileSync(path.join(__dirname, 'org.json'), 'utf-8'));

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
    const doc = buildDidDocument(did, org.controller, org);
    insert.run(did, p.name, p.role, p.kuerzel, now, now, JSON.stringify(doc));
    console.log(`Seeded [${p.kuerzel}]: ${p.name} -> ${did}`);
  }
}

module.exports = seed;