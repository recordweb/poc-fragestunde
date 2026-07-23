const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const seed = require('./seed');

const org = JSON.parse(fs.readFileSync(path.join(__dirname, 'org.json'), 'utf-8'));

seed();

const app = express();
app.use(express.json());

// RWP §2.4 — DID Resolver Endpoint
// Wildcard (*) statt :did, da DIDs vom Typ "users/slug" einen Slash enthalten
// und Express sonst die Route beim ersten "/" abschneiden würde.
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

// Login per Kürzel — für schnellen Test-Login im Frontend
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

// Liste aller registrierten Personen (für späteres Admin-Frontend, Etappe 3)
app.get('/1.0/persons', (req, res) => {
  const rows = db.prepare("SELECT did, name, role, kuerzel FROM persons").all();
  res.status(200).json(rows);
});

// Simple health/info endpoint
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
      list: "/1.0/persons"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RWP PoC Resolver [${org.namespace}] listening on port ${PORT}`);
});