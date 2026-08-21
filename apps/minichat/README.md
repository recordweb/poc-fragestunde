# MiniChat

MiniChat ist eine bewusst minimale Fachanwendung im RecordWeb-PoC Fragestunde. Sie demonstriert die standardisierte Systemintegration zwischen einer fachlichen Chat-Anwendung und SoX.

MiniChat ist kein produktiver Messenger und keine Benutzerverwaltung. Sein Zweck ist, einen operativen Gesprächsverlauf zu erzeugen, den vollständigen aktuellen Stand als strukturierten JSON-Payload an SoX zu übergeben und dadurch RWP-Versionierung demonstrierbar zu machen.

## Verantwortung

| Aufgabe | Zuständigkeit |
|---|---|
| SoX-Record-DID und Snapshot-Versionen | SoX |
| Case führen und Records verlinken | Antwortmanagement |
| Conversation-ID, Nachrichten und vollständigen Chat-Stand führen | MiniChat |
| Entscheidung über die Vollständigkeit eines Chat-Stands | MiniChat |
| Prüfung verlinkter Records bei Case-Finalisierung | Antwortmanagement |

MiniChat kennt die SoX-DID und den SoX-Submission-Endpunkt. MiniChat kennt keine SoX-Datenbanktabellen und keine Case-Persistenz.

## Ablauf

```text
SoX
  │ RecordWorkOrder
  ▼
MiniChat
  │ erzeugt Conversation-ID und leeren Chat
  │
  │ Benutzer erfasst Nachrichten
  │
  │ vollständiger RecordSubmission-Payload
  ▼
SoX
  │ erzeugt finalisierten Snapshot
  ▼
Antwortmanagement
  │ prüft den Record beim Case-Finalisieren selbst
```

## Benutzeroberfläche

MiniChat ist erreichbar unter:

```text
https://vps.recordweb.dev/minichat/
```

Ein Benutzer kann:

1. eine dreistellige Conversation-ID eingeben und einen bestehenden Chat laden;
2. Name und Nachricht erfassen;
3. den gesamten Chat-Stand an SoX finalisieren;
4. über „Bestehende Chats anzeigen“ lokal bekannte Conversations auflisten und laden.

Die UI startet keine Chats automatisch aus Antwortmanagement oder SoX. Dies ist absichtlich: Wie Fachanwendungen Benutzer über neue Vorgänge informieren oder in einen Vorgang führen, ist eine fach- und organisationsspezifische Entscheidung ausserhalb des RWP-Kerns.

## Persistenz

MiniChat speichert Conversations in PostgreSQL in einer Tabelle:

```text
minichat_conversations
```

Jede Conversation enthält:

| Feld | Bedeutung |
|---|---|
| `conversation_id` | Dreistellige fachanwendungsinterne ID, z. B. `pGX` |
| `sox_record_did` | Zuordnung zum SoX-Record |
| `sox_submission_endpoint` | Ziel für die RecordSubmission |
| `title` | Titel aus dem Work Order |
| `case_reference` | Fachlicher Case-Kontext aus dem Work Order |
| `messages` | Vollständiger Gesprächsverlauf als JSONB |
| `last_submitted_at` | Zeitpunkt der letzten erfolgreichen Übergabe an SoX |

`conversation_id` und SoX-DID sind unterschiedliche Identitäten. Die dreistellige ID dient ausschliesslich dem MiniChat; die DID ist die dauerhafte RWP-Identität des Records.

## API

| Methode | Endpunkt | Funktion |
|---|---|---|
| `GET` | `/health` | Health Check |
| `POST` | `/api/work-orders` | RecordWorkOrder von SoX entgegennehmen |
| `GET` | `/api/conversations` | Alle MiniChat-Conversations auflisten |
| `GET` | `/api/conversations/:conversationId` | Conversation laden |
| `POST` | `/api/conversations/:conversationId/messages` | Nachricht hinzufügen |
| `POST` | `/api/conversations/:conversationId/finalize` | Vollständigen Chat an SoX übergeben |

## RecordWorkOrder

SoX übergibt einen Auftrag zum Erzeugen einer lokalen Conversation:

```http
POST /api/work-orders
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

MiniChat prüft:

- `messageType: "rwp.record-work-order"`;
- `messageVersion: "1.0"`;
- `operation: "create"`;
- SoX-Record-DID;
- Titel;
- Case-Referenz;
- Submission-Endpunkt.

Bei Erfolg generiert MiniChat eine freie dreistellige Conversation-ID mit Zeichen aus `A-Z`, `a-z` und `0-9`. Dies ergibt \(62^3 = 238328\) mögliche IDs.

Antwort:

```json
{
  "accepted": true,
  "conversationId": "pGX",
  "systemEndpoint": "https://vps.recordweb.dev/minichat/"
}
```

Wird derselbe Work Order erneut zugestellt, antwortet MiniChat idempotent mit der bereits vorhandenen Conversation-ID:

```json
{
  "accepted": true,
  "alreadyExists": true,
  "conversationId": "pGX",
  "systemEndpoint": "https://vps.recordweb.dev/minichat/"
}
```

## RecordSubmission

Beim Klick auf „An SoX finalisieren“ sendet MiniChat immer den vollständigen bisherigen Gesprächsverlauf:

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

MiniChat sendet keine Deltas. Die vollständige inhaltliche Repräsentation ist Aufgabe der Fachanwendung. SoX muss keinen Gesprächsverlauf aus einzelnen Snippets zusammensetzen.

Nach jeder erfolgreichen Übergabe kann weitergeschrieben werden. Eine weitere Finalisierung übergibt wieder den vollständigen Stand; SoX erzeugt daraus eine neue finale Version desselben Records.

## Betrieb

| Variable | Beispiel | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `POSTGRES_HOST` | `db` | PostgreSQL-Host |
| `POSTGRES_PORT` | `5432` | PostgreSQL-Port |
| `POSTGRES_DB` | `poc_db` | Datenbank |
| `POSTGRES_USER` | `poc_user` | Datenbankbenutzer |
| `POSTGRES_PASSWORD` | gemäss Compose | Datenbankpasswort |
| `PUBLIC_BASE_URL` | `https://vps.recordweb.dev` | Öffentliche Basis-URL |
| `MINICHAT_SYSTEM_ENDPOINT` | `https://vps.recordweb.dev/minichat/` | Im Payload deklarierte Fachanwendungs-URL |

## Grenzen des PoC

- Keine Authentisierung oder Zugriffskontrolle.
- Keine Benutzerverwaltung.
- Nur Textnachrichten.
- Keine Anhänge, Threads, Reaktionen oder Bearbeitung von Nachrichten.
- Keine Ende-zu-Ende-Verschlüsselung.
- Keine produktive Archivierungs- oder Aufbewahrungslogik ausserhalb der SoX-Übergabe.