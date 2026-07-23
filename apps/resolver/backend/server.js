const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const seed = require('./seed');
const { generatePersonalNamespace, buildDid, buildDidDocument, slugify } = require('./didUtils');

const org = JSON.parse(fs.readFileSync(path.join(__dirname, 'org.json'), 'utf-8'));

seed();

const app = express();
app.use(express.json());

// RWP §2.4 — DID Resolver Endpoint
app.get('/1.0/identifiers/*', (req, res) => {
  const did = req.params[0];
  const row = db.prepare("SELECT * FROM persons WHERE did = ?").get(did);

  if (!row) {
    return res.status(404).json({
      error: "notFound",
      message: `DID ${did} is not known to this resolver (${org.namespace}).`
    });
  }

  const didDocument = JSON.parse(row.didDocument);
  res.status(200)
     .set('Content-Type', 'application/did+ld+json')
     .json(didDocument);
});

// Login per Kürzel
app.get('/1.0/login/:kuerzel', (req, res) => {
  const kuerzel = req.params.kuerzel;
  const row = db.prepare("SELECT * FROM persons WHERE kuerzel = ?").get(kuerzel);

  if (!row) {
    return res.status(404).json({
      error: "notFound",
      message: `Kürzel '${kuerzel}' ist nicht bekannt (${org.namespace}).`
    });
  }

  res.status(200).json({
    did: row.did,
    name: row.name,
    role: row.role,
    kuerzel: row.kuerzel
  });
});

// Liste aller registrierten Personen
app.get('/1.0/persons', (req, res) => {
  const rows = db.prepare("SELECT did, name, role, kuerzel FROM persons").all();
  res.status(200).json(rows);
});

// NEU (Etappe 3) — Person anlegen
app.post('/1.0/persons', (req, res) => {
  const { name, role, kuerzel, type } = req.body;

  if (!name || !role || !kuerzel || !type) {
    return res.status(400).json({
      error: "badRequest",
      message: "Felder 'name', 'role', 'kuerzel' und 'type' sind erforderlich."
    });
  }

  if (!["independent", "employee"].includes(type)) {
    return res.status(400).json({
      error: "badRequest",
      message: "'type' muss 'independent' oder 'employee' sein."
    });
  }

  const existingKuerzel = db.prepare("SELECT did FROM persons WHERE kuerzel = ?").get(kuerzel);
  if (existingKuerzel) {
    return res.status(409).json({
      error: "conflict",
      message: `Kürzel '${kuerzel}' ist bereits vergeben.`
    });
  }

  let person;
  if (type === "independent") {
    person = { name, role, kuerzel, type, personalNamespace: generatePersonalNamespace() };
  } else {
    const slug = slugify(name);
    const existingSlug = db.prepare("SELECT did FROM persons WHERE did LIKE ?").get(`%users/${slug}`);
    if (existingSlug) {
      return res.status(409).json({
        error: "conflict",
        message: `Slug '${slug}' ist bereits vergeben.`
      });
    }
    person = { name, role, kuerzel, type, slug };
  }

  const did = buildDid(person, org);
  const doc = buildDidDocument(did, org.controller, org);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO persons (did, name, role, kuerzel, created, updated, didDocument)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(did, name, role, kuerzel, now, now, JSON.stringify(doc));

  res.status(201).json({ did, name, role, kuerzel, type });
});

// NEU (Etappe 3) — Person löschen
app.delete('/1.0/persons/*', (req, res) => {
  const did = req.params[0];
  const row = db.prepare("SELECT did FROM persons WHERE did = ?").get(did);

  if (!row) {
    return res.status(404).json({
      error: "notFound",
      message: `DID ${did} ist nicht bekannt (${org.namespace}).`
    });
  }

  db.prepare("DELETE FROM persons WHERE did = ?").run(did);
  res.status(200).json({ deleted: did });
});

// Health/Status
app.get('/', (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM persons").get().c;
  res.json({
    service: "rwp-poc-resolver",
    organisation: org.name,
    namespace: org.namespace,
    registeredPersons: count,
    endpoints: {
      resolve: "/1.0/identifiers/{did}",
      login: "/1.0/login/{kuerzel}",
      list: "/1.0/persons",
      create: "POST /1.0/persons",
      delete: "DELETE /1.0/persons/{did}"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RWP PoC Resolver [${org.namespace}] listening on port ${PORT}`);
});