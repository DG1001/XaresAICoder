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
| **1 – Security-Quick-Wins & Bugfixes** | Secrets aus API-Antworten, Passwortprüfung auf allen sensiblen Routen, Whitelist-Validierung, Header-Redaction, XSS, Service Worker, Workshop-Härtung, atomare Persistenz, CA-Key-Rechte | ✅ umgesetzt auf Branch `security/paket-1`, Review-Runde eingearbeitet, Deploy-Test bestanden (1.11) |
| 2 – Isolation | Netzsegmentierung (Workspaces ↔ API/mitmproxy), feste Proxy-IPs, API-Login, Forgejo-Token pro Workspace, Snapshot-Sanitizing beim Klonen, `buildContainerSpec()`, echte CPU-/Disk-Limits | ✅ umgesetzt auf Branch `security/paket-2` (2.1–2.8), Abschluss-Live-Test bestanden |
| 3 – Betrieb | Log-Rotation, generierte Secrets, sticky Feature-Flags in `deploy.sh`, Node 22/`npm ci`, CI-Smoke-Test, Image-Pinning, Backups, persistente Whitelist | ✅ umgesetzt auf Branch `ops/paket-3` (3.1–3.4), CI-Smoke-Test grün |
| 4 – KI-Agenten | Tool-Auswahl prüfen, Updates ohne sudo, Doku | ✅ umgesetzt auf Branch `feat/ai-agents` (4.1–4.3) |
| 5 – Gruppen-Nutzer | Eingeschränkter Dashboard-Zugang pro Gruppe | ✅ umgesetzt auf Branch `feat/group-users` (5.1–5.3), Smoke-Test grün |
| 6 – Workspace-Ressourcen | `/dev/shm` je Workspace, Obergrenzen für RAM/CPU aus `.env`, Ressourcen nachträglich ändern | ✅ umgesetzt auf Branch `feat/workspace-resources` (6.1–6.3), Nachtrag 6.4 auf `fix/workspace-readiness` |

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
- Doku: `docs/API.md` (Abschnitt Authentication + Clone), `CLAUDE.md` (nur lokal – die
  Datei ist gitignored).

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
- ~~**Offen (Paket 2/3)**: Whitelist nur im laufenden squid-Container, Subnetz fest
  eingetragen~~ – erledigt: Subnetz per Env (2.4), Whitelist auf einem Volume (3.1).

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
- *(Nachtrag: in 1.10 auf **Archivieren** statt Löschen umgestellt.)*
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

### 1.5 Atomare, serialisierte Persistenz

**Problem**
- `projects.json` wurde per `fs.writeFile` direkt überschrieben – nicht atomar und
  nicht serialisiert (viele parallele Saves, z. B. beim Klonen). Ein Absturz oder
  volle Platte konnte eine **abgeschnittene Datei** hinterlassen.
- Beim nächsten Start schlug `JSON.parse` fehl, die Projektliste startete leer, und der
  nächste Save überschrieb die kaputte Datei mit nur einem Projekt → alle Metadaten
  und Passwort-Hashes weg.
- Workshop-Claims und -Historie: dasselbe Muster, Saves wurden zusätzlich nicht
  awaited (Antwort an den Client, bevor gespeichert war).

**Änderung**
- Neues Modul `server/src/services/persistence.js`:
  - `writeJsonAtomic(file, data)`: serialisiert zum Aufrufzeitpunkt, schreibt nach
    `<file>.tmp` (Modus **0600**) und benennt per `rename` um; pro Datei eine
    Promise-Kette, Schreibvorgänge laufen strikt in Aufrufreihenfolge. Ein
    fehlgeschlagener Write blockiert die Kette nicht.
  - `readJson(file)`: `null` bei fehlender Datei; eine nicht parsebare Datei wird nach
    `<file>.corrupt-<timestamp>` verschoben (kann also nicht mehr überschrieben
    werden) und `null` zurückgegeben.
- `workspace.js` und `routes/workshop.js` nutzen beide Funktionen; Workshop-Saves
  werden jetzt awaited.

**Entscheidungen**
- **Neue Datei** trotz „keine neuen Dateien“-Leitlinie: zwei Module brauchen exakt
  dieselbe Logik, ein gemeinsamer Helfer vermeidet Duplikation.
- `saveProjectsToDisk` **wirft weiterhin nicht**, sondern loggt: Der In-Memory-Zustand
  ist führend, der nächste erfolgreiche Save persistiert ihn. Da Writes jetzt atomar
  sind, bleibt bei einem Fehler die alte Datei intakt statt halb überschrieben.
- Kein automatisches Wiederherstellen aus der `.corrupt`-Datei – das soll ein Mensch
  entscheiden; sie bleibt zur manuellen Rettung liegen.

**Test**: 200 parallele Saves bei gleichzeitigem Dauerlesen → nie ungültiges JSON,
Endstand = letzter Aufruf, Modus 0600, keine `.tmp`-Reste. Fehlschlag (ENOTDIR)
wird gemeldet, der nächste Save funktioniert. Abgeschnittene Datei → `null` und
Quarantäne-Datei angelegt.

*Randnotiz*: Node 20 hängt bei `fs.mkdir(..., {recursive: true})` unter `/proc` in
einer Endlosschleife (fiel nur im Test auf, betrifft den Produktivpfad
`/app/workspaces` nicht).

### 1.6 Workshop: Admin-Zugang, Claims, Teilnehmerdaten

**Problem**
- Ohne `WORKSHOP_ADMIN_PASSWORD` war die Admin-API **offen** (Namen und E-Mails aller
  Teilnehmenden, Freigeben von Workspaces).
- Admin-Passwort im Query-String (`?password=`) → landet in nginx-Logs, Browser-
  History und Cache-Keys; Vergleich per `!==` (nicht zeitkonstant).
- Die 409-Antwort bei bereits registrierter E-Mail lieferte die **Workspace-URL** –
  wer eine fremde E-Mail kennt, bekam deren Workspace (bei gemeinsamem Klon-Passwort
  vollständiger Zugriff).
- Duplikat-Prüfung lief vor einem `await` → **eine E-Mail konnte parallel mehrere
  Workspaces belegen** (nachgestellt: 20 parallele Requests mit derselben E-Mail →
  5 Workspaces belegt).
- Teilnehmername ohne Längen-/Zeichenlimit; in `admin.html` wurde er per
  `onclick="releaseWorkspace('${esc(name)}')"` eingesetzt. Der Browser dekodiert
  `&#39;` vor dem Ausführen wieder zu `'` → **XSS über das öffentliche Formular**,
  ausgelöst beim Klick auf „Freigeben“; das Admin-Passwort lag in `sessionStorage`.
- `checkPassword` wertete jede Nicht-401-Antwort (auch 500/502) als Login-Erfolg.
- CSV-Export ohne Schutz gegen Formel-Injection (`=HYPERLINK(...)` etc.).

**Änderung**
- `server/src/routes/workshop.js`:
  - Admin-Endpunkte **fail closed**: ohne `WORKSHOP_ADMIN_PASSWORD` → `503` mit Hinweis.
  - Passwort nur noch im Header `X-Admin-Password` (percent-encoded), Vergleich per
    `crypto.timingSafeEqual` über SHA-256-Digests.
  - Claims laufen über eine Promise-Queue (`withClaimLock`): Duplikat-Check, Auswahl
    und Eintrag sind atomar.
  - 409 ohne URL/Projektname, mit Hinweis an die Workshop-Leitung.
  - Name 1–100 Zeichen ohne Steuerzeichen, E-Mail max. 254 Zeichen.
- `frontend/workshop/admin.html`: `adminFetch()` mit Header statt Query, `cache:
  'no-store'`; „Freigeben“ per Event-Delegation mit `data-index` – keine
  Teilnehmerdaten mehr in Inline-JS; Login nur bei `res.ok`, 503-Hinweis wird
  angezeigt; CSV-Zellen, die mit `= + - @` (oder Tab/CR) beginnen, bekommen ein `'`.
- `frontend/workshop/index.html`: Der eigene Claim wird in `localStorage` gemerkt und
  beim erneuten Öffnen angezeigt (ersetzt den bisherigen „409 zeigt URL“-Weg).
  *(Nachtrag: in 1.10 durch ein serverseitig geprüftes Claim-Token ersetzt.)*
- Doku: `docs/API.md`, `docs/user-guide.md`, `.env.example`, `CLAUDE.md` (nur lokal,
  gitignored).

**Entscheidungen**
- **Breaking**: Wer den Admin-Bereich bisher ohne Passwort genutzt hat, muss
  `WORKSHOP_ADMIN_PASSWORD` setzen. Bewusst so – ein offener Admin-Bereich mit
  personenbezogenen Daten ist auch DSGVO-relevant.
- **Breaking**: `?password=` wird nicht mehr akzeptiert (Skripte auf Header umstellen).
- „Link verloren“ auf einem anderen Gerät → Workshop-Leitung (Admin-Seite zeigt alle
  Zuordnungen). Ein Self-Service per E-Mail-Bestätigung wäre ein Folge-Feature.
- **Kein Rate-Limiting** in diesem Schritt: hinter nginx (ggf. plus äußerem Proxy) ist
  die echte Client-IP nicht zuverlässig bekannt, das braucht eine `trust proxy`-
  Entscheidung. Vorgemerkt für Paket 3.
- Korrektur zum Review: Die Vergabe *desselben Workspace an zwei Personen* war im
  alten Code nicht möglich (zwischen Auswahl und `claims.set` lag kein `await`) – die
  reale Lücke war die Mehrfachbelegung durch dieselbe E-Mail.

**Test**: Express-Test mit gemocktem Workspace-Service (künstlich verzögertes
`listProjects`): Admin ohne konfiguriertes Passwort → 503; `?password=` → 401; falscher
Header → 401; richtiger Header mit Umlaut (percent-encoded) → 200. 20 parallele Claims
mit verschiedenen E-Mails auf 5 Workspaces → 5× 200, 5 verschiedene Workspaces, 15× 503.
20 parallele Claims mit **derselben** E-Mail → alter Code 5 Workspaces, neuer Code 1.
409 enthält keine URL; Name > 100 Zeichen bzw. mit Zeilenumbruch → 400.

### 1.7 XSS im Dashboard und Convo-Viewer

**Problem**
- `escapeHtml()` (via `div.textContent → innerHTML`) escaped **keine Anführungszeichen**,
  wurde aber in Attributen und in Inline-Handlern benutzt.
- In Inline-Handlern hilft HTML-Escaping grundsätzlich nicht: Der Browser dekodiert
  `&#39;` vor dem Ausführen wieder zu `'`. Beispiel: Projektname
  `x');alert(1);//` → `onclick="app.deleteProject('id', 'x');alert(1);//')"` →
  Code läuft beim Klick auf Delete. Projektnamen sind serverseitig beim Create nicht
  eingeschränkt → **Stored XSS** für alle, die das Dashboard öffnen.
- Unescaped: Modellname aus mitgeschnittenem LLM-Traffic im AI-Conversations-Dialog
  (jeder Workspace-Nutzer kann `{"model":"<img onerror=…>"}` an api.openai.com
  schicken), `gitRepository.webUrl/name/branch`, ausgewählte Gruppe, Kurzform der
  Git-URL (Rohtext, wenn `new URL` scheitert), Gruppennamen in Handlern,
  `workspaceUrl` im Open-Handler, Alias-URL im `href`.
- Convo-Viewer: `s.time` und `r.time` (aus dem Markdown der Doku-Generierung, also aus
  Gesprächsinhalten) wurden roh eingefügt.

**Änderung**
- `app.js`:
  - `escapeHtml()` escaped jetzt `& < > " '` (rein stringbasiert, kein DOM nötig).
  - Neu `jsArg(value)`: `escapeHtml(JSON.stringify(String(value)))` – liefert ein
    String-Literal, das nach dem HTML-Dekodieren des Attributs gültiges, sicheres JS
    ist. Eingesetzt für Projektname (Delete), Workspace-URL (Open), Gruppen
    (Filter, Drop, Rename, Delete), Alias-Subdomain, Conversation-ID.
  - Neu `safeHref(url)`: nur `http(s)://`, sonst `#` (blockt `javascript:`); für
    Git-URL, Repo-Web-URL, Alias-URL.
  - Restliche Stellen escaped; Port- und Zählerwerte per `Number()` erzwungen.
  - Lokal angelegte/umbenannte Gruppen nutzen dieselbe Zeichenregel wie der Server
    (vorher wurde z. B. „WS 25/26“ lokal akzeptiert, beim Verschieben aber vom
    Server abgelehnt).
- `convo-viewer.html`: `esc()` escaped zusätzlich `'`; Zeitfelder werden escaped.

**Entscheidungen**
- **Minimal-invasiv statt Umbau**: Die saubere Lösung (Event-Delegation mit
  `data-action`, keine Inline-Handler, dann strikte CSP) ist ein größerer Refactor
  von `app.js` und gehört zur geplanten Modularisierung. `jsArg()` schließt die
  Lücke jetzt mit kleinem Diff.
- `projectId` bleibt unverändert in Handlern: serverseitig generierte UUID.
- Im Convo-Viewer kann ein präparierter Gesprächsinhalt weiterhin die *Statistik*
  verfälschen (der Markdown-Parser kennt keine Code-Fences) – das betrifft nur die
  Anzeige der eigenen Mitschnitte, kein Code läuft mehr.

**Test**: `renderProjects()` in einer VM mit DOM-Stub, Projekt mit bösartigem Namen,
Gruppe, Workspace-URL, `javascript:`-Git-URL und Repo-Daten; das erzeugte HTML wurde
mit Pythons `html.parser` geprüft (echte Attribut-Dekodierung).
Neu: keine eingeschleusten Tags/Handler, `href` = `#` für `javascript:`, Handler
enthalten den Namen als *ein* String-Argument; `jsArg()`-Roundtrip liefert exakt den
Originalstring. **Gegenprobe mit dem alten `app.js` (main)**: 7× eingeschleustes
`<img onerror>`, Handler brechen aus (`app.deleteProject('p1', 'x');alert(1);//`).

### 1.8 Service Worker: keine API-Antworten im Cache, frische Deploys

**Problem**
- `'/'` stand in der Precache-Liste, und `isStaticAsset()` prüfte per
  `url.includes(asset)` → **jede** URL galt als statisch. Alles, was nicht explizit in
  `API_ENDPOINTS` stand (`/api/config`, `/api/limits`, `/api/whitelist`,
  `/api/workshop/*`), wurde **cache-first für immer** ausgeliefert: Whitelist-Ansicht
  und Workshop-Admin zeigten veraltete Daten, `ENABLE_PROXY` kam nie im UI an.
  Teilnehmerdaten (und früher das Admin-Passwort im Cache-Key) lagen in der Cache Storage.
- Die übrigen API-Antworten (Logs, LLM-Gespräche) landeten im Dynamic Cache.
- `/workshop/index.html` passte per `endsWith('/index.html')` und wurde nach dem ersten
  Laden ebenfalls cache-first ausgeliefert.
- App-Shell (`app.js`, `style.css`) cache-first; die Cache-Version war nur der Git-Tag
  → ungetaggte Deploys erzeugten ein byte-identisches `sw.js`, Browser behielten das
  alte `app.js` unbegrenzt.
- Precache enthielt eine Google-Fonts-URL für „Segoe UI“, die **HTTP 400** liefert
  (geprüft). `cache.addAll()` ist atomar → nichts wurde gecacht, `skipWaiting()` lief
  nie, `offline.html` war nie verfügbar.
- „Update Now“ lud nur neu, ohne einen wartenden Worker zu aktivieren.

**Änderung**
- `frontend/sw.js.template` (Fetch-Logik neu):
  - nur same-origin `GET` wird behandelt; `/api/*` und `/git/*` werden **nie**
    abgefangen oder gecacht.
  - Precache-Pfade werden **exakt** gegen `url.pathname` geprüft.
  - Icons/Bilder: cache-first. App-Shell (HTML/JS/CSS/Manifest): **network-first**,
    Cache nur offline. Andere Seiten (Workshop, Convo-Viewer): Netzwerk, offline →
    `offline.html`.
  - Install cacht Assets einzeln (`Promise.allSettled`), ein fehlendes Asset blockiert
    nicht mehr den Rest; `skipWaiting()` läuft immer. Nur noch ein Cache, alte Caches
    werden beim Aktivieren gelöscht.
  - Google-Fonts-URL entfernt.
- `deploy.sh`: Cache-Version = Tag + Commit-Hash + Build-Zeit → jeder Deploy erzeugt
  ein neues `sw.js`.
- `frontend/index.html`: Google-Fonts-Links (inkl. Preconnects) entfernt – die Schrift
  existiert dort nicht, das CSS nutzt ohnehin den System-Font-Stack. Nebeneffekt: kein
  Request mehr an Google beim Laden (DSGVO).
- `app.js`: `applyUpdate()` schickt `SKIP_WAITING` an einen wartenden Worker und lädt
  bei `controllerchange` neu.

**Entscheidungen**
- **API gar nicht cachen**: Offline-Anzeige der Projektliste übernimmt bereits der
  localStorage-Cache der App; gecachte API-Antworten bringen nur veraltete Zustände
  und sensible Daten auf die Platte.
- **Network-first für die Shell** statt cache-first: Das Dashboard braucht ohnehin den
  Server; Frische nach Deploys ist wichtiger als ein paar Millisekunden Ladezeit.

**Test**: SW in einer VM mit Stubs für `self`, Cache-API und `fetch`: Install mit
einem fehlschlagenden Asset → übrige Assets inkl. `offline.html` gecacht,
`skipWaiting` aufgerufen; `/api/config`, `/api/workshop/claims`, POST und
Cross-Origin werden nicht abgefangen; `/app.js` geht trotz Cache ans Netz; Icon kommt
aus dem Cache; offline → `app.js` aus dem Cache, Workshop-Seite → `offline.html`.

### 1.9 CA-Private-Key nur für den Eigentümer lesbar

**Problem**
- `deploy.sh` erzeugte `squid/certs/mitmproxy-ca.pem` (privater CA-Schlüssel +
  Zertifikat) per `cat … > …` mit Standardrechten **0644**. Allen Workspaces wird diese
  CA 10 Jahre lang vertraut – wer den Schlüssel lesen kann, kann deren TLS-Verkehr
  abfangen. (Lokal geprüft: die Datei lag mit `-rw-r--r--` auf der Platte, während
  `squid-ca-key.pem` korrekt 0600 hatte.)
- `generate-ca-cert.sh` verließ sich auf den Default von `openssl genrsa` (0600 erst ab
  neueren OpenSSL-Versionen).

**Änderung**
- `deploy.sh`: `mitmproxy-ca.pem` wird unter `umask 077` erzeugt; zusätzlich setzt jeder
  Deploy `chmod 600` auf `squid-ca-key.pem` und `mitmproxy-ca.pem` (repariert auch
  bestehende Installationen).
- `squid/generate-ca-cert.sh`: Schlüssel unter `umask 077` erzeugen, danach `chmod 600`.
- Lokale Datei in diesem Checkout direkt auf 0600 gesetzt.

**Entscheidungen**
- Kein Risiko für den Betrieb: mitmproxy läuft als root und liest die Datei weiterhin;
  squid nutzt den Schlüssel laut `squid.conf` gar nicht (kein SSL-Bump).
- `if … fi` statt `[ -f ] && chmod` in der Schleife: Unter `set -e` hätte die
  `&&`-Variante als letzte Anweisung der Funktion einen Exit-Code 1 liefern können.

**Test**: Der geänderte Block aus `deploy.sh` wurde isoliert unter `set -e` in einem
Temp-Verzeichnis mit Test-Zertifikaten (Ausgangsrechte 0644) ausgeführt → beide
Schlüsseldateien 0600, Zertifikate unverändert 0644, Funktion endet mit Exit 0 – auch
wenn die Dateien fehlen.

### 1.10 Review-Runde: Nachbesserungen

Der komplette Branch-Diff wurde von einem unabhängigen Review-Agenten gegengelesen
(nur Änderungen dieses Branches, Fokus auf neu eingeführte Fehler). Die zentralen
Fixes wurden als korrekt bestätigt (Middleware, Serializer, Whitelist-Validierung/
Rollback, Redaction, Persistenz, Claim-Queue, XSS-Helfer, Service Worker). Gefunden
und behoben:

| # | Befund | Schwere | Behebung (Commit) |
|---|--------|---------|-------------------|
| 1 | Gemerkter Claim in `localStorage` lief nie ab: an geteilten Rechnern sah die nächste Person den fremden Workspace; nach „Freigeben“ zeigte der Browser weiter eine URL, die evtl. schon jemand anderem gehört | Mittel | Zufälliges `claimToken` bei `/claim`; die Seite speichert nur das Token und fragt `POST /api/workshop/my-claim` (404 nach Freigabe). Link „Nicht dein Workspace?“ für geteilte Rechner. Token tauchen weder in Admin-Liste noch Historie auf (`32c7fe1`) |
| 2 | Start/Stop/Delete riefen bei jedem Abschluss `hidePasswordModal()` auf – das brach nun auch einen gerade offenen Passwort-Prompt eines *anderen* Workspace ab | Niedrig–Mittel | Modal wird nur geschlossen/annotiert, wenn es noch den eigenen Prompt zeigt; sonst Fehler-Modal (`9c44103`) |
| 3 | Ein neuer Prompt überschrieb einen offenen Access-Prompt, dessen Promise nie aufgelöst wurde → spätere geschützte Aktionen warteten bis zum Reload | Niedrig | `showPasswordModal` löst einen ersetzten Prompt mit `null` auf (`9c44103`) |
| 4 | Passwortänderung aktualisierte das gemerkte Passwort nicht; Verifikations-Passwörter wurden getrimmt (Passwörter mit Leerzeichen am Rand nie gültig) | Niedrig | Cache wird nach Ändern/Entfernen aktualisiert; Verifikation ohne `trim()` (`9c44103`) |
| 5 | Muster `token` redigierte auch Rate-Limit-Header (`x-ratelimit-*-tokens`) – widersprach der eigenen Entscheidung | Niedrig | `token(?!s)` in Addon und Server (`fb7a37a`) |
| 6 | Beim Erstellen wurden Gespräche unter der neuen IP **gelöscht** – die IP kann einem nur *gestoppten* Workspace gehört haben (Datenverlust für Lehrkräfte) | Niedrig | Verschieben nach `llm_conversations/_archive/<ip>-<UTC>` statt löschen (`fb7a37a`) |
| 7 | Parallele Whitelist-Applies teilten sich `squid.conf.new`/`.bak` | Niedrig | Applies laufen über eine Queue (`dfc9815`) |
| 8 | Base64-Config in *einem* argv-String – Linux begrenzt auf 128 KiB (≈ 4 500 Domains), das 5000er-Limit war nicht erreichbar; alle Domains in einer `acl`-Zeile | Niedrig | Schreiben in 64-KiB-Teilen; ACL auf Zeilen à 20 Domains verteilt (`dfc9815`) |
| 9 | `mitmproxy/__pycache__/*.pyc` versehentlich mitcommittet (durch `py_compile` beim Testen) | Trivial | Entfernt, `__pycache__/` + `*.pyc` in `.gitignore` (`acba60a`) |
| 10 | DEVLOG nannte `CLAUDE.md` als geändert, die Datei ist aber gitignored | Trivial | Einträge korrigiert (lokale Kopie ist aktualisiert) |

**Bewusst offen gelassen**: Ein Workspace, der nach einem *Neustart* zufällig die IP
eines anderen bekommt, sieht dessen Mitschnitte weiterhin (vorbestehend, nicht durch
diesen Branch verursacht). Ein Workspace kann nicht unterscheiden, ob eine IP-Ablage
seine eigene ist – das löst erst die Zuordnung per Projekt-ID (**Paket 2**).

**Tests**: Claim-Token-Lebenszyklus per Express-Test (Token bei Claim, `my-claim` →
200, unbekannt → 404, ungültig → 400, nach Freigabe → 404, Token nicht in Admin-
Liste/Historie). Modal-Szenarien aus dem Review in der VM nachgestellt (Prompt
überlebt fremdes Start-Ende, exaktes Passwort mit Leerzeichen, ersetzter Prompt löst
`null` auf). Header-Muster für typische Credential- vs. Rate-Limit-Header in Python
und JS identisch. Archiv-Skript lokal ausgeführt (Verzeichnis vorhanden/fehlend).
Whitelist mit lokalem „Squid-Emulator“ (echte `sh`/`cat`/`cp`/`mv` auf Temp-
Verzeichnis): 4 500 Domains → 116 KB Config, 3 Chunk-Writes, größtes argv 64 KiB,
226 ACL-Zeilen, `getWhitelist`-Roundtrip vollständig; zwei parallele Applies laufen
strikt nacheinander. Alle früheren Tests gegen den Endstand erneut grün.

---

## Paket 1 – Upgrade-Hinweise (Breaking Changes)

1. **`WORKSHOP_ADMIN_PASSWORD` ist Pflicht** für die Workshop-Admin-Seite; ohne ist
   sie deaktiviert (503).
2. Workshop-Admin-API: Passwort nur noch per Header `X-Admin-Password`;
   `?password=` wird abgelehnt.
3. Passwortgeschützte Workspaces: Skripte, die Clone, Aliases, Ports, Proxy-Logs,
   Recorded Domains, LLM-Conversations oder die Doku-Generierung aufrufen, müssen
   `X-Workspace-Password` mitschicken.
4. Whitelist: IP-Adressen, URLs und Einzel-Labels (`.com`) werden abgelehnt (400).
5. Lokal angelegte Gruppen: nur noch Buchstaben, Ziffern, Leerzeichen, `-`, `_`
   (wie serverseitig schon immer).
6. Beim ersten Serverstart werden `projects.json`-Einträge bereinigt (kein
   `internalCloneUrl` mehr); Dateien werden ab jetzt mit Modus 0600 geschrieben.

## Paket 1 – Verifikation

### 1.11 Deploy-Test gegen die laufende Umgebung (2026-10-03)

**Vorgehen**: Vorher Backup von `workspace_data` (`projects.json`, Workshop-Dateien) und
`nginx_dynamic`. Deploy mit `./deploy.sh --enable-proxy --git-server --skip-build
--skip-env --skip-network` (vorhandenes Code-Server-Image, `.env` und Netzwerke
unverändert). Danach API-Tests per curl, Workspace-Lebenszyklus mit echten Containern
und ein E2E-Test des Dashboards in Headless-Chrome (puppeteer-core). Alle Test-Artefakte
wurden anschließend entfernt.

**Ergebnisse**
- `deploy.sh`: läuft durch; `mitmproxy-ca.pem` und `squid-ca-key.pem` 0600; `sw.js`
  mit neuer Cache-Version (`v7_5_1_0c5c223_<Zeitstempel>`).
- Migration: `projects.json` (27 Projekte) – `internalCloneUrl` 7 → 0, alle 4
  Passwort-Hashes erhalten, Datei jetzt 0600. Bestehende Workshop-Claims (2 aktiv,
  1 Historie) werden weiter geladen.
- API live: keine Hashes/Admin-Credentials in Liste und Detail; geschützter Workspace
  ohne/mit falschem Passwort → 401 (clone, aliases, delete); Whitelist-Injection → 400;
  `?password=` → 401; Path Traversal → 400.
- Workspace mit Passwort (Umlaut), LLM-Logging und Forgejo-Repo: in ~16 s bereit.
  Fake-Requests an Anthropic (`x-api-key`) und Gemini (`?key=`) aus dem Workspace →
  **0 Secrets** auf der Platte und in der API; einzelnes Gespräch per `_file` gelöscht;
  Alias anlegen/löschen; code-server über nginx erreichbar.
- **Archivierung hat sich direkt bewährt**: Unter den neu vergebenen IPs (`.6`, `.7`)
  lagen Mitschnitte alter Workspaces (Juli/April). Mit altem Code hätte der Test-
  Workspace sie gesehen, mit der ersten Fassung von 1.4 wären sie gelöscht worden.
- Clone mit Quell-Passwort im Header und neuem Klon-Passwort: Klon in ~9 s bereit, nimmt
  nur das neue Passwort an, Snapshot-Image aufgeräumt.
- Passwortänderung mit `'`, `"`, Leerzeichen und Umlaut (base64-Schreibweg): neues
  Passwort funktioniert beim Login, altes nicht.
- Whitelist am echten Squid: ungültiger Eintrag → 400; Apply → mehrzeilige ACL besteht
  `squid -k parse`, Backup angelegt; aus dem internen Netz pypi.org/github.com → 200,
  example.com → 403. Squid danach per Recreate auf Standard-Config zurückgesetzt.
- Workshop: Admin per Header → 200, falsch → 401; `my-claim` mit unbekanntem Token →
  404; Seiten werden ausgeliefert.
- Headless-Chrome-E2E: 29 Projekte gerendert, Projektname
  `zz-xss x');alert(1);//<img src=x onerror=alert(2)>` → kein eingeschleuster Tag, kein
  Dialog, Name als Text (auch im Delete-Confirm); AI-Conversations → Passwort-Prompt,
  falsches Passwort → Fehlermeldung, XSS-Modellname literal, kein Key sichtbar; Passwort
  wird gemerkt (Clone ohne erneute Abfrage); Service Worker: `/app.js` über den SW,
  `/api/config` und `/api/projects/` **nicht**, genau ein Cache.

**Beim Live-Test gefunden und behoben** (`fd1e624`)
- `GET /api/whitelist` meldete Wörter aus Inline-Kommentaren der Standard-squid.conf
  (`Bare`, `ACL`, `CDN`, …) als Domains – vorbestehend, hätte aber mit der neuen
  Validierung einen GET→PUT-Roundtrip scheitern lassen. Kommentare werden jetzt
  abgeschnitten (44 echte Domains statt 52).
- Log-Meldung „Archived …“ erschien auch, wenn nichts zu archivieren war.

**Nebenwirkung des Tests**: Die Domain-Aufzeichnungen, die unter den IPs `.6`/`.7`
lagen, wurden beim Erstellen der Test-Workspaces gelöscht. Das ist das bestehende
Verhalten beim Anlegen (nicht neu); die archivierten Gespräche wurden nach dem Test an
ihren ursprünglichen Ort zurückverschoben, das Forgejo-Test-Repo gelöscht.

**Nicht live getestet**: vollständiger Workshop-Claim (es gibt aktuell keine
„JavaLand N“-Workspaces; per Express-Test abgedeckt), Löschen einzelner **WebSocket**-
Captures (braucht Codex-Traffic; `_file`-Mechanik mit HTTP-Capture getestet),
PWA-Update von einer alten auf eine neue SW-Version, Neubau des Code-Server-Images.

### Beobachtete, vorbestehende Probleme (Backlog)

- ~~**„Error loading disk usage“ bei Seiten-Reloads**~~ – behoben 2026-10-25 (siehe
  „Backlog-Aufräumen“ am Ende).
- ~~**Clone-Branch auf leerem Repo**: `setupCloneBranch` meldet „Branch created“, obwohl
  `git push` scheitert~~ – entfallen in 2.7 (eigenes Repo pro Klon, Exit-Code geprüft).
- ~~**`DNS … not ready after 10000ms, proceeding anyway`** beim Erstellen~~ – behoben in
  2.4: Der Server konnte die Namen von Proxy-Workspaces nie auflösen (anderes Netz);
  die Prüfung läuft jetzt in nginx.
- ~~**Alias direkt nach dem Anlegen** liefert kurz 404~~ – behoben 2026-10-25 (siehe
  „Backlog-Aufräumen“ am Ende).
- ~~Klone erben weiterhin `GIT_ADMIN_PASSWORD` und `PASSWORD` aus dem Snapshot-Env~~ –
  erledigt seit 2.2/2.7: `PLATFORM_ENV_KEYS` überschreibt alle Plattform-Variablen im Klon
  leer, sofern der Klon sie nicht selbst setzt; `PASSWORD` ist das Klon-Passwort,
  `GIT_ADMIN_PASSWORD` das Forgejo-Token des Klons.
- **API direkt nach einem Server-Neustart**: etwa 6 s lang „Project not found“ für
  bestehende Projekte, bis `projects.json` geladen ist (beobachtet 2026-10-25, vorbestehend).

### Vorgemerkte Aufgaben und Feature-Ideen

- **XaresAICoder als MCP-Server** (vorgemerkt 2026-10-19): Ein KI-Agent – z. B. Claude
  im Chat – soll sich per MCP mit einem Workspace verbinden können, wenn er „mehr
  braucht“, ohne die Cloud-Umgebung des Anbieters zu nutzen. Kernfunktionen: Dateien
  hoch-/herunterladen, Programme/Befehle im Workspace ausführen (Ausgabe zurück).
  Optional später: Workspace anlegen. Zu klären: Transport (Streamable HTTP über nginx),
  Authentifizierung (eigener Token pro Agent/Workspace statt Admin-Session, vgl. 2.6),
  Begrenzung auf freigegebene Workspaces, Zeit-/Ausgabelimits, Protokollierung.
- **KI-Agenten überprüfen** (vorgemerkt 2026-10-19, umgesetzt in Paket 4): Die neun vorinstallierten Tools
  (Continue, Cline, Aider, OpenCode, Claude Code, Qwen Code, Codex CLI, Crush, Pi)
  durchgehen: Sind alle noch relevant und gepflegt? Gibt es inzwischen weitere
  Kandidaten? Funktioniert das Aktualisieren aus der CLI noch? Erste Befunde:
  `update_ai_agents` (genannt in README, `DEPLOYMENT.md`, `CLAUDE.md`, DEVLOG 3.2) gibt
  es seit 2025-09-29 nicht mehr – ersetzt durch `update_aider`, `update_claude`,
  `update_codex`, `update_crush`, `update_opencode`, `update_pi`, `update_qwen`. Die
  meisten werden laut `info` mit `sudo` aufgerufen, das seit 2.3 standardmäßig aus ist
  (`WORKSPACE_SUDO_ENABLED=false`, `no-new-privileges`); ob die Updates ohne `sudo`
  laufen, ist ungeprüft. Continue und Cline (VS-Code-Erweiterungen) haben kein
  Update-Skript.

---

## Paket 2 – Isolation (Variante 2: Teilnehmer gelten als nicht vertrauenswürdig)

Branch `security/paket-2`, aufgesetzt auf `security/paket-1` (PR #3 am 2026-10-18 in `main` gemergt).

### Entscheidungen vorab (2026-10-03)

| Frage | Entscheidung |
|-------|--------------|
| Vertrauensmodell | **Variante 2**: Wer einen Workspace bekommt, soll weder die Plattform-API, noch den Proxy, noch fremde Repos oder Zugangsdaten der Lehrkraft erreichen. |
| AI-Tool-Logins beim Klonen | Standardmäßig **entfernen**; Häkchen im Clone-Dialog, um sie bewusst mitzukopieren (Workshop-Key). Git-Tokens, Forgejo-Zugang, Passwörter, Shell-History werden immer entfernt. |
| sudo in Workspaces | **Pro Workspace wählbar** (Default aus `WORKSPACE_SUDO_ENABLED`), beim Erstellen und Klonen überschreibbar. |
| Workspace ↔ Workspace | Erreichbarkeit über Ports wird **akzeptiert**, dafür **Passwortpflicht für Klone**. Ein Netz pro Workspace wäre bei vielen Workspaces nicht tragfähig. |

### Plan

| Schritt | Inhalt | Abhängigkeit |
|---------|--------|--------------|
| 2.1 | `buildContainerSpec()`: ein Container-Bauplan für Create und Clone (behebt die bereits auseinanderlaufenden Pfade) | – |
| 2.2 | Klon-Snapshot bereinigen (Env + Dateien), Opt-in für AI-Logins, Passwortpflicht für Klone | 2.1 |
| 2.3 | Härtung: sudo pro Workspace, echtes CPU-Limit (`NanoCpus`), seccomp-Standardprofil (konfigurierbar), Disk-Quota wo das Host-Dateisystem es kann | 2.1 |
| 2.4 | Netzsegmentierung: API-Server nur noch im Control-Netz, getrennte interne Netze für Security- und Logging-Proxy, nginx sperrt `/api/` für Workspace-Subnetze, Migration bestehender Workspaces beim Start | 2.1 |
| 2.5 | Feste IPs für Proxy-Workspaces → Mitschnitte bleiben dauerhaft beim richtigen Projekt | 2.4 |
| 2.6 | API-Login (vorgezogen, schließt das Restrisiko aus 2.4) | 2.4 |
| 2.7 | Forgejo: eigener Nutzer + Token pro Workspace, kein `GIT_ADMIN_PASSWORD` mehr in Workspaces; Klone bekommen einen **Fork** statt eines Branches im gemeinsamen Repo (Vorschlag, siehe dort) | 2.4 |
| 2.8 | Doku, Upgrade-Hinweise, Live-Test | alle |

### 2.1 Ein Container-Bauplan für Create und Clone

**Problem**: `createWorkspaceContainer` und `createCloneContainer` enthielten je ~130
Zeilen fast identischer Env- und HostConfig-Logik, die bereits auseinanderliefen (nur
Clone setzte `User`, Docker-init kam im Upstream nachträglich in beide Kopien). Jede
Härtung aus Paket 2 hätte doppelt gebaut werden müssen.

**Änderung** (`server/src/services/docker.js`): `buildContainerSpec(projectId, opts)`
liefert `{ containerName, useProxy, spec }`; beide Pfade rufen nur noch diese Methode
auf. `User: 'coder'` gilt jetzt für beide (das Image nutzt ohnehin `coder`; nötig, weil
per export/import erzeugte Snapshots den `USER` verlieren).

**Test**: Vorher/Nachher-Vergleich der `createContainer`-Payloads für 24 Fälle (Create/
Clone × kein/Security/Logging-Proxy × mit/ohne Passwort × mit/ohne GPU): Clone
identisch, Create unterscheidet sich ausschließlich durch `User: 'coder'`.

### 2.2 Klone ohne Zugangsdaten der Vorlage, Passwortpflicht

**Problem**: `docker commit` übernahm Env und Dateisystem der Vorlage in jeden Klon:
`GIT_ACCESS_TOKEN` (privates Repo der Lehrkraft), Token in `.git/config`,
`~/.code-server-auth`, Shell-History – und die AI-Tool-Logins der Lehrkraft. Klone
ohne Passwort waren im Docker-Netz für andere Workspaces offen. Außerdem teilten sich
parallele Klon-Batches derselben Quelle einen Snapshot-Tag (der erste Batch löschte den
Snapshot des zweiten), und der export/import-Fallback verlor `ENTRYPOINT`/`USER`.

**Änderung**
- `docker.js`:
  - `commitContainer` erzeugt pro Batch einen eindeutigen Tag (`raw-<ts>`).
  - Neu `sanitizeSnapshot(raw, { keepAiLogins })`: startet einmal pro Batch einen
    Wegwerf-Container aus dem Snapshot (root, `NetworkMode: none`), führt
    `CLONE_CLEANUP_SCRIPT` aus, prüft Exit-Code und Abschlussmarker, committet nach
    `clean-<ts>` und setzt dabei Entrypoint/Cmd/User/WorkingDir aus dem Basis-Image
    (repariert nebenbei den export/import-Fallback). Der Roh-Snapshot wird gelöscht.
  - Klon-Container: Alle Plattform-Env-Variablen (`PLATFORM_ENV_KEYS`), die der Klon
    nicht selbst setzt, werden mit leerem Wert überschrieben.
- `workspace.js`: Ohne bereinigten Snapshot wird **kein** Klon erstellt (alle Klone →
  `error`) – lieber ein fehlgeschlagener Klon als verteilte Lehrer-Tokens.
- `routes/projects.js`: `password` ist Pflicht (400), neues Feld `keepAiLogins`.
- Frontend: Passwort im Clone-Dialog vorbelegt (generiert) und Pflicht; Häkchen „Copy AI
  tool logins of the source“ (Standard aus).
- Doku: `docs/API.md` (Clone).

**Was das Skript entfernt** (Pfade aus `docker diff` echter Workspaces dieser Plattform
ermittelt, nur Dateinamen angesehen):
- *Immer*: `~/.code-server-auth`, Passwort in code-server-`config.yaml`,
  `~/.git-credentials`, `~/.netrc`, `~/.pypirc`, `~/.config/gh/hosts.yml`, npm-
  `_authToken`-Zeilen, `~/.ssh/*` außer `known_hosts`, Shell-/REPL-Histories,
  Zugangsdaten in Git-Remote-URLs (`/workspace` und `~`, Tiefe 4).
- *Ohne Opt-in*: Claude Code (`.credentials.json`, `~/.claude.json`, Projekte/History/
  Sessions/…), Codex (`auth.json`, Sessions, Memories, State-DB), OpenCode (`auth.json`,
  Storage, DB), Qwen (`oauth_creds.json`), Crush (`crush.json`, `hyper.json`), Pi
  (`auth.json`, Sessions), Continue (`config.json`, `.env`, `apiKey`-Zeilen in
  `config.yaml`), Aider (`~/.env`, `~/.aider.conf.yml`, Histories im Repo).
- Einstellungen ohne Geheimnisse (z. B. `~/.claude/settings.json`) bleiben erhalten.

**Entscheidungen**
- **Env leeren statt entfernen**: Beim Commit füllt Docker fehlende Env-Variablen aus
  dem Container-Config wieder auf; entfernen lässt sich nichts. Container-Env überschreibt
  aber Image-Env pro Schlüssel → leere Werte. Der Snapshot selbst wird nach dem Batch
  gelöscht.
- **Einmal pro Batch** bereinigen statt in jedem Klon: schneller, und kein Klon läuft je
  mit ungereinigten Daten.
- **Cline** speichert API-Keys nicht im Dateisystem (in `~/.cline/data/globalState.json`
  stehen nur Einstellungen; vermutlich Secret Storage von code-server) – wird daher nicht
  mitkopiert. `~/.cline/data/secrets.json` wird vorsorglich entfernt.
- **Nicht erkannt** werden Geheimnisse in beliebigen Dateien (z. B. `.env` im Projekt);
  das ist in der API-Doku vermerkt.

**Live-Test**: Quelle mit Passwort, `GIT_ACCESS_TOKEN` und platzierten Fake-Zugangsdaten
(Claude, Codex, OpenCode, Pi, Continue-`apiKey`, Aider-`.env`, History, Git-Credentials,
SSH-Key, gh-Token, npm-Token, Remote mit Token). Clone ohne Passwort → 400. Zwei
**parallele** Batches derselben Quelle (ohne/mit Opt-in) → beide erfolgreich, Snapshots
aufgeräumt. Klon ohne Opt-in: alle Zugangsdaten weg, `settings.json`/`known_hosts`/
Projektdatei vorhanden, Remote ohne Token, `GIT_ACCESS_TOKEN` leer, keine `FAKE`-Werte in
der Env. Klon mit Opt-in: AI-Logins vorhanden, Rest bereinigt. Entrypoint/User korrekt,
Login nur mit Klon-Passwort. Quelle unverändert. Test-Workspaces gelöscht.

### 2.3 Härtung: sudo pro Workspace, echtes CPU-Limit, seccomp, Disk-Quota

**Problem**: `CpuShares` ist nur eine relative Gewichtung (ein Workspace konnte alle
CPUs belegen), es gab kein Disk-Limit (ein Workspace kann die Host-Platte füllen),
`seccomp=unconfined` öffnete die volle Kernel-Angriffsfläche, und sudo war nur global
schaltbar.

**Änderung**
- `buildContainerSpec`:
  - `NanoCpus` (harte Grenze) statt `CpuShares`, gekappt auf die CPU-Zahl des Hosts
    (`getHostCapabilities()` liest `docker info` einmal). `parseCpuCores` entfernt.
  - `sudoEnabled` pro Workspace: ohne sudo `no-new-privileges:true`.
  - seccomp: Docker-Standardprofil; `WORKSPACE_SECCOMP=unconfined` als Opt-out.
  - `StorageOpt.size` aus `WORKSPACE_DISK_LIMIT`, aber nur wenn der Host es kann
    (overlay2 auf xfs); sonst einmalige Warnung im Log.
- Codex: Neue Workspaces und Klone bekommen `sandbox_mode = "danger-full-access"`
  vorangestellt in `~/.codex/config.toml`, sofern dort noch kein `sandbox_mode` steht.
- API/UI: `sudoEnabled` bei Create und Clone (Checkboxen, vorbelegt aus
  `GET /api/config` → `workspaceSudoDefault`); Projekt speichert/liefert `sudoEnabled`.
- `docker-compose.yml` reicht `WORKSPACE_SECCOMP` und `WORKSPACE_DISK_LIMIT` durch;
  `.env.example` dokumentiert beide.

**Entscheidung seccomp (mit dir abgestimmt)**: Standardprofil. Es sperrt unprivilegierte
User-Namespaces – eine der häufigsten Quellen für Kernel-Exploits/Container-Ausbrüche.
Folge: Die eigene Sandbox von Codex (bubblewrap) kann nicht starten (live nachgewiesen:
`bwrap: No permissions to create a new namespace`; mit `unconfined` funktioniert sie).
Der Workspace-Container ist ohnehin die Sandbox, daher läuft Codex darin ohne eigene.
Chrome braucht `--no-sandbox` (Playwright-Default).

**Gilt nur für neu erstellte Workspaces/Klone** – bestehende Container behalten ihre
HostConfig, bis sie neu erstellt werden.

**Tests**
- Spec-Vergleich (24 Fälle): nur die beabsichtigten Änderungen (`NanoCpus` statt
  `CpuShares`, kein `seccomp=unconfined`, `no-new-privileges` je nach sudo).
- Unit: sudo aus/an → `["no-new-privileges:true"]`/`[]`; 8 Kerne auf 4-Kern-Host → 4;
  Quota unterstützt → `{"size":"20G"}`, nicht unterstützt → kein `StorageOpt`;
  `WORKSPACE_SECCOMP=unconfined` → wie bisher.
- Live (Standard-seccomp, ohne sudo): `cpu.max` = `200000 100000` (2 Kerne), seccomp-Modus
  2, sudo blockiert; Node, Python, Git, `npm install`, `pip install --user`,
  `node --inspect`, Multiprocessing und alle 7 CLI-Agents (`--version`) funktionieren;
  `unshare --user` blockiert. Mit sudo: `sudo` funktioniert.
- Codex-Konfiguration: Live-Test fand einen Fehler im ersten Skript (fehlende Datei →
  `[ -f ] && cat` als letzter Befehl → Exit 1 → `mv` lief nie); korrigiert. Danach alle
  drei Fälle geprüft (keine Datei; Datei mit `[table]` → Eintrag davor; vorhandenes
  `sandbox_mode` bleibt). `codex login status` liest die Datei fehlerfrei; ein
  ungültiger Wert wird von Codex abgelehnt (Gegenprobe).
- Auf Docker Desktop (Backing FS `extfs`) ist Disk-Quota nicht verfügbar – nur die
  Erkennung/Warnung ist getestet.

### 2.4 Netzsegmentierung: API-Server, Proxy-Netze, `/api/` aus Workspaces

**Problem**
- Workspaces ohne Proxy hingen mit dem API-Server im selben Netz und erreichten
  `server:3000` direkt – an nginx und einer äußeren Zugangskontrolle vorbei.
- Security- und Logging-Proxy teilten sich `xares-internal`: Ein Security-Workspace
  konnte statt squid einfach den uneingeschränkten mitmproxy (`172.30.0.5:8080`)
  nutzen und so die Whitelist komplett umgehen.
- nginx hängt zwangsläufig in jedem Workspace-Netz (es leitet code-server und App-Ports
  weiter); `/api/` war darüber für jeden Workspace offen – inkl. `PUT /api/whitelist`.

**Änderung**
- `docker-compose.yml`: neues Netz `xares-control` (nginx, Server, Forgejo); der Server
  hängt **nur** noch dort. Neues internes Netz `xares-security`
  (`SECURITY_NETWORK_SUBNET`, Standard `172.31.0.0/16`) für Security-Workspaces mit
  squid, nginx und dnsmasq; `xares-internal` bleibt für Logging-Workspaces und
  mitmproxy (squid ist dort raus). dnsmasq hängt in beiden internen Netzen.
- squid: `xares-entrypoint.sh` setzt die ACL `internal_network` beim Start aus
  `SECURITY_NETWORK_SUBNET` (vorher fest `172.30.0.0/16` in `squid.conf`); der
  Whitelist-Generator definiert die ACL nicht mehr ein zweites Mal.
- `docker.js`:
  - `networkForProxyMode()` / `workspaceNetworks()`; `buildContainerSpec` wählt Netz
    und DNS (dnsmasq im jeweiligen Netz) pro Modus. `getWorkspaceIPAddress` liest die
    IP aus dem Logging- **oder** Security-Netz.
  - `ensureWorkspaceNetwork()` ersetzt `isContainerOrphaned`/`recoverOrphanedContainer`:
    verbindet mit dem Netz des Modus, trennt von den anderen Workspace-Netzen
    (fremde Netze bleiben unberührt) und entfernt **veraltete Netz-IDs** (siehe unten).
    Läuft bei jedem `start` und für alle Workspaces beim Serverstart
    (`migrateWorkspaceNetworks`).
  - `getWorkspaceNetworkRanges()` liefert Subnetze und Gateways der Workspace-Netze.
  - `waitForDnsReady` fragt per `getent hosts` im nginx-Container (der Server teilt
    kein Netz mehr mit Workspaces).
- `aliasesService.writeApiAccessConfig()` schreibt `api-access.conf`
  (`allow <Gateway>; … deny <Subnetz>; …`, Werte validiert); `nginx-base.conf.template`
  bindet sie in `location /api/` ein (Glob → optional beim allerersten Boot).
  `index.js` schreibt sie beim Start als Erstes, danach Migration und Alias-Config.
- `deploy.sh`: `configure_proxy_subnet` prüft beide Proxy-Subnetze auf Konflikte (auch
  gegeneinander) und schreibt Alternativen samt dnsmasq-Adresse in `.env`. Zwei
  vorbestehende Fehler behoben: Im Alternativen-Check fing `except: pass` das
  `sys.exit(1)` ab (jede Alternative galt als frei), und `x=$(…)` brach unter `set -e`
  das Deploy ab, wenn keine Alternative gefunden wurde.
- `.env.example`: `SECURITY_NETWORK_SUBNET`, `SECURITY_DNSMASQ_IP`,
  `SECURITY_PROXY_NETWORK`; Hinweis zu `HOST_PORT=127.0.0.1:<port>`.
- Doku: `SECURITY.md` (Network Isolation inkl. Restrisiken), `PROXY_ARCHITECTURE.md`.
  Die übrigen Erwähnungen von `xares-internal`/`172.30` in der Doku folgen in 2.8.

**Entscheidungen**
- **Logging bleibt in `xares-internal`, Security bekommt das neue Netz**: Mitschnitte
  hängen an der Client-IP. Ein Umzug der Logging-Workspaces hätte ihre IPs und damit die
  Zuordnung der vorhandenen Mitschnitte verändert; Squid-Logs werden nur live gelesen.
- **dnsmasq bleibt** für beide internen Netze: Ohne eigenen DNS-Server könnten externe
  Namen je nach Docker-Version über den Host aufgelöst werden (Exfiltration per DNS).
  Im Security-Netz liegt dnsmasq auf der **letzten** Adresse (`172.31.255.254`): nginx
  und squid haben dort dynamische Adressen, squid bekam beim Deploy prompt `.2`.
- **Sperre per Quell-Subnetz, Gateways erlaubt**: Vom Gateway kommen der Host selbst und
  die Port-Weiterleitung von Docker Desktop (der Browser des Admins). Welches Netz nginx'
  „Veröffentlichungsnetz“ ist, legt Docker selbst fest (hier `xares-aicoder-network`) –
  die Gateway-Ausnahme macht die Regel davon unabhängig.
- **Regeln aus den echten Netzen generiert** statt aus `.env`: Das Subnetz von
  `xares-aicoder-network` wählt `setup-network.sh` ggf. selbst; IPv6-Subnetze werden mit
  erfasst.
- **Kein Ziel-Filter in mitmproxy**: Lokale Modelle (`host.docker.internal`, LAN-IPs)
  sind ausdrücklich ein Logging-Feature; ein Filter auf private Ziele hätte es zerstört,
  ein Filter nur auf `HOST_PORT` wäre bei `HOST_PORT=8000` (vLLM-Standard) ebenso
  kollidiert und hätte direkte Workspaces (gleicher Weg ohne Proxy) nicht geschützt.

**Beim Live-Test gefunden und behoben**: Gestoppte Proxy-Workspaces ließen sich nach
einem Deploy **nicht mehr starten**. `docker compose down` entfernt `xares-internal`,
wenn kein laufender Container daran hängt; der gestoppte Container behält die alte
Netz-ID, Docker antwortet beim Start mit 404 („network … not found“), und die API
meldete irreführend „Workspace container not found“. Betroffen war der vorhandene
Workspace „newtest“. `ensureWorkspaceNetwork` trennt den veralteten Eintrag per Name
und verbindet neu; die 404-Meldung gilt nur noch für fehlende Container.

**Tests**
- Unit (gemockte Docker-API): Netz/DNS pro Modus; Migration (alt→neu, verwaist,
  falsches + fremdes Netz, idempotent); fehlendes Netz → klare Meldung; veraltete
  Netz-ID → trennen + verbinden; fehlendes falsches Netz → Warnung; IP-Lookup;
  `api-access.conf` inkl. IPv6 und Injection-Versuchen; DNS-Check über nginx;
  Whitelist-Abschnitt ohne eigene ACL. `deploy.sh`: Subnetzwahl mit Fake-`docker` für
  5 Fälle (frei, Re-Deploy, fremdes Netz auf 172.31 bzw. 172.30 bei belegtem
  Security-Subnetz, alles belegt → kein Abbruch).
- Live (Docker Desktop, Engine 28.5.1), nach Backup von `workspace_data`,
  `nginx_dynamic`, `mitmproxy_logs`; Deploy mit `--enable-proxy --git-server
  --skip-build --skip-env --skip-network`:
  - Netze wie geplant; Server nur in `xares-control`; `api-access.conf` mit
    `allow 172.19.0.1` und `deny` für 172.19/16, 172.30/16, 172.31/16 (interne Netze
    haben kein Gateway). Health-Check vom Host → 200.
  - Je ein Workspace pro Modus, in ~15 s bereit, DNS-Check über nginx sofort grün.
    Erreichbarkeit:

    | aus … | Server | `/api/` via nginx | mitmproxy | squid | Host-Gateway `/api/` |
    |-------|--------|-------------------|-----------|-------|----------------------|
    | ohne Proxy | – | 403 | – | erreichbar (400) | 403 |
    | Security | – | 403 | **–** | ✔ | – |
    | Logging | – | 403 | ✔ | – | – |
    | Security via squid | 403 | 403 | | | 403 |
    | Logging via mitmproxy | 502 | 403 | | | 403 |

    Workspace-UI über nginx (302) und Forgejo-Web (`/git/`) bleiben erreichbar;
    squid lässt `pypi.org` durch und sperrt `example.com`.
  - Migration: laufender Security-Workspace künstlich ins alte Netz gehängt →
    Serverstart verschiebt ihn; gestoppt → `start` verschiebt ihn; squid danach ✔,
    mitmproxy –. „newtest“ (veraltete Netz-ID) beim Serverstart repariert, startet,
    erreichbar, wieder gestoppt.
  - Mitschnitt im Logging-Workspace (Fake-Key) → per API für das richtige Projekt,
    Key redigiert; Recorded Domains über `172.30.0.3`; Squid-Logs des Security-
    Workspaces gefiltert. Whitelist `PUT` → nur noch eine `internal_network`-ACL
    (`172.31.0.0/16`), `squid -k parse` fehlerfrei, `example.org` danach erlaubt.
  - Klon eines Security-Workspaces landet in `xares-security` mit dnsmasq-DNS.
  - Docker-Verhalten (Wegwerf-Netze): interne Netze erreichen veröffentlichte Host-Ports
    nicht; aus einem anderen Bridge-Netz gesperrt; aus demselben Netz wie nginx kommt die
    Anfrage mit der eigenen Container-IP an (→ 403).
  - Aufgeräumt: Test-Workspaces gelöscht, squid neu erstellt (Standard-Whitelist),
    Test-Mitschnitte/Domain-Dateien entfernt; vorhandene Mitschnitte unverändert
    (nichts archiviert). 27 Projekte wie vorher.

**Restrisiko (bewusst offen, dokumentiert in `SECURITY.md`)**: Was über den
**veröffentlichten Host-Port** zurückkommt, sieht für nginx aus wie der Host selbst.
Unter Docker Desktop erreicht `host.docker.internal:80` die API aus direkten Workspaces
und über mitmproxy (**200**); `HOST_PORT=127.0.0.1:…` hilft dort nicht (getestet).
Unter Linux mit Docker 28 bleibt die Quelladresse erhalten (→ 403); ältere Versionen
mit Userland-Proxy oder ein Reverse Proxy ohne Auth vor der öffentlichen URL öffnen den
Weg wieder. Belastbar schließen lässt sich das nur mit einem **Login für die API** (als
Feature vorgemerkt) oder per Host-Firewall – umgesetzt als Login in 2.6.

**Gilt für bestehende Installationen**: Squid-Image wird neu gebaut (Entrypoint),
`build/nginx.conf.template` von `deploy.sh` neu erzeugt. Migrierte Security-Workspaces
behalten ihr altes `HostConfig.Dns` (`172.30.0.2`, im neuen Netz unerreichbar) – ohne
Wirkung, da externe Namen dort ohnehin nicht auflösbar sind und Containernamen über
Dockers DNS laufen.

### 2.5 Feste IPs für Proxy-Workspaces

**Problem**: mitmproxy und squid kennen einen Workspace nur über seine Client-IP, Docker
vergibt sie aber bei jedem Start dynamisch. Ein neu gestarteter Workspace konnte unter
einer anderen IP zurückkommen – seine Mitschnitte waren dann nicht mehr sichtbar, und
unter der neuen IP lagen womöglich die eines anderen Workspaces (die Archivierung aus
1.4 griff nur beim *Erstellen*). Für gestoppte Workspaces lieferte die API gar nichts
(404), weil Docker die IP beim Stoppen freigibt. Squid-Logzeilen eines gelöschten
Workspaces erschienen beim nächsten Besitzer derselben IP.

**Änderung**
- `docker.js`:
  - `allocateProxyIp(mode, taken)`: niedrigste freie Adresse in der **oberen Hälfte**
    des Subnetzes (z. B. ab `172.30.128.1`), ohne `.0`/`.255`, ohne belegte Adressen
    im Netz, dnsmasq und die IPs aller anderen Projekte (auch gestoppter).
  - `buildContainerSpec(…, proxyIp)` pinnt die Adresse per `IPAMConfig` (nur bei Proxy).
  - `ensureWorkspaceNetwork(…, proxyIp)`: verbindet mit fester Adresse neu, wenn sie
    nicht gepinnt ist – ein laufender Workspace, der sie schon nutzt, bleibt
    ungestört und wird beim nächsten Start gepinnt. Schlägt das Verbinden fehl
    (Adresse belegt), wird er dynamisch wieder angehängt und der Fehler gemeldet.
  - `getSquidLogsForWorkspace(ip, lines, since)`: blendet Zeilen vor `since` aus.
  - `resetProxyLogsForIp(ip)` aus `resetProxyLogsForWorkspace` herausgelöst.
- `workspace.js`:
  - `withProxyIpLock()` serialisiert die Vergabe; Create und Clone vergeben die IP
    vor dem Speichern (`proxyIp`, `proxyIpSince` in `projects.json`). Clone ist
    all-or-nothing: Gehen die Adressen aus, wird kein Klon registriert.
  - `migrateWorkspaceNetworks()` beim Serverstart: Proxy-Workspaces ohne gültige IP
    bekommen eine – ein **laufender** behält seine aktuelle (Mitschnitte bleiben
    zugeordnet), ein gestoppter oder einer, dessen IP schon vergeben ist, bekommt
    eine neue (deren alte Logs werden archiviert/geleert). Liegt eine gespeicherte
    IP nach einer Subnetz-Änderung außerhalb des Netzes, wird neu vergeben.
  - `getProxyIp()` / `getProxyIpSince()` als Quelle für alle Log-Routen.
- `routes/projects.js`: alle sechs Log-Routen nutzen die gespeicherte IP; Squid-Logs
  mit `since`.
- Doku: `LLM_CONVERSATION_LOGGING.md` (IP-to-Project Mapping, Troubleshooting,
  „Static IP Assignment“ aus Future Enhancements entfernt), `SECURITY.md`.

**Entscheidungen**
- **IP behalten statt Logs auf Projekt-IDs umstellen**: mitmproxy und squid sehen
  nur die Client-IP; eine Projekt-ID müsste aus der IP abgeleitet werden – genau
  das, was eine feste IP liefert, ohne Änderungen an Addon und Log-Format.
- **Obere Hälfte**: Docker vergibt dynamische Adressen (nginx und squid im Security-
  Netz, alte Workspaces) von unten; fest vergebene liegen damit außerhalb.
- **Laufende Alt-Workspaces behalten ihre IP**, auch wenn sie in der unteren Hälfte
  liegt: Im Logging-Netz haben alle Infrastruktur-Container feste Adressen, eine
  Kollision ist dort ausgeschlossen; Security-Workspaces gibt es vor 2.5 nur aus der
  Migration von 2.4, und die bekommen dabei ohnehin eine neue Adresse.
- **Kein Aufräumen beim Löschen**: Mitschnitte bleiben auf der Platte, bis die IP neu
  vergeben wird (dann archiviert) – wie bisher.

**Tests**
- Unit: Vergabe (obere Hälfte, belegt/vergeben/dnsmasq/`.0`/`.255` übersprungen,
  `/29`, erschöpft, fehlendes Netz); `ipInSubnet`; Spec pinnt nur bei Proxy; Pinning
  (gestoppt, laufend mit übernommener IP, laufend mit falscher IP, belegte Adresse →
  dynamischer Fallback + Fehler, schon gepinnt); 12 parallele Vergaben → 12 IPs,
  Sperre übersteht Fehler; Boot-Migration (behalten, laufend übernehmen, gestoppt/
  belegt/außerhalb des Subnetzes neu, Logs neuer IPs zurückgesetzt); Squid-`since`-
  Filter mit dem echten awk-Befehl. Regressionstests aus 2.4 weiter grün.
- Live (Backup von `workspace_data` vorher):
  - Serverstart: „newtest“ (gestoppt, Logging) bekommt `172.30.128.1`, in Docker
    gepinnt.
  - Drei Logging-Workspaces **gleichzeitig** angelegt → `.128.2`, `.128.3`, `.128.4`;
    Security → `172.31.128.1`.
  - Mitschnitt (Fake-Key) und Squid-Logs auch nach dem **Stoppen** per API abrufbar;
    nach API-Start und nach `docker restart` (ohne API) dieselbe IP.
  - Klon ×2 eines Security-Workspaces → `.128.2`, `.128.3`.
  - Logging- und Security-Workspace gelöscht und neu angelegt: Die Nachfolger erben
    die IPs; der Mitschnitt des Vorgängers liegt in `_archive/`, die API zeigt 0
    Gespräche; die Squid-Zeile des Vorgängers ist im Log, wird aber ausgeblendet.
  - Aufgeräumt: Test-Workspaces gelöscht, Test-Mitschnitte und Domain-Dateien
    entfernt, 27 Projekte wie vorher.

**Gilt für bestehende Installationen**: Beim ersten Start vergibt der Server die
Adressen (Log: `Fixed proxy IP for …`). Mitschnitte gestoppter Alt-Workspaces, die
unter ihrer früheren dynamischen IP liegen, werden ihnen nicht zugeordnet – das war
schon vorher nicht verlässlich der Fall.

### 2.6 API-Login

**Problem**: Die Plattform-API hatte keine Anmeldung – wer das Dashboard erreichte,
konnte alle ungeschützten Workspaces steuern, die Whitelist ändern usw. Die
Netzsegmentierung (2.4) hält Workspaces nur fern, solange sie nicht über den
veröffentlichten Host-Port kommen; unter Docker Desktop ging das per
`host.docker.internal` (live nachgewiesen), hinter einem Reverse Proxy ohne Auth
über die öffentliche URL.

**Entscheidungen vorab (2026-10-19, mit dir abgestimmt)**

| Frage | Entscheidung |
|-------|--------------|
| Login-Modell | **Ein gemeinsames Admin-Passwort** (`ADMIN_PASSWORD`), Session-Cookie, Login-Dialog im Dashboard. Rollen später. |
| Ohne Passwort | **API gesperrt** (503); `deploy.sh` erzeugt eins. |
| Workspace-Passwörter | **Weiter abfragen**, auch für eingeloggte Admins. |
| Workshop-Admin-Seite | Nimmt **zusätzlich** die Dashboard-Session; `WORKSHOP_ADMIN_PASSWORD` bleibt optional. |

**Änderung**
- `services/auth.js` (neu): signierte Session-Tokens (`<Ablauf>.<Nonce>.<HMAC>`),
  Schlüssel aus `/app/workspaces/.session-secret` (0600, überlebt Neustarts) gemischt
  mit dem Passwort → Passwortwechsel beendet alle Sessions. Cookie `xares_admin`:
  HttpOnly, SameSite=Strict, host-only, `Secure` bei `PROTOCOL=https`, Laufzeit
  `ADMIN_SESSION_HOURS` (12). Logout widerruft die Nonce. Rate-Limit: 10 Fehlversuche
  pro Client (`X-Real-IP`) in 15 Minuten → 429. Middleware `requireLogin` für
  `/api/*` außer Health, `/api/auth/*`, `/api/workshop/*` (dort eigene Prüfung).
- **CSRF**: Workspace-Apps laufen auf Subdomains – *same-site*, der Browser schickt
  SameSite=Strict-Cookies mit. Schreibende Requests mit fremdem `Origin`-Hostnamen,
  `Origin: null` oder `Sec-Fetch-Site: same-site/cross-site` → 403. Clients ohne
  diese Header (curl) sind keine Browser und brauchen ohnehin das Cookie.
- `routes/auth.js` (neu): `POST /login`, `POST /logout`, `GET /status`.
- `routes/workshop.js`: `requireAdmin` akzeptiert die Session (nicht bei Cross-Site-
  Schreibzugriffen) oder wie bisher `X-Admin-Password`.
- Frontend: Login-Dialog (blockierend) und Logout-Button. Ein Wrapper um `fetch`
  öffnet bei `401 LOGIN_REQUIRED` den Dialog und sendet die Anfrage nach dem Login
  erneut – alle bestehenden Aufrufe funktionieren ohne Änderung; parallele Anfragen
  teilen sich einen Dialog. Bei `LOGIN_NOT_CONFIGURED` erklärt der Dialog, was zu
  tun ist. Workshop-Admin-Seite probiert zuerst die Session; Convo-Viewer meldet
  „Nicht angemeldet“ statt nach einem Workspace-Passwort zu fragen.
- `deploy.sh`: `ensure_admin_password` erzeugt ein Passwort (24 Zeichen, a–z/A–Z/0–9)
  in `.env`, auch mit `--skip-env`, und zeigt es am Ende einmalig an.
  `docker-compose.yml` reicht `ADMIN_PASSWORD`/`ADMIN_SESSION_HOURS` durch;
  `.env.example` dokumentiert beide. `tests/test-resource-limits.sh` meldet sich an.
- Doku: `API.md` (Authentication, Workshop-Claims), `SECURITY.md`.

**Tests**
- Integration (Express, echte Router): ohne Passwort 503, Health/Status öffentlich;
  401 `LOGIN_REQUIRED`; Workshop-Teilnehmer-Endpunkte öffentlich; falsches/leeres
  Passwort 401; Login mit Umlaut-Passwort → Cookie-Attribute; manipulierte
  Ablaufzeit/Signatur/Müll → 401; CSRF (curl-artig und same-origin ✔, fremde
  Subdomain/same-site/cross-site/`null` → 403, GET unberührt); Workshop-Admin per
  Session/Passwort, ohne beides 401/503, Cross-Site-Schreibzugriff mit Session → 401;
  Logout widerruft; Passwortwechsel beendet Sessions; Rate-Limit 429 nur für den
  betroffenen Client; `Secure` bei https.
- Live (Deploy mit `--skip-env`): Passwort generiert und in `.env`; ohne Login
  `/api/projects/` → 401, Health/Workshop-Status 200; Login → 27 Projekte; CSRF von
  einer Workspace-Subdomain → 403; Workshop-Claims mit Session 200.
  **Die Lücke aus 2.4 ist zu**: Direkter Workspace und Logging-Workspace über
  mitmproxy → `host.docker.internal/api/projects/` → `401 LOGIN_REQUIRED`.
- Headless-Chrome-E2E: Dialog ohne Session, keine Projekte; falsches Passwort →
  Fehlermeldung; Login per Enter → Projektliste, Logout-Button, Cookie HttpOnly/Strict
  und für JS unsichtbar; Reload bleibt eingeloggt; Cookie mitten in der Nutzung
  gelöscht → Dialog, Anfrage nach Login erneut gesendet; Workshop-Admin-Seite öffnet
  mit Session ohne Passwortabfrage; Logout → Dialog, Workshop-Admin fragt wieder;
  Convo-Viewer ohne Session → „Nicht angemeldet“, kein Prompt. Konsolenfehler nur
  „Error loading disk usage“ bei Seiten-Reloads (vom Browser abgebrochene Requests,
  unabhängig vom Login).
- Aufgeräumt: Test-Workspaces gelöscht, 27 Projekte.

**Bewusst offen**
- Keine Rollen: Jeder Admin sieht und steuert alle Workspaces.
- Rate-Limit pro `X-Real-IP`: Unter Docker Desktop kommen Browser und Workspaces
  (über `host.docker.internal`) mit derselben Gateway-Adresse an – ein Workspace
  könnte den Login dort für 15 Minuten sperren. Unter Linux haben Workspaces eigene
  Adressen (und erreichen `/api/` ohnehin nicht).
- `app.use(cors())` erlaubt weiter jede Origin für **nicht** authentifizierte
  Antworten; mit Cookie scheitern Cross-Origin-Requests am fehlenden
  `Allow-Credentials`.

**Gilt für bestehende Installationen (Breaking Change)**: Nach dem Update ist die API
ohne `ADMIN_PASSWORD` gesperrt. `./deploy.sh` erzeugt es automatisch; wer ohne
`deploy.sh` deployt, muss es in `.env` setzen. Skripte, die die API nutzen, brauchen
das Cookie (siehe `API.md`).

### 2.7 Forgejo: eigener Nutzer und Token pro Workspace

**Problem**: Jeder Workspace bekam `GIT_ADMIN_USER`/`GIT_ADMIN_PASSWORD` des Forgejo-
**Administrators** in die Umgebung, Workspaces mit Repo zusätzlich in die Remote-URL.
Live: ein einziger Nutzer `developer` (Admin), 22 Repos (18 öffentlich), Passwort noch
der Standardwert `admin123!`. Jeder Teilnehmer hatte damit Vollzugriff auf alle Repos
und die Forgejo-Administration. Klone legten einen Branch im gemeinsamen Repo an
(jeder konnte jeden überschreiben); seit 2.2 fehlten den Klon-Remotes die Zugangsdaten,
der Branch-Push scheiterte still (Backlog-Punkt).

**Entscheidungen vorab (2026-10-19, mit dir abgestimmt)**

| Frage | Entscheidung |
|-------|--------------|
| Klone | **Eigenes privates Repo pro Klon**, Stand inkl. History per Push |
| Workspaces ohne Repo | Bekommen **immer** Nutzer + Token (`setup_local_remote` legt Repos im eigenen Namensraum an) |
| Löschen | Nutzer und Repos **bleiben**, nur der Token wird widerrufen. Weiterarbeiten: neuen Workspace aus der Repo-URL anlegen |
| Bestand | **Migrieren** und das Admin-Passwort **rotieren** |

**Änderung**
- `git.js` neu: Admin-Zugang nur noch serverseitig (Basic Auth). Pro Workspace
  `ensureWorkspaceUser` (Name `<projekt-slug>-<8 hex>`, zufälliges, nicht gespeichertes
  Passwort, Profil *private*), `issueToken` (`write:repository`, `write:user`),
  `revokeTokens` (nur Plattform-Tokens), `createRepoForUser` (privat, Namenskonflikt →
  Suffix), `transferRepo`, `addCollaborator`, `parseLocalRepoUrl` (externe `/git/…`- und
  interne `forgejo:3000`-URLs).
- `docker.js`: Env `FORGEJO_USER`/`FORGEJO_TOKEN`, dazu `GIT_ADMIN_USER`/
  `GIT_ADMIN_PASSWORD` mit **denselben Workspace-Werten** für ältere Images – das
  Admin-Passwort erreicht keinen Workspace mehr. `setupCloneBranch` ersetzt durch
  `pushToOwnRepo` (prüft Exit-Code); `execInWorkspace`, `listForgejoRemotes`,
  `setGitRemote`.
- `workspace.js`:
  - Create: Nutzer + Token; Repo auf Wunsch privat im eigenen Namensraum. Ist die
    Klon-URL ein Repo dieses Forgejo, wird der neue Nutzer Collaborator und klont mit
    seinem Token (kein Token im Formular nötig).
  - Clone: Nutzer + Token vor dem Container-Start (Env), danach eigenes Repo und Push.
  - Delete: Tokens widerrufen, Nutzer/Repos bleiben.
  - `migrateForgejoUsers` (Serverstart) + `completeForgejoMigration` (sobald der
    Container läuft, sonst nach dem nächsten `start`): Repos unter dem Admin, die nur
    zu diesem Workspace gehören, werden übertragen und Remotes auf den Token
    umgeschrieben; ein Klon (oder ein von mehreren Projekten genutztes Repo) bekommt
    für `origin` eine eigene Kopie. Fremde Remotes bleiben unberührt. Die Boot-
    Migration läuft nach der nginx-Konfiguration und wartet bis zu 3 Minuten, bis
    Forgejo (startet gleichzeitig) mit dem Admin-Konto antwortet.
- `workspace-init.sh` (Image): `setup_local_remote` nutzt `FORGEJO_*` (Fallback
  `GIT_ADMIN_*`), legt private Repos an und kodiert den Auth-Header mit `base64 -w0`
  (GNU `base64` bricht nach 76 Zeichen um – mit `Nutzer:Token` wäre der Header
  kaputt). **Erfordert neu gebautes Code-Server-Image.**
- `deploy.sh`: `rotate_git_admin_password` ersetzt `admin123!` einmalig durch ein
  zufälliges Passwort (Forgejo-CLI, `.env`, Server neu erstellt);
  `--rotate-git-password` erzwingt es.
- `.env.example`: Admin-Konto muss Forgejo-Admin sein (alte Empfehlung „kein Admin,
  Token statt Passwort“ galt nur, solange es in Workspaces landete). Frontend:
  Git-Hilfe auf `FORGEJO_*`, Hinweis „Weiterarbeiten“. Doku: `SECURITY.md`, `API.md`,
  `ARCHITECTURE.md`.

**API-Verhalten vorher geprüft** (Wegwerf-Nutzer, danach gelöscht): Der Admin kann per
Basic Auth Tokens für andere Nutzer anlegen (auch mit einem Admin-Token als Passwort,
nicht per `Authorization: token`), Repos für Nutzer anlegen, Repos sofort übertragen
(alter Pfad → 307); ein Nutzer-Token bekommt 403 auf die Admin-API.

**Tests**
- Unit (gefälschter Forgejo-Server): Nutzername (lesbar, ≤ 40 Zeichen, gültig),
  Nutzer idempotent und privat, Tokens, Widerruf nur von Plattform-Tokens, Repo privat
  + Suffix bei Konflikt, Übertragung, Collaborator, URL-Erkennung (extern/intern/fremd/
  falscher Port/Unterpfad), Container-Env ohne Admin-Passwort, Migrationsentscheidungen
  (eigenes Repo übertragen, Quelle mit Klonen übertragen, Klon und geteiltes Repo →
  eigene Kopie, eigenes Repo nur Token tauschen, fremde Remotes unberührt).
  Regression 2.4–2.6 grün.
- Live (Backup von `workspace_data`, `forgejo_data` und `.env` vorher):
  - Deploy: `admin123!` rotiert (alt → 401, neu → 200, Server nutzt das neue);
    27 Workspace-Nutzer angelegt, Migration für alle (gestoppt) offen.
  - Alt-Simulation: Workspace mit Admin-Remote auf öffentliches `developer`-Repo
    (laufend) → beim Serverstart übertragen, Remote mit Token; Alt-Klon (gestoppt,
    Remote ohne Zugangsdaten) → beim `start` eigenes privates Repo mit Stand.
  - Isolation: Push ins fremde Repo → „not found“; fremdes (sogar öffentliches) Repo
    lesen → 404, weil der Besitzer privat ist; Admin-API → 403.
  - Neu: Workspace mit Repo → privat, Push mit Token; Klon ×2 → je eigenes privates
    Repo mit History, Push ✔; Vorlage gelöscht → Nutzer/Repo bleiben, 0 Plattform-
    Tokens; neuer Workspace aus `http://localhost/git/<nutzer>/<repo>.git` ohne Token →
    History da, Push mit eigenem Token ✔.
  - Code-Server-Image neu gebaut (ohne Cache, aktuelles Basis-Image, Debian trixie):
    `setup_local_remote` in einem Workspace ohne Repo → privates Repo im eigenen
    Namensraum, `origin` mit Token, Push ✔. Grundcheck: UI 302, Node 22.23.3 mit
    gebündeltem npm 10.9.9 (kein Upgrade), alle sieben CLI-Agents starten.
  - Aufgeräumt: Test-Workspaces gelöscht, Test-Nutzer in Forgejo samt Repos entfernt
    (`purge`); 27 Projekte, 28 Forgejo-Nutzer (27 + Admin).

**Gilt für bestehende Installationen**
- Beim ersten Start bekommt jeder Workspace einen Forgejo-Nutzer; Repos und Remotes
  werden umgestellt, sobald der Workspace läuft. In alten Containern bleibt das
  (rotierte, damit wertlose) Admin-Passwort in der Umgebung, und `setup_local_remote`
  funktioniert dort erst nach Neuerstellung (alte Images lesen nur `GIT_ADMIN_*`).
- Neue Workspaces brauchen das neu gebaute Code-Server-Image für `setup_local_remote`.
- Das Forgejo-Admin-Passwort steht nach der Rotation nur in `.env`.
- Öffentliche Alt-Repos bleiben öffentlich, sind aber für andere Workspace-Nutzer
  unsichtbar (Besitzer privat). Für anonyme Besucher von `/git/` ebenso.
- Unverändert: Security-/Logging-Proxy-Workspaces erreichen Forgejo nicht (nicht in
  ihren internen Netzen).

### 2.8 Doku, Upgrade-Hinweise, Abschluss-Live-Test

**Doku**
- `DEPLOYMENT.md`: neuer Abschnitt **„Upgrading Existing Installations“** – Backup,
  Deploy mit `deploy.sh`, Tabelle aller Änderungen aus Paket 1 und 2 mit nötigen
  Schritten, verbleibende Grenzen. `README.md`: „Security Hardening“ unter Recent
  Updates, Login-Hinweis beim Schnellstart, Forgejo-Login aus `.env`, Klone mit
  eigenem Repo.
- curl-Beispiele (36 in 10 Dateien) senden das Session-Cookie; je Datei ein Hinweis,
  wie man sich per curl anmeldet.
- `INSTALLATION.md`: Git-Admin-Abschnitt neu (Admin-Konto bleibt auf dem Server, muss
  Forgejo-Admin sein, Rotation). `PROXY_ARCHITECTURE.md`: Workspace-Env `FORGEJO_*`.
  `NETWORK_TROUBLESHOOTING.md`: vier Netze, automatische Reparatur beim Start; der
  dokumentierte Endpunkt `/api/system/network-health` existierte nie – ersetzt.
  `OUTGOING_PROXY.md`: Hinweis auf die aktuelle Topologie. `TROUBLESHOOTING.md`:
  Forgejo-Beispiele ohne `admin123!`. Beispiel-IPs in `API.md`/`LLM_CONVERSATION_LOGGING.md`
  an Security- bzw. Logging-Netz und feste IPs angepasst.

**Paket 2 – Upgrade-Hinweise (Breaking Changes)**: siehe `docs/DEPLOYMENT.md` →
„Upgrading Existing Installations“. Kurz: Admin-Login (API ohne `ADMIN_PASSWORD`
gesperrt), Security-Proxy-Workspaces in neuem Netz `xares-security` (Subnetz prüfen),
feste Proxy-IPs, Forgejo-Admin-Passwort wird rotiert und bleibt auf dem Server,
Code-Server-Image neu bauen, Klone brauchen ein Passwort.

**Abschluss-Live-Test (Docker Desktop, Engine 28.5.1)**
- Erneutes Deploy mit dem finalen Stand: idempotent – kein neues Admin-Passwort,
  keine erneute Forgejo-Rotation, 27 Projekte, 28 Forgejo-Nutzer, API-Sperrliste da.
- Alle Testsuiten gegen den finalen Code: Netze (10), feste IPs (8), Login (10),
  Forgejo (6), Subnetzwahl in `deploy.sh` (5 Fälle) – grün.
- Ein Workspace pro Modus: Netz und feste IP wie erwartet (direkt dynamisch,
  Security `172.31.128.1`, Logging `172.30.128.2`), harte CPU-Grenze, eigener
  Forgejo-Nutzer überall. Erreichbarkeitsmatrix identisch mit 2.4 (Server nie
  erreichbar, `/api/` über nginx 403, kein Proxy-Hopping, Squid-Whitelist greift).
  Hinweis: `pypi.org/simple/` (Gesamtindex, viele MB) läuft über den puffernden
  mitmproxy in den Timeout des Probe-Skripts; einzelne Paketseiten und `pip download`
  funktionieren.
- Direkter Workspace mit Repo: Push mit eigenem Token, Admin-API 403. Klon eines
  Security-Workspaces: feste IP `172.31.128.2`, eigener Forgejo-Nutzer, PyPI über
  squid ✔ (Forgejo ist aus Proxy-Netzen wie bisher nicht erreichbar).
- Headless-Chrome-E2E (Login, falsches Passwort, Reload, Session-Verlust, Workshop-
  Admin, Logout, Convo-Viewer): alle 8 Schritte ✔.
- Aufgeräumt: Test-Workspaces, Forgejo-Test-Nutzer und Probe-Artefakte in
  `/var/log/mitmproxy` entfernt; Zustand wie vorher (27 Projekte, 28 Forgejo-Nutzer).

---

## Paket 3 – Betrieb

Branch `ops/paket-3`. Reihenfolge (mit dir abgestimmt, 2026-10-19): 1) generierte
Secrets + persistente Whitelist, 2) Sticky Flags, Node 22/`npm ci`, Image-Pinning,
3) Backups + Log-Rotation, 4) CI-Smoke-Test.

### 3.1 Generierte Secrets und persistente Whitelist

**Problem**
- `docker-compose.yml` setzte `FORGEJO__security__SECRET_KEY` fest auf den öffentlich
  bekannten Platzhalter `your-secret-key-change-this-in-production` – live auch in
  `app.ini`. Forgejo signiert damit u. a. Sessions und CSRF-Tokens und verschlüsselt
  2FA-, Mirror- und Actions-Secrets.
- Eine per `PUT /api/whitelist` angewandte Whitelist lebte nur in der `squid.conf`
  des Containers; jedes `deploy.sh` (Container neu erstellt) setzte sie zurück.

**Änderung**
- `docker-compose.yml`: `SECRET_KEY=${FORGEJO_SECRET_KEY:?…}` – ohne Wert bricht
  `docker compose` mit klarer Meldung ab. Der leere `INTERNAL_TOKEN`-Eintrag ist raus
  (Forgejo erzeugt ihn selbst).
- `deploy.sh`: `ensure_generated_secret` (allgemein) erzeugt fehlende/leere Werte in
  `.env`, auch mit `--skip-env`; genutzt für `ADMIN_PASSWORD` und neu
  `FORGEJO_SECRET_KEY` (64 Zeichen). `.env.example` dokumentiert ihn.
- squid: Der Whitelist-Abschnitt (ACLs + Access-Regeln) steht jetzt in
  `squid/whitelist-default.conf`; `squid.conf` bindet
  `/etc/squid/whitelist/whitelist.conf` per `include` ein. Diese Datei liegt auf dem
  neuen Volume `squid_whitelist`; `xares-entrypoint.sh` befüllt es beim ersten Start
  aus der Vorlage.
- `whitelist.js`: liest/schreibt nur noch die Whitelist-Datei; Prüfung mit
  `squid -k parse` gegen eine Kopie von `squid.conf`, die den Kandidaten einbindet;
  Backup und Rollback wie bisher.

**Entscheidungen**
- **Leerer Schlüssel ist keine Option**: Test mit Wegwerf-Forgejo – ein leerer Wert
  landet als leerer `SECRET_KEY` in `app.ini`, Forgejo läuft damit; einen eigenen
  erzeugt es nicht. Daher harter Abbruch statt stiller Unsicherheit.
- **Schlüsselwechsel auf Bestandsinstallationen**: Vorher geprüft – keine mit
  `SECRET_KEY` verschlüsselten Daten (0 Actions-Secrets, Push-Mirrors, 2FA, Webhooks;
  nur die drei eingebauten OAuth-Apps). Wer 2FA, Mirrors oder Actions-Secrets nutzt,
  muss sie nach dem Wechsel neu einrichten (Upgrade-Hinweis).
- **Volume statt Server-seitiger Wiederanwendung**: squid lädt die Datei selbst beim
  Start; kein Zeitfenster mit Standard-Whitelist nach einem Neustart von squid.

**Tests**
- `deploy.sh`-Funktionen mit temporären `.env`: Schlüssel fehlt / leer / gesetzt →
  erzeugt (24 bzw. 64 Zeichen) / erzeugt / unangetastet; kein Abbruch unter `set -e`.
- Live (Backup von `forgejo_data` und `.env` vorher): Deploy erzeugt
  `FORGEJO_SECRET_KEY`, `app.ini` übernimmt ihn, Platzhalter weg; Admin-Login und
  Web-UI funktionieren. Whitelist auf dem Volume, `squid -k parse` fehlerfrei.
  Security-Workspace: `PUT` mit `example.org` → erlaubt, `example.com` gesperrt;
  squid neu erstellt → weiterhin erlaubt; komplettes Deploy → weiterhin erlaubt,
  Secrets unverändert. Danach Standard-Whitelist wiederhergestellt, Test-Workspace
  und Forgejo-Testnutzer entfernt.

### 3.2 Sticky Feature-Flags, Node 22 / `npm ci`, Image-Pinning

**Problem**
- `deploy.sh` ohne `--git-server` bzw. `--enable-proxy` schrieb `ENABLE_*=false` in
  `.env` – ein vergessenes Flag schaltete Git-Server oder Proxy unbemerkt ab.
- Der API-Server lief auf `node:18-alpine` (seit April 2025 ohne Support) und
  installierte mit `npm install` (nicht reproduzierbar, inkl. Dev-Abhängigkeiten).
- `nginx:alpine`, `forgejo:9`, `mitmproxy:latest`, `dnsmasq:latest`,
  `ubuntu/squid:latest`, `codercom/code-server:latest`: Jeder Rebuild konnte andere
  Versionen bringen (in 2.7 kam so ungeplant ein neues Debian-Basisimage).

**Änderung**
- `deploy.sh`: `set_feature_flag` – Flag gesetzt → an, neue `--disable-git-server` /
  `--disable-proxy` → aus, ohne Flag bleibt der Wert aus `.env`. Die Subnetzprüfung
  läuft, wenn der Proxy *effektiv* aktiv ist, ebenso die CA-Erzeugung.
- `server/Dockerfile`: `node:22-alpine`, `npm ci --omit=dev`.
- Pinning auf die **laufenden** Versionen (kein Versionssprung): `nginx:1.29.0-alpine`,
  `forgejo:9.0.3`, `mitmproxy:12.2.1`, `codercom/code-server:4.141.0`; dnsmasq
  (2.84rc2) und squid (6.13) per Digest, weil kein Versions-Tag zum laufenden Build
  passt (`ubuntu/squid:6.13-25.04_*` hat einen anderen Digest). Node nur auf die
  Hauptversion – Sicherheits-Patches sollen mit Rebuilds kommen.
- KI-Tools im Code-Server-Image bleiben bewusst auf `latest` (`update_ai_agents`).
- Doku: `DEPLOYMENT.md` („Pinned versions“, Upgrade-Tabelle).

**Tests (live)**
- Deploy **ohne** Feature-Flags und ohne `--skip-env`: „Keeping … ENABLE_GIT_SERVER=true /
  ENABLE_PROXY=true“, Subnetzprüfung lief, `.env` unverändert, Git-Server-Setup ✔.
- Laufende Dienste genau in den gepinnten Versionen; Server Node 22.23.3, `npm ci`
  (166 Pakete). Login, Projektliste, Whitelist ✔; Workspace mit Repo angelegt, UI 302,
  gelöscht (Forgejo-Testnutzer entfernt).
- Code-Server-Image mit gepinnter Basis gebaut: alle Schritte aus dem Cache, gleiche
  Image-ID wie zuvor → Basis identisch mit dem bisherigen `latest`.

### 3.3 Log-Rotation und Backups

**Problem**
- Kein Container hatte ein Limit für seine Docker-Logs (`json-file` ohne `max-size`).
  dnsmasq (`--log-queries`), mitmproxy und squid schreiben eine Zeile pro Anfrage;
  squid spiegelt sein `access.log` zusätzlich per `tail -F` auf stdout.
- squids `access.log` liegt auf dem Volume `squid_logs` und wurde nie rotiert (live
  38 MB, übersteht jeden Redeploy). `logrotate` und `cron` sind im Image, laufen aber
  nicht.
- Es gab kein Backup. Workspaces haben **keine Volumes**: Ihre Dateien liegen in der
  beschreibbaren Schicht des Containers (live 27 Container, 10 MB bis 3,5 GB).

**Änderung**
- `docker-compose.yml`: YAML-Anker `x-logging` (`json-file`, `max-size`
  `${LOG_MAX_SIZE:-10m}`, `max-file` `${LOG_MAX_FILE:-3}`) für alle sechs Dienste;
  `docker.js` setzt dieselben Werte als `LogConfig` in `buildContainerSpec()` (Anlegen
  und Klonen). `.env.example` dokumentiert beide Variablen.
- squid: `squid/logrotate.conf` (täglich, ab 100 MB früher, 14 Generationen, gzip,
  `delaycompress`, `postrotate` → `squid -k rotate`); `xares-entrypoint.sh` startet
  eine Schleife, die stündlich `logrotate` aufruft, Statusdatei auf dem Volume.
  `squid.conf` setzt `logfile_rotate 0` ausdrücklich (kam bisher nur aus `conf.d` des
  Ubuntu-Pakets), damit `-k rotate` die Dateien nur neu öffnet.
- Neues `backup.sh`:
  - Ohne Option: `.env`, `squid/certs` (CA) und die Volumes `workspace_data`,
    `forgejo_data`, `nginx_dynamic`, `squid_whitelist`, `mitmproxy_logs` nach
    `backups/xares-<Zeit>/` (Modus 700/600, `MANIFEST`); erst in `.partial`, bei Erfolg
    umbenannt, bei Abbruch gelöscht. `--keep N` (Standard 7) räumt ältere auf.
  - `--workspaces`: pro Workspace `/workspace` und `/home/coder` per `docker cp` (auch
    gestoppte Container), ohne Caches, Image-Anteile (`extensions`,
    `CachedExtensionVSIXs`, OpenCode-Binary) und die code-server-Anmeldung;
    `workspaces/index.tsv` mit ID und Projektname. Fehlgeschlagene Workspaces landen in
    `workspaces/FAILED`, Exit-Code 1.
  - `--restore`: stoppt die Plattform-Container (Compose-Label), sichert den aktuellen
    Stand nach `xares-<Zeit>-before-restore`, spielt `.env`, CA und Volumes zurück
    (fehlende Volumes mit Compose-Labels anlegen) und startet wieder – nicht, wenn sich
    `.env` oder die CA geändert haben (dann `./deploy.sh`).
  - `--restore-workspace BACKUP ID [--into ID]`: kopiert die Dateien per `docker cp -a`
    zurück in denselben oder einen neuen Workspace.
- `.gitignore`: `backups/`. Doku: `DEPLOYMENT.md` (Abschnitte „Logs“, „Backup and
  Restore“, Upgrade-Tabelle), README, Hinweis in `SNAPSHOTS_AND_BACKUPS.md`.

**Entscheidungen** (mit dir abgestimmt, 2026-10-19)
- **Workspaces per Flag**: Standard nur Plattformdaten (klein, ~7 s), `--workspaces`
  zusätzlich die Nutzerdaten. Volle Container-Snapshots wären bei dir ≈ 30 GB.
- **Forgejo kurz stoppen** statt `docker pause` (crash-konsistent, mögliche `.lock`-
  Dateien) oder `forgejo dump` (Restore aufwendig). Git ist dabei wenige Sekunden weg.
- **Eigenes Skript mit Restore** statt Subcommand in `deploy.sh` (schon 1163 Zeilen).
- **Aufbewahrung**: Docker 10 MB × 3, squid 14 Tage; LLM-Mitschnitte und `_archive`
  sind Daten, keine Logs, und bleiben unangetastet.
- **tar im gepinnten nginx-Image** (busybox): auf jeder Installation vorhanden, kein
  weiteres Image; `--numeric-owner`, weil die Volumes UIDs aus anderen Images
  enthalten (squid 13, Forgejo 1000). Die Archive werden dem aufrufenden Nutzer
  übergeben (`chown`): Auf diesem Host legt root im Container root-eigene Dateien an.
- **code-server-Anmeldung nicht im Backup**: `config.yaml`/`.code-server-auth` gehören
  zum Container. Sonst würde `--into` Passwort bzw. Auth des Ziel-Workspace
  überschreiben und ein Restore ein inzwischen geändertes Passwort zurückdrehen.
- **Kein Neuanlegen von Containern**: Auf einem neuen Host stehen die Projekte wieder
  in der Liste, ihre Container fehlen. Neue Workspaces anlegen und `--into` nutzen;
  ein „Container zu bestehendem Projekt neu erzeugen“ wäre ein eigenes Feature.

**Tests (live)**
- Vorher manuelle Sicherung von `.env`, CA und Volumes
  (`~/xares-backups/…/*-before-3.3*`). Deploy: alle Dienste mit
  `{"max-file":"3","max-size":"10m"}`, Server kennt `LOG_MAX_*`; neuer Workspace
  ebenso.
- logrotate: Trockenlauf ok; erzwungene Rotation → `access.log.1`, squid schreibt
  nach `-k rotate` in die neue Datei, `tail -F` folgt (`docker logs`); zweite Rotation
  → `access.log.2.gz` (38 MB → 2,4 MB). Danach `-k rotate` stumm geschaltet (gab jedes
  Mal alle Whitelist-Warnungen aus).
- Backup ohne Workspaces: 7 s, 97 MB; Forgejo gestoppt/gestartet, danach `healthy`,
  `/git/` 200. `--keep 2` löscht nur ältere reguläre Backups, nicht `-before-restore`
  oder `.partial`.
- `--workspaces` über 28 Workspaces: exit 0, knapp 10 min, 3,2 GB. Größter Brocken war
  `CachedExtensionVSIXs` (bis 300 MB pro Workspace) → ausgeschlossen. Zweiter Lauf
  (27 Workspaces): exit 0, 8,5 min, 1,2 GB, keine Cache-Pfade mehr in den Archiven.
- Restore in denselben Workspace: veränderte/gelöschte Dateien zurück, Besitzer
  `coder:coder`, Rechte 600 erhalten, neue Dateien bleiben, Container läuft wieder.
  `--into` in einen passwortgeschützten Workspace: Dateien da, Login weiter verlangt.
- Plattform-Restore: Projekt umbenannt und `example.org` auf die Whitelist gesetzt,
  dann Restore (13 s) → Name und Whitelist (44 Einträge) wieder wie vorher, 29
  Projekte, Forgejo `healthy`, Git 200, Workspace 302, `-before-restore` angelegt.
- Restore in neue Volumes (Wegwerf-Projektname `xarestest`): Volumes mit Labels
  `com.docker.compose.project/volume` angelegt, Pfade wie im Archiv, `gitea.db`
  bitgleich, Hinweis „Start the platform with ./deploy.sh“.
- Aufgeräumt: Test-Workspaces, ihre Forgejo-Nutzer, `xarestest_*`-Volumes und die
  Test-Backups.

### 3.4 CI-Smoke-Test, `.env` nur für den Eigentümer

**Problem**
- CI baute Images nur beim Release-Tag; ob die Plattform danach startet, Workspaces
  anlegen kann und die Isolation greift, prüfte nichts. `tests/` enthielt nur alte
  Ad-hoc-Skripte ohne echte Prüfung.
- `deploy.sh` ohne Terminal (CI, cron, `</dev/null`) brach an der Frage „edit the
  configuration?“ **still** ab: `read` liefert bei EOF 1, `set -e` beendet das Skript
  ohne Meldung. Unbeaufsichtigt ging nur `--skip-env`.
- `.env` (Admin-Passwort, Forgejo-Schlüssel und -Admin-Passwort) entstand per
  `cp .env.example` mit der umask, meist `644` – für alle Nutzer des Hosts lesbar
  (live so vorgefunden).

**Änderung**
- `tests/smoke-test.sh` (liest `.env`, prüft über nginx mit `--resolve`): API-Sperre
  ohne Login, Login, Dashboard, Catch-all-404, Forgejo; Workspace ohne Proxy (VS Code
  über nginx, neun KI-Tools, Log-Limit, `/api/` aus dem Workspace gesperrt, eigener
  Forgejo-Nutzer, Stop/Start/Löschen); Security-Proxy-Workspace (`pypi.org` erlaubt,
  `example.com` 403, kein direkter Internetzugang); Logging-Proxy-Workspace
  (`example.com` über mitmproxy, Domain aufgezeichnet, kein direkter Zugang);
  `--backup`: `backup.sh` + Restore, danach API, Login, `projects.json` unverändert,
  Forgejo. Räumt beim Beenden alles ab (Workspaces, Forgejo-Nutzer per Admin-API,
  Domain-Datei); Passwörter gehen per stdin an curl, nicht über die Kommandozeile.
- `.github/workflows/smoke-test.yml`: bei PRs, Push auf `main` und manuell (vorerst
  auch auf `ops/paket-3`). Statische Prüfungen (`bash -n`, `node --check`, Python-
  Syntax des mitmproxy-Addons, `docker compose config` aller Profile), dann
  `.env` aus `.env.example` und `./deploy.sh --git-server --enable-proxy </dev/null`,
  dann `tests/smoke-test.sh --backup`; bei Fehlern Container- und Workspace-Logs.
  Ein neuer Push bricht den laufenden Test desselben Branches ab.
- `deploy.sh`: alle Rückfragen mit `|| REPLY=""` – ohne Terminal gilt die
  Standardantwort. `ensure_admin_password` setzt `.env` auf `600`.
- Doku: `DEVELOPMENT.md` (Smoke Test), `GITHUB_ACTIONS.md`, Upgrade-Tabelle.

**Entscheidungen** (mit dir abgestimmt, 2026-10-19)
- **Voller Durchlauf** statt nur Plattform ohne Workspaces: Die Kernfunktion
  (Workspace anlegen) und die Isolation sind das, was kaputtgehen kann. Kostet bei
  einem öffentlichen Repo nichts.
- **Echter `deploy.sh`** statt eigenem Compose-Aufruf im Workflow: CI prüft so auch
  den Weg, den Nutzer gehen (Secrets, CA, Netze, Forgejo-Setup, Passwort-Rotation).
- **Ein Skript für CI und lokal**: gegen die eigene Installation in etwa einer Minute,
  ohne Spuren; `--backup` nur auf Wunsch, weil es die Plattform kurz stoppt.
- **Whitelist nicht verändern**: Der Security-Test nutzt die Standard-Domains
  (`pypi.org` ist dort komplett frei), damit er eine angepasste Whitelist einer
  echten Installation nicht anfasst.
- Bekannt, hier nicht geändert (→ 3.5): `--skip-env` ignoriert `--git-server`/`--enable-proxy`
  (die Flags werden in `setup_environment` geschrieben). Vorbestehend seit 3.2.

**Tests (live)**
- Statische Prüfungen lokal sauber (Node 22 im Container, `compose config` mit
  `.env.example` + Platzhalter-Schlüssel).
- Erster Lauf gegen die Live-Umgebung: 28 von 29 grün; KI-Tool-Prüfung scheiterte am
  Begrüßungstext der Login-Shell (→ Markierung `missing:`). Forgejo-Nutzer wurden
  nicht entfernt: Der Container entsteht asynchron, `FORGEJO_USER` wurde vor dem
  Start gelesen (→ erst nach `running`). Drei Testnutzer von Hand gelöscht.
- Deploy ohne `--skip-env` mit `</dev/null`: läuft durch, `.env` von `644` auf `600`.
- Zweiter Lauf mit `--backup`: alle 36 Prüfungen grün in 82 s; danach 27 Projekte,
  27 Workspace-Container, 28 Forgejo-Nutzer wie vorher, keine Temp-Verzeichnisse.

**CI auf GitHub** (fünf Läufe bis grün; die Job-Logs brauchen Admin-Rechte auf
`DG1001/XaresAICoder`, daher Fehler jetzt auch als Annotationen)
- Lauf 1 (`ubuntu-latest`): Deploy scheitert am Health-Check. Lauf 2 nur *scheinbar*
  grün: Ohne ausdrückliches `shell: bash` laufen Schritte mit `bash -e` **ohne
  `pipefail`**, `deploy.sh … | tee` zählte daher immer als Erfolg. → `shell: bash` für
  den Job; bei Fehlern die Log-Enden, eine Health-Probe (`curl -v`,
  `api-access.conf`, nginx-Netze) und bei Erfolg die Ergebniszeile als Annotation.
- Lauf 3 zeigte die Ursache: **403** auf `/api/health`, `api-access.conf` ohne
  `allow`-Zeile. Docker unter Linux trägt ein selbst vergebenes Gateway nicht in
  `IPAM.Config` ein (Docker Desktop schon), `deny 172.19.0.0/16` sperrte so auch den
  Host – **jede frische Linux-Installation seit 2.4** war über `localhost` ohne API,
  `deploy.sh` brach ab. → `networkGateway()` in `docker.js`: fehlt das Gateway, gilt
  bei nicht internen Netzen die erste Adresse des Subnetzes (Dockers Standard, von
  Docker reserviert); interne Netze bekommen keine Ausnahme. Lokal unverändert
  (gleiche `api-access.conf`, Health 200); Ausweichwerte mit Testdaten geprüft.
- Lauf 4: Deploy grün, Smoke-Test 502 – `deploy.sh` erzeugt beim ersten Deploy am
  Ende den Server neu (Rotation des Forgejo-Admin-Passworts), der Test kam zu früh.
  → Der Smoke-Test wartet bis zu 60 s auf die API. Außerdem `tr`s harmloses „Broken
  pipe“ (CI ignoriert `SIGPIPE`) aus dem Deploy-Log entfernt.
- Lauf 5: Deploy 3:46 min, Smoke-Test 1 min, „All 36 checks passed“.
- Runner fest auf `ubuntu-24.04` (`ubuntu-latest` wechselt ab 2026-10-19 auf Ubuntu
  26), `actions/checkout@v5` (Node 24). Der vorübergehende Trigger auf `ops/paket-3`
  ist vor dem Merge wieder entfernt.

### 3.5 `--skip-env` übernimmt Feature-Flags (Nachtrag)

**Problem**
- Seit 3.2 schreibt `set_feature_flag` die Flags in `setup_environment` – das mit
  `--skip-env` komplett übersprungen wird. `./deploy.sh --skip-env --enable-proxy`
  erzeugte zwar die CA (die Entscheidung dafür liest das Flag), startete den Proxy
  aber nicht (die Compose-Profile kommen aus `.env`); `--disable-…` wirkte gar nicht.
  Die Subnetzprüfung lief mit `--skip-env` ebenfalls nie.
- Ohne `.env` lief `--skip-env` weiter und scheiterte erst später unklar.

**Änderung**
- `deploy.sh`: Flags, Subnetzprüfung der Proxy-Netze und `HOST_PORT` stehen in der
  neuen Funktion `apply_env_settings`. `setup_environment` ruft sie wie bisher auf
  (vor Anzeige und „edit?“-Frage), mit `--skip-env` wird sie direkt aufgerufen –
  übersprungen wird nur noch der interaktive Teil. `--skip-env` ohne `.env` bricht mit
  klarer Meldung ab, bevor etwas geschrieben wird. Hilfetext angepasst.
- Doku: Upgrade-Tabelle (`deploy.sh` flags), `INSTALLATION.md`.

**Tests**
- Funktion mit Wegwerf-`.env`: `--git-server` → an, `HOST_PORT` aus `BASE_PORT`
  ergänzt; ohne Flag → behalten; `--disable-git-server` → aus; `--enable-proxy` → an,
  Subnetzprüfung gegen die echten Netze ohne Konflikt.
- `--skip-env` in einem leeren Verzeichnis: Abbruch mit Meldung, keine Datei angelegt.
- Live: `./deploy.sh --skip-build --skip-env --skip-network` → „Keeping …“,
  Subnetzprüfung, Deploy erfolgreich, `.env` unverändert; Smoke-Test 29/29.

---

## Paket 4 – KI-Agenten

Branch `feat/ai-agents`. Auslöser: der Punkt „KI-Agenten überprüfen“ (siehe
„Vorgemerkte Aufgaben“). Recherche zum Stand der Tools am 2026-10-25 (Registry-APIs von
npm, PyPI, Open VSX, GitHub; Stichproben selbst nachgeprüft).

### 4.1 Tool-Auswahl, Updates ohne sudo

**Problem**
- `update_ai_agents` (in README, `DEPLOYMENT.md`, `CLAUDE.md` genannt) gibt es seit
  2025-09-29 nicht mehr; ersetzt durch `update_<tool>`. Live in einem Workspace ohne
  `sudo` (Standard seit 2.3) getestet: **6 von 7 scheitern** – npm-Tools mit `EACCES`
  auf `/usr/lib/node_modules`, Crush mit `mv … Permission denied`, Aider in
  `/opt/uv-tools` – und **alle melden trotzdem „✅ updated successfully“**. Nur OpenCode
  ging (installierte ins Home). Auf der Live-Umgebung fiel es nicht auf, weil deren
  `.env` `WORKSPACE_SUDO_ENABLED=true` setzt.
- Crush wurde per npm installiert, aber per GitHub-Binary nach `/usr/local/bin`
  aktualisiert; `info` nannte den Befehl `qwen-code` (heißt `qwen`); OpenCode lag doppelt
  im Image (`/usr/local/bin` und `~/.opencode/bin`, je 186 MB).
- Recherche: **Continue eingestellt** (README: „no longer actively maintained and is
  read-only“, letzter Commit Juli 2026; neueste Version auf Open VSX eine Vorabversion);
  **Aider stagniert** (letztes Release 2026-02-12); **Qwen Code** ohne Gratis-Zugang seit
  2026-04-15; **OpenCode 2** erschienen (`@opencode/cli`), `opencode.ai/install`
  installiert nur noch v1; **Cline** ist auf Open VSX, war aber entgegen der Doku nie
  vorinstalliert. Neu relevant: GitHub Copilot CLI (auch im Free-/Student-Plan, Login
  per Token ohne Browser), Kilo Code (MIT, VS-Code-Erweiterung), Claude-Code-Erweiterung.

**Änderung**
- `code-server/Dockerfile`: CLI-Tools per npm nach `/opt/ai-tools` (`NPM_CONFIG_PREFIX`,
  gehört `coder`): Claude Code, Codex, **Copilot CLI**, Crush, **OpenCode 2**
  (`@opencode/cli`), Pi. `/opt/ai-tools/bin` steht **am Ende** von `PATH` (auch für
  Login-Shells über `/etc/profile.d/ai-tools.sh`). Aider (samt `UV_TOOL_*`-Variablen),
  Qwen Code und `setup-opencode.sh` entfernt; `uv` selbst bleibt. Keine automatischen
  Updates: `DISABLE_AUTOUPDATER=1` (Claude; `claude update` geht weiter),
  `OPENCODE_DISABLE_AUTOUPDATE=1`, `COPILOT_AUTO_UPDATE=false`; VS Code
  `extensions.autoUpdate: false`.
- OpenCode zieht per npm alle vier Linux-Builds (glibc/musl, baseline, je 230 MB); der
  Postinstall verlinkt den passenden nach `bin/`. Die übrigen werden nach der
  Installation gelöscht (Image 916 → 230 MB für OpenCode), ebenso nach einem Update.
- `workspace-init.sh`: ein Befehl `update_ai_agents [tool …]` (`npm install -g
  <paket>@latest`), Exit-Code 1 und Liste bei Fehlern, Hinweis auf die Whitelist; die
  sieben `update_<tool>`-Skripte entfallen. `info`, Projekt-README und
  Erweiterungsempfehlungen mit der neuen Auswahl.
- `extensions.txt`: Continue raus; **Cline** (`saoudrizwan.claude-dev`), **Kilo Code**
  (`kilocode.kilo-code`), **Claude Code** (`anthropic.claude-code`) rein.
- Klone (`CLONE_CLEANUP_SCRIPT`): zusätzlich `~/.copilot` und Kilos `auth.json`,
  `storage`, `log`, `*.db` unter `~/.local/share/kilo`; Einträge für Qwen, Continue und
  Aider bleiben für Snapshots älterer Workspaces.
- Smoke-Test: neue Tool-Liste inkl. `update_ai_agents`, die drei Erweiterungen,
  `/opt/ai-tools` gehört `coder`.

**Entscheidungen** (mit dir abgestimmt, 2026-10-25)
- **Nutzer darf aktualisieren, nichts automatisch**: Im Workshop haben alle dieselben
  Versionen, bis jemand selbst `update_ai_agents` oder den Update-Befehl eines Tools
  aufruft.
- **Raus**: Continue, Aider, Qwen Code. **Neu**: Cline, Copilot CLI, Kilo Code,
  Claude-Code-Erweiterung. **OpenCode auf v2.**
- **npm für alle CLI-Tools** (auch OpenCode, Copilot) statt verschiedener Installer:
  ein Update-Weg, eine Whitelist-Anforderung (npm-Registry, GitHub).
- **`/opt/ai-tools` statt `/usr/local/bin` beschreibbar**: Das Aufräumskript beim Klonen
  läuft als root und ruft Systembefehle über `PATH`; ans Ende angehängt kann eine Datei
  dort keinen Systembefehl überdecken.
- Bestehende Workspaces behalten ihre Tools und Skripte (eigene Container-Schicht);
  neue Workspaces bekommen den neuen Stand.

**Tests (live)**
- Test-Image unter eigenem Tag: Build 3–4 min, alle Erweiterungen installiert; Image
  5,44 GB (vorher 5,32 GB; Kilo-Erweiterung 557 MB, Claude-Erweiterung 291 MB bringen
  eigene Binaries mit). Versionen: Claude 2.1.310, Codex 0.164.0, Copilot 1.0.103,
  Crush 0.98.2, OpenCode 2.1.4, Pi 1.4.0.
- Als `coder` ohne sudo: `update_ai_agents pi opencode crush` ✔ (OpenCode danach wieder
  230 MB), unbekanntes Tool → Exit 1, ohne Netz → „❌ Not updated: pi“, Exit 1;
  `claude update` → „up to date“. Dabei gefunden und behoben: Login-Shells verloren
  `/opt/ai-tools/bin` (`/etc/profile` setzt `PATH` neu).
- Live-Deploy (Backup vorher mit `backup.sh`), Smoke-Test 31/31 inkl. der neuen Prüfungen.
- Klon eines Workspaces mit Schein-Logins (Copilot, Kilo, Claude): im Klon entfernt,
  Projektdateien erhalten. Test-Workspaces und Forgejo-Nutzer entfernt.
- ~~**Offen**: Kilos `bwrap`-Sandbox~~ – geprüft 2026-10-25 (siehe unten): Kilo führt
  Shell-Befehle im Standard-Workspace normal aus; nur der optionale Sandbox-Modus
  scheitert.
- Das Dashboard („AI Tools“) zeigte Continue, Aider und Qwen Code und bezeichnete die
  Erweiterungen als „install from marketplace“; Codex sollte per kopierter `auth.json`
  angemeldet werden. Der Hinweis zu „Copy AI tool logins“ beim Klonen nannte die alten
  Tools.
- Die neuen Tools sprechen mit eigenen Diensten, die weder die Standard-Whitelist noch
  die Erfassung im Logging-Proxy kannten: Copilot `*.githubcopilot.com`, Kilo
  `api.kilo.ai` / `ai-gateway.kilo.ai`, Cline `api.cline.bot` (Hosts aus den
  installierten Erweiterungen gelesen; Copilot aus GitHubs „Copilot allowlist
  reference“, das Binary enthält sie nicht im Klartext).

**Änderung**
- `frontend/index.html`: Erweiterungen Cline, Kilo Code, Claude Code als vorinstalliert;
  CLI-Tools Claude Code, Codex (`codex login --device-auth` / `--with-api-key`), Copilot
  CLI (`/login` oder `GH_TOKEN`), OpenCode, Crush, Pi; Hinweis auf `update_ai_agents`;
  Klon-Hinweis mit den aktuellen Tools.
- `squid/whitelist-default.conf`: `ai_copilot` (`.githubcopilot.com`), `ai_kilo`
  (`.kilo.ai`), `ai_cline` (`.cline.bot`). Die Anmeldung bei Copilot läuft über die
  bereits erlaubten `.github.com` / `.githubusercontent.com`.
- `mitmproxy/llm-logger.py`: dieselben Hosts als LLM-Endpunkte; `docker.js`: Kategorie
  „AI APIs“ für aufgezeichnete Domains um `githubcopilot.com`, `kilo.ai`, `cline.bot`.

**Entscheidungen**
- Bestehende Installationen behalten ihre angewandte Whitelist (Volume
  `squid_whitelist`, 3.1); die neuen Hosts gelten dort erst nach Aufzeichnen und
  Anwenden oder `PUT /api/whitelist` (Upgrade-Hinweis in 4.3).

**Tests (live)**
- Neue Standard-Whitelist in einem Wegwerf-Container: `squid -k parse` rc 0, keine
  Fehler, die drei ACLs verarbeitet.
- Deploy; Workspace hinter dem Logging-Proxy: Anfragen an Copilot, Kilo und Cline als
  Domains aufgezeichnet und unter „AI APIs“ einsortiert; Aufrufe im Chat-Format an
  Copilot und Kilo als Gespräch erfasst (GETs ohne `model` verwirft der Logger wie
  vorgesehen). Mitschnitte, Domain-Datei, Workspace und Forgejo-Nutzer entfernt.
- Smoke-Test 31/31.

### 4.3 Doku

**Änderung**
- `docs/AI_TOOLS.md` überarbeitet: drei vorinstallierte Erweiterungen und sechs
  CLI-Tools, Abschnitte für Continue, Aider und Qwen entfernt, neue Abschnitte für Copilot
  CLI, Kilo Code und die Claude-Code-Erweiterung, OpenCode 2 statt „OpenCode SST“ mit
  Installer-Skript, Codex-Anmeldung per `--device-auth` / `--with-api-key` statt kopierter
  `auth.json`. Neu: „Updating the Tools“ (keine automatischen Updates, `update_ai_agents`,
  Paketnamen, eigene Update-Befehle der Tools), Netzwerk in beiden Proxy-Modi, Logins in
  Klonen. Vergleichstabellen ohne die entfernten Tools; Kilo Code und Copilot CLI ohne
  Sterne-Bewertung (keine belastbare Grundlage).
- `docs/user-guide.md`, `docs/CREDENTIAL_MANAGEMENT.md` (Entwurf, nur die Tool-Nennungen)
  entsprechend; README (Tool-Liste, `update_ai_agents` statt des nicht mehr vorhandenen
  `setup_ai_tools`), `ARCHITECTURE.md`, `TROUBLESHOOTING.md`, `API.md` (Klon-Bereinigung),
  `OPENCLAW_INTEGRATION.md` (Beispieldaten), `DEPLOYMENT.md` (KI-Tools nicht fixiert,
  Upgrade-Tabelle mit Rebuild-Hinweis und den neuen Whitelist-Hosts). Lokale `CLAUDE.md`.
- Die drei großen Dokumente hat ein Agent nach einem festen Faktenblatt überarbeitet;
  danach von mir geprüft: keine Reste der alten Tools, OpenCode-2-Befehle (`auth login`,
  `/init`, `/share`, `/model`) gegen die installierte Version und die OpenCode-Doku
  belegt.

**Tests**
- `codex update` und `opencode upgrade` als `coder` ohne sudo: beide erfolgreich
  (Codex aktualisiert, OpenCode bereits aktuell). `opencode upgrade` installiert bei einer
  neuen Version wieder alle vier Linux-Builds → Hinweis in `AI_TOOLS.md`, für OpenCode
  `update_ai_agents opencode` zu nehmen.

### 4.4 Nachtrag: Kilo-Sandbox geprüft (2026-10-25)

Mit einem temporären OpenRouter-Key (von dir bereitgestellt, per Datei übergeben, nach
dem Test gelöscht) in einem Workspace mit Standardeinstellungen (kein sudo,
`no-new-privileges`, Standard-Seccomp):
- Das Kilo-Backend der Erweiterung (`bin/kilo` 7.8.17, `kilo run --auto`, Modell
  `openai/gpt-4.1-mini`) führt einen Shell-Befehl aus: Datei geschrieben, Nutzer `coder`,
  keine `bwrap`- oder Namespace-Meldung. Ohne `--auto` lehnt Kilo nicht freigegebene
  Befehle im nicht interaktiven Modus ab (Freigaberegeln, keine Sandbox).
- Kilo hat einen **optionalen** Sandbox-Modus (Erweiterung: `kilo.sandbox.newSessionDefault`,
  pro neuer Sitzung). Das mitgelieferte `bwrap` startet im Workspace nicht („No permissions
  to create a new namespace“), wie bei Codex. Hinweis in `AI_TOOLS.md`: den Modus nicht
  einschalten. Keine Codeänderung; der Modus ist standardmäßig aus.
- Nebenbefund: Kilo sendet Telemetrie (PostHog), im Log sichtbar.
- Workspace, Kilo-Daten, Key-Dateien (Host und Workspace) und Forgejo-Nutzer entfernt.

---

### 4.5 Nachtrag: Kilo Code nicht mehr vorinstalliert (2026-10-25)

**Problem**: Kilo Code belegt im Image 556 MB (eigenes `kilo`-Backend 258 MB, `ffmpeg` 68 MB,
JavaScript 190 MB) und startet mit `onStartupFinished` bei jedem VS-Code-Fenster – auch
ungenutzt rund 350 MB RAM pro Workspace (von dir gemessen). Bei 2 GB pro Workspace und
Workshops mit 20–30 Klonen ist das zu viel für eine Erweiterung, deren Aufgabe Cline schon
abdeckt.

**Änderung**: `kilocode.kilo-code` aus `code-server/extensions.txt` und aus den
Erweiterungsempfehlungen (`.vscode/extensions.json` in `workspace-init.sh`) entfernt. `info`,
AI-Tools-Tab, `AI_TOOLS.md`, User Guide, README, ARCHITECTURE nennen Kilo als optional mit
`code-server --install-extension kilocode.kilo-code` (ohne sudo; Open VSX steht in der
Standard-Whitelist). Upgrade-Zeile in `DEPLOYMENT.md`. Der Smoke-Test erwartet nur noch Cline
und Claude Code.

**Entscheidungen** (mit dir abgestimmt): nachinstallierbar statt ganz entfernt. Deshalb
bleiben `KILO_DISABLE_SESSION_INGEST=1`, das Entfernen der Kilo-Logins beim Klonen, der
mitmproxy-Mitschnitt von `api.kilo.ai`/`ai-gateway.kilo.ai` und `.kilo.ai` in der Whitelist.
Für Workshops: Kilo im Basis-Workspace installieren, die Klone übernehmen es per Snapshot.

**Tests (live)**: neues Image 4,87 GB, Kilo nicht mehr unter den Erweiterungen.
Test-Workspace im Browser (Puppeteer) jeweils nach Neustart: Nachinstallation per
`code-server --install-extension` als `coder` in 43 s; mit Kilo startet ungenutzt
`kilo serve` (433 MB RSS), Container 1,27 GiB gegenüber 914 MiB ohne Kilo (≈ 370 MB).
Beobachtung: neue Workspaces öffnen im Restricted Mode (Ordner nicht vertraut); erst nach
„Trust“ starten Kilo, Cline usw. – für die Messung war die Trust-Abfrage nur in diesem
Test-Container abgeschaltet. `tests/smoke-test.sh` lokal: 44/44 grün.

### 4.6 Nachtrag: VS Code ohne Workspace-Trust-Abfrage (2026-10-25)

**Problem**: Neue Workspaces öffneten VS Code im Restricted Mode (beim Messen in 4.5
aufgefallen); Cline, Claude Code für VS Code und Kilo starteten erst nach einem Klick auf
„Trust“.

**Änderung**: `"security.workspace.trust.enabled": false` in `code-server/config/settings.json`
(wird im Dockerfile als Benutzereinstellung kopiert). `SECURITY.md` (neuer Abschnitt „VS Code
Workspace Trust“) und Upgrade-Zeile in `DEPLOYMENT.md`.

**Entscheidungen** (auf deinen Wunsch): Die Trust-Abfrage schützt vor Einstellungen und
Werkzeugen aus fremden Repositories. Ohne sie gelten `.vscode/settings.json` eines geklonten
Repos, Erweiterungen können dort konfigurierte Programme starten – nur im Workspace-Container
als `coder`, aber mit Zugriff auf dessen Logins und Forgejo-Token. Automatische Tasks bleiben
aus: `task.allowAutomaticTasks` ist in VS Code 1.141 standardmäßig `off` und anwendungsweit,
ein Repo kann es nicht einschalten. Nutzer können die Abfrage in ihren Einstellungen wieder
einschalten.

**Tests (live)**: neues Image; neuer Workspace im Browser (Puppeteer) ohne Restricted-Mode-
Banner, Cline und Claude Code aktiviert (Extension-Host-Log), Symbole in der Aktivitätsleiste.
`tests/smoke-test.sh` lokal: 44/44 grün.

## Backlog-Aufräumen (2026-10-25)

**Alias sofort erreichbar**
- Problem nachgestellt: Alias auf einen Port mit laufendem Webserver angelegt → API 201,
  Anfrage sofort danach 404, nach 0,3 s 200 (6 von 6 Versuchen). `nginx -s reload` kehrt
  zurück, sobald das Signal gesendet ist; bis neue Worker laufen, antworten die alten.
- `aliasesService.reloadNginx`: merkt sich die PIDs der nginx-Worker (aus `/proc`, das
  Image hat kein procps; nur Befehlszeilen, die mit „nginx: worker process“ beginnen –
  die eigene Prüf-Shell enthielt den Text auch) und wartet nach dem Reload bis zu 3 s,
  bis ein neuer Worker läuft. Danach nehmen die alten keine neuen Verbindungen mehr an.
- Test: 6 neue Aliase, jeweils sofort 200; die API antwortet nach etwa 0,5 s statt sofort.
  Test-Workspace samt Aliasen und Forgejo-Nutzer entfernt.

**„Error loading disk usage“**
- `app.js`: `pagehide` setzt `leavingPage`; Fehler der Disk-Usage-Abfragen werden beim
  Verlassen der Seite und bei `AbortError` nicht mehr gemeldet. Nicht im Browser getestet
  (die Reihenfolge `pagehide` → Abbruch beim Entladen ist durch den Browser vorgegeben).

**Klone erben Plattform-Variablen**: veralteter Eintrag, seit 2.2/2.7 erledigt (siehe oben).

**Kilo Code: Telemetrie und Session-Upload** (2026-10-25)
- Recherche (statische Analyse der Erweiterung 7.8.17 und des gebündelten `kilo`, Repo
  `Kilo-Org/kilocode`, kilo.ai/privacy): Telemetrie an PostHog US (`us.i.posthog.com`) –
  Nutzungsereignisse mit Modell, Provider, Tokens, Kosten, Sprache, Fehlermeldungen
  (können Pfade enthalten), Geräte-ID; mit Kilo-Konto an dessen E-Mail gebunden. Keine
  Prompts oder Code gefunden. Standard an; die Erweiterung richtet sich nach VS Codes
  Telemetrie-Schalter und gibt ihn als `KILO_TELEMETRY_LEVEL` an ihr Backend weiter. Bei
  uns aus: code-server läuft mit `disable-telemetry: true` (Image und vom Server
  geschriebene `config.yaml`; zur Laufzeit mit geöffneter Kilo-Oberfläche nicht geprüft).
- Getrennt davon lädt Kilo mit Kilo-Konto **komplette Sitzungen** (Prompts, Antworten,
  Tool-Ausgaben, Code, Diffs) nach `ingest.kilosessions.ai` – unabhängig vom
  Telemetrie-Schalter. Mit dir abgestimmt: im Image abgeschaltet
  (`KILO_DISABLE_SESSION_INGEST=1`, die Erweiterung reicht die Umgebung an ihr Backend
  durch). Mit eigenem API-Key gibt es keinen Upload.
- Hinweise in `AI_TOOLS.md` (Abschnitt Kilo Code) und auf der Kilo-Karte im Dashboard.
- Image neu gebaut, Variable gesetzt, Tools laufen; Smoke-Test grün.

---

## Paket 5 – Gruppen-Nutzer

Branch `feat/group-users`. Wunsch: bestimmte Personen sehen im Dashboard nur die Projekte
ihrer Gruppe(n) und dürfen dort öffnen, umbenennen, starten, stoppen, Notizen und das
Workspace-Passwort bearbeiten. Mit dir abgestimmt (2026-10-25): Nutzer legt der Admin im
Dashboard an (Benutzername, Passwort, eine oder mehrere Gruppen); geschützte Workspaces
verlangen beim Start/Stop weiter ihr Passwort; MCP-Server zurückgestellt.

### 5.1 Server: Nutzer, Sitzungen mit Rolle, Rechteprüfung

**Änderung**
- `services/users.js`: Nutzer in `/app/workspaces/group-users.json` (atomar, im Backup),
  bcrypt (Kosten 10), Benutzername `[a-z0-9._-]{2,40}`, `admin` reserviert, Passwortregel
  gemeinsam mit den Workspace-Passwörtern; `sessionVersion` steigt bei neuem Passwort.
  Login gegen einen Dummy-Hash bei unbekanntem Namen (gleiche Laufzeit).
- `services/auth.js`: Token `expires.nonce.uid.version.signatur`; `requireLogin` setzt
  `req.user` (`admin` oder `group` mit Gruppen) bei jedem Request aus dem aktuellen Stand –
  gelöschte Nutzer und alte Passwörter sind sofort draußen. Alte Tokens ungültig (einmal
  neu anmelden). `isAdminRequest` (Workshop) nur noch für die Admin-Rolle.
- `routes/auth.js`: Login mit `{password}` (Admin, wie bisher) oder `{username, password}`;
  `/status` liefert Rolle, Benutzername, Gruppen.
- `services/access.js` (Middleware nach `requireLogin`): Gruppen-Nutzer dürfen
  `GET /config`, die Listen (gefiltert) sowie für Projekte ihrer Gruppen `GET /:id`,
  `PUT /:id/name`, Start/Stop, Notizen, Disk-Usage und `PUT /:id/password`; fremde
  Projekte 404, alles andere 403 `FORBIDDEN_FOR_ROLE`.
- `routes/users.js` (`/api/users`, Admin): auflisten, anlegen, Gruppen/Passwort ändern,
  löschen. `PUT|DELETE /api/projects/groups/:name` (Admin): Gruppe umbenennen bzw.
  auflösen – Projekte **und** Nutzerzuordnungen in einem Schritt.

**Tests (live, per curl)**: Admin-Login mit `{password}` unverändert; Nutzer anlegen,
Login (falsches Passwort 401); Liste und Gruppen nur `zz-grp`; Anlegen, fremdes Projekt,
Nutzerliste, Gruppe ändern, Whitelist, Löschen → 403/404/403/403/403/403; Umbenennen,
Notizen, Stop, Start → 200; Workspace-Passwort setzen → Stop ohne 401, mit 200 → entfernen;
Gruppe umbenennen → Zuordnung wandert mit, Nutzer sieht sein Projekt weiter; Passwort-Reset
→ alte Sitzung 401; Workshop-Admin als Nutzer 401.

### 5.2 Dashboard

**Änderung** (`frontend/index.html`, `app.js`, `style.css`)
- Login-Dialog mit Feld „User name“ (leer oder `admin` = Admin), Fehlermeldung „Wrong user
  name or password“. Nach dem Login holt `loadSession()` `GET /api/auth/status` und setzt
  `body[data-role]`; neben dem Logout steht „Signed in as …“.
- Ausblenden per CSS: `.admin-only` ist nur bei `data-role="admin"` sichtbar, `.group-only`
  nur bei `group`; ohne bekannte Rolle (vor dem Login) bleibt beides verborgen. Gruppen-Nutzer
  sehen kein Erstellen-Formular, keinen Quick Clone, keinen Git-Server-Tab, kein „Add Group“,
  keine Umbenennen/Löschen-Knöpfe an Gruppen, keine Icons für Aliase, KI-Gespräche,
  aufgezeichnete Domains und Proxy-Logs, kein Klonen/Löschen und kein Drag & Drop. Sichtbar
  bleiben Öffnen/Start/Stop, Umbenennen, Notizen und Workspace-Passwort; die Gruppenleiste
  zeigt genau ihre zugewiesenen Gruppen. Die eigentliche Sicherung bleibt die Server-Prüfung.
- `/api/limits` lädt nur noch der Admin (für Gruppen-Nutzer 403, wird nicht gebraucht).
- Neuer Tab „Users“ (Admin): Liste mit Gruppen und Anlagedatum; Dialog zum Anlegen
  (Benutzername, generiertes Passwort, Gruppen als Checkboxen) und Bearbeiten (Gruppen,
  optional neues Passwort – meldet den Nutzer ab); Löschen mit Rückfrage. Fehler des Servers
  (Name vergeben, Passwort zu kurz) erscheinen im Dialog.
- Gruppe umbenennen/löschen in der Seitenleiste nutzt `PUT|DELETE /api/projects/groups/:name`
  statt einer Schleife über `PUT /:id/group`; die Rückfrage beim Löschen nennt auch die
  betroffenen Nutzer.

**Entscheidungen**
- Nutzerverwaltung als eigener Tab statt Dialog: passt zur Aktivitätsleiste und bietet Platz
  für die Tabelle.
- Läuft die Sitzung ab und meldet sich im Dialog ein anderes Konto an, lädt die Seite neu –
  sonst bliebe die Ansicht des vorigen Kontos stehen.
- Logout löscht die Offline-Kopie der Projektliste (`localStorage`), damit ein Gruppen-Nutzer
  am selben Rechner nie die Liste des Admins zu sehen bekommt.

**Tests (live, Puppeteer)**: vor dem Login keine Admin-Elemente; falsches Passwort zeigt die
Meldung; Login als `ZZUser` (Groß-/Kleinschreibung egal) → nur Tabs Projects/AI Tools, Gruppe
`zz-grp2`, ein Projekt mit Umbenennen/Passwort/Notizen und „Start“, nicht ziehbar; Umbenennen
über den Dialog hin und zurück, Notizen öffnen; Logout leert die Offline-Liste. Admin: alle
Tabs, Formular, Klonen/Löschen; Users-Tab: anlegen, doppelter Name (409) und zu kurzes
Passwort (400) im Dialog, Gruppen entfernen, löschen; Gruppe umbenennen → Zuordnung des
Nutzers wandert mit, zurück; Gruppe löschen → Projekt in „Uncategorized“, Nutzer ohne Gruppe
(danach wiederhergestellt); abgelaufene Sitzung + Login als `zzuser` → Seite lädt neu in
dessen Ansicht.

### 5.3 Doku, Smoke-Test

**Änderung**
- `docs/API.md`: Abschnitt „Login and Roles“ (Login mit `username`, Status mit Rolle),
  Tabelle „Group User Permissions“ (Allowlist, 404/403), neuer Abschnitt „Group Users“
  (`/api/users`, Regeln), „Rename or Delete a Group“, Fehlercodes `LOGIN_REQUIRED` und
  `FORBIDDEN_FOR_ROLE`; das Antwortbeispiel von `GET /api/projects/groups` stimmte nicht
  (Objekte mit `name`/`count`/`projects` statt Strings) – korrigiert.
- `docs/SECURITY.md`: Rollenmodell, Durchsetzung (Sitzung mit Konto und Version,
  Middleware, 404 statt 403 für fremde Projekte), Grenzen (Gruppen-Nutzer sehen die
  Workspace-URLs ihrer Gruppen; Verschieben eines Projekts ändert, wer es sieht).
- `docs/user-guide.md`: Abschnitt „Group Users“ für Admin und Gruppen-Nutzer;
  `docs/DEPLOYMENT.md`: Upgrade-Zeile (einmal neu anmelden), Grenzen-Absatz;
  `README.md`: „Recent Updates“; lokale `CLAUDE.md`.
- `tests/smoke-test.sh`: Abschnitt „Group users“ mit dem Workspace ohne Proxy (kein
  zusätzlicher Container): in Gruppe `zz-smoke-group` verschieben, Nutzer anlegen, Login
  mit eigener Cookie-Datei (`as_group`), Liste nur dieser Workspace, Anlegen und
  Nutzerverwaltung 403, Umbenennen/Notizen/Stop/Start 200, nach dem Verschieben aus der
  Gruppe 404, neues Passwort beendet die Sitzung (401), Nutzer löschen; Aufräumen löscht
  übrig gebliebene Nutzer.

**Tests (live)**: `tests/smoke-test.sh` lokal – alle 44 Prüfungen grün, davon 13 im neuen
Abschnitt „Group users“; danach keine `zz-smoke-*`-Workspaces, Nutzer oder Forgejo-Nutzer
übrig.

### 5.4 Nachtrag: ein Login statt Basic Auth davor (2026-10-29)

**Problem**: Vor dem Dashboard lag im Host-nginx eine Basic Auth (gemeinsamer Account, nur
vom Admin genutzt; die Workspace-Subdomains liegen außerhalb). Dazu kam der App-Login, also
zweimal anmelden; Gruppen-Nutzer hätten zusätzlich das gemeinsame Basic-Auth-Passwort
gebraucht. Die Basic Auth soll weg, der App-Login bleibt der einzige. Hindernis: Hinter dem
Host-nginx kommen alle Anfragen beim inneren nginx von derselben Adresse (Docker-Gateway,
lokal gemessen `172.19.0.1`). `X-Real-IP` war damit für alle gleich, und 10 falsche
Passwörter in 15 Minuten hätten den Login für alle gesperrt – ohne Basic Auth davor für
jeden aus dem Internet auslösbar.

**Änderung**
- `aliasesService.writeTrustedProxyConfig` schreibt beim Serverstart
  `trusted-proxies.conf` (Volume `nginx_dynamic`): `set_real_ip_from` für die Gateways der
  nicht-internen Netze von nginx (`docker.getHostGateways`, wartet bis zu 60 s auf den
  nginx-Container, den Compose nach dem Server startet) und für `TRUSTED_PROXIES` aus `.env`
  (IP oder CIDR; ungültige Einträge und Präfixlängen werden mit Warnung verworfen, damit
  nginx nicht an der Datei scheitert), dazu `real_ip_header X-Forwarded-For`. nginx bindet
  sie auf http-Ebene ein (`nginx-base.conf.template`, per Glob optional). Ohne
  `real_ip_recursive` gilt der letzte Eintrag – der, den der vertrauenswürdige Proxy
  angehängt hat.
- Wirkung: `$remote_addr` ist der echte Client – im Access-Log, in `X-Real-IP` für API,
  Forgejo und Workspace-Apps, in der Login-Sperre. Workspaces kommen mit ihrer eigenen
  Adresse an, ihr `X-Forwarded-For` wird ignoriert; die `deny`-Regeln für die
  Workspace-Netze greifen unverändert.
- `ADMIN_SESSION_HOURS`: Standard 168 (7 Tage) statt 12 – Code, Compose, `.env.example`.
- `deploy.sh`, Smoke-Test: `HOST_PORT=127.0.0.1:<port>` (Bindung an Loopback, in
  `.env.example` und `SECURITY.md` schon empfohlen) ergab URLs wie `localhost:127.0.0.1:8080`,
  der Health-Check von `deploy.sh` brach ab. Beide nehmen jetzt nur den Port.
- Doku: `DEPLOYMENT.md` (externer SSL-Proxy: eigener Login statt Basic Auth,
  `X-Forwarded-For` nötig, `TRUSTED_PROXIES`, Loopback; Upgrade-Zeile), `SECURITY.md`
  (Admin Login), `API.md` (Login-Zeile); lokale `CLAUDE.md`.
- `tests/smoke-test.sh`: Abschnitt „Login limit behind a reverse proxy“ (zehn falsche
  Passwörter für Client A → 429, Client B hinter demselben „Proxy“ → 401, eigene Sitzung
  → 200; zufällige Adressen aus den Dokumentationsnetzen, vor dem Restore, der den Server
  neu startet); im Workspace-Abschnitt: gefälschtes `X-Forwarded-For` aus dem Workspace →
  weiter 403.

**Entscheidungen**: Dem Docker-Host wird automatisch vertraut statt nur einer Liste in
`.env`: Die Gateway-Adresse hängt vom Docker-Netz ab und ändert sich, wenn Netze neu angelegt
werden; ein Proxy auf demselben Rechner ist der übliche Fall. Wer vom Gateway kommt, kann
jede Client-Adresse angeben – das sind Prozesse auf dem Host, bei älterem Docker mit
Userland-Proxy oder IPv6-Zugriff über `docker-proxy` aber evtl. auch externe Clients, wenn
der Port offen ist; deshalb die Empfehlung, `HOST_PORT` an Loopback zu binden. Für `/api/`
waren die Gateways schon bisher freigegeben (`api-access.conf`), es entsteht kein neuer
Zugang; schlimmstenfalls lässt sich die Login-Sperre umgehen.

**Tests (live)**: Anfragen vom Host kommen bei nginx von `172.19.0.1` (Gateway von
`xares-aicoder-network`); erzeugte Datei mit `172.19.0.1` und `172.18.0.1`
(`xares-control`), interne Netze ausgelassen, `nginx -T` lädt sie. Falsches Passwort mit
`X-Forwarded-For: 192.0.2.77` → Server-Log „Failed login from 192.0.2.77“; bei
`192.0.2.1, 192.0.2.88` gilt `192.0.2.88`. Container im Workspace-Netz: `/api/health` ohne,
mit fremder und mit Gateway-Adresse im Header → jeweils 403, Log zeigt die Container-Adresse.
Schreiber lokal mit Testeingaben (`/33`, `/129`, Text → verworfen). `tests/smoke-test.sh`
lokal: 47/47 grün.

### 5.5 Nachtrag: Forgejo zeigt ohne Login nichts (2026-10-29)

**Problem**: Bisher verbarg die Basic Auth vor der Hauptdomain auch `/git/`. Ohne sie sah ein
anonymer Besucher lokal Explore-Seiten, Profile und 18 öffentliche Repositories des
Admin-Kontos (angelegt vor den Forgejo-Nutzern pro Workspace, Paket 2) – auch per API
(`/api/v1/repos/search`). Auf einer öffentlichen Installation wären solche Altbestände im
Internet lesbar.

**Änderung**: `FORGEJO__service__REQUIRE_SIGNIN_VIEW=${GIT_REQUIRE_SIGNIN_VIEW:-true}` in
`docker-compose.yml`, Variable in `.env.example`. `SECURITY.md` (Abschnitt Forgejo),
`DEPLOYMENT.md` (Upgrade-Zeile, Hinweis beim externen SSL-Proxy). `tests/smoke-test.sh`:
`/git/api/v1/repos/search` ohne Login → 403 (übersprungen bei
`GIT_REQUIRE_SIGNIN_VIEW=false`).

**Entscheidung**: Standard `true`, per `.env` abschaltbar, falls öffentliche Repositories
gewollt sind. Anonymes `git clone` öffentlicher Repos geht damit nicht mehr; die Plattform
selbst nutzt überall Admin-Zugang oder Workspace-Token. Der Forgejo-Healthcheck (`curl -f /`)
und die Prüfungen in `deploy.sh`/`setup-forgejo.sh` bleiben grün: Die Startseite antwortet
weiter mit 200, `curl -f` wertet Weiterleitungen nicht als Fehler. `testGitServerConnection`
(anonym auf `/api/v1/version`, jetzt 403) wird nirgends aufgerufen.

**Tests (live)**: Forgejo mit der neuen Variable neu erstellt. Anonym: `/`, `/user/login`,
`/api/healthz` → 200; `/explore/repos`, `/explore/users`, Profil `/developer` → 303 auf die
Login-Seite; `/api/v1/version`, `/users/search`, `/repos/search` → 403. Workspace
`zz-forgejo-test`: Commit, `setup_local_remote`, `git ls-remote` mit Token → ok; Workspace
`zz-forgejo-clone` aus `http://localhost/git/<user>/workspace.git` → als Collaborator mit
Token geklont, Commit vorhanden. Beide gelöscht, Forgejo-Nutzer entfernt. Session-Cookie nach dem
Deploy: `Max-Age=604799` (7 Tage). README: Zeile „One Login Is Enough“ unter „Recent Updates“.
`tests/smoke-test.sh` lokal: 49/49 grün, darunter die neue Forgejo-Prüfung und die
Fälschungsprüfung aus 5.4 (`X-Forwarded-For` aus dem Workspace → 403).

### 5.6 Nachtrag: `TRUSTED_PROXIES=none` für Installationen ohne Proxy davor (2026-10-29)

**Problem**: Ohne Reverse Proxy davor braucht niemand das automatische Vertrauen in den
Docker-Host aus 5.4. Es schadet aber, wo Clients trotzdem von einem Gateway kommen
(IPv6-Clients über `docker-proxy` auf Dual-Stack-Servern, älteres Docker mit Userland-Proxy,
Docker Desktop mit Zugriff aus dem LAN): Sie könnten per `X-Forwarded-For` jede Adresse
angeben und die Login-Sperre umgehen – kein Zugang zur API, aber unbegrenzt Passwörter
raten.

**Änderung**: `none` in `TRUSTED_PROXIES` (Groß-/Kleinschreibung egal) lässt die Gateways
weg; daneben aufgeführte Adressen bleiben vertrauenswürdig. Die erzeugte Datei vermerkt das
(`# Docker host not trusted`). `tests/smoke-test.sh` überspringt bei `none` den Abschnitt
„Login limit behind a reverse proxy“ (die zehn Fehlversuche würden sonst den Host selbst
sperren). Doku: `.env.example`, `SECURITY.md` (Admin Login), `DEPLOYMENT.md` („Port
Considerations“, Upgrade-Zeile); lokale `CLAUDE.md`.

**Tests (live)**: Schreiber mit `""`, `none`, `None, 10.0.0.5`, `10.0.0.5`. Lokal mit
`TRUSTED_PROXIES=none` deployt: Datei ohne `set_real_ip_from`, falsches Passwort mit
`X-Forwarded-For: 192.0.2.55` → „Failed login from 172.19.0.1“; `tests/smoke-test.sh`
46/46 grün, Abschnitt übersprungen. Danach Zeile aus der lokalen `.env` entfernt, Server neu
erstellt: Gateways wieder in der Datei, `X-Forwarded-For` wird übernommen. CI-Smoke-Test für
5.4/5.5 (`66ff5d8`) auf Linux grün – dort kommen Anfragen vom Runner ebenfalls über ein
Gateway an.

### README: Bilder und GIF ohne echte Projekte (2026-10-29)

**Problem**: `docs/screen-server.png` (2025) zeigte echte Projekte und Gruppen des Betreibers.
Das hochgeladene Video oben im README war veraltet (helles UI mit Template-Auswahl, Gemini
CLI, die nicht mehr vorinstalliert ist).

**Änderung**: Neue Medien unter `docs/images/`, alle mit Demo-Daten:
- `demo.gif` (1024 px, 23 s, 811 KiB) ersetzt Bild und Video oben: Gruppe wählen, `todo-app`
  anlegen, CREATING → RUNNING, VS Code öffnet, `info` mit den KI-Tools,
  `python3 -m http.server 8000`, App unter `<workspace>-8000.<domain>`; Bildunterschriften
  je Abschnitt.
- `dashboard.png` (Overview), `vscode.png` (Cline, Flask-App im Terminal; Abschnitt KI-Tools),
  `group-user.png` (Ansicht von `teacher-anna`; „Group Users“), `recorded-domains.png`
  (aufgezeichnete Domains nach Kategorien; „Dual Proxy Modes“).
- `docs/screen-server.png` gelöscht (bleibt in der Git-Historie); das Video ist nicht mehr
  verlinkt (liegt weiter auf GitHub, löschen nur über die Weboberfläche).

**Vorgehen**: Lokal sechs Demo-Workspaces in drei Gruppen (alle Netzwerkmodi, Passwort,
Notizen, Git-Repo) und zwei Gruppen-Nutzer angelegt; im Workspace mit LLM-Logging-Proxy
Verkehr erzeugt (pip, npm, Doku-Seiten, KI-APIs). Aufnahme mit Puppeteer; die
Listen-Aufrufe (`/api/projects/`, `/api/projects/groups`, `/api/users`) wurden im Browser
abgefangen und auf die Demo-Einträge gefiltert, echte Projekte erscheinen auf keinem Bild.
GIF aus Einzelbildern mit eigener Anzeigedauer (Wartezeiten herausgeschnitten), Palette
über alle Bilder mit ffmpeg. Danach alles gelöscht: 7 Workspaces samt Forgejo-Nutzern,
Gruppen-Nutzer, Domain-Datei von `teacher-prep`.

**Beobachtung (offen)**: `info` (Abschnitt „Git Remotes“) und das Ende von
`setup_local_remote` geben `git remote -v` aus – mit dem Forgejo-Token des Workspace in der
URL. Bei geteiltem Bildschirm (Workshop) oder in Screenshots ist es sichtbar. Für die Medien
umgangen (GIF-Workspace ohne Repo, im VS-Code-Bild läuft die App statt `info`).

### Nachtrag: Remote-URLs ohne Forgejo-Token auf dem Bildschirm (2026-10-29)

**Problem** (beim Aufnehmen der README-Medien aufgefallen): `info` („Git Remotes“), das Ende
von `setup_local_remote` und dessen Frage nach dem bisherigen `origin` gaben die Remote-URLs
aus – mit `user:token@` des Workspace. Bei geteiltem Bildschirm im Workshop oder in
Screenshots war das Token lesbar. Das Init-Skript beim Anlegen (Klon plus Forgejo-Repo,
`docker.js`) schrieb dieselbe Liste ins Server-Log.

**Änderung**: Alle vier Ausgaben laufen durch `sed -E 's#(://)[^/@[:space:]]+@#\1***@#'`
(in `setup_local_remote` als Funktion `hide_credentials`). Git selbst nutzt die URLs
unverändert; `git remote -v` und `.git/config` enthalten das Token weiter. `SECURITY.md`
(Abschnitt Forgejo), Upgrade-Zeile in `DEPLOYMENT.md` (Image neu bauen; bestehende
Workspaces behalten die alten Skripte bis zur Neuerstellung).

**Tests (live)**: Ausdruck mit Forgejo-URL, GitHub-URL mit Token, URL ohne Zugangsdaten,
SSH-Remote, `@` im Pfad. code-server-Image neu gebaut, Server neu deployt. Workspace
`zz-remote-test` aus `github.com/octocat/Hello-World` mit Forgejo-Repo: Server-Log zeigt
`origin http://***@forgejo:3000/…`; `info` maskiert; `setup_local_remote` (zweites Repo als
Remote `forgejo`) maskiert die bisherige `origin`-Zeile und die Abschlussliste; in keiner
Ausgabe ein Token. `git push origin` funktioniert weiter. Workspace und Forgejo-Nutzer
gelöscht.

### Nachtrag: Deploy ohne Terminal, belegte Subnetze, Hosts ohne `/bin/bash` (2026-10-29)

**Problem** (bei einer Installation auf NixOS, Updates per Skript ohne Terminal):

- Alle Skripte begannen mit `#!/bin/bash`; NixOS hat kein `/bin/bash`, `./deploy.sh` und die
  Hilfsskripte starteten nicht („required file not found“).
- Ohne `openssl` im `PATH` brach die CA-Erzeugung für den Proxy mit einer wenig sagenden
  Meldung ab.
- `docker-compose.yml` legte nginx und mitmproxy auf `xares-internal` fest auf
  `172.30.0.4`/`.5`. Wich `deploy.sh` wegen eines belegten Subnetzes aus, schrieb es nur
  `INTERNAL_NETWORK_SUBNET` und `DNSMASQ_IP` und bat darum, die Compose-Datei von Hand
  anzupassen – eine lokale Änderung, die jedes Update stört.
- `setup-network.sh` nimmt beim ersten Mal ein Ausweichnetz, wenn `172.19.0.0/16` belegt ist.
  Beim nächsten Deploy erwartete es wieder `172.19.0.0/16`, fragte nach dem Neuanlegen, und
  `read` ohne Terminal beendete das Skript (`set -e`): jedes weitere unbeaufsichtigte Deploy
  brach mit „Failed to setup Docker network“ ab.
- Ein vorhandenes code-server-Image wird nur nach Rückfrage neu gebaut; ohne Terminal heißt
  die Antwort „nein“. Ein Update per Skript lief so mit dem alten Image weiter.

**Änderung**:

- Shebang `#!/usr/bin/env bash` in allen Skripten (Zeile 1; in Heredocs erzeugte Skripte
  laufen im Container und bleiben).
- `deploy.sh` prüft vor der CA-Erzeugung, ob `openssl` vorhanden ist.
- Neue `.env`-Werte `NGINX_INTERNAL_IP`, `MITMPROXY_IP` (Vorgabe wie bisher); Compose liest
  sie. `configure_proxy_subnet` nimmt eine Liste `KEY:Hostteil` und schreibt alle festen
  Adressen eines Netzes: neu bei geändertem Subnetz, ergänzt, wenn sie fehlen (bestehende
  Installationen auf einem anderen Subnetz bekommen sie beim nächsten Deploy). Subnetze, die
  kein `/16` auf `.0.0` sind, bleiben unangetastet (Warnung).
- `setup-network.sh` behält ein vorhandenes `xares-aicoder-network` mit anderem Subnetz
  (kein Neuanlegen mehr; mit angeschlossenen Workspaces ginge das ohnehin nicht); das zweite
  `read` endet ohne Terminal nicht mehr das Skript.
- `deploy.sh --rebuild`: baut das code-server-Image ohne Rückfrage neu; der Hinweis beim
  Überspringen nennt die Option.
- Doku: Voraussetzungen in `INSTALLATION.md` (bash im `PATH`, `openssl` für den Proxy,
  `python3` optional), Upgrade-Zeile und Aufruf für unbeaufsichtigte Updates in
  `DEPLOYMENT.md`, `.env.example`.

**Tests**: `bash -n` aller geänderten Skripte. `configure_proxy_subnet` mit fünf `.env`:
Standard ohne neue Werte (ergänzt `.4`/`.5`), anderes Subnetz ohne neue Werte (ergänzt im
eigenen Subnetz, `DNSMASQ_IP` unverändert), belegtes Subnetz (wechselt auf `172.28.0.0/16`,
alle drei Adressen neu), kein `/16` (nur Warnung), vorhandene eigene Werte bei unverändertem
Subnetz (bleiben). `docker compose config` mit und ohne die neuen Werte.
`setup-network.sh` mit abweichendem vorhandenen Netz und `</dev/null`: alte Fassung Exit 1,
neue Exit 0.

### Nachtrag: Stoppen läuft auf dem Server, Fehler bleiben sichtbar (2026-10-29)

**Problem** (bei einer Installation mit langsamer Platte und viel Schreiblast beobachtet):
Zwei Workspaces sollten gestoppt werden; Docker brauchte so lange, dass die Verbindung zum
Browser nach 40 s ohne Antwort endete (nginx: 499). Eine scheiterte danach im Server mit „tried to kill
container, but did not receive an exit event“, die andere hing weiter. Im Dashboard war
davon nichts zu sehen: Die Ladeanzeige gab es nur im Browser, nach dem Neuladen stand wieder
„Stop“ da; der Fehler stand nur im Server-Log.

**Änderung**:

- `POST /api/projects/:id/stop` startet den Stopp und antwortet sofort `202`
  (`accepted: true`). Der Server merkt sich laufende Stopps (`pendingStops`); solange Docker
  den Container noch als laufend meldet, liefern Liste und Einzelabfrage `status: "stopping"`
  – für jeden Client, auch nach dem Neuladen. Ein zweiter Stopp hängt sich an den laufenden;
  ein Start währenddessen antwortet `409` („Workspace is still stopping“).
- Scheitert der Stopp, bekommt der Workspace `lastError` (`action`, `message`, `at`) und den
  Status von Docker. Der nächste Start oder Stopp löscht ihn. Das Dashboard zeigt ihn unter
  den Angaben zum Workspace und meldet ihn beim Übergang aus „Stopping“ einmal als Fehler.
- `?wait=true` (oder `"wait": true` im Body) behält das alte Verhalten: Antwort `200` erst
  nach dem Stopp, `500` bei Fehler – für Skripte.
- `stopWorkspaceContainer`: Meldet Docker einen Fehler, prüft der Server bis zu 30 s lang
  alle 2 s, ob der Container nicht doch steht, bevor er den Fehler weitergibt.
- Dashboard: Status „Stopping“ mit Ladeanzeige statt Knöpfen, Liste fragt währenddessen alle
  3 s nach (wie beim Anlegen).
- Doku: `API.md` (Status `stopping`, `lastError`, `202`/`wait`), Upgrade-Zeile in
  `DEPLOYMENT.md`. Smoke-Test: erster Stopp mit `?wait=true` (200, Container steht), Stopp
  als Gruppen-Nutzer ohne (202, `stopping`, danach `stopped`).

**Tests**: Logik von `stopProject` mit nachgebautem Docker-Dienst (langsam, Fehler):
sofortige Antwort mit `stopping`, Liste zeigt `stopping`, zweiter Stopp hängt sich an, Start
währenddessen abgelehnt, danach `stopped` ohne `lastError`; Fehlschlag: Status von Docker,
`lastError` gesetzt, Start löscht ihn; `wait` mit Fehler und mit Erfolg.
`stopWorkspaceContainer` mit nachgebautem dockerode: Fehler „no exit event“, Container steht
2,5 s später → Erfolg; Container läuft weiter → Fehler nach Ablauf der Wartezeit.
`node --check` für Server und `app.js`, `bash -n` für den Smoke-Test.

**Nachbesserung nach Review** (2026-10-29):

- Antwortet Docker auf den Stopp nie (der zweite Workspace oben hing so), blieb der Eintrag in
  `pendingStops` bis zum Neustart des Servers: Der Workspace stand dauerhaft auf „Stopping“
  ohne Knöpfe, Start antwortete `409`, ein weiterer Stopp hängte sich an den hängenden an.
  Jetzt gibt der Server nach 3 Minuten auf (`stopGiveUpMs`): `lastError` „Docker did not
  finish the stop within 180 s (it may still complete)“, Status `error` bis zur nächsten
  Abfrage bei Docker; danach gehen Start, Stopp und Löschen wieder. Löschen schon während
  „Stopping“ anzubieten hilft dabei nicht: `deleteProject` ruft ebenfalls `container.stop()`
  auf und hinge genauso.
- Smoke-Test: `check … [ 202 ] && [ stopping ]` prüfte den Status außerhalb von `check`;
  ohne `set -e` blieb ein falscher Status unbemerkt. Jetzt ein Vergleich in `check`.

**Tests**: `runStop` mit nachgebautem Docker-Dienst und kurzer Frist: Stopp, der nie
antwortet → nach der Frist `lastError`, Status `error`, `pendingStops` leer, Start wieder
möglich; späte Ablehnung des hängenden Aufrufs ohne „unhandled rejection“; normaler Stopp
unverändert. Smoke-Test lokal komplett, Dashboard im Browser („Stopping“, Fehlerzeile).

### Nachtrag: AI Conversations als Übersicht, Inhalt bei Bedarf (2026-10-30)

**Problem** (Installation mit Agenten-Nutzung, Logging-Proxy): Das Fenster „AI Conversations“
ließ sich nicht mehr öffnen. `GET /llm-conversations?limit=50` las die letzten 50 Aufzeichnungen
komplett und schickte sie in einer Antwort: 40 MB bzw. 124 MB JSON, 10–15 s Laufzeit; Firefox
stellte sie nicht mehr dar (ein Aufruf brach ab, nginx 499). Ursache: Agenten (hier OpenCode)
schicken bei jedem Schritt den ganzen Verlauf samt Tools; eine Aufzeichnung war bis zu 4,7 MB
groß, und der Rohtext steht doppelt drin (`body` und `parsed_request`).

**Änderung**:

- Die Liste liefert pro Aufzeichnung nur eine Übersicht: Datei, Zeit, Modell, HTTP-Status, Zahl
  der Nachrichten, Token (Eingang, Ausgang, Cache; OpenAI-, DeepSeek- und Anthropic-Felder),
  Größe, Auszüge (240 Zeichen) aus der letzten Nutzernachricht mit Text (Agenten spielen
  Screenshots als Nutzernachricht ohne Text zurück; nur Bilder: `[image]`) und der Antwort; bei
  WebSocket-Aufzeichnungen Zahl der Frames und ob sie noch läuft. Dazu `total` für das Blättern.
- Der Server merkt sich die Übersichten im Speicher je Datei, gültig solange Änderungszeit und
  Größe gleich sind (WebSocket-Aufzeichnungen wachsen); Löschen verwirft sie. Höchstens 5000.
- Neu `GET …/llm-conversations/:file` für eine vollständige Aufzeichnung (Name wie beim Löschen
  geprüft). `?full=true` liefert die alte Liste. Gruppen-Nutzer haben weiterhin keinen Zugriff.
- Dashboard: Liste aus den Übersichten, „Load more“ in 50er-Schritten, Aufklappen lädt die
  Aufzeichnung einzeln; die doppelten Rohtexte sind in der Ansicht gekürzt, „Download JSON“
  speichert alles.
- nginx komprimiert JSON-Antworten der API (nur `/api/`, ab 4 KB).
- Smoke-Test: Aufruf an die OpenAI-API aus dem Logging-Workspace (ohne gültigen Schlüssel,
  401), dann Übersicht ohne Bodies, Einzelabruf mit Anfrage und Antwort ohne den Schlüssel,
  `400` für einen ungültigen Namen, `full=true`.

**Tests**: Logik mit nachgebauten Aufzeichnungen (OpenAI/DeepSeek-, Anthropic-,
WebSocket-Format, eine kaputte Datei): Übersicht 1,2 KB statt ~12 MB, Token inkl. Cache,
Auszüge, redigierte URL, Blättern, Filter, Cache (zweiter Aufruf liest nichts neu, geänderte
oder gelöschte Datei schon), Einzelabruf mit redigiertem `Authorization`, fehlende Datei. 15/15.
`node --check`, `bash -n`.

Live auf einer Installation (90 Aufzeichnungen, bis 4,7 MB): Übersicht für 50 Einträge 15,8 KB
statt 124 MB; erster Aufruf 5,7 s (jede Datei einmal gelesen), danach 0,08 s aus dem Speicher;
Einzelabruf 4,5 MB in 0,2 s.

**Nachbesserung nach Review** (2026-10-30):

- Blättern: Überspringt der Server Einträge (Datei nicht lesbar, Filter), kamen weniger als
  50 zurück, und „Load more“ setzte den nächsten Offset um genau so viele weiter – die
  nächste Seite begann mit Einträgen, die schon da waren. Die Antwort trägt jetzt
  `nextOffset` (Offset plus gelesene Einträge der Seite), das Dashboard nimmt ihn.
- Smoke-Test: Die Testaufzeichnung blieb im Verzeichnis der IP liegen und tauchte beim
  nächsten Workspace mit dieser IP auf. Sie wird jetzt über die API gelöscht (`200`, danach
  `404`); das prüft zugleich das Löschen einzelner Aufzeichnungen.

**Tests**: Smoke-Test lokal 56/56. Logging-Workspace mit 120 nachgebauten Aufzeichnungen
(eine kaputt, eine 5,7 MB): Seiten 49 + 50 + 20, `nextOffset` 50/100/120, 119 verschiedene
Einträge ohne Wiederholung; erster Aufruf je Seite 4,6–4,9 s (ein `docker exec` je Datei),
danach 0,1–0,2 s aus dem Speicher; Antworten gzip. Im Browser: Zähler „120 (showing 49)“,
„Load 50 more“/„Load 20 more“, 119 eindeutige Einträge; Aufklappen der großen Aufzeichnung
lädt sie einzeln, Rohbody gekürzt, „Download JSON“ da, kein Schlüssel im Text.

---

## Paket 6 – Workspace-Ressourcen (2026-10-31)

Anlass: ein Feature-Wunsch von der Installation auf dem NixOS-Server. MPI-Rechnungen
(OpenFOAM mit MPICH) legen ihre Puffer in `/dev/shm` an; Workspace-Container hatten
Dockers Standard von 64 MB, damit laufen höchstens etwa 8 Prozesse. Ein Remount im
laufenden Container ist nach jedem Neustart weg (und braucht `CAP_SYS_ADMIN`). Außerdem
waren RAM und CPU im Server fest auf 16 GB / 8 Kerne begrenzt; ein ProLiant mit 32 GB und
12 Kernen ließ sich nicht ausnutzen.

Entscheidungen (per Rückfrage, jeweils die Empfehlung):
- **Bearbeiten**: eigener Dialog „Resources“ je Workspace. RAM/CPU wirken sofort
  (`docker update`); eine shm-Änderung baut den Container aus einem Snapshot seiner selbst
  neu auf (6.2), weil Docker `ShmSize` eines bestehenden Containers nicht ändern kann und
  die Dateien im Container liegen, nicht in Volumes.
- **shm höchstens so groß wie das RAM-Limit**: tmpfs zählt zum Speicher des Containers.
- **Obergrenzen aus den vorhandenen `.env`-Werten** `MEMORY_PER_WORKSPACE_MB` und
  `CPU_PER_WORKSPACE`, keine neuen Variablen.

### 6.1 Obergrenzen aus `.env`, Shared Memory beim Anlegen

**Problem**: `MEMORY_PER_WORKSPACE_MB`/`CPU_PER_WORKSPACE` filterten nur die Auswahl im
Dashboard (aus festen Listen 1–16 GB, 1/2/4/8 Kerne); die API nahm jeden Wert der festen
Listen an, unabhängig von der Einstellung. Werte über 16 GB/8 Kerne gab es gar nicht.
`/dev/shm` war nicht einstellbar.

**Änderung**:
- `workspaceService.getResourceOptions()` erzeugt die Auswahl: Zweierpotenzen bis zur
  Obergrenze plus die Obergrenze selbst (12 Kerne → 1, 2, 4, 8, 12; 32 GB → 1, 2, 4, 8, 16,
  32). Die Obergrenzen werden auf den Docker-Host gedeckelt (CPU-Zahl; Speicher auf ganze GB
  aufgerundet, damit ein 32-GB-Host nicht bei 31 GB endet). Standard 2 GB / 2 Kerne, sonst
  das Maximum. `shm`: `64m` und die Speicherwerte.
- `resolveResources()` prüft `memoryLimit`, `cpuCores`, `shmSize` gegen diese Auswahl
  (`400 Invalid resources` mit den erlaubten Werten) und `shmSize ≤ memoryLimit`. Beim
  späteren Ändern (6.2) wird nur geprüft, was sich ändert, damit ein Workspace einen Wert
  von vor einer gesenkten Grenze behalten kann.
- `GET /api/limits` liefert zusätzlich `resources` (Auswahl, Maxima, Standards).
- Docker: `HostConfig.ShmSize` aus `shmSize`; `parseMemoryLimit`/`cpuCoresToNanoCpus`
  nehmen beliebige ganze Werte statt fester Listen; `getHostCapabilities` kennt `MemTotal`.
- `shmSize` wird mit dem Projekt gespeichert (alte Einträge: `64m`), von Klonen
  übernommen und in Liste und Klon-Übersicht angezeigt (nur wenn nicht 64 MB).
- Dashboard: Auswahl aus `resources`, neues Feld „Shared Memory (/dev/shm)“ mit Hinweis
  (zählt zum RAM-Limit, OpenFOAM/MPI); es bietet nur Werte bis zum gewählten RAM-Limit an
  und passt sich an, wenn das Limit geändert wird.
- Doku: `API.md` (Felder, `/api/limits`), `INSTALLATION.md` (Bedeutung der beiden Werte,
  Beispiel Simulationsserver), `.env.example`, Upgrade-Zeile in `DEPLOYMENT.md`.

**Verhaltensänderung**: API-Aufrufe über den Obergrenzen antworten `400`. Ohne Angabe
bekommt ein Workspace 2 GB / 2 Kerne oder das niedrigere Maximum – mit dem Standard
`CPU_PER_WORKSPACE=1.0` also 1 Kern (das Dashboard bot ohnehin nur 1 Kern an).

**Tests** (lokal, `MEMORY_PER_WORKSPACE_MB=8192`, `CPU_PER_WORKSPACE=4`, Host 8 CPUs /
11,7 GB): `/api/limits` → 1/2/4/8 GB, 1/2/4 Kerne, shm 64m–8g. `shmSize 8g` bei 2 GB → 400,
`cpuCores 8` → 400, `shmSize 3g` → 400. Workspace mit 4 GB, 4 Kernen (als Zahl), 2 GB shm:
`df -h /dev/shm` 2,0G, `HostConfig` Memory 4 GiB, NanoCpus 4e9, ShmSize 2 GiB; 1,5 GB in
`/dev/shm` geschrieben (74 %); nach Stop/Start und nach `docker restart` weiterhin 2,0G.

### 6.2 Ressourcen nachträglich ändern, Neuaufbau für Shared Memory

**Änderung**:
- `PUT /api/projects/:id/resources` (`memoryLimit`, `cpuCores`, `shmSize`, jeweils optional;
  Workspace-Passwort wie bei den anderen Workspace-Routen; Gruppen-Nutzer `403`, nicht auf
  ihrer Allowlist).
- Nur RAM/CPU geändert: `docker update` am laufenden oder gestoppten Container, `200`.
  Docker hatte beim Anlegen Swap = 2 × RAM gesetzt; `MemorySwap` zieht mit, sonst lehnt
  Docker ein größeres RAM-Limit ab.
- Anderes `shmSize`: Neuaufbau im Hintergrund (`202`, Status `rebuilding`, `?wait=true`
  für Skripte). `rebuildWorkspaceContainer`: Workspace stoppen, `docker commit` nach
  `workspace-rebuild-<id>:raw-<zeit>` (Rückfall export/import wie beim Klonen), alten
  Container in `rebuild-backup-<id>` umbenennen (bewusst ohne Präfix `workspace-`, damit
  ihn nichts als Workspace sieht), neuen Container mit gleichem Namen aus dem Snapshot
  anlegen – Env (Passwort, Forgejo-Token), Cmd/Entrypoint/User, die komplette
  `HostConfig` des alten mit neuen Werten für Memory/MemorySwap/NanoCpus/ShmSize, Netz
  mit fester Proxy-IP –, starten, falls er lief, auf code-server warten (60 s statt 15 s,
  läuft ja im Hintergrund), alten Container löschen, ältere Snapshot-Tags entfernen.
  Schlägt ein Schritt nach dem Umbenennen fehl: neuen Container weg, alten zurück unter
  seinem Namen, ggf. starten, Snapshot löschen, `lastError` (`action: rebuild`).
- Server-Neustart mitten im Neuaufbau: `recoverInterruptedRebuilds()` beim Laden holt
  `rebuild-backup-<id>` zurück (ein evtl. schon angelegter neuer Container fällt weg; die
  gespeicherten Werte passen zum alten, sie werden erst nach Erfolg geschrieben).
- Während des Neuaufbaus antworten Start, Stopp, Löschen, Klonen und eine weitere Änderung
  `409`. Löschen eines Workspace entfernt auch seine Snapshot-Images.
- Dashboard: Knopf „Resources“ (nur Admin) in der Kopfzeile des Workspace; Dialog mit den
  drei Auswahlen (ein Wert von vor einer gesenkten Grenze bleibt wählbar), Hinweis, dass
  Shared Memory zum RAM zählt, und bei geänderter shm-Größe ein Hinweis auf den Neuaufbau
  plus Rückfrage. Status „Rebuilding“ mit Ladeanzeige ohne Knöpfe; danach Erfolgsmeldung
  oder die Fehlermeldung einmal und die Fehlerzeile.
- Quick Clone schickte fest 2 GB / 2 Kerne; mit echten Obergrenzen hätte das auf einer
  Standard-Installation (max. 1 Kern) `400` ergeben. Es schickt jetzt keine Werte mehr,
  der Server nimmt seine Standards.
- Doku: `API.md` (Abschnitt „Change Resources“, Status `rebuilding`), Upgrade-Zeile.

**Bewusst nicht**: keine Zeitgrenze für den Neuaufbau (ein `docker commit` eines großen
Workspace darf Minuten dauern; ein Abbruch mittendrin wäre schlimmer). Hängt Docker, hilft
wie beim Stopp ein Neustart des Servers – der holt den alten Container zurück.

**Tests** (lokal):
- Laufender Workspace 4 GB/4 Kerne/2 GB shm → 8 GB/2 Kerne: `200`, `HostConfig` Memory
  8 GiB, MemorySwap 16 GiB, NanoCpus 2e9, Container lief weiter. RAM 1 GB bei 2 GB shm → 400;
  gleiche Werte → „Nothing changed“.
- shm 2 → 4 GB am laufenden Workspace: `202`, Start und weitere Änderung währenddessen
  `409`, nach 20 s `running`, neuer Container aus `workspace-rebuild-…`, `df` 4,0G, Datei in
  `/workspace` und `~` erhalten, RAM-Einstellung erhalten, kein `rebuild-backup-` übrig,
  Workspace-URL 302.
- Gestoppter Workspace, shm 1 GB und RAM 2 GB mit `?wait=true`: `200`, bleibt gestoppt,
  alter Snapshot-Tag entfernt; nach Start `df` 1,0G, Datei da.
- Logging-Workspace mit Passwort und Forgejo-Repo: ohne Passwort `401`; Neuaufbau:
  Fingerabdruck von `PASSWORD`/`FORGEJO_*` gleich, gleiche feste IP `172.30.128.2`, gleiches
  DNS, letzter Commit da, Proxy funktioniert. (Push nach Forgejo geht aus Proxy-Workspaces
  wie bisher nicht – bekannte Einschränkung aus Paket 2.) Dabei gefunden: code-server war
  nach 15 s noch nicht bereit → Wartezeit beim Neuaufbau 60 s.
- Abgebrochener Neuaufbau: Container von Hand in `rebuild-backup-<id>` umbenannt, Server
  neu deployt → „Restored … after an interrupted rebuild“, Workspace wieder da (gestoppt).
- Rücksprung mit nachgebautem dockerode: Erfolg (Reihenfolge, shm/RAM/Swap/CPU, Init,
  CapDrop, Env, feste IP, Name) sowie Fehler bei `create` und bei `start` (neuer Container
  weg, alter zurückbenannt und gestartet, Snapshot gelöscht). 9/9.
- Klon eines neu aufgebauten Workspace: shm 2 GB übernommen, Datei da.
- Browser: Formular bietet 64 MB–2 GB shm bei 2 GB RAM, nach 1 GB RAM nur bis 1 GB, nach
  8 GB alle; Dialog zeigt die Werte des Workspace, Hinweis auf den Neuaufbau erscheint erst
  bei geänderter shm-Größe; Speichern → Rückfrage → „Rebuilding workspace...“ →
  `stopped` → Meldung „rebuilt with 2 GB shared memory“.

### 6.3 Smoke-Test und README

**Änderung**:
- Smoke-Test, Abschnitt „Workspace resources“ am Workspace ohne Proxy: Auswahl aus
  `/api/limits`, `/dev/shm` 64 MB als Standard, shm über dem RAM-Limit → 400, Neuaufbau auf
  1 GB mit `?wait=true` (200, läuft danach, `df` 1 GB, Datei erhalten), RAM-Limit sofort
  geändert (200, `HostConfig.Memory`). Gruppen-Nutzer: Ressourcen ändern → 403. Nach dem
  Löschen keine `workspace-rebuild-<id>`-Images mehr.
- README: Auswahl bis zu den Grenzen statt fester 1–16 GB / 1–8 Kerne, Shared Memory,
  Bedeutung der beiden `.env`-Werte, Beispiel Simulationsserver.

**Tests**: Smoke-Test lokal 66 von 67; alle neuen Prüfungen grün. Rot war „VS Code
reachable through nginx (HTTP 502)“ direkt nach dem Anlegen – unabhängig von diesem Paket:
Auf dem lokalen Rechner braucht der Erweiterungs-Check im Entrypoint gerade 23 s
(`code-server --list-extensions` je Erweiterung), der Server wartet beim Anlegen aber nur
15 s auf code-server (`waitForWorkspaceReady`, danach „proceeding anyway“) und meldet den
Workspace als `running`. Gemessen auf diesem Branch und auf `main` gleich: `running` nach
19–20 s, VS Code über nginx erst nach 26–27 s. Vorgemerkt (siehe unten).

### 6.4 Nachtrag: „running“ erst, wenn VS Code antwortet (2026-10-31)

**Problem** (vorgemerkt in 6.3): Anlegen, Start, Klonen und Passwortwechsel warten höchstens
15 s auf code-server (`waitForWorkspaceReady`, danach „proceeding anyway“) und melden den
Workspace dann als `running`; „Open Workspace“ lieferte danach noch einige Sekunden 502.
Der Entrypoint (`check-extensions.sh`) startete `code-server --list-extensions` einmal je
Erweiterung aus `extensions.txt` plus einmal für die kritischen – elf Node-Starts,
16 s im Container ohne Limit, 23 s im Workspace des Smoke-Tests; ein Start mit einem Kern
dauerte damit 35 s.

**Änderung**:
- `check-extensions.sh` listet die Erweiterungen einmal und prüft gegen diese Liste
  (`grep -qixF`, Groß-/Kleinschreibung egal wie in VS Code); neu gelistet wird nur nach einer
  Installation. Braucht ein neues code-server-Image.
- `waitForWorkspaceReady` wartet standardmäßig 45 s statt 15 s, auch beim Passwortwechsel
  (dort stand fest 15 s). Grund für die Länge: Bestehende Workspaces und ihre Klone bzw.
  Neuaufbauten behalten das alte Skript, bis sie neu angelegt werden.

**Entscheidungen**:
- 45 s statt der 60 s des Neuaufbaus: Start und Passwortwechsel antworten synchron, nginx
  bricht `/api/` nach 60 s ab (`proxy_read_timeout`-Standard). Start = Docker-Start + ≤ 45 s
  + DNS-Check (sofort, höchstens 10 s), Passwortwechsel = Stopp (≤ 10 s) + Start + ≤ 45 s.
- Antwortet code-server nach 45 s nicht, geht es wie bisher trotzdem weiter (`running`);
  ein Fehler wäre falsch, wenn z. B. nur das Netz für eine Nachinstallation langsam ist.

**Tests**:
- Neues Image, Anlegen (Smoke-Timing wie in 6.3): VS Code über nginx nach 15 s, `running`
  nach 17 s – vorher 26–27 s bzw. 19–20 s, also `running` jetzt erst nach VS Code.
- Workspace mit einem Kern und dem alten Skript (von `main` hineinkopiert), Stopp und Start
  über die API: Start antwortet nach 34,5 s, nginx sofort danach 302. Mit dem neuen Skript
  im selben Workspace: 11,4 s, 302.
- Passwort am laufenden Workspace gesetzt: 200 nach 14 s, nginx sofort 302.
- Skript im Image-Container: 1,9 s statt 15,8 s, Ausgabe gleich.
- Smoke-Test lokal: alle 67 Prüfungen grün (vorher 66, „VS Code reachable through nginx“).

### Vorgemerkt aus Paket 6

- **Fehlende Erweiterungen werden beim Start nicht nachinstalliert**: Der Zweig in
  `check-extensions.sh` ruft `su - coder -c "code-server --install-extension …"` auf, der
  Entrypoint läuft aber schon als `coder` – `su` fragt nach einem Passwort und scheitert
  („Authentication failure“), getestet in 6.4. Schon immer so, also unbemerkt: Wer eine
  vorinstallierte Erweiterung entfernt, behält sie entfernt. Vor einer Reparatur klären, ob
  das überhaupt gewollt ist: Sie würde entfernte Erweiterungen bei jedem Start wieder
  installieren und ohne Internet (Intranet-Installation) den Start pro Erweiterung bis zu
  60 s aufhalten.
