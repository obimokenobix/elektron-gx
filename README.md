# Elektron GX – der Gaming-Browser

Chromium-basierter Browser (Electron) mit Gaming-Funktionen im Stil von Opera GX.

## Funktionen

- **GX Control** (Tacho-Symbol links): Live-Anzeige von RAM und CPU des Browsers
- **RAM-Limiter**: legt die am längsten unbenutzten Tabs schlafen, wenn das Limit überschritten wird
- **CPU-Limiter**: friert den hungrigsten Hintergrund-Tab ein, wenn der Browser zu viel CPU braucht
- **Netzwerk-Limiter**: begrenzt die Bandbreite aller Tabs
- **Gaming-Modus** (Strg+Umschalt+G): friert alle Hintergrund-Tabs ein und senkt die Prozess-Priorität des Browsers
- **Beim Minimieren einfrieren**: Tabs ohne Ton ruhen, solange der Browser minimiert ist
- **Werbeblocker** (Ghostery-Engine, volle Listen inkl. Cookie-Banner) mit Zähler, blockiert Werbe-Popups
- **YouTube-Werbung überspringen**: Videowerbung wird stummgeschaltet und sofort übersprungen
- **Split-Screen** (Strg+Umschalt+S): zwei Tabs nebeneinander, Trennlinie ziehbar
- **Schwebende Fenster** (Strg+Umschalt+F): Tab als kleines Fenster immer im Vordergrund, mit Transparenz-Regler
- **Video ausklappen** (Strg+Umschalt+P): Bild-in-Bild, auch automatisch beim Tab-Wechsel oder Minimieren
- **Webcam/Mikrofon-Regeln**: Kamera standardmäßig ohne Nachfrage blockiert
- **Seitenleiste** mit Discord, Twitch, YouTube und WhatsApp – läuft im Hintergrund weiter (z. B. Discord-Sprachkanal)
- **Gaming-Startseite** mit Google-Suche und bearbeitbarem Schnellzugriff
- Dedizierte Grafikkarte erzwingen, FPS-Limit für Browser-Spiele aufheben
- Tabs wiederherstellen (laden erst beim Anklicken), Akzentfarben, Downloads, Berechtigungs-Abfragen

- **Lesezeichen** mit Stern in der Adressleiste, Lesezeichenleiste und Verwaltung; Import aus Edge, Chrome und Opera GX
- **Verlauf** mit Suche und Löschen (letzte Stunde, 24 Stunden, alles)
- **Vorschläge in der Adressleiste** aus Lesezeichen, Verlauf und Google
- **Suchen auf der Seite** (Strg+F), **Downloads-Übersicht** mit Fortschritt, **private Tabs**
- **PDF-Anzeige** und **Rechtschreibprüfung** (Deutsch/Englisch)
- **Automatische Updates** über einen Ordner auf deiner Webseite; als Standardbrowser auswählbar

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| Strg+T / Strg+W | Neuer Tab / Tab schließen |
| Strg+Umschalt+T | Geschlossenen Tab wiederherstellen |
| Strg+Tab, Strg+1…9 | Tabs wechseln |
| Strg+L | Adressleiste |
| F5 / Strg+F5 | Neu laden / ohne Cache |
| Alt+← / Alt+→ | Zurück / Vor |
| F11 | Vollbild |
| Strg+Umschalt+G | Gaming-Modus |
| Strg+Umschalt+S | Split-Screen |
| Strg+Umschalt+F | Tab als schwebendes Fenster |
| Strg+Umschalt+P | Video ausklappen (Bild-in-Bild) |
| Strg+Umschalt+N | Privater Tab |
| Strg+D / Strg+Umschalt+B / Strg+Umschalt+O | Lesezeichen setzen / Leiste ein-aus / verwalten |
| Strg+H / Strg+J | Verlauf / Downloads |
| Strg+F, F3 | Auf der Seite suchen, nächster Treffer |
| Strg+P | Drucken |
| Strg+Plus / Minus / 0 | Zoom |
| F12 | Entwicklertools |

## Selbst bauen (Windows)

Voraussetzung: [Node.js](https://nodejs.org) (LTS).

```
npm install
npm start            # Browser starten
npm run dist:win     # Windows-Installer in dist\ erzeugen
```

## Updates veröffentlichen

1. In `package.json` die Versionsnummer erhöhen (z. B. 2.0.0 → 2.0.1), committen und hochladen.
2. GitHub baut den Installer automatisch auf Windows (`.github/workflows/release.yml`) und veröffentlicht ihn als Release.
3. Fertig – installierte Browser finden das Update innerhalb von 4 Stunden (oder sofort über „Nach Updates suchen“).

Die Update-Adresse (`releases/latest/download/`) steht in `update.json` und lässt sich in GX Control → Updates ändern.
Die Webseite liegt im Ordner `docs/` und wird über GitHub Pages veröffentlicht: https://obimokenobix.github.io/elektron-gx/
Neue Chromium-Sicherheitsupdates kommen durch eine neuere Electron-Version: `npm install electron@latest`, Version erhöhen, neu bauen, hochladen.

## Grenzen

- Netflix, Disney+ und andere DRM-Dienste funktionieren nicht (kein Widevine in Electron).
- Keine Chrome-Erweiterungen aus dem Web Store.
- Die App ist nicht signiert – Windows SmartScreen fragt bei der Installation nach.
- Kein Passwort-Manager und keine Synchronisierung zwischen Geräten.

## Projektstruktur

- `main.js` – Hauptprozess: Fenster, Tabs, Limiter, Gaming-Modus, Werbeblocker, Updates
- `store.js` – Lesezeichen, Verlauf, Downloads (JSON im Benutzerordner)
- `installer.nsh` – Registrierung als Browser bei Windows
- `preload-ui.js` – sichere Brücke zwischen Oberfläche und Hauptprozess
- `preload-float.js`, `ui/float.*` – Leiste der schwebenden Fenster
- `ui/` – Browser-Oberfläche (Tabs, Adressleiste, Seitenleiste, GX Control)
- `start/` – Startseite und Fehlerseite (`elektron://start/`)
- `assets/` – Logo und Icons
