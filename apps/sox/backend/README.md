# SoX Backend

Backend des System of X (SoX) im RecordWeb-PoC Fragestunde.

SoX verwaltet eigene RWP-Records. Andere Anwendungen dürfen SoX über dessen HTTP-API anweisen, einen Record anzulegen oder abzufragen. SoX greift nicht direkt auf Tabellen anderer Anwendungen zu.

## DID

SoX verwendet den Namespace:

```text
s73f42a3
```

Die DID eines Records wird wie folgt gebildet (analog zu Fragenmanagement und Antwortmanagement):

```text
did:rwp:s73f42a3:records:<uuid>
```

## Endpunkte

| Endpunkt | Funktion |
|---|---|
| `GET /health` | Health Check |
| `POST /api/records` | RWP-Draft-Record erzeugen |
| `GET /api/records` | Alle Records auflisten |
| `GET /api/records/:id` | Einzelnen Record mit Payload lesen |
| `GET /did/:id` | DID-Dokument des Record auflösen (liefert `recordEndpoint`) |
| `GET /api-docs` | Swagger UI |

## Auflösungsmuster

Der DID-Resolver liefert dasselbe Dokumentformat wie Fragenmanagement und Antwortmanagement, insbesondere das Feld `recordEndpoint`. Andere Apps lösen eine SoX-DID so auf:

```text
GET /sox/did/<did>          → liefert { recordEndpoint, ... }
GET <recordEndpoint>         → liefert den vollständigen Record
```

## Konfiguration

| Variable | Beispiel |
|---|---|
| `PORT` | `3000` |
| `POSTGRES_HOST` | `db` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | `poc_db` |
| `POSTGRES_USER` | `poc_user` |
| `POSTGRES_PASSWORD` | gemäss zentraler Compose-Konfiguration |
| `SOX_DID_NAMESPACE` | `s73f42a3` |
| `PUBLIC_BASE_URL` | `https://vps.recordweb.dev` |

## Entwicklungsstand

Records werden als Draft mit leerem Gesprächsstand angelegt. Es gibt noch keine Capture-Funktion und keine Finalisierung. Das Frontend wird nicht durch dieses Backend ausgeliefert, sondern direkt durch Nginx.