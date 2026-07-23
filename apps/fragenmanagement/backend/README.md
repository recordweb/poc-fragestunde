# Fragenmanagement — Backend API

Kurzreferenz für alle Endpunkte des Fragenmanagement-Backends (RecordWeb PoC).
Alle Pfade sind relativ zu `https://vps.recordweb.dev`.

## Basis-Konfiguration

- **API-Basis:** `/fragenmanagement/api/records`
- **DID-Resolver:** `/fragenmanagement/did/`
- **Namespace:** `did:rwp:a3f9e21c`
- **Record-Typ:** `did:rwp:a3f9e21c:schema:fragestunde-frage`

> Hinweis zur Pfad-Struktur
>
>`/fragenmanagement/api/*` bündelt alle internen Anwendungs-Endpunkte (Records, Notifications, Logs).  
>`/fragenmanagement/did/*` ist bewusst getrennt davon, da DID-Auflösung eine system­übergreifende Interoperabilitäts-Schnittstelle ist (analog zu W3C DID Core), nicht Teil der internen App-API.

- **Frontend:** https://vps.recordweb.dev/fragenmanagement/
- **OpenAPI:** https://vps.recordweb.dev/fragenmanagement/api-docs/

---

## Records

### Alle Records auflisten (inkl. Drafts)
```
GET /fragenmanagement/api/records
```
```bash
curl "https://vps.recordweb.dev/fragenmanagement/api/records"
```

### Draft anlegen
```
POST /fragenmanagement/api/records
```
```bash
curl -X POST "https://vps.recordweb.dev/fragenmanagement/api/records" \
  -H "Content-Type: application/json" \
  -d '{
    "recordType": "did:rwp:a3f9e21c:schema:fragestunde-frage",
    "owner": "did:rwp:f2c81e05:self",
    "payload": {
      "fragetext": "Testfrage",
      "session": "Herbstsession 2026",
      "parlamentarier_did": "did:rwp:f2c81e05:self",
      "eingereicht_am": "2026-07-23T13:00:00.000Z"
    }
  }'
```
Antwort: `201`, vollständiger Record mit `did` und Snapshot-Daten.

### Draft bearbeiten (nur solange `state: draft`)
```
PUT /fragenmanagement/api/records/{did}
```
```bash
curl -X PUT "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>" \
  -H "Content-Type: application/json" \
  -d '{"payload": {"fragetext": "Aktualisierte Frage", "session": "Herbstsession 2026", "parlamentarier_did": "did:rwp:f2c81e05:self", "eingereicht_am": "2026-07-23T13:00:00.000Z"}}'
```

### Finalisieren (JSON-Repräsentation)
```
PUT /fragenmanagement/api/records/{did}/finalize
```
```bash
curl -X PUT "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>/finalize"
```
Unwiderruflich. Berechnet `snapshotHash`, versendet LDN-Notification.

### Finalisieren als PDF (Multi-Representation)
```
PUT /fragenmanagement/api/records/{did}/finalize-pdf
```
```bash
curl -X PUT "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>/finalize-pdf"
```
Erzeugt zusätzlich eine PDF-Repräsentation, JSON-Quelle bleibt erhalten.

### Neue Version starten (nur ab `state: finalized`)
```
POST /fragenmanagement/api/records/{did}/new-version
```
```bash
curl -X POST "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>/new-version" \
  -H "Content-Type: application/json" \
  -d '{"correctionReason": "Tippfehler korrigiert"}'
```
Erzeugt einen neuen Draft-Snapshot mit `parents`-Referenz auf den vorherigen Snapshot.

### Historie eines Records
```
GET /fragenmanagement/api/records/{did}/history
```
```bash
curl "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>/history"
```
Liefert alle Snapshots (Version-Graph) chronologisch aufsteigend.

### Einzelnen Record lesen (nur wenn finalisiert)
```
GET /fragenmanagement/api/records/{did}
```
```bash
curl "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>"
```
`403`, falls Record noch `draft` ist — Drafts sind extern nicht sichtbar.

---

## Solid-Pod-Links

### Link erstellen (nur bei finalisierten Records)
```
POST /fragenmanagement/api/records/{did}/solid-link
```
```bash
curl -X POST "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>/solid-link" \
  -H "Content-Type: application/json" \
  -d '{"podUrl": "https://bernasconi.solidpod.ch/fragestunde/", "linkedBy": "did:rwp:f2c81e05:self"}'
```

### Alle Links eines Records abrufen
```
GET /fragenmanagement/api/records/{did}/solid-links
```
```bash
curl "https://vps.recordweb.dev/fragenmanagement/api/records/<DID>/solid-links"
```

---

## DID-Resolver

### DID auflösen
```
GET /fragenmanagement/did/{did}
```
```bash
curl -i "https://vps.recordweb.dev/fragenmanagement/did/<DID>"
```
Antwort: `200` mit DID-Dokument (inkl. `recordEndpoint`, `currentVersion`, `controller`) oder `404` mit `{"error": "DID unbekannt"}`.

---

## Sonstige Endpunkte

### LDN-Notifications abrufen
```
GET /fragenmanagement/api/notifications
```

### Server-Logs abrufen (letzte 100)
```
GET /fragenmanagement/api/logs
```

### Health-Check
```
GET /health
```

---

## Hinweis zur DID-Kodierung in URLs

DIDs enthalten Doppelpunkte (`:`), die in URL-Pfad-Segmenten technisch erlaubt sind und **nicht** URL-encodiert werden müssen, wenn du sie direkt in `curl` einsetzt. Der Server dekodiert intern via `decodeURIComponent`, falls doch encodiert übergeben wird (z.B. `did%3Arwp%3A...`).
