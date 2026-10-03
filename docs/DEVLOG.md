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
| **1 – Security-Quick-Wins & Bugfixes** | Secrets aus API-Antworten, Passwortprüfung auf allen sensiblen Routen, Whitelist-Validierung, Header-Redaction, XSS, Service Worker, Workshop-Härtung, atomare Persistenz, CA-Key-Rechte | ✅ umgesetzt auf Branch `security/paket-1`, Review-Runde eingearbeitet – **Deploy-Test steht aus** |
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

## Paket 1 – Was noch nicht verifiziert ist

In dieser Umgebung steht **kein Docker** zur Verfügung. Alle Tests liefen mit Node-/
Python-Stubs, echten Shell-Befehlen auf Temp-Verzeichnissen und einem HTML-Parser –
**nicht** gegen laufende Container. Vor dem Merge sollte ein Deploy-Test laufen:

- [ ] `./deploy.sh` (mit `--git-server --enable-proxy`) durchläuft, Server startet,
      bestehende `projects.json` wird geladen.
- [ ] Workspace mit Passwort anlegen → Clone/Aliases/Logs fragen nach dem Passwort.
- [ ] LLM-Logging-Workspace: Gespräch erzeugen → im UI ohne Keys sichtbar; Löschen
      einzelner (auch WebSocket-)Gespräche funktioniert.
- [ ] Whitelist aus Recorded Domains anwenden → `squid -k parse` akzeptiert die
      mehrzeilige ACL, Security-Proxy-Workspace erreicht nur freigegebene Domains.
- [ ] Workshop: Claim, Reload zeigt Workspace, Admin „Freigeben“ → Reload zeigt
      Formular; Admin-Login per Header.
- [ ] PWA: nach Deploy lädt das Dashboard die neue Version ohne Hard-Reload.
