import { CONFIG } from "./config.js";

const STORAGE_KEYS = {
  CLIENT_ID: "ratespiel_spotify_client_id",
  ACCESS_TOKEN: "ratespiel_spotify_access_token",
  REFRESH_TOKEN: "ratespiel_spotify_refresh_token",
  EXPIRES_AT: "ratespiel_spotify_expires_at",
  CODE_VERIFIER: "ratespiel_spotify_code_verifier",
  AUTH_STATE: "ratespiel_spotify_auth_state"
};

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

let activeRefreshPromise = null;

/**
 * Liefert die aktive Spotify Client ID (entweder aus config.js oder aus localStorage).
 */
export function getClientId() {
  return (CONFIG.CLIENT_ID || localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || "").trim();
}

/**
 * Speichert eine Client ID lokal im Browser.
 */
export function saveClientId(clientId) {
  const cleaned = clientId.trim();
  if (cleaned) {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, cleaned);
  }
}

/**
 * Erzeugt eine kryptografisch sichere Zufallszeichenkette für PKCE / State.
 */
function generateRandomString(length) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (value) => charset[value % charset.length]).join("");
}

/**
 * Erzeugt eine Base64-URL-codierte SHA-256 Code Challenge für OAuth 2.0 PKCE.
 */
async function generateCodeChallenge(codeVerifier) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error(
      "Web Crypto API nicht verfügbar. Bitte öffne die App über http://127.0.0.1:<Port>/ oder HTTPS."
    );
  }
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Startet die Weiterleitung zur einmaligen Spotify-Anmeldung (OAuth 2.0 PKCE).
 */
export async function startLogin(clientIdInput) {
  const clientId = (clientIdInput || getClientId()).trim();
  if (!clientId) {
    throw new Error("Bitte gib zuerst deine Spotify Client ID ein.");
  }

  saveClientId(clientId);

  const codeVerifier = generateRandomString(64);
  const state = generateRandomString(16);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  localStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, codeVerifier);
  localStorage.setItem(STORAGE_KEYS.AUTH_STATE, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: CONFIG.REDIRECT_URI,
    scope: CONFIG.SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state
  });

  window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/**
 * Verarbeitet den Rücksprung von Spotify (?code=... oder ?error=...).
 * Gibt true zurück, wenn ein Callback verarbeitet wurde.
 */
export async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");

  if (!error && !code) {
    return false;
  }

  // URL sofort bereinigen, damit ein Neuladen den Code nicht erneut verwendet
  window.history.replaceState({}, document.title, CONFIG.REDIRECT_URI);

  if (error) {
    throw new Error(`Spotify-Anmeldung abgebrochen oder fehlgeschlagen (${error}).`);
  }

  const expectedState = localStorage.getItem(STORAGE_KEYS.AUTH_STATE);
  const codeVerifier = localStorage.getItem(STORAGE_KEYS.CODE_VERIFIER);
  localStorage.removeItem(STORAGE_KEYS.AUTH_STATE);
  localStorage.removeItem(STORAGE_KEYS.CODE_VERIFIER);

  if (!expectedState || returnedState !== expectedState) {
    throw new Error("Ungültiger OAuth-State. Bitte melde dich erneut an.");
  }

  if (!codeVerifier) {
    throw new Error("PKCE Code Verifier fehlt. Bitte melde dich erneut an.");
  }

  const clientId = getClientId();
  if (!clientId) {
    throw new Error("Spotify Client ID fehlt. Bitte erneut eingeben.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: CONFIG.REDIRECT_URI,
    code_verifier: codeVerifier
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(
      `Token-Austausch fehlgeschlagen: ${details.error_description || details.error || response.status}`
    );
  }

  const tokenData = await response.json();
  storeTokens(tokenData);
  return true;
}

/**
 * Speichert Access Token, Refresh Token und Ablaufzeitpunkt im localStorage.
 */
function storeTokens(tokenData) {
  if (tokenData.access_token) {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokenData.access_token);
  }
  if (tokenData.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokenData.refresh_token);
  }
  if (tokenData.expires_in) {
    // 60 Sekunden Puffer vor dem tatsächlichen Ablauf
    const expiresAt = Date.now() + Math.max(0, tokenData.expires_in - 60) * 1000;
    localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(expiresAt));
  }
}

/**
 * Erneuert ein abgelaufenes Access Token mithilfe des Refresh Tokens.
 */
async function refreshAccessToken() {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    const clientId = getClientId();

    if (!refreshToken || !clientId) {
      clearTokens();
      return null;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId
    });

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const tokenData = await response.json();
    storeTokens(tokenData);
    return tokenData.access_token || null;
  })();

  try {
    return await activeRefreshPromise;
  } finally {
    activeRefreshPromise = null;
  }
}

/**
 * Gibt ein gültiges Access Token zurück (erneuert bei Bedarf automatisch) oder null.
 */
export async function getValidAccessToken() {
  const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || 0);

  if (accessToken && Date.now() < expiresAt) {
    return accessToken;
  }

  if (localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)) {
    return await refreshAccessToken();
  }

  return null;
}

/**
 * Prüft, ob eine Anmeldung vorhanden ist.
 */
export async function isAuthenticated() {
  const token = await getValidAccessToken();
  return Boolean(token);
}

/**
 * Löscht gespeicherte Tokens (Client ID bleibt für schnellen Re-Login erhalten).
 */
export function clearTokens() {
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  localStorage.removeItem(STORAGE_KEYS.CODE_VERIFIER);
  localStorage.removeItem(STORAGE_KEYS.AUTH_STATE);
}
