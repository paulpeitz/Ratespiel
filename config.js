/**
 * Zentrale Konfiguration für das Musik-Ratespiel.
 *
 * CLIENT_ID kann hier fest eingetragen werden oder beim ersten Start
 * direkt über die Weboberfläche hinterlegt werden (gespeichert im localStorage).
 */
export const CONFIG = {
  CLIENT_ID: "4d1d1edfee5b4648a98a81cb3707c06c",
  REDIRECT_URI: window.location.origin + window.location.pathname,
  SCOPES: [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state"
  ],
  SONGS_FILE: "./songs.json",
  PLAYER_NAME: "Musik-Ratespiel Player"
};
