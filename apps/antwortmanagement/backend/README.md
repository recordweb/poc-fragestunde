# Antwortmanagement — Backend API

Kurzreferenz für alle Endpunkte des Antwortmanagement-Backends (RecordWeb PoC).
Alle Pfade sind relativ zu `https://vps.recordweb.dev`.

## Basis-Konfiguration

- **API-Basis:** `/antwortmanagement/api/records`
- **DID-Resolver:** `/antwortmanagement/did/`
- **Namespace:** `did:rwp:b7d4c810` (Bundeskanzlei)
- **Record-Typ:** `did:rwp:b7d4c810:schema:fragestunde-antwort`

> Hinweis zur Pfad-Struktur
>
>`/antwortmanagement/api/*` bündelt alle internen Anwendungs-Endpunkte (Records, Logs).  
>`/antwortmanagement/did/*` ist bewusst getrennt davon, da DID-Auflösung eine system­übergreifende Interoperabilitäts-Schnittstelle ist (analog zu W3C DID Core), nicht Teil der internen App-API.

- **Frontend:** https://vps.recordweb.dev/antwortmanagement/
- **OpenAPI:** https://vps.recordweb.dev/antwortmanagement/api-docs/

> Aktueller Ausbaustand: Login und Antwort-Lebenszyklus (Draft → Finalized). Das
> Case-Konzept und die LDN-Anbindung an das Fragenmanagement folgen in einem
> späteren Schritt.

---

## Records

### Alle Antworten auflisten (inkl. Drafts)
```
GET /antwortmanagement/api/records
```
```bash
curl "https://vps.recordweb.dev/antwortmanagement/api/records"
```

### Draft anlegen
```
POST /antwortmanagement/api/records
```
```bash
curl -X POST "https://vps.recordweb.dev/antwortmanagement/api/records" \
  -H "Content-Type: application/json" \
  -d '{
    "recordType": "did:rwp:b7d4c810:schema:fragestunde-antwort",
    "owner": "did:rwp:b7d4c810:users/sandra-huber",
    "payload": {
      "antworttext": "Testantwort",
      "frage_did": "did:rwp:a3f9e21c:records:56a2d6a6-cb2e-41b3-bee3-f443289d977f",
      "frage_snapshot_hash": "sha256:e3f1a2b9c4d5e6f7a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
      "bundesrat_did": "did:rwp:b7d4c810:users/sandra-huber",
      "beantwortet_am": "2026-09-10T09:42:00.000Z"
    }
  }'
```
Antwort: `201`, vollständiger Record mit `did` und Snapshot-Daten.

### Draft bearbeiten (nur solange `state: draft`)
```
PUT /antwortmanagement/api/records/{did}
```
```bash
curl -X PUT "https://vps.recordweb.dev/antwortmanagement/api/records/<DID>" \
  -H "Content-Type: application/json" \
  -d '{"payload": {"antworttext": "Aktualisierte Antwort", "frage_did": "did:rwp:a3f9e21c:records:56a2d6a6-cb2e-41b3-bee3-f443289d977f", "frage_snapshot_hash": "sha256:e3f1a2b9c4d5e6f7a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6", "bundesrat_did": "did:rwp:b7d4c810:users/sandra-huber", "beantwortet_am": "2026-09-10T09:42:00.000Z"}}'
```

### Finalisieren (JSON-Repräsentation)
```
PUT /antwortmanagement/api/records/{did}/finalize
```
```bash
curl -X PUT "https://vps.recordweb.dev/antwortmanagement/api/records/<DID>/finalize"
```
Unwiderruflich. Berechnet den `snapshotHash`.

### Neue Version starten (nur ab `state: finalized`)
```
POST /antwortmanagement/api/records/{did}/new-version
```
```bash
curl -X POST "https://vps.recordweb.dev/antwortmanagement/api/records/<DID>/new-version" \
  -H "Content-Type: application/json" \
  -d '{"correctionReason": "Tippfehler korrigiert"}'
```
Erzeugt einen neuen Draft-Snapshot mit `parents`-Referenz auf den vorherigen Snapshot.

### Historie eines Records
```
GET /antwortmanagement/api/records/{did}/history
```
```bash
curl "https://vps.recordweb.dev/antwortmanagement/api/records/<DID>/history"
```
Liefert alle Snapshots (Version-Graph) chronologisch aufsteigend.

### Einzelne Antwort lesen (nur wenn finalisiert)
```
GET /antwortmanagement/api/records/{did}
```
```bash
curl "https://vps.recordweb.dev/antwortmanagement/api/records/<DID>"
```
`403`, falls Record noch `draft` ist — Drafts sind extern nicht sichtbar.

---

## DID-Resolver

### DID auflösen
```
GET /antwortmanagement/did/{did}
```
```bash
curl -i "https://vps.recordweb.dev/antwortmanagement/did/<DID>"
```
Antwort: `200` mit DID-Dokument (inkl. `recordEndpoint`, `currentVersion`, `controller`) oder `404` mit `{"error": "DID unbekannt"}`.

---

## Sonstige Endpunkte

### Server-Logs abrufen (letzte 100)
```
GET /antwortmanagement/api/logs
```

### Health-Check
```
GET /health
```

---

## Datenhaltung

Das Antwortmanagement nutzt dieselbe PoC-Postgres-Instanz wie das Fragenmanagement,
legt seine Tabellen (`records`, `record_snapshots`, `server_logs`) aber im eigenen
Postgres-Schema `antwortmanagement` ab. Damit bleiben Frage- und Antwort-Records
sauber getrennt, ohne dass eine zweite Datenbank nötig ist.

---

## Hinweis zur DID-Kodierung in URLs

DIDs enthalten Doppelpunkte (`:`), die in URL-Pfad-Segmenten technisch erlaubt sind und **nicht** URL-encodiert werden müssen, wenn du sie direkt in `curl` einsetzt. Der Server dekodiert intern via `decodeURIComponent`, falls doch encodiert übergeben wird (z.B. `did%3Arwp%3A...`).
