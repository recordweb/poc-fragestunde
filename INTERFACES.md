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
- Wird in 5 Etappen von Simulation auf produktive Zustellung umgestellt (Status je Etappe unten)

### Inbox-Discovery (Etappe 1 — umgesetzt)

Das Antwortmanagement macht seine Inbox-URL normativ per LDN-Link-Header auf `GET /antwortmanagement/api/health` bekannt:

```
Link: <https://vps.recordweb.dev/antwortmanagement/api/inbox>; rel="http://www.w3.org/ns/ldp#inbox"
```

Ein System-DID-Dokument (`did:rwp:b7d4c810:system/rwp-node`) existiert im PoC bewusst nicht — `did.js` löst ausschliesslich Record-DIDs auf. Der Link-Header ist daher der einzige, aber vollständig LDN-konforme Discovery-Weg.

Das Fragenmanagement wird die Ziel-Inbox zusätzlich explizit über die Env-Variable `LDN_INBOX_URL` konfigurieren (Default: obige URL) — damit ist kein Discovery-Request zur Laufzeit vor jedem Versand nötig; der Link-Header bleibt für Spec-Konformität und externe Discovery bestehen.

### Inbox-Route (Etappe 2 — umgesetzt)

- `POST /antwortmanagement/api/inbox` — nimmt Notifications entgegen, validiert LDN-Pflichtfelder (`@context`, `id`, `type`, `actor`, `object.id`), speichert in `ldn_inbox`, antwortet `201 Created` mit `Location`-Header auf die gespeicherte Notification
- `GET /antwortmanagement/api/inbox` — listet empfangene Notifications (neueste zuerst), `GET /antwortmanagement/api/inbox/:id` liefert eine einzelne Notification vollständig
- Bewusst **ohne Zugriffskontrolle** — wie alle anderen bestehenden Routen in diesem PoC ist die Inbox offen lesbar/schreibbar. Entscheid: Der PoC ist ein Demonstrator, bei dem Offenheit den Ablauf nachvollziehbar zeigen soll; das gilt genauso für das `rwp:owner`-Feld, das bewusst nicht pseudonymisiert wird
- Noch keine Signatur-/Herkunftsprüfung des Absenders — folgt in Etappe 5

### Echte Zustellung (Etappe 3 — umgesetzt)

- `sendLdnNotification()` im Fragenmanagement macht bei Finalisierung ein echtes `fetch`-POST an `LDN_INBOX_URL` — keine DB-Insert-Simulation mehr.
- Default-Zustelladresse ist der interne Docker-Netzwerkname des Antwortmanagement-Containers (`http://antwort-api:3000/antwortmanagement/api/inbox`), nicht die öffentliche URL — schneller und unabhängig von nginx/Cloudflare, da beide Container im selben Docker-Netzwerk laufen. Die öffentliche URL aus dem Link-Header (Etappe 1) bleibt die für externe Discovery gültige Adresse.
- `finalizeCommon()` bleibt synchron: Zustellversuch blockiert die Finalisierung nicht — bei Fehlern (Netzwerk, Non-2xx) wird `delivered=false` + `delivery_error` in `ldn_notifications` festgehalten und via `logEvent()` protokolliert. Automatische Wiederholung folgt in Etappe 4.

### Fehlerbehandlung — Retry, Dead-Letter, konfigurierbare Zustelladresse (Etappe 4 — umgesetzt)

- Zustellstatus wird direkt auf der jeweiligen Zeile in `ldn_notifications` gepflegt (`status`, `attempts`, `delivery_error`, `next_attempt_at`, `target_url`) — keine separate Tabelle nötig, eine Notification ist ihr eigener Outbox-Eintrag.
- Bei Zustellfehlern (Netzwerk, Non-2xx) wird automatisch mit exponentiellem Backoff wiederholt (30s / 1min / 2min / 4min / 8min, gedeckelt bei 10min), bis zu `MAX_ATTEMPTS = 5`. Danach `status = 'dead_letter'` — keine weiteren automatischen Versuche.
- Ein periodischer Worker (`startOutboxWorker()` in `ldn.js`-Umfeld, alle 15s) prüft fällige Retries.
- `GET /fragenmanagement/api/outbox` listet alle Zustellversuche mit Status, Versuchsanzahl, letztem Fehler und nächstem geplanten Versuch — analog zum bestehenden `GET /api/logs`.
- `POST /fragenmanagement/api/outbox/:id/retry` löst einen sofortigen manuellen Zustellversuch aus, unabhängig vom Backoff — funktioniert auch für bereits als Dead Letter markierte Notifications.
- Die Zustelladresse (`LDN_INBOX_URL`) ist zur Laufzeit über `GET`/`PUT /fragenmanagement/api/settings/ldn-inbox-url` konfigurierbar (persistiert in `app_settings`), mit der Docker-Compose-Umgebungsvariable `LDN_INBOX_URL` als Fallback-Default. Im Admin-Bereich des Fragenmanagement-Frontends editierbar — ermöglicht die Demonstration, dass eine falsche Adresse zu `failed`/`dead_letter` führt und die Korrektur (ggf. mit manuellem Retry) die Zustellung nachträglich ermöglicht.

### Antwortmanagement liest Fragen nur noch aus der Inbox (Etappe 4b — umgesetzt)

- Die Fragenauswahl im Antwortmanagement-Frontend rief bisher direkt `GET /fragenmanagement/api/records` auf — ein direkter Zugriff auf die Datenbasis des anderen Bounded Context, am eigentlichen LDN-Fluss vorbei.
- `GET /antwortmanagement/api/inbox/offene-fragen` (neu) liefert nur Inbox-Einträge, deren `object_did` **noch nicht** als `frage_did` in einem bestehenden Antwort-Record (Draft oder finalisiert) vorkommt — dedupliziert nach `object_did` (neuester Eintrag gewinnt), sortiert nach Empfangsdatum.
- Effekt: Wird versucht, dieselbe Frage doppelt zu beantworten, taucht sie nach dem ersten Draft nicht mehr in der Auswahl auf; wird eine falsche Inbox-Adresse konfiguriert (Etappe 4), erscheinen neue Fragen im Antwortmanagement erst gar nicht, was den Fehlerfall in der Demo sichtbar macht.
- Beim Bearbeiten (`startEdit`) einer bereits verknüpften Antwort wird deren Frage weiterhin angezeigt (aus dem lokalen Cache aller je empfangenen Fragen), damit die bestehende Verknüpfung sichtbar bleibt, auch wenn sie nicht mehr Teil der offenen Auswahl ist.

### Notification ohne Inhalt — "da ist was Neues", nicht "hier ist der Inhalt" (umgesetzt)

- `buildLdnNotification()` im Fragenmanagement (`ldn.js`) trägt **nur noch** `object.id` (die Record-DID) und `object.type` — kein Fragetext, keine Session, kein Owner, kein Snapshot-Hash. Die Notification ist bewusst ein reiner, nicht-autoritativer Hinweis, kein Inhaltskanal.
- Das Antwortmanagement löst die DID bei jedem Zugriff auf `GET /inbox` bzw. `GET /inbox/offene-fragen` selbst auf (`resolveRecord.js`): erst `GET /fragenmanagement/did/{did}` (DID-Dokument, liefert `recordEndpoint`), dann `GET` auf diesem `recordEndpoint` — genau der Weg, den auch ein beliebiger Dritter ohne Sonderwissen über die Fragenmanagement-internen Strukturen gehen müsste. Beide Aufrufe laufen über `PUBLIC_BASE_URL`, nicht über das interne Docker-Netz, um diesen Punkt auch technisch nicht zu verwässern.
- Die Antwort dieser Endpunkte enthält zusätzlich zum Original-`payload` (der dünnen Notification) das frisch aufgelöste Feld `record` (der tatsächliche, aktuelle Record) bzw. `null`, wenn er gerade nicht auflösbar ist (z. B. Fragenmanagement nicht erreichbar oder Record nicht mehr finalisiert). `offene-fragen` zeigt nur Einträge mit erfolgreich aufgelöstem `record`.
- Damit setzt der PoC das im README als "im Scope" formulierte Prinzip ("Antwortmanagement liest die Frage via DID direkt aus dem Fragenmanagement, keine lokale Kopie") tatsächlich um, statt es durch mitgeschickte Notification-Inhalte zu unterlaufen. Entspricht dem RWC-Grundsatz "Vollständigkeit wird nicht vertraut, sondern bewiesen" — siehe auch die Diskussion in einem Kommentar zu [RWP-Issue #6](https://github.com/recordweb/rwp/issues/6).

### Authentifizierung / Herkunft der Notification (bewusst nicht umgesetzt)

- Weder RWP noch RWC treffen eine Aussage darüber, wie ein empfangendes System die Herkunft einer Delivery-Notification (z. B. eines LDN-POSTs) authentifiziert — anders als bei der (in RWP tatsächlich spezifizierten, hier im PoC aber noch als Platzhalter umgesetzten) Record-Owner-Signatur. Das wurde bewusst diskutiert und **nicht** als Spezifikations-Lücke eingestuft, die RWP schliessen sollte: Es ist eine Betriebs-/Deployment-Frage (vgl. RWPs expliziter Verzicht auf ein verbindliches Autorisierungsmodell), und der oben beschriebene Resolve-on-Read-Mechanismus macht die Frage weitgehend irrelevant — eine gefälschte oder falsch zugeordnete Notification führt höchstens zu unnötiger, aber folgenloser Auflösungsarbeit, nie zu einem falsch vertrauten Inhalt.
- Ursprünglich als "Etappe 5" mit HMAC-SHA256-Signierung der Notification geplant — bewusst verworfen, da ohne Grundlage in RWP/RWC und durch den Resolve-on-Read-Mechanismus in ihrer Schutzwirkung weitgehend redundant.

## Case-Record im Antwortmanagement (Etappe 6 — umgesetzt)

- Vorher erzeugte "Als Draft speichern" nur einen `fragestunde-antwort`-Record, der die Frage über `frage_did`/`frage_snapshot_hash` referenzierte. Neu erstellt derselbe Klick **zwei** Records in einem Zug: die Antwort und einen umschliessenden `fragestunde-case`-Record (`POST /antwortmanagement/api/cases`), der Frage und Antwort korrekt verlinkt. Beide starten im Status `draft`.
- Der Case-Record ist **keine PoC-Erfindung**, sondern setzt RWPs normativen `CaseRecord`-Typ um (RWP-Spezifikation, Kapitel 8 "Case Specification", Payload-Schema in Annex A.2): `trigger` (genau ein Hard Link — hier die bereits finalisierte Frage), `context`/`process`/`decision` (in diesem PoC-Stand ungenutzt, `[]`/`null`), `result` (mind. ein Hard Link nach Finalisierung — hier die Antwort) und `merkleRoot` (Merkle-Root über alle Hard-Link-`snapshotHash`-Werte, Algorithmus gemäss RWP Abschnitt 9.5).
- **`workingLinks`** ist eine dokumentierte, nicht-normative PoC-Erweiterung (nicht Teil von Annex A.2): Hält den Soft Link (RWP 8.4) auf die noch nicht finalisierte Antwort, solange `result` per Schema nur Hard Links zulässt. Wird die Antwort finalisiert (`PUT /antwortmanagement/api/records/{did}/finalize`), verschiebt das Backend (`caseSync.js`) den Link automatisch nach `result` (jetzt als Hard Link mit dem feststehenden `snapshotHash`) und berechnet die `merkleRoot` neu — der Case selbst bleibt dabei `draft`.
- Ein Case lässt sich erst finalisieren (`PUT /antwortmanagement/api/cases/{did}/finalize`), wenn `workingLinks` leer ist und mindestens ein `result`-Hard-Link vorhanden ist (— die Antwort also finalisiert wurde) sowie die `merkleRoot` verifiziert werden kann. Der Case kennt bewusst **kein eigenes "Bearbeiten"** — nur die verlinkte Antwort wird bearbeitet, der Case wird ausschliesslich nachverlinkt und abschliessend finalisiert.
- `GET /antwortmanagement/api/cases` / `GET /antwortmanagement/api/cases/{did}` reichern den Case um die per DID aufgelöste Frage (`resolvedFrage`, über `resolveRecord.js`, gleicher Resolve-on-Read-Mechanismus wie bei der Inbox) sowie die lokal bekannte Antwort (`antwort`) an — damit zeigt das Frontend die Frage per Resolver-Abfrage und die Antwort direkt, ohne zusätzliche Round-Trips.
- `GET /antwortmanagement/api/cases/{did}/completeness` implementiert die in RWP 8.6 vorgeschlagene Vollständigkeitsprüfung (`complete`, `missingElements`, `openWorkingReferences`, `merkleRootValid`).
- Der Filter `GET /antwortmanagement/api/inbox/offene-fragen` wurde entsprechend umgestellt: er prüft jetzt, ob die `object_did` einer Inbox-Notification bereits als `trigger.recordDid` in einem bestehenden Case vorkommt (vorher: als `frage_did` in einem Antwort-Record) — fachlich äquivalent, da die Verlinkung jetzt im Case statt in der Antwort lebt.
- Der `fragestunde-antwort`-Record selbst verliert `frage_did`/`frage_snapshot_hash` vollständig (`required` ist jetzt nur noch `antworttext`, `bundesrat_did`, `beantwortet_am`) — die Verlinkung zur Frage lebt ausschliesslich im Case.
- **Bekannte Grenze dieser Etappe:** Case-Korrektur/-Versionierung ist nicht gebaut. Wird eine bereits im Case verlinkte, finalisierte Antwort per `new-version` neu versioniert und erneut finalisiert, bleibt der bestehende Hard Link im Case auf den ursprünglichen (jetzt u.U. überholten) `snapshotHash` verweisen — der Case müsste dazu selbst eine neue Version bekommen, was RWP grundsätzlich vorsieht (Records sind versionierbar), hier aber noch nicht umgesetzt ist.

## Status

Dieses Dokument enthält Annahmen aus App-Sicht. Verbindlich wird die jeweilige Schnittstelle erst mit der Bestätigung im zugehörigen Service-Repo (siehe Issues in `rwp-resolver`, `rwp-solid-connector`, `rwp-nanopub-service`). Der DID-Resolver-Abschnitt ist eine Ausnahme: Er beschreibt den tatsächlich implementierten Mini-Resolver im PoC-Repo selbst, nicht einen externen Service.
