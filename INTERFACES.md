# Interfaces – PoC Fragestunde

Dieses Dokument beschreibt, wie die PoC-Anwendungen (Fragenmanagement, Antwortmanagement) mit den externen Services interagieren. Die Abschnitte zu Resolver, Solid-Connector und Nanopub-Service sind als Vorschlag aus Sicht der App-Entwicklung zu verstehen und müssen von den jeweiligen Repo-Verantwortlichen bestätigt oder angepasst werden. Die verbindliche Schnittstellendefinition liegt jeweils im zugehörigen Service-Repo, nicht in diesem Dokument.

## DID-Resolver (Mini-Resolver, PoC-Phase)

> Status: Lernprototyp im PoC-Repo, kein produktiver `rwp-resolver`. Dient als Konzeptnachweis und Tastaturübung, bevor der echte `rwp-resolver` gebaut wird.

Zwei Resolver-Instanzen, je eine pro Organisation/Namespace, gemäss RWP Kapitel 2.4 und 12.

| Organisation | Namespace | Interner Service | Externer Pfad |
|---|---|---|---|
| Parlamentsdienste (inkl. persönliche Namespaces der Parlamentarier) | a3f9e21c, f2c81e05, c6cdee0b | resolver-parlament:3000 | /resolver/parlament/ |
| Bundeskanzlei | b7d4c810 | resolver-bk:3000 | /resolver/bk/ |

### Endpunkt: DID auflösen

```
GET /resolver/{organisation}/1.0/identifiers/{did}
```

Antworten:
- 200 + DID-Dokument (`application/did+ld+json`), wenn DID bekannt
- 404 + Fehlerobjekt, wenn DID unbekannt

### Endpunkt: Login per Kürzel

```
GET /resolver/{organisation}/1.0/login/{kuerzel}
```

Liefert DID, Name und Rolle zur registrierten Person. Kürzel-Konvention: 1. Buchstabe Vorname + 1. Buchstabe Nachname (klein), z. B. `mb` für Maria Bernasconi. Admin-Accounts nutzen durchgehend `admin`.

### Endpunkt: Alle Personen auflisten

```
GET /resolver/{organisation}/1.0/persons
```

Beispiel:

```
curl https://vps.recordweb.dev/resolver/parlament/1.0/login/mb
```

### Offene Punkte für den produktiven `rwp-resolver`

- Namespace-Delegation zwischen Organisationen (RWP Kapitel 12.3)
- Trust-Anchor-Ledger für Signaturvalidierung
- Admin-Frontend zur User-Registrierung (siehe `apps/resolver/README.md`)


## DID-Resolver (Produktiv, geplant)

> Vorschlag aus App-Sicht, zu bestätigen durch `rwp-resolver`

- Endpoint: TBD (z. B. `GET /resolve/{did}`)
- Response: DID-Dokument gemäss RWP Kapitel 2.3
- Statuscodes: 200 (gefunden), 404 (unbekannt), 410 (gelöscht)
- Offen: Basis-URL des Resolvers für den PoC, Umgang mit den vier bekannten Namespaces (siehe `namespaces.json`)

## Solid-Connector

> Vorschlag aus App-Sicht, zu bestätigen durch `rwp-solid-connector`

- Zwei Anwendungsfälle im PoC: Bernasconi (aus dem Fragenmanagement heraus) und Meier (unabhängig, eigener Solid-Server)
- Offen: Wird der Connector von der App aus aufgerufen (API-Call), oder bedient der Nutzer ihn separat als eigenständiges Tool?
- Offen: Wie wird der kryptographische Pointer auf den Record im Pod abgelegt (Format, Vokabular)?

## Nanopub-Service

> Vorschlag aus App-Sicht, zu bestätigen durch `rwp-nanopub-service`

- Auslöser im PoC: Finalisierung einer Frage (Fragenmanagement), Case-Abschluss (Antwortmanagement)
- Offen: Push (App meldet an Service) oder Pull (Service pollt die App)?
- Offen: Endpoint und Payload-Format für die Meldung

## LDN zwischen Fragenmanagement und Antwortmanagement

- Basiert auf W3C Linked Data Notifications (Inbox-Discovery, POST-Mechanismus)
- Im PoC-Scope: Minimalimplementierung, CORS-basiert, keine Authentifizierung
- Offen: Konkrete Inbox-URL-Konvention für beide Apps im PoC

## Status

Dieses Dokument enthält Annahmen aus App-Sicht. Verbindlich wird die jeweilige Schnittstelle erst mit der Bestätigung im zugehörigen Service-Repo (siehe Issues in `rwp-resolver`, `rwp-solid-connector`, `rwp-nanopub-service`). Der DID-Resolver-Abschnitt ist eine Ausnahme: Er beschreibt den tatsächlich implementierten Mini-Resolver im PoC-Repo selbst, nicht einen externen Service.
