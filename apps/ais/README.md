# AIS – ArchivInformationsSystem

AIS ist das **ArchivInformationsSystem** im RecordWeb-PoC Fragestunde. Es übernimmt finalisierte MiniChat-Records als archivische Aufbewahrungseinheiten (AIP), bewahrt deren Payload und Snapshot-Historie langfristig und stellt sie read-only bereit.

AIS demonstriert den End-of-Life-Fall eines Quellsystems: MiniChat wird abgelöst, die Records bleiben über ihre ursprünglichen RWP-DIDs identifizierbar und werden nach erfolgreicher Übernahme am neuen Standort aufgelöst.

## Zweck

AIS bildet im PoC den Langzeitstandort für archivierte MiniChat-Records.

Ein übernommener Record bleibt fachlich unverändert:

- Die DID bleibt unverändert, zum Beispiel `did:rwp:s73f42a3:records:<uuid>`.
- Der Record bleibt im Zustand `finalized`.
- Es wird keine neue fachliche Version und kein Status `archived` erzeugt.
- Snapshot-Historie, Parent-Graph, Payload-Hashes und Snapshot-Hashes werden übernommen.
- Der Standortwechsel erfolgt über das DID-Dokument bzw. den vorhandenen Fabric-/Root-Resolver, nicht durch Änderung des Records.

AIS speichert zusätzlich archivische Verwaltungsinformationen:

- SIP-Package-Hash und Manifest;
- AIP-ID;
- AIS Submission Receipt;
- Preservation-Metadaten;
- optional einen DeletionRecord als Nachweis der späteren lokalen Payload-Löschung im SoX.

## Abgrenzung

AIS ist im PoC bewusst ein read-only Archivsystem. Es erzeugt und bearbeitet keine MiniChat-Records.

Nicht Teil des AIS-PoC:

- Resolver- oder Hyperledger-Fabric-Administration;
- Erzeugung von MiniChat-Records;
- Zugriffskontrolle und Authentisierung;
- Signaturen und Schlüsselverwaltung;
- vollständige eCH-0160-Konformität;
- produktives Langzeitarchiv oder vollständige OAIS-Implementierung.

## Architektur

```text
MiniChat / SoX
      │
      │ RWP-OAIS-SIP
      ▼
AIS API
      │
      ├─ validiert SIP und historische Evidenz
      ├─ persistiert AIP, Record und Snapshots
      ├─ stellt Submission Receipt aus
      ├─ nimmt DeletionRecords entgegen
      └─ liefert archivierte Records read-only
      │
      ▼
AIS PostgreSQL (ais_db, eigenes Volume)
```

AIS läuft als eigenständiger Node.js-/Express-Service mit einer eigenen PostgreSQL-Datenbank. Dies demonstriert die physische Trennung von operativem SoX und Archivstandort.

## RWP-OAIS-Ablauf

Der End-of-Life-Ablauf wird von der separaten MiniChat-EOL-App gesteuert:

1. Die EOL-App liest einen finalisierten MiniChat-Record aus SoX.
2. Sie erzeugt ein `RWP-OAIS-SIP / MiniChat / 0.1`.
3. AIS validiert und übernimmt das SIP als AIP.
4. AIS stellt ein `RWP-AIS-Submission-Receipt` aus.
5. Der Standort der bestehenden MiniChat-DID wird manuell über den `RootResolver-Admin` auf AIS umgestellt.
6. Die EOL-App prüft über RecordFinder die föderierte DID-Auflösung bis zum AIS-Record.
7. Erst danach werden die Primärdaten im SoX gelöscht.
8. Die EOL-App übermittelt einen DeletionRecord an AIS.

```text
SoX finalized Record
  → SIP
  → AIS AIP + Submission Receipt
  → RootResolver + RecordFinder: DID → AIS
  → SoX payload-only deletion
  → DeletionRecord → AIS
```

## Datenmodell

| Tabelle | Zweck |
|---|---|
| `ais_aips` | Archivische Aufbewahrungseinheit pro übernommener SIP |
| `ais_records` | Read-model des übernommenen MiniChat-Records |
| `ais_record_snapshots` | Übernommene Snapshot-Historie |
| `ais_submission_receipts` | Unveränderliche AIS-Übernahmequittung |
| `ais_deletion_records` | Löschprotokoll zur lokalen SoX-Payload-Löschung |

Die Datenbank wird beim Start automatisch initialisiert.

## API

Öffentliche Basisadresse im PoC:

```text
https://vps.recordweb.dev/ais
```

Swagger UI:

```text
https://vps.recordweb.dev/ais/api-docs/
```

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/health` | Health-Check |
| `POST` | `/api/sips` | SIP entgegennehmen und AIP erzeugen |
| `GET` | `/api/aips` | Archivbestand listen |
| `GET` | `/api/aips/:aipId` | AIP-Verwaltungsansicht |
| `GET` | `/api/aips/:aipId/receipt` | Submission Receipt abrufen |
| `GET` | `/api/aips/:aipId/package` | Archivnahes JSON-AIP-Paket herunterladen |
| `GET` | `/api/records` | Archivierte Records listen |
| `GET` | `/api/records/:id` | Archivierten Record abrufen |
| `GET` | `/api/records/:id/history` | Snapshot-Historie abrufen |
| `GET` | `/api/records/:id/deletion-record` | Löschprotokoll zum Record abrufen |
| `POST` | `/api/deletion-records` | DeletionRecord übernehmen |
| `GET` | `/api/deletion-records` | Löschprotokolle listen |
| `GET` | `/api/deletion-records/:did` | Löschprotokoll via SystemRecord-DID abrufen |
| `GET` | `/did/:id` | Lokales DID-Dokument eines archivierten Records |

## Weboberfläche

AIS stellt eine read-only Weboberfläche bereit:

```text
https://vps.recordweb.dev/ais/
```

Sie zeigt:

- archivische Aufbewahrungseinheiten;
- archivierte MiniChat-Records;
- Conversation-Payload;
- Snapshot-Historie und Hashwerte;
- AIS Submission Receipt;
- DeletionRecord und Löschprotokoll, sofern vorhanden;
- Download des logisch strukturierten JSON-AIP-Pakets.

## AIP-Exportpaket

`GET /api/aips/:aipId/package` erzeugt ein logisch strukturiertes JSON-Exportpaket.

```text
AIP/
├── aip.json
├── metadata/
│   ├── rwp-record.json
│   ├── rwp-snapshots.json
│   ├── preservation-metadata.json
│   ├── submission-receipt.json
│   └── deletion-record.json           # nur nach lokaler SoX-Löschung
├── content/
│   └── conversation.json
└── manifest-sha256.json
```

Der PoC liefert diese Struktur als JSON-Objekt, inklusive Paketmanifest und SHA-256-Hashes. Ein physisches ZIP mit derselben Struktur ist ein möglicher Ausbau.

## SIP-Validierung

AIS akzeptiert nur SIPs, die unter anderem folgende Bedingungen erfüllen:

- `MiniChat`-Record im Namespace `s73f42a3`;
- Zustand `finalized`;
- konsistente DID, Record-ID und aktuelle Snapshot-Referenz;
- lückenlose Snapshot-Versionen und valide Parent-Kette;
- reproduzierbarer Payload-Hash;
- gültiges zentral abgelegtes JSON Schema;
- konsistenter SIP-Package-Hash;
- keine widersprüchliche bestehende AIP-Übernahme derselben DID.

Eine identische Wiederholung desselben SIP ist idempotent: AIS liefert die bestehende Submission Receipt zurück, ohne ein zweites AIP zu erzeugen.

## DeletionRecord

Der DeletionRecord dokumentiert nicht die Löschung des archivierten MiniChat-Records. Er dokumentiert ausschliesslich:

> Nach erfolgreicher Übernahme und prüfbarer DID-Auflösung wurden die Primärdaten der lokalen operativen SoX-Kopie gelöscht.

Der DeletionRecord verwendet den SystemRecord-Namespace:

```text
did:rwp:a1b2c3d4:records:<uuid>
```

Er referenziert mindestens den Zielrecord, finalen Snapshot, SIP, AIP, AIS Submission Receipt, Löschzeitpunkt, gelöschte Komponenten und beibehaltene Evidenzen.

## Konfiguration

| Variable | Zweck | Beispiel |
|---|---|---|
| `PORT` | HTTP-Port | `3000` |
| `POSTGRES_HOST` | AIS-Datenbankhost | `ais-db` |
| `POSTGRES_PORT` | AIS-Datenbankport | `5432` |
| `POSTGRES_DB` | AIS-Datenbank | `ais_db` |
| `POSTGRES_USER` | Datenbanknutzer | `poc_user` |
| `POSTGRES_PASSWORD` | Datenbankpasswort | – |
| `PUBLIC_BASE_URL` | Öffentliche Basisadresse | `https://vps.recordweb.dev` |
| `MINICHAT_DID_NAMESPACE` | MiniChat-Namespace | `s73f42a3` |
| `SYSTEM_RECORD_DID_NAMESPACE` | SystemRecord-Namespace | `a1b2c3d4` |
| `SCHEMAS_DIR` | Gemounteter gemeinsamer Schema-Ordner | `/app/schemas` |

Gemeinsame Schemas liegen im Repository-Hauptordner:

```text
/schemas
├── minichat-sip.schema.json
├── ais-submission-receipt.schema.json
├── deletion-record.schema.json
└── eol-migration-state.schema.json
```

## Betrieb

Beispiel für Start oder Rebuild im PoC:

```bash
docker compose up -d --build ais-db ais nginx
```

Health prüfen:

```bash
curl -i https://vps.recordweb.dev/ais/health
```

Erwartete Antwort:

```json
{
  "status": "ok",
  "service": "ais"
}
```

Logs prüfen:

```bash
docker compose logs --tail=150 ais
```

## RWP-Erkenntnisse aus dem PoC

Der PoC liefert insbesondere drei Weiterentwicklungsfragen für RWP:

1. **CustodyTransfer:** Nachweis der Verwahrungs-/Standortübertragung eines unveränderten bestehenden Records.
2. **Payload-only:** Abgrenzung zwischen logischer Record-Löschung und lokaler Quellkopienlöschung nach erfolgreicher Archivübernahme.
3. **Snapshot-Hash-Reproduzierbarkeit:** Normative Zeitwertserialisierung und Persistierung hashrelevanter kanonischer Repräsentationen.

## Lizenz und Status

AIS ist eine PoC-Komponente im RecordWeb-Ökosystem. Es ist kein produktives Archivsystem und erhebt keinen Anspruch auf vollständige OAIS- oder eCH-0160-Konformität.
