# rwp-poc-resolver — Etappe 1

Dieser Resolver ist **kein** produktiver `rwp-resolver`. Er ist ein bewusst einfach gehaltener Lernprototyp innerhalb des PoC-Fragestunde-Repos, um das Konzept eines DID-Resolvers gemäss RWP Kapitel 2.4 praktisch nachzuvollziehen, bevor der echte, eigenständige `rwp-resolver` entsteht.

## Aufbau

Zwei Instanzen des identischen Codes laufen parallel, unterschieden durch ihre jeweilige `org.json`:

- `parlament/org.json` — Namespace `a3f9e21c` (Parlamentsdienste), inkl. Personen mit persönlichem Namespace (Parlamentarier)
- `bk/org.json` — Namespace `b7d4c810` (Bundeskanzlei)

## DID-Struktur

- **Unabhängige Personen** (nicht organisationsangestellt, z. B. Parlamentarier): `did:rwp:<personalNamespace>:self`
- **Angestellte Personen**: `did:rwp:<org.namespace>:users/<slug>`
- **Systemakteure**: `did:rwp:<org.namespace>:system/rwp-node`

## Testpersonen registrieren

Testpersonen werden in `org.json` unter `testPersons` definiert und bei jedem Deployment automatisch geseedet (deterministisch, keine zufälligen UUIDs). Jede Person braucht:

```json
{
  "kuerzel": "mb",
  "name": "Maria Bernasconi",
  "role": "Nationalrätin",
  "type": "independent",
  "personalNamespace": "f2c81e05"
}
```

oder für Angestellte:

```json
{
  "kuerzel": "dw",
  "name": "Daniel Wyss",
  "role": "Sachbearbeiter",
  "type": "employee",
  "slug": "daniel-wyss"
}
```

## Endpunkte

- `GET /1.0/identifiers/{did}` — DID-Auflösung (RWP §2.4)
- `GET /1.0/login/{kuerzel}` — Login per Kürzel
- `GET /1.0/persons` — Alle registrierten Personen
- `GET /` — Status/Health

## Testen
Der Service startet auf Port 3000 und seeded automatisch drei Testpersonen beim ersten Start (Maria Bernasconi, Thomas Frei, Admin Parlamentsdienste).

```
curl http://localhost:3000/
curl http://localhost:3000/1.0/identifiers/did:rwp:parlament.ch:<uuid-aus-log>
```

Die tatsaechliche DID pro Person wird beim ersten Start in der Konsole ausgegeben (siehe "Seeded: ...").

Erwartete Antworten:
- Bekannte DID -> HTTP 200 + DID-Dokument (application/did+ld+json)
- Unbekannte DID -> HTTP 404 + Fehlermeldung
