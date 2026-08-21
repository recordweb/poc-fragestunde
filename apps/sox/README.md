# SoX – System of X

SoX ist im PoC **Fragestunde** die RecordWeb-kompatible Record-Perspektive auf fachliche Kollaborations- und Kommunikationssysteme.

SoX ist weder das System of Work noch die Chat-Anwendung selbst. Es verwaltet die RWP-Identität, die finalisierten Versionen und die auflösbare Record-Repräsentation von Inhalten, die aus einer externen Fachanwendung stammen. Im aktuellen PoC sind dies `MiniChat` und vorbereitend `TeamsChat`.

## Rolle im PoC

SoX trennt drei Verantwortlichkeiten:

| Verantwortlichkeit | Zuständiges System |
|---|---|
| Case führen, Records verknüpfen und Case finalisieren | Antwortmanagement |
| Operativen Chat führen und vollständigen Gesprächsstand bestimmen | MiniChat bzw. später TeamsChat |
| RWP-DID, Snapshot-Versionen, Resolver und Record-Repräsentation führen | SoX |

Ein Case verlinkt einen SoX-Record zunächst als `workingLink`. Der Case-Custodian prüft beim Finalisierungsversuch selbst über DID-Auflösung, ob der verlinkte Record finalisiert ist. Nur dann wird der Link als Hard Link mit dem konkreten `snapshotHash` in den Case übernommen.

SoX informiert das Antwortmanagement nicht per Callback über neue Versionen. Der Case-Custodian bleibt für die Prüfung seiner Verlinkungen verantwortlich.

## Umgesetzter Ablauf

```text
Antwortmanagement
  │
  │ POST /sox/api/records
  │ { recordType, title, caseReference }
  ▼
SoX
  │
  │ 1. erzeugt RWP-Draft mit DID
  │ 2. speichert Draft unabhängig von der Fachanwendung
  │ 3. sendet einen RecordWorkOrder an den konfigurierten Chat-Endpunkt
  ▼
MiniChat oder TeamsChat-Adapter
  │
  │ erzeugt lokale Conversation-ID und verwaltet den Chat
  │
  │ bei "Finalisieren":
  │ PUT /sox/api/records/:id/submissions
  │ vollständiger RecordSubmission-Payload
  ▼
SoX
  │
  │ 1. validiert die Submission
  │ 2. erzeugt finalisierten Snapshot
  │ 3. behält dieselbe DID
  │ 4. bildet bei jeder weiteren Submission eine neue Version
  ▼
Antwortmanagement
  │
  │ prüft beim Case-Finalisieren selbst die DID und den aktuellen Record
  │ und setzt bei finalisierten Records Hard Links auf Snapshot-Hashes
  ▼
finalisierter Case
```

## Record-Identität

SoX verwendet den Namespace:

```text
s73f42a3
```

DIDs werden analog zu Fragenmanagement und Antwortmanagement gebildet:

```text
did:rwp:s73f42a3:records:<uuid>
```

Beispiel:

```text
did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966
```

Die SoX-DID und eine fachanwendungsinterne Conversation-ID sind bewusst unterschiedliche Identitäten:

| Identität | Beispiel | Verantwortliches System |
|---|---|---|
| RWP-Record-DID | `did:rwp:s73f42a3:records:<uuid>` | SoX |
| Conversation-ID | `pGX` | MiniChat bzw. TeamsChat |

## Record-Zustände und Versionen

Ein neuer SoX-Record startet als Draft:

```json
{
  "status": "draft",
  "version": 0,
  "payload": {
    "source": {
      "system": "MiniChat",
      "conversationId": null,
      "workOrderStatus": "pending"
    },
    "conversation": {
      "participants": [],
      "messages": []
    }
  }
}
```

Nach einer erfolgreichen Submission wird ein finalisierter Snapshot erzeugt:

```json
{
  "status": "finalized",
  "version": 1,
  "snapshotHash": "sha256:...",
  "payload": {
    "conversation": {
      "conversationId": "pGX",
      "messages": []
    }
  }
}
```

Eine spätere Submission desselben fachlichen Chats erzeugt eine neue finale Version mit:

- derselben Record-DID;
- einer erhöhten Versionsnummer;
- einem neuen `snapshotHash`;
- einem Parent-Verweis auf den bisher aktuellen finalisierten Snapshot;
- dem vollständigen, neuen Gesprächsstand.

Finalisierte Snapshots werden nicht verändert.

## Systemintegrationsnachrichten

### RecordWorkOrder: SoX an Fachanwendung

SoX sendet nach Erzeugung des Drafts einen Startauftrag an den konfigurierten API-Endpunkt der Fachanwendung:

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
    "did": "did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966",
    "recordType": "MiniChat",
    "title": "MiniChat zu Fragestunde-Case"
  },
  "caseReference": {
    "system": "antwortmanagement",
    "caseId": "did:rwp:b7d4c810:records:...",
    "uri": "https://vps.recordweb.dev/antwortmanagement/api/cases/did%3Arwp%3A..."
  },
  "submission": {
    "endpoint": "https://vps.recordweb.dev/sox/api/records/f0158594-d7cc-4174-b8f8-c75d70dd6966/submissions",
    "method": "PUT",
    "contentType": "application/json"
  }
}
```

Die Fachanwendung antwortet mindestens mit:

```json
{
  "accepted": true,
  "conversationId": "pGX",
  "systemEndpoint": "https://vps.recordweb.dev/minichat/"
}
```

SoX speichert die Conversation-ID und den Zustellstatus in seinem Draft-Payload.

### RecordSubmission: Fachanwendung an SoX

Beim fachlichen Finalisieren übergibt die Fachanwendung immer den **vollständigen** aktuellen Stand der Conversation:

```http
PUT /sox/api/records/:id/submissions
Content-Type: application/json
```

```json
{
  "messageType": "rwp.record-submission",
  "messageVersion": "1.0",
  "recordDid": "did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966",
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
    "messages": [
      {
        "id": "pGX-001",
        "createdAt": "2026-08-21T09:34:42.907Z",
        "author": {
          "id": "manual:nik",
          "displayName": "Nik"
        },
        "content": {
          "format": "text/plain; charset=utf-8",
          "text": "Was meint MeteoSchweiz?"
        }
      }
    ]
  }
}
```

Die Submission ist unabhängig davon, ob sie die erste oder eine spätere Version des Records darstellt. SoX bestimmt anhand der bekannten DID, ob ein erster finalisierter Snapshot oder eine Nachfolgeversion erzeugt wird.

## Fehlerbehandlung

Die Erzeugung des SoX-Drafts und die Zustellung des Work Orders sind getrennte Schritte:

1. SoX persistiert den Draft.
2. SoX versucht den Work Order an die Fachanwendung zuzustellen.
3. Bei einer fehlgeschlagenen Zustellung bleibt der SoX-Draft bestehen.
4. Der Draft enthält den Zustellstatus `failed` und einen technischen Fehlerhinweis.
5. Die Antwortmanagement-Verknüpfung kann trotzdem bestehen bleiben.

Dadurch wird die dauerhafte RWP-Identität nicht von der temporären Verfügbarkeit eines integrierten Systems abhängig.

## Resolver

SoX stellt ein DID-Dokument bereit:

```text
GET /sox/did/<vollständige-URL-kodierte-DID>
```

Beispiel:

```text
GET /sox/did/did%3Arwp%3As73f42a3%3Arecords%3Af0158594-d7cc-4174-b8f8-c75d70dd6966
```

Das DID-Dokument enthält insbesondere:

```json
{
  "id": "did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966",
  "recordEndpoint": "https://vps.recordweb.dev/sox/api/records/f0158594-d7cc-4174-b8f8-c75d70dd6966",
  "currentVersion": "sha256:..."
}
```

Der Einzelrecord liefert bei finalisierten Records zusätzlich `snapshotHash`.

## Endpunkte

| Endpunkt | Funktion |
|---|---|
| `GET /health` | Health Check |
| `POST /api/records` | SoX-Draft erzeugen und Work Order zustellen |
| `GET /api/records` | Alle SoX-Records auflisten |
| `GET /api/records/:id` | Aktuellen Record mit Payload lesen |
| `GET /api/records/:id/history` | Finale Snapshot-Historie eines Records lesen |
| `PUT /api/records/:id/submissions` | Vollständigen fachlichen Stand übernehmen und finalisieren |
| `GET /api/settings` | Konfigurierte Chat-Endpunkte lesen |
| `PUT /api/settings` | Chat-Endpunkte konfigurieren |
| `GET /did/:id` | DID-Dokument mit `recordEndpoint` liefern |
| `GET /api-docs` | Swagger UI |

## Betrieb und Konfiguration

| Variable | Beispiel | Zweck |
|---|---|---|
| `PORT` | `3000` | HTTP-Port des SoX-Backends |
| `POSTGRES_HOST` | `db` | PostgreSQL-Host |
| `POSTGRES_PORT` | `5432` | PostgreSQL-Port |
| `POSTGRES_DB` | `poc_db` | Datenbank |
| `POSTGRES_USER` | `poc_user` | Datenbankbenutzer |
| `POSTGRES_PASSWORD` | gemäss Compose | Datenbankpasswort |
| `SOX_DID_NAMESPACE` | `s73f42a3` | SoX-DID-Namespace |
| `PUBLIC_BASE_URL` | `https://vps.recordweb.dev` | Öffentliche Basis-URL für DID- und Submission-URLs |

Chat-Endpunkte werden über das SoX-Frontend persistiert konfiguriert:

| Einstellung | Wert im PoC |
|---|---|
| MiniChat-Endpunkt | `https://vps.recordweb.dev/minichat/api` |
| TeamsChat-Endpunkt | noch durch Teams-Adapter zu liefern |

Der konfigurierte Endpunkt ist ein **API-Endpunkt**, nicht zwingend die menschliche Web-Oberfläche.

## Aufruf

```text
https://vps.recordweb.dev/sox/
https://vps.recordweb.dev/sox/api/records
https://vps.recordweb.dev/sox/api-docs/
```

## Noch offen

- TeamsChat-Adapter gemäss `STORY_TeamsChat.md`.
- Authentisierung und Autorisierung zwischen SoX und Fachanwendungen.
- Signaturen nach RWP-Signaturmodell.
- Retry- und Zustellungsprotokoll für fehlgeschlagene Work Orders.
- Produktionsreife SchemaRecord-Definitionen für `MiniChat` und `TeamsChat`.
- Generische, normative RWP-Systemintegrationsschnittstelle.