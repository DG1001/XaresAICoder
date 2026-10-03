# XaresAICoder – Entwicklungslog

Fortlaufendes Protokoll zu Weiterentwicklungen: was geändert wurde, warum, welche
Entscheidungen getroffen wurden und was bewusst offen bleibt. Neueste Einträge
stehen jeweils am Ende eines Abschnitts.

---

## Ausgangslage: Code-Review (2026-10-03, Stand `e11f49b`)

Vier parallele Reviews (Server-Routes/Workspace-Service, Docker/Aliases/Whitelist/
mitmproxy, Frontend, Infra/Deploy/Image). Die schwersten Befunde wurden im Code
gegengeprüft. Kernaussage: Das Sicherheitsmodell geht implizit davon aus, dass alle
Nutzer vertrauenswürdige Admins sind – der Hauptanwendungsfall (Workshops,
Studierende, Security Proxy für Prüfungen) setzt aber das Gegenteil voraus.

Die Befunde wurden in drei Pakete gegliedert:

| Paket | Inhalt | Status |
|-------|--------|--------|
| **1 – Security-Quick-Wins & Bugfixes** | Secrets aus API-Antworten, Passwortprüfung auf allen sensiblen Routen, Whitelist-Validierung, Header-Redaction, XSS, Service Worker, Workshop-Härtung, atomare Persistenz, CA-Key-Rechte | 🚧 in Arbeit (Branch `security/paket-1`) |
| 2 – Isolation | Netzsegmentierung (Workspaces ↔ API/mitmproxy), Forgejo-Token pro Workspace, Snapshot-Sanitizing beim Klonen, `buildContainerSpec()`, echte CPU-/Disk-Limits | offen – braucht Entscheidung zum Vertrauensmodell |
| 3 – Betrieb | Log-Rotation, generierte Secrets, sticky Feature-Flags in `deploy.sh`, Node 22/`npm ci`, CI-Smoke-Test, Image-Pinning, Backups | offen |

---

## Paket 1 – Security-Quick-Wins & Bugfixes

Ziel: die gravierendsten Lücken schließen, **ohne** die Architektur (Netzwerke,
Container-Layout, Git-Workflow) umzubauen. Jedes Thema ist ein eigener Commit auf
`security/paket-1`.

<!-- Einträge pro Thema folgen unten -->

### 1.1 Keine Secrets mehr in API-Antworten und `projects.json`

**Problem**
- `GET /api/projects/:id` und die Antworten von Start/Stop gaben das komplette
  interne Projektobjekt per `...project` zurück – inklusive `passwordHash` (bcrypt)
  und der Alias-Hashes (`authPasswordHash`, ungesalzenes `{SHA}`, sofort knackbar).
- `gitRepository.internalCloneUrl` enthält `http://<admin>:<GIT_ADMIN_PASSWORD>@forgejo…`.
  Das Feld wurde in `projects.json` persistiert und von **allen** Listen-/Detail-
  Endpunkten ausgeliefert → jeder mit Zugriff auf die API (inkl. jedem Workspace,
  da diese die API intern erreichen) hatte das Forgejo-Admin-Passwort.
- Git-URLs mit eingebetteten Credentials (`https://user:token@…`) wurden ebenfalls
  gespeichert und angezeigt.

**Änderung** (`server/src/services/workspace.js`)
- Neue Funktion `serializeProject()` als **einzige** öffentliche Darstellung eines
  Projekts (Allowlist statt Spread). Genutzt von `listProjects`, `getProject`,
  `startProject`, `stopProject`. Die doppelte Mapping-Logik in `listProjects`
  (inkl. unerreichbarem catch-Zweig) ist dabei entfallen.
- `sanitizeGitRepository()`: behält nur `name, fullName, cloneUrl, webUrl,
  description, private, branch`. `internalCloneUrl` wird **nicht mehr persistiert** –
  es wird nur noch transient an `createWorkspaceContainer` übergeben (dort für
  `GIT_REMOTE_URL` benötigt).
- `stripUrlCredentials()`: entfernt `user:pass@` aus `gitUrl` beim Speichern und
  bei der Ausgabe.
- Migration beim Laden: bestehende Einträge in `projects.json` werden beim
  Serverstart bereinigt und beim nächsten Save ohne Secrets zurückgeschrieben.

**Entscheidungen**
- Allowlist statt Blocklist: neue interne Felder landen nicht versehentlich in der API.
- Die Create-Antwort gibt weiterhin das *selbst gesetzte* Klartext-Passwort an den
  Ersteller zurück – das Frontend zeigt es im „Workspace ready“-Dialog an. Kein Leak
  an Dritte, daher bewusst beibehalten.
- Das Admin-Passwort steckt weiterhin als Env-Variable und in `.git/config` jedes
  Workspace mit Forgejo-Repo. Das sauber zu lösen (Token pro Workspace) ist
  **Paket 2**, weil es den Push-/Branch-Workflow beim Klonen verändert.

**Test**: Node-Skript mit gemocktem Docker-Service – Liste, Detail und Start-Antwort
enthalten weder `passwordHash`, `{SHA}`, `internalCloneUrl`, Admin-Passwort noch
Token aus der Git-URL.

### 1.2 Workspace-Passwort auf allen sensiblen Routen

**Problem**
- Nur Start, Stop und Delete prüften das Workspace-Passwort. Clone, Aliases,
  Port-Erkennung, Proxy-Logs, Recorded Domains, LLM-Conversations (lesen/löschen)
  und die Doku-Generierung waren für geschützte Workspaces offen.
- Besonders kritisch: `POST /:id/clone` mit `{count: 1}` lieferte eine **ungeschützte
  Kopie** eines geschützten Workspace (inkl. Dateien, Dotfiles, Git-Credentials).
- Das neue Passwort wurde bei `updatePassword` erst im Speicher gesetzt und dann
  erst im Container – schlug der Container-Teil fehl, passte der gespeicherte Hash
  nicht mehr zum tatsächlichen code-server-Passwort.
- `updateWorkspacePassword` schrieb die Auth-Override-Datei per Heredoc
  (`<< 'AUTHEOF'`). Ein Passwort mit einer Zeile `AUTHEOF` hätte den Heredoc
  beendet und den Rest als Shell ausgeführt.

**Änderung**
- `workspaceService.verifyWorkspacePassword()` – eine zentrale Prüfung statt drei
  Kopien in start/stop/delete.
- Express-Middleware `requireWorkspacePassword` (`routes/projects.js`) auf: clone,
  ports, aliases (GET/POST/PUT/DELETE), squid-logs, recorded-domains,
  llm-conversations (GET/DELETE/DELETE :timestamp), generate-documentation.
- Passwort kommt im Header **`X-Workspace-Password`**, percent-encoded
  (`encodeURIComponent`). Start/Stop/Delete akzeptieren zusätzlich weiterhin
  `body.password` (Abwärtskompatibilität).
- Gemeinsame Validierung `validateNewPassword()` (8–50 Zeichen, **keine
  Steuerzeichen**) für Create, Clone und Passwortänderung.
- `updatePassword`: erst Container aktualisieren, dann Hash übernehmen.
- `updateWorkspacePassword`: Override-Datei wird wie die config.yaml base64-kodiert
  geschrieben – kein Passwortinhalt erreicht mehr die Shell.
- `lines`/`limit`/`offset` der Log-Routen werden auf sinnvolle Bereiche begrenzt
  (sie landen in Shell-Pipelines im Container).
- Frontend (`app.js`): `getWorkspacePassword()` + `protectedFetch()`. Beim Öffnen
  von Clone-, Aliases-, Logs-, AI-Conversations- und Domains-Dialog wird bei
  geschützten Workspaces einmal nach dem Passwort gefragt; danach bleibt es **nur im
  Speicher** des Tabs (nie localStorage). Bei 401 wird erneut gefragt, Abbrechen
  bricht die Aktion ab. Parallele Requests teilen sich einen Prompt. Erfolgreiche
  Start/Stop-Aktionen merken sich das Passwort ebenfalls.
- Passwort-Dialog liegt per `z-index` über den anderen Modals.
- Convo-Viewer (`convo-viewer.html`) fragt bei 401 per `prompt()` nach dem Passwort.
- Doku: `docs/API.md` (Abschnitt Authentication + Clone), `CLAUDE.md`.

**Entscheidungen**
- **Header statt Body**: GET-Routen haben keinen Body, und beim Clone ist
  `body.password` bereits das Passwort der *neuen* Klone – ein eigener Header
  vermeidet die Doppeldeutigkeit.
- **Percent-Encoding** im Header: HTTP-Header sind faktisch ASCII/Latin-1, deutsche
  Passwörter mit Umlauten würden in `fetch()` sonst einen TypeError werfen. ASCII-
  Passwörter ohne `%` können per curl unverändert geschickt werden.
- **Name, Gruppe, Notizen bleiben ohne Passwort änderbar.** Das sind organisatorische
  Metadaten (Drag & Drop zwischen Gruppen soll nicht ständig nach Passwörtern
  fragen). Notizen sind über die Projektliste ohnehin lesbar.
- Das ist **keine Plattform-Authentifizierung** – ungeschützte Workspaces bleiben
  über die API steuerbar. Ein echter Login mit Rollen ist als Feature vorgemerkt.

**Test**: Express-Integrationstest mit gemocktem Docker-Service –
geschützter Workspace ohne/mit falschem Passwort → 401 (clone, ports, llm, aliases),
mit Umlaut-Passwort (percent-encoded) → 200, ungeschützt → 200, unbekannt → 404,
Stop per Header → 200, Passwort mit Zeilenumbruch → 400, `lines=99999` → auf 500
begrenzt. Frontend-Logik per VM-Test: zwei parallele Requests → ein Prompt,
falsches Passwort → erneuter Prompt mit Fehlermeldung, Abbruch → `null`.

### 1.3 Whitelist: Validierung, Parse-Check, Rollback

**Problem**
- `PUT /api/whitelist` prüfte nur, ob `domains` ein Array ist; `_normalizeDomains`
  trimmte nur. Die Liste landete mit Leerzeichen verbunden in **einer** squid.conf-
  Zeile. Ein Eintrag wie `"x.com\nhttp_access allow all"` fügte eine eigene Direktive
  vor `deny all` ein → Security Proxy komplett ausgehebelt.
- Nicht-Strings führten zu einem TypeError (500).
- Exit-Codes von `squid -k reconfigure` wurden ignoriert, es gab keinen Parse-Check
  und keinen Rollback – ein kaputter Eintrag konnte squid für alle Studierenden
  lahmlegen.
- squid.conf wurde per `printf '%s' '<ganze Datei>'` mit Shell-Quoting geschrieben.

**Änderung** (`server/src/services/whitelist.js`, `server/src/index.js`)
- Strenge Validierung je Eintrag: nur Hostnamen (Labels aus `a-z0-9-_`, max. 63/253
  Zeichen, **mindestens zwei Labels**). Erlaubte Schreibweisen: `example.com`,
  `.example.com`, `*.example.com`, `example.com.`. Ungültige Einträge →
  `400` mit Liste (max. 10 angezeigt). Maximal 5000 Einträge pro Request.
- `_execInSquid` arbeitet jetzt mit argv statt `bash -c` und liefert
  `{stdout, stderr, exitCode}`; `_execInSquidChecked` wirft bei Exit ≠ 0.
- Schreiben per base64 (`printf %s "$1" | base64 -d > "$2"` mit Positionsargumenten).
- Ablauf beim Anwenden: Kandidat nach `squid.conf.new` → `squid -k parse -f` →
  bei Fehler `422`, Live-Config unberührt → sonst Backup `squid.conf.bak`, `mv`,
  `squid -k reconfigure` → schlägt das fehl, Backup zurückspielen und erneut
  reconfigure.
- Doku: `docs/API.md` (Apply Whitelist).

**Entscheidungen**
- **Ablehnen statt still überspringen**: Ein Injection-Versuch oder ein Tippfehler
  soll sichtbar sein. Das Frontend zeigt die Server-Meldung an, der Nutzer kann die
  betroffenen Einträge abwählen.
- **IP-Adressen werden abgelehnt**: `dstdomain` matcht Hostnamen; für IPs bräuchte
  es eine `dst`-ACL. Falls „Select All“ in Recorded Domains IP-Literale enthält, muss
  man sie abwählen. Eine eigene `dst`-ACL für IPs wäre ein mögliches Folge-Feature.
- **Einzel-Labels wie `.com` werden abgelehnt**, weil sie faktisch alles freigeben.
- **Offen (Paket 2/3)**: Die Whitelist lebt nur im laufenden squid-Container und geht
  beim Neuerstellen verloren; das Subnetz `172.30.0.0/16` ist weiterhin fest
  eingetragen. Sauberer wäre eine per `include` eingebundene Datei auf einem Volume.

**Test**: Node-Test mit simuliertem squid-Container: gültige Schreibweisen werden
normalisiert und dedupliziert; Newline-Injection, Leerzeichen, IP, `.com`, URL und
Nicht-String → `INVALID`. Erfolgreiches Apply ersetzt nur den Markerbereich; Parse-
Fehler → Live-Config unverändert, Kandidat gelöscht; Reconfigure-Fehler → Rollback.
Der base64-Schreibbefehl wurde lokal mit identischem argv ausgeführt.

### 1.4 LLM-Logging: Credentials redigieren, IP-Wiederverwendung, Pfade

**Problem**
- Das mitmproxy-Addon schrieb alle Request-Header (`Authorization`, `x-api-key`,
  ChatGPT-OAuth-Bearer) und die URL (Gemini: `?key=AIza…`) unverändert auf die Platte.
  Die API lieferte diese Dateien roh aus, das Frontend zeigte sie im JSON-Dump an.
- Gespräche werden pro **Container-IP** abgelegt und beim Löschen eines Workspace nicht
  entfernt. Docker vergibt freie IPs neu → ein neuer Workspace sah die Gespräche (inkl.
  Keys) seines Vorgängers.
- `_flush_all_domains` schrieb alle IPs im Speicher zurück und stellte damit Domain-
  Dateien wieder her, die der Server gerade gelöscht hatte.
- Jeder Flow wurde in `request()` **und** `response()` gezählt (Hit-Counts doppelt).
- Domain- und HTTP-Capture-Dateien wurden nicht atomar geschrieben (der Server konnte
  halbe JSON-Dateien lesen).
- `DELETE …/llm-conversations/:timestamp`: Express dekodiert `%2F`, der Wert ging
  ungeprüft in einen `rm -f`-Pfad im (root-)mitmproxy-Container → Path Traversal.
- Squid-Logs wurden per `grep "<ip>"` gefiltert: `172.30.0.1` traf auch `.10`–`.19`
  und `.100+` (und `.` ist ein Regex-Wildcard) → Logs anderer Workspaces sichtbar.
- WebSocket-Captures (Codex) heißen `<ts>-ws.json`, das Frontend löschte aber
  `<ts>.json` → Löschen einzelner WS-Gespräche lief ins Leere.

**Änderung**
- `mitmproxy/llm-logger.py`: `redact_headers()` / `redact_url()` für Request-,
  Response- und WebSocket-Header; `atomic_write_json()` für alle Dateien; Flush
  verwirft IPs, deren Datei extern gelöscht wurde; Domain-Tracking einmal pro Flow.
- `server/src/services/docker.js`:
  - dieselben Redaction-Regeln beim **Lesen** (`redactConversation`) – schützt auch
    Captures, die vor diesem Fix geschrieben wurden; gilt damit auch für die
    Doku-Generierung.
  - `resetProxyLogsForWorkspace()` löscht Domains **und** Gespräche unter der neuen
    IP – direkt nach `container.start()` (Create und Clone), also bevor der neue
    Workspace Traffic erzeugt. Nebeneffekt: Domains aus der Initialisierung (z. B.
    `git clone`) werden jetzt mit aufgezeichnet statt danach gelöscht.
  - jede Conversation bekommt `_file` (Dateiname ohne `.json`); das Frontend nutzt
    das zum Löschen.
  - Squid-Filter: `awk -v ip="$1" '$3 == ip'` (exakter Vergleich des Client-Felds im
    `detailed`-Logformat), Argumente positionsbasiert statt interpoliert; Fenster
    von 500 auf 5000 Logzeilen vergrößert, damit bei vielen Workspaces genug Treffer
    bleiben.
- `routes/projects.js`: Conversation-ID muss `^[0-9A-Za-z-]{1,64}$` sein, sonst 400.
- Doku: `docs/LLM_CONVERSATION_LOGGING.md` (Data Captured, API Key Exposure, IP-Reuse).

**Entscheidungen**
- **Header-Allowlist vs. -Blocklist**: Blocklist per Muster (`authorization`,
  `cookie`, `*api-key*`, `*token*`, `*secret*`, `*session*`). Eine Allowlist wäre
  strenger, würde aber nützliche Diagnose-Header (`anthropic-version`, `openai-beta`,
  Rate-Limit-Header) verstecken.
- **Löschen beim Erstellen, nicht beim Löschen** eines Workspace: Lehrkräfte wollen
  Mitschnitte ggf. nach dem Löschen noch auswerten (sie bleiben auf der Platte, bis
  die IP wiederverwendet wird). Die eigentliche Lösung – Zuordnung per Projekt-ID statt
  IP (Proxy-Auth pro Workspace) – gehört zu **Paket 2**.
- Request-**Bodies** werden nicht redigiert (dort steckt der eigentliche Inhalt).

**Test**
- Addon mit mitmproxy-Stub: Anthropic- und Gemini-Flow → keine Secrets auf der Platte
  (`x-api-key`, `Authorization`, `?key=`, `x-goog-api-key`, `set-cookie`),
  `anthropic-version` und `alt=sse` bleiben; Domain-Counts = 1 pro Flow; extern
  gelöschte Domain-Datei wird beim Flush nicht wiederhergestellt.
- Server mit gemocktem Docker: alte, unredigierte Capture wird beim Lesen redigiert,
  `_file` enthält `-ws`; der awk-Filter (lokal mit identischem Skript ausgeführt)
  liefert für `172.30.0.1` nur dessen Zeilen, nicht `172.30.0.10`.
- ID-Regex: `../domains/…`, `a/b`, `x.json` abgelehnt; echte Dateinamen erlaubt.
