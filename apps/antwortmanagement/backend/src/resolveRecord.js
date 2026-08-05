// Löst eine Record-DID auf und lädt den zugehörigen Record direkt bei der
// Quelle (Fragenmanagement) nach — genau das, was jedes RecordWeb-System tun
// muss, das nur die DID aus einer (nicht-autoritativen) LDN-Notification
// kennt: erst das DID-Dokument holen, daraus den recordEndpoint entnehmen,
// dann den Record selbst abrufen.
//
// Bewusst KEINE interne Docker-Netzwerk-Abkürzung: Der recordEndpoint im
// DID-Dokument ist die öffentlich resolvbare Adresse (PUBLIC_BASE_URL) — das
// bildet ab, dass ein beliebiger Dritter (nicht nur das Antwortmanagement)
// denselben Weg gehen könnte, ohne Sonderwissen über die Docker-Topologie.
// Eine echte namespace-basierte Root-Auflösung (welcher Resolver ist für
// welchen DID-Namespace zuständig) ist im PoC nicht nachgebildet — hier ist
// von vornherein bekannt, dass Fragen-DIDs vom Fragenmanagement stammen.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

// Liefert den vollständigen, aktuell gültigen Record oder null, wenn er
// (noch) nicht auflösbar ist — z. B. weil der Record nicht (mehr) finalisiert
// ist, die DID unbekannt ist, oder das Fragenmanagement gerade nicht
// erreichbar ist. Wirft absichtlich nicht: ein einzelner nicht auflösbarer
// Eintrag soll nie die ganze Inbox-Ansicht zum Absturz bringen.
export async function resolveRecord(did) {
  try {
    const didDocRes = await fetch(`${PUBLIC_BASE_URL}/fragenmanagement/did/${encodeURIComponent(did)}`);
    if (!didDocRes.ok) return null;
    const didDoc = await didDocRes.json();
    if (!didDoc.recordEndpoint) return null;

    const recordRes = await fetch(didDoc.recordEndpoint);
    if (!recordRes.ok) return null;
    return await recordRes.json();
  } catch {
    return null;
  }
}
