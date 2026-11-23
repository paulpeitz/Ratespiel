# Musik-Ratespiel (Spotify Web Playback)

Eine schlichte Webanwendung für ein Musik-Ratespiel mit direkter Wiedergabe im Browser über das **Spotify Web Playback SDK** (setzt ein **Spotify-Premium-Konto** voraus).

## Voraussetzungen

- Ein **Spotify-Premium-Account**
- Eine kostenlose App im [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) (liefert die benötigte **Client ID**)
- Ein lokaler Webserver (z. B. Python oder Node.js), da Spotify OAuth und das Web Playback SDK nicht direkt über `file://` funktionieren

## Einrichtung (einmalig)

1. Öffne das [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) und klicke auf **Create app**.
2. Vergib einen Namen (z. B. `Musik-Ratespiel`) und eine kurze Beschreibung.
3. Trage unter **Redirect URIs** die lokale Adresse ein, z. B.:
   ```
   http://127.0.0.1:8000/
   ```
   *(Hinweis: Spotify verlangt für lokale Entwicklung `127.0.0.1` statt `localhost`.)*
4. Aktiviere unter **APIs used** die Optionen **Web API** und **Web Playback SDK** und speichere die App.
5. Kopiere die **Client ID** aus den App-Einstellungen.
   - Du kannst sie entweder fest in `config.js` bei `CLIENT_ID` eintragen **oder** direkt beim ersten Öffnen der Webseite eingeben.

## Lokal starten

Im Projektverzeichnis einen einfachen HTTP-Server starten:

**Mit Python:**
```powershell
python -m http.server 8000 --bind 127.0.0.1
```

**Oder mit Node.js:**
```powershell
npx serve -l tcp://127.0.0.1:8000 .
```

Danach im Browser öffnen:
```
http://127.0.0.1:8000/
```

Beim ersten Start einmalig auf **Mit Spotify anmelden** klicken. Danach bleibt die Anmeldung über Refresh-Tokens erhalten.

## Spielablauf

1. **Start**: Spielt ein zufälliges Lied aus `songs.json` ab (jedes Lied einmal pro Durchlauf). Der Button wechselt zu **Stopp**.
2. **Stopp**: Das Lied läuft weiter. Es erscheinen **Titel**, **Artist**, **Album**, **Jahr** und **Genre** sowie der Button **Nächstes Lied**.
3. **Nächstes Lied**: Blendet die Auflösung aus und startet sofort das nächste Zufallslied.

## Format der `songs.json` (für das Befüllungs-Skript)

Die Datei `songs.json` enthält ein JSON-Array mit Objekten in folgendem Format:

```json
[
  {
    "spotifyId": "4cOdK2wGLETKBW3PvgPWqT",
    "title": "Never Gonna Give You Up",
    "artist": "Rick Astley",
    "album": "Whenever You Need Somebody",
    "year": 1987,
    "genre": "Dance-Pop"
  }
]
```

- `spotifyId` akzeptiert sowohl reine Spotify-Track-IDs (`4cOdK2wGLETKBW3PvgPWqT`) als auch vollständige URIs (`spotify:track:...`) oder Spotify-Links (`https://open.spotify.com/track/...`).
- Änderungen an `songs.json` werden beim Neuladen der Seite sofort übernommen (`cache: "no-store"`).

## Design anpassen

Alle Farben, Schriftarten, Abstände und Button-Stile sind oben in `style.css` über CSS-Variablen (`:root`) definiert und können dort zentral angepasst werden.
