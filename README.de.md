# PVE Vitals

Ein permanent laufender, nur lesender Statusbildschirm für deinen Proxmox VE Cluster.
Grün heißt alles ok. Rot heißt hinschauen.

Entworfen für einen fest montierten Monitor, damit du im Vorbeigehen sofort siehst, ob dein Cluster gesund ist. Keine Knöpfe, keine Steuerung, keine Klicks: reine Information.

English readme: [README.md](README.md).

## Installation per Einzeiler (Debian oder Ubuntu)

Auf dem Gerät ausführen, das den Monitor antreiben soll (ein Debian 12 LXC auf deinem Proxmox-Host ist das empfohlene Ziel):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/MiaLaMala/PVE-Vitals/main/install.sh)"
```

Das Skript installiert Node.js 20, klont das Repo, fragt die Proxmox-Zugangsdaten ab und startet die App unter PM2 mit Autostart. Ein erneuter Aufruf aktualisiert die Installation.

Das Skript kannst du vor der Ausführung in `install.sh` in diesem Repo lesen.

## Funktionen

- Live-Status aller Knoten (CPU, RAM, Disk, Laufzeit) mit Sparkline-Historie (Zeitraum wechselt zwischen Stunde / Tag / Woche)
- Übersicht aller VMs und Container inklusive Lastanzeige
- Speichernutzung pro aktivem Pool
- Feed der letzten Aufgaben mit Fehlerhervorhebung
- Alarm-Engine mit konfigurierbaren Warn- und Critwerten
- Einbrennschutz durch leichtes Pixel-Drift
- Zweisprachige Oberfläche: Deutsch und Englisch, automatisch erkannt, per `?lang=de` erzwingbar
- Keine CDN-Abhängigkeiten, läuft komplett im eigenen Netz
- Strikt nur lesend: Steuerungs-Endpunkte existieren im Code gar nicht

## Manuelle Installation

Wer den Einzeiler nicht nutzen will, folgt diesen Schritten.

### 1. API-Token in Proxmox erstellen (nur lesen)

In der Proxmox-Weboberfläche:

1. **Rechenzentrum > Berechtigungen > API-Tokens > Hinzufügen**
2. Benutzer: beliebiger Benutzer mit `PVEAuditor` auf `/` (root funktioniert)
3. Token-ID: z. B. `vitals`
4. Haken bei "Privilege Separation" entfernen, außer du hast eigene Rollen eingerichtet
5. Die einmal angezeigte UUID kopieren

Mindestberechtigung für den Token-Benutzer:

| Pfad | Rolle |
|------|-------|
| `/`  | PVEAuditor |

### 2. App konfigurieren

```bash
cp .env.example .env
```

Werte eintragen:

```
PVE_HOST=192.168.1.10
PVE_TOKEN_ID=root@pam!vitals
PVE_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PORT=3000
```

Optional: Alarm-Schwellwerte (Prozent) und Standardsprache.

```
CPU_WARN=80
CPU_CRIT=95
MEM_WARN=85
MEM_CRIT=95
DISK_WARN=85
DISK_CRIT=95
STORAGE_WARN=85
STORAGE_CRIT=95
DEFAULT_LANG=de
```

### 3. Installieren und starten

```bash
npm install
npm start
```

Der Bildschirm ist unter `http://<host>:3000` erreichbar.

### 4. Autostart mit PM2 (empfohlen)

```bash
npm install -g pm2
pm2 start server.js --name pve-vitals
pm2 save
pm2 startup
```

### 5. Monitor darauf richten

Jeder Kiosk-fähige Browser funktioniert. Beliebte Varianten:

- **Raspberry Pi** im Kiosk-Modus:
  ```
  chromium-browser --kiosk --noerrdialogs --disable-session-crashed-bubble http://pve-vitals.lan:3000
  ```
- **macOS**: Safari > Darstellung > Vollbildmodus
- **Windows / Linux Desktop**: F11 im Browser

## Alarmlogik

Das Banner oben fasst den Gesamtzustand in drei Stufen zusammen:

- **OK** (grün): nichts über dem Warnwert
- **Warnung** (gelb): mindestens ein Wert über dem Warnwert oder eine Aufgabe kürzlich fehlgeschlagen
- **Kritisch** (rot): ein Knoten ist offline, ein Wert ist über dem Critwert, oder die Proxmox-API ist nicht erreichbar

Einzelne Alarme erscheinen zusätzlich als Chips unter dem Banner.

## Sprache

Die Oberfläche übernimmt Englisch oder Deutsch aus dem Browser. Per `?lang=de` oder `?lang=en` lässt sich die Sprache erzwingen. Die Voreinstellung steuert `DEFAULT_LANG` in der `.env`.

## Auto-Deploy per GitLab Webhook

`deploy.js` ist ein kleiner HTTP-Empfänger. Push-Events aus GitLab lösen `git pull` und PM2-Neustart aus.

### Auf dem Server

```bash
DEPLOY_SECRET=starkes-geheimnis \
REPO_PATH=/opt/pve-vitals \
PM2_APP=pve-vitals \
pm2 start deploy.js --name deploy-webhook
pm2 save
```

| Variable | Default | Beschreibung |
|---|---|---|
| `DEPLOY_SECRET` | Pflicht | gemeinsames Secret mit GitLab |
| `REPO_PATH` | `/opt/pve-vitals` | lokaler Repo-Pfad auf dem Server |
| `PM2_APP` | `pve-vitals` | Name des PM2-Prozesses |
| `DEPLOY_PORT` | `4000` | Port des Webhook-Listeners |

### In GitLab

Einstellungen > Webhooks > Webhook hinzufügen

| Feld | Wert |
|---|---|
| URL | `http://dein-server-ip:4000/deploy` |
| Secret Token | identisch zu `DEPLOY_SECRET` |
| Trigger | Push-Events auf `main` |

## Projektstruktur

```
.
├── server.js              # Express-Backend, Read-only Proxmox-Proxy
├── install.sh             # Einzeilige Installation für Debian und Ubuntu
├── deploy.js              # Optionaler GitLab-Webhook
├── public/
│   ├── index.html         # App-Gerüst
│   ├── style.css          # Kiosk-Dark-Theme
│   └── app.js             # Frontend-Logik, i18n, Alarme, Sparklines
├── .env.example           # Konfig-Vorlage
└── package.json
```

## Warum PVE Vitals und nicht die Proxmox-Oberfläche selbst?

Die eingebaute Oberfläche ist mächtig, aber:

- steckt hinter einem Login
- ist für aktives Arbeiten gebaut
- zeigt viele Details, die für einen Überblick zu viel sind

PVE Vitals ist das Gegenteil: eine Seite, kein Login, optimiert für das Auge im Vorbeigehen. Sie beantwortet genau eine Frage: "Ist gerade irgendwas kaputt?"

## Lizenz

MIT
