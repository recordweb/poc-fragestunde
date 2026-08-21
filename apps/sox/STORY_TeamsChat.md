# User Story: TeamsChat-Adapter für SoX

## Basis
https://recordweb.github.io/rwp

## Ziel

Als verantwortliches Fachteam für Microsoft Teams möchte ich einen TeamsChat-Adapter entwickeln, der ausgewählte Teams-Unterhaltungen als RecordWeb-konforme SoX-Records repräsentiert. Der Adapter soll einen Startauftrag von SoX entgegennehmen, einen fachanwendungsspezifischen Gesprächskontext führen oder referenzieren und bei einer fachlich ausgelösten Finalisierung einen vollständigen strukturierten Conversation-Snapshot an SoX übergeben.

Der Adapter soll nicht die RecordWeb-Versionierung, Case-Verlinkung oder DID-Verwaltung selbst implementieren. Diese Aufgaben liegen bei SoX beziehungsweise beim Case-Custodian.

## Fachlicher Kontext

Im PoC Fragestunde werden parlamentarische Fragen im Fragenmanagement erstellt und per LDN an das Antwortmanagement übermittelt. Das Antwortmanagement führt zu einer Frage einen Case. Ein Case ist ein eigenständiger RWP-Record und enthält keine fremden Payloads; er verlinkt andere Records.

Ein TeamsChat kann einen Bearbeitungsschritt dokumentieren, beispielsweise:

- Abstimmung innerhalb einer Bundesstelle;
- Klärung von Fakten;
- Koordination einer Antwort;
- Austausch mit einem Fachamt;
- Vorbereitung eines Entscheids.

Der Case verlinkt den zugehörigen SoX-Record zunächst als `softLink`. Ein `softLink` darf auf einen Draft zeigen. Beim Finalisieren des Cases prüft das Antwortmanagement den aktuellen Zustand der verlinkten Records selbst über deren DIDs. Ein finalisierter TeamsChat-Record wird dann als `hardLink` mit Snapshot-Hash nach `process` übernommen.

```text
Fragestunde-Frage
  │ Hard Link
  ▼
Case im Antwortmanagement
  │ softLink, targetField: process
  ▼
SoX-TeamsChat-Record
  │ RecordWorkOrder
  ▼
TeamsChat-Adapter
  │ RecordSubmission mit vollständigem Chat-Stand
  ▼
SoX finalisierter Snapshot
  │ DID-Auflösung beim Case-Finalisieren
  ▼
Case-Hard-Link nach process
```

## Verantwortlichkeiten

| Verantwortlichkeit | Zuständiges System |
|---|---|
| Teams-Chat lesen, berechtigen und in ein kanonisches Payload-Modell abbilden | TeamsChat-Adapter |
| Vollständigkeit des übergebenen Teams-Gesprächs bestimmen | TeamsChat-Adapter |
| RWP-DID erzeugen und verwalten | SoX |
| Snapshot-Hash, Versionierung und finale Record-Repräsentation führen | SoX |
| Case führen, Links prüfen und Case finalisieren | Antwortmanagement |
| Benutzerinformation, Deep Links und Teams-UI-Interaktion | Fachteam / Organisation |

Der Adapter darf SoX nicht direkt über Datenbanktabellen integrieren. Die Integration erfolgt ausschliesslich über die hier beschriebenen HTTP/JSON-Nachrichten.

## Akzeptanzkriterien

Der TeamsChat-Adapter ist für den PoC fachlich ausreichend, wenn er:

1. einen gültigen `rwp.record-work-order` von SoX über HTTP annimmt;
2. die SoX-DID dauerhaft mit einem Teams-spezifischen Gesprächsobjekt korreliert;
3. Work Orders idempotent verarbeitet;
4. eine fachanwendungsinterne Conversation-ID oder Teams-Thread-ID an SoX zurückgibt;
5. bei einer expliziten fachlichen Aktion einen vollständigen aktuellen Conversation-Snapshot an SoX übergibt;
6. keine Nachrichten-Deltas an SoX übermittelt;
7. jede Teams-Nachricht mit stabiler ID, Autor, Zeitstempel und Inhalt abbildet;
8. die Submission gegen den von SoX im Work Order gelieferten Endpunkt sendet;
9. keinen Callback vom Case-System erwartet;
10. technische Fehler nachvollziehbar protokolliert.

## Nachricht 1: RecordWorkOrder

### Richtung und Transport

```text
SoX → TeamsChat-Adapter
POST <teamsChatApiEndpoint>/work-orders
Content-Type: application/json
Accept: application/json
```

Der in SoX konfigurierte TeamsChat-Endpunkt ist ein API-Endpunkt. Er ist nicht zwingend ein Teams-Deep-Link und nicht zwingend eine Benutzeroberfläche.

### Semantik

Der Startauftrag bedeutet:

> SoX hat einen RWP-Draft mit der angegebenen DID erzeugt. Erzeuge oder korreliere in deiner Fachanwendung einen operativen Gesprächskontext. Verwende die angegebene Submission-URL für jeden späteren vollständigen Gesprächsstand.

Der Auftrag löst keine Benutzerbenachrichtigung, keine automatische Teams-Öffnung und keinen vorgeschriebenen UI-Mechanismus aus. Wie Nutzer in Teams oder einer Fachanwendung auf den Vorgang aufmerksam werden, liegt ausserhalb dieser Schnittstelle.

### Request

```json
{
  "messageType": "rwp.record-work-order",
  "messageVersion": "1.0",
  "operation": "create",
  "issuedAt": "2026-08-21T09:33:51.000Z",
  "record": {
    "did": "did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966",
    "recordType": "TeamsChat",
    "title": "TeamsChat zu Fragestunde-Case"
  },
  "caseReference": {
    "system": "antwortmanagement",
    "caseId": "did:rwp:b7d4c810:records:d6da6445-cc4b-4326-892f-147b22f0e9e0",
    "uri": "https://vps.recordweb.dev/antwortmanagement/api/cases/did%3Arwp%3Ab7d4c810%3Arecords%3Ad6da6445-cc4b-4326-892f-147b22f0e9e0"
  },
  "submission": {
    "endpoint": "https://vps.recordweb.dev/sox/api/records/f0158594-d7cc-4174-b8f8-c75d70dd6966/submissions",
    "method": "PUT",
    "contentType": "application/json"
  }
}
```

### Pflichtfelder

| JSON-Pfad | Typ | Bedeutung |
|---|---|---|
| `messageType` | String | Muss exakt `rwp.record-work-order` sein |
| `messageVersion` | String | Muss exakt `1.0` sein |
| `operation` | String | Muss aktuell `create` sein |
| `issuedAt` | ISO-8601-String | Erstellungszeitpunkt des Auftrags |
| `record.did` | DID-String | Dauerhafte RWP-Identität des künftigen TeamsChat-Records |
| `record.recordType` | String | Muss `TeamsChat` sein |
| `record.title` | String | Menschenlesbarer Titel |
| `caseReference.system` | String | Führendes Case-System |
| `caseReference.caseId` | DID-String | Identität des Case |
| `caseReference.uri` | URL | Auflösbare Case-Repräsentation; dient als Kontext, nicht als Callback-Ziel |
| `submission.endpoint` | URL | Autoritativer Zielendpunkt für RecordSubmission |
| `submission.method` | String | Im PoC `PUT` |
| `submission.contentType` | String | Im PoC `application/json` |

### Verhalten des Adapters

Der Adapter muss:

1. `messageType`, Version und Operation validieren.
2. Die SoX-DID als dauerhafte externe Korrelations-ID speichern.
3. Einen neuen Teams-Bezug erzeugen oder eine lokale Adapter-Conversation anlegen.
4. Die Submission-URL unverändert speichern.
5. Bei wiederholtem identischen Work Order dieselbe lokale Conversation wiederfinden.
6. Keine Teams-Daten an SoX senden, solange keine fachliche Finalisierung ausgelöst wurde.

### Erfolgsantwort

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "accepted": true,
  "conversationId": "teams:19:abc123@thread.v2",
  "systemEndpoint": "https://teams.microsoft.com/"
}
```

`conversationId` darf eine Teams-Thread-ID, eine Adapter-ID oder eine andere stabile, fachanwendungsinterne Referenz sein. Sie darf nicht mit der SoX-DID verwechselt werden.

### Idempotente Wiederholung

Bei erneutem Work Order für dieselbe `record.did` muss der Adapter keinen zweiten Teams-Vorgang erzeugen. Stattdessen:

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "accepted": true,
  "alreadyExists": true,
  "conversationId": "teams:19:abc123@thread.v2",
  "systemEndpoint": "https://teams.microsoft.com/"
}
```

### Fehlerantworten

| Status | Bedeutung |
|---|---|
| `400` | Nachricht syntaktisch oder semantisch ungültig |
| `401` / `403` | Absender nicht authentisiert oder nicht berechtigt |
| `409` | Auftrag widerspricht einer bestehenden Korrelationsbeziehung |
| `422` | Auftrag ist vollständig, aber fachlich nicht verarbeitbar |
| `500` | Interner Adapterfehler |
| `503` | Teams oder eine benötigte Abhängigkeit ist temporär nicht verfügbar |

Ein fehlgeschlagener Work Order macht den in SoX bereits bestehenden Draft nicht ungültig. SoX protokolliert den Zustellfehler.

## Nachricht 2: RecordSubmission

### Richtung und Transport

```text
TeamsChat-Adapter → SoX
PUT <submission.endpoint aus RecordWorkOrder>
Content-Type: application/json
Accept: application/json
```

### Semantik

Die Nachricht bedeutet:

> Der TeamsChat-Adapter übergibt den vollständigen, fachlich als vollständig bestimmten aktuellen Stand der Conversation für den angegebenen SoX-Record.

Die Nachricht unterscheidet nicht zwischen erster und späterer Übergabe. SoX erstellt mit jeder Submission eine neue finalisierte Version.

### Request

```json
{
  "messageType": "rwp.record-submission",
  "messageVersion": "1.0",
  "recordDid": "did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966",
  "submittedAt": "2026-08-21T09:34:50.000Z",
  "payloadFormat": "application/json",
  "payload": {
    "conversationId": "teams:19:abc123@thread.v2",
    "title": "TeamsChat zu Fragestunde-Case",
    "system": {
      "type": "TeamsChat",
      "endpoint": "https://teams.microsoft.com/"
    },
    "participants": [
      {
        "id": "aad:8a10c10e-7b4e-4a69-a8c9-123456789abc",
        "displayName": "Petra Muster",
        "role": "member"
      },
      {
        "id": "aad:3b1c0cde-77ab-4d4d-91df-123456789def",
        "displayName": "Max Beispiel",
        "role": "member"
      }
    ],
    "messages": [
      {
        "id": "teams:1744704000000",
        "createdAt": "2026-08-21T09:34:42.907Z",
        "author": {
          "id": "aad:8a10c10e-7b4e-4a69-a8c9-123456789abc",
          "displayName": "Petra Muster"
        },
        "content": {
          "format": "text/plain; charset=utf-8",
          "text": "Bitte prüft die aktuellen Fakten."
        }
      },
      {
        "id": "teams:1744704010000",
        "createdAt": "2026-08-21T09:34:49.186Z",
        "author": {
          "id": "aad:3b1c0cde-77ab-4d4d-91df-123456789def",
          "displayName": "Max Beispiel"
        },
        "content": {
          "format": "text/plain; charset=utf-8",
          "text": "Abklärung ist erfolgt."
        }
      }
    ]
  }
}
```

### Pflichtfelder der Submission

| JSON-Pfad | Typ | Erwartung |
|---|---|---|
| `messageType` | String | Exakt `rwp.record-submission` |
| `messageVersion` | String | Exakt `1.0` |
| `recordDid` | DID-String | Muss der DID aus dem Work Order entsprechen |
| `submittedAt` | ISO-8601-String | Zeitpunkt der Übergabe |
| `payloadFormat` | String | Für diese Story exakt `application/json` |
| `payload` | Objekt | Vollständiger fachlicher Conversation-Snapshot |
| `payload.conversationId` | String | Stabile lokale Teams-/Adapter-Conversation-ID |
| `payload.title` | String | Titel der Conversation |
| `payload.system.type` | String | Exakt `TeamsChat` |
| `payload.system.endpoint` | URL | Menschlich bzw. systemisch relevante Teams-/Adapter-URL |
| `payload.participants` | Array | Beteiligte Personen, soweit fachlich verfügbar (Vorschlag) |
| `payload.messages` | Array | Vollständiger geordneter Chat-Verlauf |

### Pflichtfelder je Nachricht (Vorschlag)

| JSON-Pfad | Typ | Erwartung |
|---|---|---|
| `messages[].id` | String | Stabile, adapterseitige Nachrichten-ID |
| `messages[].createdAt` | ISO-8601-String | Erstellungszeitpunkt |
| `messages[].author.id` | String | Stabile Personen-/System-ID |
| `messages[].author.displayName` | String | Lesbarer Name |
| `messages[].content.format` | String | Im ersten Adapterstand `text/plain; charset=utf-8` |
| `messages[].content.text` | String | Kanonischer Klartext der Nachricht |

### Inhaltliche Regeln

Der Adapter muss:

- den **vollständigen** fachlich relevanten Gesprächsverlauf liefern;
- Nachrichten in nachvollziehbarer zeitlicher Reihenfolge liefern;
- pro Nachricht stabile IDs verwenden;
- die gleiche Conversation-ID über wiederholte Submissions beibehalten;
- vollständige Daten auch bei späteren Submissions erneut senden;
- den aktuellsten fachlichen Stand bestimmen;
- Teams-spezifische HTML-, Mention- oder Rich-Text-Strukturen in einen dokumentierten, kanonischen Klartext überführen oder später durch eine definierte strukturierte Erweiterung ergänzen;
- Siehe auch https://recordweb.github.io/rwp/#format-requirements (für den PoC wird nur `application/json` unterstützt)
- Anhänge, Reaktionen, Bearbeitungen und gelöschte Nachrichten entweder nachvollziehbar abbilden oder für die erste Version ausdrücklich ausschliessen.

Der Adapter darf nicht nur seit der letzten Übergabe neue Nachrichten senden. SoX ist nicht dafür verantwortlich, aus Deltas einen fachlich vollständigen Chat zu rekonstruieren.

### Erfolgsantwort von SoX

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "f0158594-d7cc-4174-b8f8-c75d70dd6966",
  "did": "did:rwp:s73f42a3:records:f0158594-d7cc-4174-b8f8-c75d70dd6966",
  "recordType": "TeamsChat",
  "status": "finalized",
  "version": 1,
  "snapshotHash": "sha256:...",
  "payloadHash": "sha256:...",
  "parents": [],
  "finalizedAt": "2026-08-21T09:34:50.000Z"
}
```

Bei einer späteren erfolgreichen Submission:

- bleibt `did` gleich;
- erhöht sich `version`;
- entsteht ein neuer `snapshotHash`;
- enthält `parents` den Hash der vorigen finalisierten Version.

## Nicht Teil des Adapters

Folgendes ist bewusst nicht durch diese Story vorgegeben:

- Auswahl des Teams-Chats durch Benutzer;
- Benachrichtigung von Nutzern;
- Teams-Deep-Links;
- Case-UI;
- RWP-DID-Generierung;
- Case-Finalisierung;
- direkte Datenbankintegration mit SoX;
- Callback von SoX an Antwortmanagement;
- Aufbewahrungsfristen und produktive Compliance-Konfiguration;
- Signatur- und Berechtigungskonzept.

Diese Aspekte erfordern organisations- und fachkontextspezifische Entscheidungen.

## Sicherheits- und Produktionsanforderungen

Für einen produktiven Adapter sind zusätzlich erforderlich:

- wechselseitige Authentisierung zwischen SoX und Adapter;
- Autorisierung für Work Orders und Submissions;
- Secrets-Management für Teams- und SoX-Zugangsdaten;
- TLS und Zertifikatsprüfung;
- Audit-Logging;
- Retry-Strategie mit Idempotenzschlüsseln;
- Begrenzung und Validierung von Payload-Grössen;
- Schutz vor unzulässiger Datenweitergabe;
- Teams-spezifische Berechtigungs- und Retention-Prüfung;
- Signaturmodell gemäss künftigem RWP-Profil.

## Testfälle

| Test | Erwartetes Ergebnis |
|---|---|
| Gültiger Work Order | Adapter erzeugt oder korreliert Conversation und antwortet `201` |
| Gleicher Work Order erneut | Adapter antwortet `200`, `alreadyExists: true` und gleiche Conversation-ID |
| Ungültiger Work Order | Adapter antwortet `400` oder `422` |
| Adapter nicht erreichbar | SoX-Draft bleibt bestehen, Work Order wird als fehlgeschlagen ausgewiesen |
| Vollständige erste Submission | SoX erzeugt finalisierten Snapshot Version 1 |
| Zweite vollständige Submission | SoX erzeugt Version 2 mit Parent auf Version 1 |
| Submission mit falscher DID | SoX weist die Submission zurück |
| Submission mit Delta statt Vollverlauf | Adapter erfüllt die Story nicht |
| Case-Finalisierung mit TeamsChat-Draft | Antwortmanagement weist Case-Finalisierung zurück |
| Case-Finalisierung mit finalem TeamsChat | Antwortmanagement setzt Hard Link nach `process` |