# BAR Conformance Authority

Diese Anwendung ist die erste Ausbaustufe der BAR-Integration im RecordWeb-Fragestunde-PoC.

Sie modelliert das Schweizerische Bundesarchiv (BAR) als unabhängige Conformance Authority. Das BAR prüft dabei nicht jeden einzelnen Inhaltsrecord. Es prüft eine konkret identifizierte Version einer Software-Implementation und hält das Ergebnis als RWP-ConformanceRecord fest.

## Ziel der Ausbaustufe 1

Die BAR-Anwendung ermöglicht:

- eine einfache PoC-Anmeldung mit einer neu erzeugten RWP-DID für die handelnde Person;
- das Anlegen einer Conformance-Prüfung als Draft;
- die Dokumentation der geprüften Anwendung, Version, RWP-Version, Profile und Rollen;
- die Erfassung von positiven und negativen Testfällen sowie Evidenz;
- die Finalisierung eines unveränderlichen ConformanceRecords durch einen BAR Attester;
- das Lesen finalisierter ConformanceRecords durch Auditoren und Viewer.

Die Anwendung ist in dieser Stufe bewusst noch nicht mit einem SchemaRecord oder mit der Finalisierung in Fragenmanagement bzw. Antwortmanagement verbunden.

## BAR-Rollen

| Rolle | Bedeutung im PoC | Berechtigungen |
|---|---|---|
| `bar-attester` | Verantwortliche BAR-Stelle für die Attestation | Assessment anlegen, ändern und finalisieren |
| `bar-auditor` | Prüfende BAR-Stelle | Assessment lesen und Prüfergebnisse/Evidenz ergänzen |
| `bar-viewer` | Revisions- oder Beobachtungsrolle | Nur lesen |

Die Anmeldung ist kein produktives IAM. Sie erzeugt eine DID nach dem Muster `did:rwp:poc-fragestunde:bar-user-<name>-<uuid>` und verwendet diese als identifizierbaren handelnden Agenten im PoC.

## Conformance-Ablauf

1. Ein BAR Attester legt eine neue Assessment-Akte als `draft` an.
2. Das BAR dokumentiert die geprüfte Anwendung und die beanspruchten RWP-Profile/Rollen.
3. Die Pflichttests werden mit Resultat und Evidenz geführt.
4. Ein BAR Attester finalisiert die Akte erst, wenn:
   - alle Pflichttests den Status `passed` haben;
   - keine Tests fehlgeschlagen sind;
   - die Anwendung, Version, RWP-Version, Claims und Evidenz vorhanden sind.
5. Das Backend erzeugt einen finalisierten `ConformanceRecord` mit:
   - einer eigenen DID;
   - Payload-Hash;
   - Snapshot-Hash;
   - einer sichtbaren PoC-Signatur;
   - dem Attester als Owner und `attester` im Payload.

## Standardtests

- DID-Auflösung
- Schema-Bindung
- Payload-Validierung
- Snapshot-Integrität
- Unveränderlichkeit finalisierter Snapshots

Die Tests sind als Ausgangspunkt für die Diskussion gedacht. In späteren Stufen können sie durch automatisierte Tests gegen Fragenmanagement, Antwortmanagement und Resolver ersetzt oder ergänzt werden.

## API

| Methode | Endpoint | Zweck |
|---|---|---|
| `POST` | `/api/session` | Erzeugt eine PoC-User-DID und BAR-Rolle |
| `GET` | `/api/assessments` | Listet Assessments |
| `POST` | `/api/assessments` | Erstellt einen Assessment-Draft |
| `GET` | `/api/assessments/:id` | Liest einen Assessment-Draft |
| `PUT` | `/api/assessments/:id` | Aktualisiert einen Draft |
| `POST` | `/api/assessments/:id/finalize` | Finalisiert den ConformanceRecord |
| `GET` | `/api/conformance-records` | Listet finalisierte Attestationen |
| `GET` | `/api/conformance-records/:did` | Liest einen ConformanceRecord |

Für alle geschützten Endpoints sind die folgenden Request Header erforderlich:

```text
x-rwp-user-did: did:rwp:...
x-rwp-role: bar-attester | bar-auditor | bar-viewer
```

## Lokal starten

```bash
cd apps/bar/backend
npm install
npm start
```

Danach `apps/bar/frontend/bar.html` im Browser öffnen. Die Standard-API ist:

```text
http://localhost:3000
```

Bei einer Docker-/Nginx-Integration kann im Frontend vor dem Laden der Seite beispielsweise `window.BAR_API_BASE = "/bar-api"` gesetzt werden.

## Nächste Ausbaustufen

### Stufe 2: SchemaRecord-Verbindung

Ein Schema-Snapshot erhält ein `conformanceGate` oder ein vergleichbares normatives Element. Dieses referenziert konkrete finalisierte ConformanceRecords des BAR als unveränderliche Snapshots.

### Stufe 3: Durchsetzung in den Fachanwendungen

Fragenmanagement und Antwortmanagement prüfen beim Finalisieren eines Inhaltsrecords:

1. Welche Conformance-Anforderung enthält der verwendete Schema-Snapshot?
2. Existiert ein finalisierter und passender BAR-ConformanceRecord?
3. Deckt dieser die laufende Implementation, deren Version, Profil und Rolle?
4. Ist er zum Zeitpunkt der Finalisierung gültig?

Erst dann kann ein neuer Inhaltsrecord finalisiert werden.