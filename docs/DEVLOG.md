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
| 2 – Isolation | Netzsegmentierung (Workspaces ↔ API/mitmproxy), Forgejo-Token pro Workspace, Snapshot-Sanitizing beim Klonen, `buildContainerSpec()`, echte CPU-/Disk-Limits | 🚧 in Arbeit (Branch `security/paket-2`, Variante 2) |
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

- **Clone-Branch auf leerem Repo**: `setupCloneBranch` meldet „Branch created“, obwohl
  `git push` mit „src refspec … does not match any“ scheitert (Workspace ohne Commits).
- ~~**`DNS … not ready after 10000ms, proceeding anyway`** beim Erstellen~~ – behoben in
  2.4: Der Server konnte die Namen von Proxy-Workspaces nie auflösen (anderes Netz);
  die Prüfung läuft jetzt in nginx.
- **Alias direkt nach dem Anlegen** liefert kurz 404 (nginx-Reload ist asynchron); das
  API meldet bereits Erfolg.
- Klone erben weiterhin `GIT_ADMIN_PASSWORD` und `PASSWORD` aus dem Snapshot-Env
  (bekannt, Paket 2).

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
| 2.6 | Forgejo: eigener Nutzer + Token pro Workspace, kein `GIT_ADMIN_PASSWORD` mehr in Workspaces; Klone bekommen einen **Fork** statt eines Branches im gemeinsamen Repo (Vorschlag, siehe dort) | 2.4 |
| 2.7 | Doku, Upgrade-Hinweise, Live-Test | alle |

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
  Die übrigen Erwähnungen von `xares-internal`/`172.30` in der Doku folgen in 2.7.

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
Feature vorgemerkt) oder per Host-Firewall – Vorschlag als eigener Schritt.

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
