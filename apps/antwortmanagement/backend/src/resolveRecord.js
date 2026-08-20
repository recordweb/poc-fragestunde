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

const DID_RESOLVER_PATHS = {
  b7d4c810: "/fragenmanagement/did",
  s73f42a3: "/sox/did"
};

function resolverPathForDid(did) {
  const match = /^did:rwp:([^:]+):/.exec(did || "");
  return match ? DID_RESOLVER_PATHS[match[1]] || null : null;
}

// Löst eine Record-DID über das DID-Dokument auf. Das DID-Dokument liefert
// den autoritativen recordEndpoint; erst danach wird der Record selbst bei
// seiner Quelle nachgeladen.
export async function resolveRecord(did) {
  try {
    const resolverPath = resolverPathForDid(did);
    if (!resolverPath) return null;

    const didDocRes = await fetch(
      `${PUBLIC_BASE_URL}${resolverPath}/${encodeURIComponent(did)}`
    );
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
