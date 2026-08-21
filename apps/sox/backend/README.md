# SoX Backend

Backend des **System of X (SoX)** im RecordWeb-PoC Fragestunde.

SoX ist ein RWP-nahes System, das Records aus externen Fachanwendungen als eigene RWP-Records verwaltet. Es führt die Record-DID, die finale Snapshot-Historie, die Record-Auflösung und die Systemintegrationsschnittstelle. Es führt nicht den operativen Chat selbst.

## Architektur

```text
Antwortmanagement
  │ POST /api/records
  ▼
SoX
  │ POST <Fachanwendung>/work-orders
  ▼
MiniChat / TeamsChat-Adapter
  │ PUT /api/records/:id/submissions
  ▼
SoX
```

SoX greift nicht direkt auf Tabellen von Antwortmanagement, MiniChat oder TeamsChat zu. Die Integration erfolgt ausschliesslich über HTTP/JSON-Nachrichten.

## Persistenz

SoX verwendet folgende Tabellen:

| Tabelle | Inhalt |
|---|---|
| `sox_records` | Aktueller Zustand eines SoX-Records, inklusive Draft-Payload, Work-Order-Status und aktuelle Versionsnummer |
| `sox_record_snapshots` | Unveränderliche finalisierte Snapshots eines SoX-Records |
| `sox_settings` | Konfiguration der API-Endpunkte für MiniChat und TeamsChat |

Ein finalisierter Snapshot enthält unter anderem:

- `snapshot_hash`;
- Record-ID und DID;
- Versionsnummer;
- Parent-Hashes;
- vollständigen Payload;
- Payload-Hash;
- Payload-Format;
- Erstellungs- und Finalisierungszeitpunkt.

## DID

SoX verwendet:

```text
did:rwp:s73f42a3:records:<uuid>
```

Beispiel:

```text
did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966
```

`GET /did/:id` akzeptiert sowohl die interne UUID als auch die vollständige URL-kodierte DID.

## HTTP-API

| Methode | Endpunkt | Funktion |
|---|---|---|
| `GET` | `/health` | Health Check |
| `POST` | `/api/records` | SoX-Draft erzeugen und Work Order zustellen |
| `GET` | `/api/records` | Alle aktuellen Records auflisten |
| `GET` | `/api/records/:id` | Aktuellen Record lesen |
| `GET` | `/api/records/:id/history` | Finalisierte Snapshot-Historie lesen |
| `PUT` | `/api/records/:id/submissions` | RecordSubmission übernehmen und neuen finalen Snapshot erzeugen |
| `GET` | `/api/settings` | Chat-Endpunkte lesen |
| `PUT` | `/api/settings` | Chat-Endpunkte speichern |
| `GET` | `/did/:id` | DID-Dokument liefern |
| `GET` | `/api-docs` | Swagger UI |

## Record erzeugen

```http
POST /api/records
Content-Type: application/json
```

```json
{
  "recordType": "MiniChat",
  "title": "MiniChat zu Fragestunde-Case",
  "caseReference": {
    "system": "antwortmanagement",
    "caseId": "did:rwp:b7d4c810:records:...",
    "uri": "https://vps.recordweb.dev/antwortmanagement/api/cases/did%3Arwp%3A..."
  }
}
```

SoX erzeugt einen Draft und versucht anschliessend den Work Order an den für den RecordType konfigurierten API-Endpunkt zuzustellen.

Die Antwort enthält den SoX-Record. In `payload.source` ist der Zustand der Zustellung sichtbar:

```json
{
  "workOrderStatus": "delivered",
  "workOrderError": null,
  "conversationId": "pGX",
  "workOrderDeliveredAt": "2026-08-21T09:33:51.222Z"
}
```

Bei nicht verfügbarer Fachanwendung bleibt der Draft bestehen; `workOrderStatus` wird auf `failed` gesetzt.

## RecordWorkOrder

SoX sendet:

```http
POST <chatEndpoint>/work-orders
Content-Type: application/json
```

```json
{
  "messageType": "rwp.record-work-order",
  "messageVersion": "1.0",
  "operation": "create",
  "issuedAt": "2026-08-21T09:33:51.000Z",
  "record": {
    "did": "did:rwp:s73f42a3:records:...",
    "recordType": "MiniChat",
    "title": "MiniChat zu Fragestunde-Case"
  },
  "caseReference": {
    "system": "antwortmanagement",
    "caseId": "did:rwp:b7d4c810:records:...",
    "uri": "https://vps.recordweb.dev/antwortmanagement/api/cases/did%3Arwp%3A..."
  },
  "submission": {
    "endpoint": "https://vps.recordweb.dev/sox/api/records/<id>/submissions",
    "method": "PUT",
    "contentType": "application/json"
  }
}
```

Die Fachanwendung muss mindestens eine `conversationId` zurückgeben:

```json
{
  "accepted": true,
  "conversationId": "pGX",
  "systemEndpoint": "https://vps.recordweb.dev/minichat/"
}
```

## RecordSubmission

Eine Fachanwendung übergibt den vollständigen aktuellen Fachstand:

```http
PUT /api/records/:id/submissions
Content-Type: application/json
```

```json
{
  "messageType": "rwp.record-submission",
  "messageVersion": "1.0",
  "recordDid": "did:rwp:s73f42a3:records:...",
  "submittedAt": "2026-08-21T09:34:50.000Z",
  "payloadFormat": "application/json",
  "payload": {
    "conversationId": "pGX",
    "title": "MiniChat zu Fragestunde-Case",
    "system": {
      "type": "MiniChat",
      "endpoint": "https://vps.recordweb.dev/minichat/"
    },
    "participants": [],
    "messages": []
  }
}
```

SoX validiert:

- `messageType` und `messageVersion`;
- Übereinstimmung von `recordDid` und SoX-Record;
- `payloadFormat: application/json`;
- vollständige Conversation-Struktur;
- `conversationId` gegen die beim Work Order bekannte ID;
- Nachrichtenstruktur und Klartext-MIME-Typ.

Bei Erfolg erzeugt SoX einen finalisierten Snapshot. Jede weitere gültige Submission erzeugt eine Folgeversion mit gleicher DID und Parent-Verweis auf den zuvor finalisierten Snapshot.

## Auflösung

DID-Auflösung erfolgt zweistufig:

```text
GET /did/<vollständige-DID>
  → DID-Dokument mit recordEndpoint und currentVersion

GET <recordEndpoint>
  → aktueller SoX-Record mit payload und bei finalen Records snapshotHash
```

## Konfiguration

| Variable | Beispiel |
|---|---|
| `PORT` | `3000` |
| `POSTGRES_HOST` | `db` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | `poc_db` |
| `POSTGRES_USER` | `poc_user` |
| `POSTGRES_PASSWORD` | gemäss Compose-Konfiguration |
| `SOX_DID_NAMESPACE` | `s73f42a3` |
| `PUBLIC_BASE_URL` | `https://vps.recordweb.dev` |

Die Fachanwendungsendpunkte werden über `/api/settings` gespeichert. Für MiniChat ist dies im PoC:

```text
https://vps.recordweb.dev/minichat/api
```

## Grenzen des PoC

- Keine Authentisierung der beteiligten Systeme.
- Keine kryptographische Owner-Signatur.
- Kein Retry-Protokoll für fehlgeschlagene Work Orders.
- Keine persistente Zustellungswarteschlange.
- Keine produktive SchemaRecord-Publikation für die konkreten Chat-RecordTypes.
- Kein automatischer Callback an den Case-Custodian: Dieser prüft die verlinkten Records selbst beim Finalisierungsentscheid.