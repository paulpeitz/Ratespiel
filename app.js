import { CONFIG } from "./config.js";
import {
  clearTokens,
  getClientId,
  getValidAccessToken,
  handleAuthCallback,
  isAuthenticated,
  startLogin
} from "./spotify-auth.js";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_SDK_URL = "https://sdk.scdn.co/spotify-player.js";

/** @type {"idle" | "playing" | "revealed"} */
let gameState = "idle";
let allSongs = [];
let songQueue = [];
let currentSong = null;
let playedInCycle = 0;

let spotifyPlayer = null;
let deviceId = null;
let isBusy = false;
let isPaused = false;

// DOM-Referenzen
const els = {
  authSection: document.getElementById("auth-section"),
  gameSection: document.getElementById("game-section"),
  authForm: document.getElementById("auth-form"),
  clientIdGroup: document.getElementById("client-id-group"),
  clientIdInput: document.getElementById("client-id-input"),
  redirectUriDisplay: document.getElementById("redirect-uri-display"),
  loginBtn: document.getElementById("login-btn"),

  errorBanner: document.getElementById("error-banner"),

  actionBtn: document.getElementById("action-btn"),
  revealCard: document.getElementById("reveal-card"),
  songTitle: document.getElementById("song-title"),
  songArtist: document.getElementById("song-artist"),
  songAlbum: document.getElementById("song-album"),
  songYear: document.getElementById("song-year"),
  songGenre: document.getElementById("song-genre"),

  statusBar: document.getElementById("status-bar"),
  statusText: document.getElementById("status-text"),
  counterText: document.getElementById("counter-text"),
  pauseBtn: document.getElementById("pause-btn"),
  pauseIcon: document.getElementById("pause-icon"),
  playIcon: document.getElementById("play-icon"),
  pauseBtnLabel: document.getElementById("pause-btn-label"),
  logoutBtn: document.getElementById("logout-btn")
};

/* -------------------------------------------------------------------------- */
/* Hilfsfunktionen                                                            */
/* -------------------------------------------------------------------------- */

function showError(message) {
  if (!message) {
    els.errorBanner.textContent = "";
    els.errorBanner.classList.add("hidden");
    return;
  }
  els.errorBanner.textContent = message;
  els.errorBanner.classList.remove("hidden");
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function updateCounter() {
  if (!allSongs.length) {
    els.counterText.textContent = "";
    return;
  }
  els.counterText.textContent = `Runde: ${playedInCycle} / ${allSongs.length}`;
}

/**
 * Akzeptiert reine Spotify-Track-IDs, spotify:track:-URIs oder open.spotify.com-URLs.
 */
function toSpotifyTrackUri(rawId) {
  if (typeof rawId !== "string") return null;
  const trimmed = rawId.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("spotify:track:")) {
    return trimmed;
  }

  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([a-zA-Z0-9]+)/);
  if (urlMatch) {
    return `spotify:track:${urlMatch[1]}`;
  }

  return `spotify:track:${trimmed}`;
}

/**
 * Lädt die Liedliste aus songs.json (ohne Cache, damit Änderungen sofort greifen).
 */
async function loadSongs() {
  const response = await fetch(CONFIG.SONGS_FILE, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Lieddatei (${CONFIG.SONGS_FILE}) konnte nicht geladen werden (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Die Datei ${CONFIG.SONGS_FILE} enthält keine Lieder.`);
  }

  const validSongs = data
    .map((entry) => ({
      spotifyUri: toSpotifyTrackUri(entry.spotifyId),
      title: entry.title ?? "Unbekannter Titel",
      artist: entry.artist ?? "Unbekannter Interpret",
      album: entry.album ?? "Unbekanntes Album",
      year: entry.year ?? "—",
      genre: entry.genre ?? "—"
    }))
    .filter((entry) => Boolean(entry.spotifyUri));

  if (validSongs.length === 0) {
    throw new Error(`Keine gültigen Spotify-IDs in ${CONFIG.SONGS_FILE} gefunden.`);
  }

  allSongs = validSongs;
  refillQueue(null);
  updateCounter();
}

/**
 * Fisher-Yates-Shuffle ohne unmittelbare Wiederholung am Durchlaufübergang.
 */
function refillQueue(previousUri) {
  const copy = [...allSongs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  if (previousUri && copy.length > 1 && copy[0].spotifyUri === previousUri) {
    const swapIndex = copy.length - 1;
    [copy[0], copy[swapIndex]] = [copy[swapIndex], copy[0]];
  }

  songQueue = copy;
  playedInCycle = 0;
}

function drawNextSong() {
  if (songQueue.length === 0) {
    refillQueue(currentSong ? currentSong.spotifyUri : null);
  }
  const next = songQueue.shift();
  playedInCycle += 1;
  updateCounter();
  return next;
}

/* -------------------------------------------------------------------------- */
/* UI-Darstellung                                                             */
/* -------------------------------------------------------------------------- */

function showAuthView() {
  els.authSection.classList.remove("hidden");
  els.gameSection.classList.add("hidden");
  els.statusBar.classList.add("hidden");

  els.redirectUriDisplay.textContent = CONFIG.REDIRECT_URI;

  if (CONFIG.CLIENT_ID) {
    els.clientIdGroup.classList.add("hidden");
    els.clientIdInput.disabled = true;
  } else {
    els.clientIdGroup.classList.remove("hidden");
    els.clientIdInput.disabled = false;
    els.clientIdInput.value = getClientId();
  }
}

function showGameView() {
  els.authSection.classList.add("hidden");
  els.gameSection.classList.remove("hidden");
  els.statusBar.classList.remove("hidden");
  renderGameState();
}

function renderPauseButton(playerReady) {
  const canPause = playerReady && (gameState === "playing" || gameState === "revealed");
  const pausedActive = canPause && isPaused;

  els.pauseBtn.disabled = !canPause || isBusy;
  els.pauseBtn.setAttribute("aria-pressed", String(pausedActive));
  els.pauseBtn.setAttribute("aria-label", pausedActive ? "Wiedergabe fortsetzen" : "Wiedergabe pausieren");
  els.pauseIcon.classList.toggle("hidden", pausedActive);
  els.playIcon.classList.toggle("hidden", !pausedActive);
  els.pauseBtnLabel.textContent = pausedActive ? "Weiter" : "Pause";
}

function renderGameState() {
  const btn = els.actionBtn;
  btn.classList.remove("action-btn--start", "action-btn--stop", "action-btn--next");

  const playerReady = Boolean(deviceId) && allSongs.length > 0;
  renderPauseButton(playerReady);

  if (gameState === "idle") {
    btn.textContent = playerReady ? "Start" : "Verbinde Spotify…";
    btn.classList.add("action-btn--start");
    btn.disabled = !playerReady || isBusy;
    els.revealCard.classList.add("hidden");
    return;
  }

  if (gameState === "playing") {
    btn.textContent = "Lösung";
    btn.classList.add("action-btn--stop");
    btn.disabled = isBusy;
    els.revealCard.classList.add("hidden");
    return;
  }

  if (gameState === "revealed") {
    if (currentSong) {
      els.songTitle.textContent = currentSong.title;
      els.songArtist.textContent = currentSong.artist;
      els.songAlbum.textContent = currentSong.album;
      els.songYear.textContent = String(currentSong.year);
      els.songGenre.textContent = currentSong.genre;
    }
    els.revealCard.classList.remove("hidden");
    btn.textContent = "Nächstes Lied";
    btn.classList.add("action-btn--next");
    btn.disabled = !playerReady || isBusy;
  }
}

/* -------------------------------------------------------------------------- */
/* Spotify Web Playback SDK & Wiedergabe                                      */
/* -------------------------------------------------------------------------- */

function loadSpotifySdkScript() {
  return new Promise((resolve, reject) => {
    if (window.Spotify && window.Spotify.Player) {
      resolve();
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => resolve();

    if (document.querySelector(`script[src="${SPOTIFY_SDK_URL}"]`)) {
      return;
    }

    const script = document.createElement("script");
    script.src = SPOTIFY_SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error("Spotify Web Playback SDK konnte nicht geladen werden."));
    document.head.appendChild(script);
  });
}

async function initSpotifyPlayer() {
  setStatus("Verbinde mit Spotify…");
  await loadSpotifySdkScript();

  if (spotifyPlayer) {
    spotifyPlayer.disconnect();
  }

  spotifyPlayer = new window.Spotify.Player({
    name: CONFIG.PLAYER_NAME,
    getOAuthToken: async (cb) => {
      const token = await getValidAccessToken();
      if (token) {
        cb(token);
      } else {
        handleSessionExpired();
      }
    },
    volume: 0.85
  });

  spotifyPlayer.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    setStatus("Spotify bereit");
    showError("");
    renderGameState();
  });

  spotifyPlayer.addListener("not_ready", () => {
    deviceId = null;
    setStatus("Spotify-Player getrennt");
    renderGameState();
  });

  spotifyPlayer.addListener("initialization_error", ({ message }) => {
    showError(`Player-Initialisierung fehlgeschlagen: ${message}`);
    setStatus("Fehler");
  });

  spotifyPlayer.addListener("authentication_error", ({ message }) => {
    showError(`Authentifizierung fehlgeschlagen: ${message}`);
    handleSessionExpired();
  });

  spotifyPlayer.addListener("account_error", () => {
    showError("Für die Wiedergabe im Browser ist ein aktives Spotify-Premium-Abo erforderlich.");
    setStatus("Premium erforderlich");
  });

  spotifyPlayer.addListener("playback_error", ({ message }) => {
    showError(`Wiedergabefehler: ${message}`);
  });

  spotifyPlayer.addListener("player_state_changed", (state) => {
    if (!state) return;
    if (isPaused !== state.paused) {
      isPaused = state.paused;
      renderGameState();
    }
  });

  const connected = await spotifyPlayer.connect();
  if (!connected) {
    throw new Error("Verbindung zum Spotify Web Playback SDK fehlgeschlagen.");
  }
}

function handleSessionExpired() {
  if (spotifyPlayer) {
    spotifyPlayer.disconnect();
    spotifyPlayer = null;
  }
  deviceId = null;
  clearTokens();
  gameState = "idle";
  currentSong = null;
  isPaused = false;
  showAuthView();
}

async function transferPlayback(token) {
  await fetch(`${SPOTIFY_API_BASE}/me/player`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play: false
    })
  });
}

async function playSongOnSpotify(song) {
  if (!deviceId) {
    throw new Error("Der Spotify-Player ist noch nicht bereit.");
  }

  // Browser-Autoplay-Schutz per Nutzerklick freischalten
  if (spotifyPlayer && typeof spotifyPlayer.activateElement === "function") {
    await spotifyPlayer.activateElement();
  }

  const token = await getValidAccessToken();
  if (!token) {
    handleSessionExpired();
    throw new Error("Deine Spotify-Sitzung ist abgelaufen. Bitte melde dich erneut an.");
  }

  const sendPlayRequest = () =>
    fetch(`${SPOTIFY_API_BASE}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uris: [song.spotifyUri]
      })
    });

  let response = await sendPlayRequest();

  // Falls das Browser-Gerät noch nicht als aktives Gerät bekannt ist, einmalig übertragen & erneut starten
  if (response.status === 404) {
    await transferPlayback(token);
    response = await sendPlayRequest();
  }

  if (response.status === 401) {
    handleSessionExpired();
    throw new Error("Sitzung abgelaufen. Bitte erneut bei Spotify anmelden.");
  }

  if (response.status === 403) {
    throw new Error("Wiedergabe nicht erlaubt. Bitte prüfe, ob dein Account über Spotify Premium verfügt.");
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Lied konnte nicht abgespielt werden: ${msg}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Spielaktionen & Event-Listener                                             */
/* -------------------------------------------------------------------------- */

async function startNextRound() {
  if (isBusy) return;
  isBusy = true;
  showError("");
  renderGameState();

  try {
    const nextSong = drawNextSong();
    await playSongOnSpotify(nextSong);
    currentSong = nextSong;
    gameState = "playing";
    isPaused = false;
  } catch (err) {
    showError(err.message || "Unbekannter Fehler beim Starten des Liedes.");
  } finally {
    isBusy = false;
    renderGameState();
  }
}

function revealCurrentSong() {
  if (isBusy || !currentSong) return;
  // Musik läuft weiter, bis auf "Nächstes Lied" geklickt wird
  gameState = "revealed";
  renderGameState();
}

async function togglePause() {
  if (isBusy || !spotifyPlayer || !deviceId || gameState === "idle") return;
  isBusy = true;
  showError("");
  renderGameState();

  try {
    if (isPaused) {
      await spotifyPlayer.resume();
      isPaused = false;
    } else {
      await spotifyPlayer.pause();
      isPaused = true;
    }
  } catch (err) {
    showError(err?.message || "Wiedergabe konnte nicht pausiert oder fortgesetzt werden.");
  } finally {
    isBusy = false;
    renderGameState();
  }
}

els.actionBtn.addEventListener("click", () => {
  if (gameState === "idle" || gameState === "revealed") {
    startNextRound();
  } else if (gameState === "playing") {
    revealCurrentSong();
  }
});

els.pauseBtn.addEventListener("click", togglePause);

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  try {
    const inputId = CONFIG.CLIENT_ID || els.clientIdInput.value;
    await startLogin(inputId);
  } catch (err) {
    showError(err.message);
  }
});

els.logoutBtn.addEventListener("click", async () => {
  if (spotifyPlayer) {
    try {
      await spotifyPlayer.pause();
    } catch {
      // Ignorieren, falls nichts abgespielt wird
    }
    spotifyPlayer.disconnect();
    spotifyPlayer = null;
  }
  deviceId = null;
  clearTokens();
  gameState = "idle";
  currentSong = null;
  isPaused = false;
  showError("");
  showAuthView();
});

/* -------------------------------------------------------------------------- */
/* App-Start                                                                  */
/* -------------------------------------------------------------------------- */

async function init() {
  try {
    await handleAuthCallback();
  } catch (err) {
    showError(err.message);
  }

  const loggedIn = await isAuthenticated();
  if (!loggedIn) {
    showAuthView();
    return;
  }

  showGameView();

  try {
    await loadSongs();
    await initSpotifyPlayer();
  } catch (err) {
    showError(err.message);
    setStatus("Fehler");
    renderGameState();
  }
}

init();
