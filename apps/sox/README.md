# SoX – System of X

SoX ist im PoC Fragestunde die systemneutrale Sicht auf Records, die aus
unterschiedlichen Anwendungen und Integrationen entstehen.

SoX ist selbst weder ein System of Work noch die jeweilige Quellanwendung.
Es verwaltet bzw. präsentiert die Record-Perspektive einer externen
Kollaboration oder eines anderen integrierten Systems.

## Erste Phase

Die erste Implementierung umfasst ausschliesslich eine statische
Record-Übersicht:

- Darstellung sämtlicher bekannter Records als Cards
- Kein Login und keine Berechtigungsprüfung
- Lokale Beispieldaten im Frontend
- Sichtbare Unterscheidung der RecordTypes `MiniChat` und `TeamsChat`
- Detailansicht eines Records in einem Dialog

Die Beispielrecords dienen nur der Darstellung. Es besteht noch keine
Verbindung zu einer API, zu RWP oder zu einer Chat-Anwendung.

## Aufruf

Die Anwendung ist als statische HTML-Seite verfügbar:

```text
apps/sox/frontend/sox.html
```

Je nach lokaler PoC-Konfiguration kann die Datei direkt geöffnet oder über
den bestehenden Webserver ausgeliefert werden.

## Weiterer Ausbau

Die nächsten Schritte sind:

1. `MiniChat` als eigenständige Anwendung umsetzen.
2. Eine API zwischen MiniChat und SoX definieren.
3. Einen `MiniChat`-Record als Draft in SoX erzeugen.
4. Einen Gesprächssnapshot übernehmen und als neue Version speichern.
5. Den Record explizit finalisieren.
6. Einen Microsoft-Teams-Connector als weitere externe Quelle integrieren.