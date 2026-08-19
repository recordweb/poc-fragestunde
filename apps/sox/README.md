# SoX – System of X

SoX ist im PoC Fragestunde die systemneutrale Sicht auf Records, die aus unterschiedlichen Anwendungen und Integrationen entstehen.

SoX ist selbst weder ein System of Work noch die jeweilige Quellanwendung. Es verwaltet bzw. präsentiert die Record-Perspektive einer externen Kollaboration oder eines anderen integrierten Systems.

## Stand

Umgesetzt:

- Eigenständiges Backend mit eigener Tabelle `sox_records` (gleiche Datenbank wie die anderen Apps, aber kein Zugriff auf deren Tabellen).
- `POST /api/records`: legt einen neuen RWP-Draft-Record an (RecordType `MiniChat` oder `TeamsChat`).
- `GET /api/records`: listet alle SoX-Records.
- `GET /api/records/:id`: liefert Metadaten und Payload eines Records.
- `GET /did/:id`: löst die DID auf ein DID-Dokument auf.
- Swagger UI unter `/api-docs`.
- Statisches Frontend (`frontend/sox.html`), ausgeliefert direkt durch Nginx (alias, analog zu Antwortmanagement/Fragenmanagement) — nicht durch das Node-Backend.

Noch offen:

- Integration mit Antwortmanagement (Button "Chat starten").
- MiniChat als eigenständige Anwendung.
- Übernahme eines Gesprächssnapshots in den Record (Capture).
- Explizite Finalisierung von Draft-Records.
- Microsoft-Teams-Connector.

## DID

SoX verwendet den Namespace:

```text
s73f42a3
```

Die DID eines Records wird (analog zu Fragenmanagement/Antwortmanagement) wie folgt gebildet:

```text
did:rwp:s73f42a3:records:<uuid>
```

## Aufruf

```text
https://vps.recordweb.dev/sox/
https://vps.recordweb.dev/sox/api/records
https://vps.recordweb.dev/sox/api-docs/
```

## Weiterer Ausbau

1. Button "Chat starten" im Antwortmanagement, der einen SoX-Draft anlegt.
2. Case im Antwortmanagement verlinkt die zurückgegebene SoX-DID.
3. Antwortmanagement löst die SoX-DID über den Resolver auf und zeigt den Inhalt in einer aufklappbaren Ansicht.
4. `MiniChat` als eigenständige Anwendung, die einen Gesprächssnapshot an SoX liefert.
5. Explizite Finalisierung eines Drafts.
6. Microsoft-Teams-Connector als weitere externe Quelle.