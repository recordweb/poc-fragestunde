# MiniChat-EOL

MiniChat-EOL ist die kontrollierte Migrationsanwendung für den End-of-Life-Fall von MiniChat im RecordWeb-PoC Fragestunde.

Die Anwendung übernimmt finalisierte MiniChat-Records aus SoX in AIS, prüft nach einer manuellen RootResolver-Umschaltung den neuen Standort und löscht erst danach die lokalen Primärdaten im SoX. Abschliessend erstellt und übermittelt sie einen DeletionRecord als maschinenlesbares Löschprotokoll.

## Zweck

MiniChat-EOL modelliert einen typischen Archivierungsablauf bei Ablösung eines Fachsystems bzw. GEVER-nahen Quellsystems:

1. Archivwürdige Primärdaten werden an ein Archiv übergeben.
2. Das Archiv bestätigt die Übernahme.
3. Die globale/föderierte Auflösung zeigt auf den neuen Archivstandort.
4. Die operative Quellkopie wird gelöscht.
5. Ein Löschprotokoll belegt die Entfernung der Primärdaten.

Die Anwendung verändert den fachlichen MiniChat-Record nicht:

- Die MiniChat-DID bleibt unverändert.
- Der Record bleibt `finalized`.
- Es wird keine neue fachliche Record-Version erzeugt.
- Der Standortwechsel erfolgt ausserhalb der App über die Fabric-Testnet-Admin-App.

## Architektur und Rollen

```text
SoX / MiniChat                      MiniChat-EOL                    AIS
──────────────                      ────────────                    ───
finalisierte Records      →         SIP erzeugen              →     AIP übernehmen
Primärdaten vorhanden               SIP validieren                  Submission Receipt
                                    Root-Resolver prüfen       ←     archivierten Record liefern
Primärdaten löschen       ←         deletion payload-only
                                    DeletionRecord erzeugen    →     Löschprotokoll speichern
```

| Komponente | Verantwortung |
|---|---|
| SoX | Hält den operativen MiniChat-Record vor der Archivierung |
| MiniChat-EOL | Kontrolliert Migrationszustand, SIP, AIS-Übergabe, Resolver-Prüfung, Quelllöschung und Löschprotokoll |
| AIS | Archivstandort, AIP, Submission Receipt, read-only Bereitstellung und DeletionRecord-Aufbewahrung |
| Fabric-Admin-App | Manuelle Änderung des DID-Standorts von SoX auf AIS |
| RecordFinder | Unabhängiger Consumer; prüft Root-Resolver → Namespace-Resolver → DID-Dokument → Record-Endpunkt |

## End-to-End-Ablauf

```text
candidate
  → sip-created
  → accepted
  → resolver-confirmed
  → source-deleted
  → completed
```

### 1. Kandidaten wählen

Die EOL-App zeigt MiniChat-Records nur dann als neue Kandidaten, wenn sie:

- `record_type = MiniChat` haben;
- `status = finalized` haben;
- noch eine Conversation mit mindestens einer Message im SoX enthalten.

Records mit bereits gestarteter Migration bleiben sichtbar, damit ein unterbrochener Ablauf fortgesetzt und der Nachweis später angezeigt werden kann.

### 2. SIP erzeugen

Die App liest Record und vollständige Snapshot-Historie direkt aus den SoX-Tabellen und erzeugt ein:

```text
RWP-OAIS-SIP / MiniChat / 0.1
```

Das SIP enthält:

```text
SIP/
├── header/
│   ├── sip.json
│   ├── manifest-sha256.json
│   └── preservation-metadata.json
├── metadata/
│   ├── rwp-record.json
│   └── rwp-snapshots.json
└── content/
    └── conversation.json
```

Vor der Persistierung validiert die App die grundlegende Quellkonsistenz:

- MiniChat-Namespace;
- finalisierter Zustand;
- vollständige Snapshot-Historie;
- lückenlose Versionen und Parent-Kette;
- Payload-Hash;
- Konsistenz von aktuell gespeichertem Conversation-Payload und letztem Snapshot;
- gemeinsames JSON Schema;
- SIP-Manifest und Package-Hash.

### 3. SIP an AIS übermitteln

Die App sendet das SIP an AIS. Nach erfolgreicher Annahme speichert sie:

- AIP-ID;
- AIS Record Endpoint;
- AIS Submission Receipt;
- Receipt-Hash;
- Übernahmezeitpunkt.

Eine erneute Übermittlung desselben SIP ist idempotent.

### 4. Resolver umstellen und prüfen

Die Standortänderung erfolgt absichtlich nicht automatisch durch MiniChat-EOL.

Die Bedienperson aktualisiert den Eintrag über die vorhandene Fabric-Testnet-Admin-App. Anschliessend verwendet die EOL-App denselben unabhängigen Auflösungsweg wie RecordFinder:

```text
GET /recordfinder/api/resolve?did=<MiniChat-DID>
```

Sie prüft:

- die aufgelöste DID ist die erwartete MiniChat-DID;
- das DID-Dokument verweist auf den AIS Record Endpoint;
- die `currentVersion` entspricht dem finalen Snapshot-Hash;
- der über den RecordFinder abgerufene Record stammt aus AIS und enthält dieselbe DID sowie denselben Snapshot-Hash.

Nur dann ist die lokale Quelllöschung freigeschaltet.

### 5. Primärdaten im SoX löschen

Die Aktion ist nur im Zustand `resolver-confirmed` verfügbar.

Sie entfernt in einer Datenbanktransaktion:

- `sox_records.payload.conversation`;
- `sox_record_snapshots.payload`;
- temporäre SIP-Arbeitskopien, soweit vorhanden.

Sie behält:

- Record-ID und DID;
- Titel, Typ, Status und Version;
- Case-Referenz;
- Snapshot-Hashes;
- Payload-Hashes;
- Parent-Graph und Finalisierungsinformationen.

Der SoX-Record bleibt damit als auflösbare, strukturelle Referenz vorhanden, während AIS die alleinige Langzeitkopie des Chat-Payloads hält.

### 6. Löschprotokoll übermitteln

Nach der Quelllöschung erzeugt MiniChat-EOL einen DeletionRecord und übermittelt ihn an AIS.

Der DeletionRecord verwendet den SystemRecord-Namespace:

```text
did:rwp:a1b2c3d4:records:<uuid>
```

Er dokumentiert:

- Ziel-MiniChat-DID und finalen Snapshot;
- SIP-Package-Hash;
- AIP-ID und AIS-Endpoint;
- AIS Submission Receipt;
- Löschzeitpunkt;
- gelöschte und beibehaltene Komponenten;
- erfolgreiche Resolver- und AIS-Prüfung.

`completed` bedeutet: Archivübernahme, Standortprüfung, lokale Quelllöschung und Übernahme des Löschprotokolls in AIS sind abgeschlossen.

## Weboberfläche

PoC-URL:

```text
https://vps.recordweb.dev/minichat-eol/
```

Die Oberfläche zeigt:

- archivierungsfähige MiniChat-Records;
- den aktuellen Migrationszustand;
- technische Migrationsdetails;
- kontextabhängig aktivierte Aktionen;
- Fehler mit Validierungsdetails;
- eine Sicherheitsabfrage vor der Primärdatenlöschung.

Ablauf der Buttons:

```text
1. SIP erzeugen
2. An AIS übermitteln
3. Resolver prüfen
4. Primärdaten im SoX löschen
5. Löschprotokoll an AIS senden
```

Swagger UI:

```text
https://vps.recordweb.dev/minichat-eol/api-docs/
```

Health:

```text
https://vps.recordweb.dev/minichat-eol/health
```

## API

Öffentliche Basisadresse:

```text
https://vps.recordweb.dev/minichat-eol
```

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/health` | Health-Check |
| `GET` | `/api/candidates` | Kandidaten und sichtbare Migrationsvorgänge listen |
| `GET` | `/api/migrations` | Alle Migrationszustände listen |
| `GET` | `/api/migrations/:recordId` | Zustand einer Migration abrufen |
| `POST` | `/api/migrations/:recordId/sip` | SIP erzeugen und persistieren |
| `POST` | `/api/migrations/:recordId/submit` | SIP an AIS übermitteln |
| `POST` | `/api/migrations/:recordId/verify-resolver` | Föderierte Resolverkette über RecordFinder prüfen |
| `POST` | `/api/migrations/:recordId/delete-source-payload` | SoX-Primärdaten löschen und DeletionRecord erzeugen |
| `POST` | `/api/migrations/:recordId/submit-deletion-record` | Löschprotokoll an AIS übermitteln |

## Datenmodell

MiniChat-EOL verwendet die bestehende PoC-Datenbank `poc_db`. Die Quelltabellen verbleiben im Besitz von SoX; die EOL-App führt nur eine eigene Steuerungstabelle:

| Tabelle | Zweck |
|---|---|
| `eol_migrations` | Persistierter Migrationszustand, SIP, AIS Receipt, Resolver-Prüfung, DeletionRecord und Fehlerdaten |

Die Tabelle erlaubt Wiederanlauf nach Fehlern oder Unterbrüchen. Insbesondere bleibt ein Record nach lokaler Payload-Löschung sichtbar, damit Schritt 5 – die Übermittlung des Löschprotokolls – durchgeführt werden kann.

## Migrationszustände

| Zustand | Bedeutung |
|---|---|
| `candidate` | Archivierungsfähiger MiniChat-Record erkannt |
| `sip-created` | SIP erzeugt und lokal gespeichert |
| `submitted` | SIP-Versand an AIS läuft bzw. wurde ausgelöst |
| `accepted` | AIS hat SIP akzeptiert und AIP erzeugt |
| `resolver-confirmed` | RecordFinder bestätigt die föderierte Auflösung auf AIS |
| `source-deletion-pending` | Quelllöschung läuft innerhalb der SoX-DB-Transaktion |
| `source-deleted` | Primärdaten lokal gelöscht; DeletionRecord liegt lokal vor |
| `deletion-record-submitted` | Reservierter Zwischenzustand für Protokollübermittlung |
| `completed` | DeletionRecord von AIS bestätigt |
| `validation-failed` | SIP-/Quellvalidierung fehlgeschlagen |
| `rejected` | AIS hat SIP abgewiesen |
| `resolver-not-confirmed` | Resolver zeigt nicht auf den erwarteten AIS-Record |
| `source-deletion-failed` | Lokale Löschung fehlgeschlagen bzw. zurückgerollt |
| `deletion-protocol-failed` | Quelllöschung war erfolgreich, DeletionRecord-Übermittlung ist noch offen |

## Konfiguration

| Variable | Zweck | Beispiel |
|---|---|---|
| `PORT` | HTTP-Port | `3000` |
| `POSTGRES_HOST` | PoC-Datenbankhost | `db` |
| `POSTGRES_PORT` | Datenbankport | `5432` |
| `POSTGRES_DB` | Gemeinsame PoC-Datenbank | `poc_db` |
| `POSTGRES_USER` | Datenbanknutzer | `poc_user` |
| `POSTGRES_PASSWORD` | Datenbankpasswort | – |
| `PUBLIC_BASE_URL` | Öffentliche PoC-Basisadresse | `https://vps.recordweb.dev` |
| `AIS_API_BASE_URL` | Interner AIS-API-Endpunkt | `http://ais:3000/api` |
| `MINICHAT_DID_NAMESPACE` | Namespace für MiniChat-Records | `s73f42a3` |
| `SYSTEM_RECORD_DID_NAMESPACE` | Namespace für DeletionRecords | `a1b2c3d4` |
| `MINICHAT_RESOLVER_ENDPOINT` | Historischer SoX-Resolver im SIP | `https://vps.recordweb.dev/sox/did` |
| `RECORD_FINDER_RESOLVE_ENDPOINT` | Föderierter Prüf-Endpunkt | `https://vps.recordweb.dev/recordfinder/api/resolve` |
| `SCHEMAS_DIR` | Zentral eingebundene JSON Schemas | `/app/schemas` |

Die gemeinsamen Schemas liegen im Repository-Hauptordner:

```text
/schemas
├── minichat-sip.schema.json
├── ais-submission-receipt.schema.json
├── deletion-record.schema.json
└── eol-migration-state.schema.json
```

## Betrieb

Beispiel für Start oder Rebuild:

```bash
docker compose up -d --build minichat-eol nginx
```

Health prüfen:

```bash
curl -i https://vps.recordweb.dev/minichat-eol/health
```

Erwartete Antwort:

```json
{
  "status": "ok",
  "service": "minichat-eol"
}
```

Logs prüfen:

```bash
docker compose logs --tail=150 minichat-eol
```

## Sicherheits- und PoC-Hinweise

Die Aktion **„Primärdaten im SoX löschen“** ist im PoC absichtlich eine irreversible Operation. Sie ist nur nach erfolgreicher AIS-Übernahme und bestätigter föderierter DID-Auflösung möglich.

Der PoC implementiert keine Authentisierung, Berechtigungsprüfung oder Signaturen. Für einen produktiven Einsatz wären mindestens erforderlich:

- Zugriffsschutz und Rollenmodell;
- Vier-Augen-Freigabe bzw. fachliche Löschbewilligung;
- vollständiges, unveränderliches Migrations- und Löschjournal;
- Signaturen für Übernahme- und Löschprotokolle;
- verbindliche Aufbewahrungs- und Bewertungsregeln;
- abgesicherte Transport- und Schlüsselverwaltung.

## RWP-Erkenntnisse

Die Umsetzung liefert praktische Grundlagen für folgende RWP-Weiterentwicklungen:

1. `custodyTransfer` als nachweisbare Übertragung der Verwahrung bzw. des autoritativen Standorts ohne Änderung des bestehenden Records.
2. Differenzierung von `payload-only`: logische Payload-Löschung eines Records gegenüber lokaler Quellkopienlöschung nach Custody Transfer.
3. Normative Snapshot-Hash-Reproduzierbarkeit, insbesondere kanonische Zeitwertserialisierung und Speicherung hashrelevanter Repräsentationen.

## Status

MiniChat-EOL ist eine PoC-Komponente für RecordWeb. Sie ist keine produktive Migrations- oder Archivierungssoftware.
