# SoX Backend

Backend des System of X (SoX) im RecordWeb-PoC Fragestunde.

SoX verwaltet eigene RWP-Records. Andere Anwendungen dürfen SoX über dessen
HTTP-API anweisen, einen Record anzulegen oder abzufragen. SoX greift nicht
direkt auf Tabellen anderer Anwendungen zu.

## DID

SoX verwendet den Namespace:

```text
s73f42a3
```

Die DID eines Records wird wie folgt gebildet:

```text
did:rwp:s73f42a3:<opaque-record-id>
```

## Endpunkte

| Endpunkt | Funktion |
|---|---|
| `GET /health` | Health Check |
| `POST /api/records` | RWP-Draft-Record erzeugen |
| `GET /api/records` | Alle Records auflisten |
| `GET /api/records/:id` | Einzelnen Record mit Payload lesen |
| `GET /did/:id` | DID-Dokument des Record auflösen |
| `GET /api-docs` | Swagger UI |

## Konfiguration

| Variable | Beispiel |
|---|---|
| `PORT` | `3000` |
| `POSTGRES_HOST` | `postgres` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | gemäss zentraler Compose-Konfiguration |
| `POSTGRES_USER` | gemäss zentraler Compose-Konfiguration |
| `POSTGRES_PASSWORD` | gemäss zentraler Compose-Konfiguration |
| `SOX_DID_NAMESPACE` | `s73f42a3` |

## Entwicklungsstand

Die erste Stufe implementiert die Erzeugung und Anzeige von Draft-Records.
MiniChat und TeamsChat werden noch nicht erstellt oder integriert. Der
fachliche Payload wird anfänglich als leerer Gesprächsstand angelegt und
später durch das jeweilige Quellsystem geliefert.