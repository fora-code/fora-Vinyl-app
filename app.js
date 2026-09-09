/* ==================================================================
   Fora Vinyl — a virtual turntable for Spotify now-playing
   Plain JS, no build step. Sections:
     1. storage + config        5. palette extraction
     2. PKCE auth               6. vinyl renderer (5 presets)
     3. Web API + Playback SDK  7. background + tonearm + spin loop
     4. player state            8. UI wiring
================================================================== */

(() => {
  "use strict";

  /* ---------------- 1. storage + config ---------------- */
  const LS = {
    clientId: "fv.clientId",
    tokens: "fv.tokens",
    verifier: "fv.pkce.verifier",
    state: "fv.pkce.state",
    preset: "fv.presetIndex",
    lastTrack: "fv.lastTrackId",
  };
  const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
  ].join(" ");
  const PRESETS = ["solid", "black", "speckled", "translucent", "wavy"];
  const PRESET_LABELS = { solid: "Solid", black: "Classic black", speckled: "Speckled", translucent: "Translucent", wavy: "Wavy" };
  const DEVICE_NAME = "Fora Vinyl";
  const RPM_DEG_PER_S = 200; // 33 1/3 rpm

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  function redirectUri() {
    let path = location.pathname.replace(/index\.html$/, "");
    if (!path.endsWith("/")) path += "/";
    return location.origin + path;
  }

  /* ---------------- 2. PKCE auth ---------------- */
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomString = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join(""); };
  const sha256 = (s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

  async function beginLogin() {
    const clientId = store.get(LS.clientId);
    const verifier = randomString(96);
    const state = randomString(16);
    store.set(LS.verifier, verifier);
    store.set(LS.state, state);
    const challenge = b64url(await sha256(verifier));
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
    });
    location.assign("https://accounts.spotify.com/authorize?" + p.toString());
  }

  async function finishLogin(code, state) {
    const expected = store.get(LS.state);
    const verifier = store.get(LS.verifier);
    store.del(LS.state); store.del(LS.verifier);
    if (!verifier || state !== expected) throw new Error("Login state mismatch. Please try again.");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: store.get(LS.clientId),
      code_verifier: verifier,
    });
    const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!r.ok) throw new Error("Spotify rejected the login (" + r.status + "). Check that the redirect URI in your Spotify app matches exactly.");
    saveTokens(await r.json());
  }

  function saveTokens(t) {
    const prev = store.get(LS.tokens) || {};
    store.set(LS.tokens, {
      access_token: t.access_token,
      refresh_token: t.refresh_token || prev.refresh_token,
      expires_at: Date.now() + (t.expires_in || 3600) * 1000 - 30000,
    });
  }

  let refreshing = null;
  async function getToken() {
    const t = store.get(LS.tokens);
    if (!t) return null;
    if (Date.now() < t.expires_at) return t.access_token;
    if (!t.refresh_token) return null;
    if (!refreshing) {
      refreshing = (async () => {
        const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: store.get(LS.clientId) });
        const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        if (!r.ok) { store.del(LS.tokens); throw new Error("Session expired. Please sign in again."); }
        saveTokens(await r.json());
        return store.get(LS.tokens).access_token;
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function logout() {
    store.del(LS.tokens);
    if (sdkPlayer) { try { sdkPlayer.disconnect(); } catch {} sdkPlayer = null; }
    route();
  }

  /* ---------------- 3. Web API + Playback SDK ---------------- */
  async function api(path, opts = {}) {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    const r = await fetch("https://api.spotify.com/v1" + path, {
      ...opts,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 204) return null;
    if (r.status === 401) { store.del(LS.tokens); route(); throw new Error("Session expired. Please sign in again."); }
    if (r.status === 429) { const wait = +(r.headers.get("Retry-After") || 2); await new Promise((res) => setTimeout(res, wait * 1000)); return api(path, opts); }
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("Spotify error " + r.status);
      const err = new Error(msg); err.status = r.status; err.reason = data && data.error && data.error.reason; throw err;
    }
    return data;
  }

  let sdkPlayer = null;
  let sdkDeviceId = null;
  let sdkReadyPromise = null;

  function initSdk() {
    if (sdkReadyPromise) return sdkReadyPromise;
    sdkReadyPromise = new Promise((resolve) => {
      const start = () => {
        if (!window.Spotify) return resolve(null);
        const player = new Spotify.Player({
          name: DEVICE_NAME,
          getOAuthToken: async (cb) => { try { cb(await getToken()); } catch { cb(""); } },
          volume: 0.8,
        });
        player.addListener("ready", ({ device_id }) => { sdkDeviceId = device_id; resolve(player); });
        player.addListener("not_ready", () => { sdkDeviceId = null; });
        player.addListener("initialization_error", ({ message }) => { console.warn("SDK init:", message); resolve(null); });
        player.addListener("authentication_error", ({ message }) => { console.warn("SDK auth:", message); resolve(null); });
        player.addListener("account_error", () => { toast("Spotify Premium is required for the browser to play audio. You can still control other devices from here."); resolve(null); });
        player.addListener("player_state_changed", onSdkState);
        player.connect().then((ok) => { if (!ok) resolve(null); });
        sdkPlayer = player;
        setTimeout(() => resolve(sdkPlayer), 8000); // don't hang forever if "ready" never fires
      };
      if (window.Spotify) start();
      else window.onSpotifyWebPlaybackSDKReady = start;
    });
    return sdkReadyPromise;
  }

  /* ---------------- 4. player state ---------------- */
  const state = {
    trackId: null,
    title: "", artist: "", album: "", artUrl: "",
    durationMs: 0,
    positionMs: 0,       // position at lastTick
    lastTick: 0,         // performance.now() when positionMs was sampled
    playing: false,
    deviceName: "",
    deviceIsLocal: false,
    hasDevice: false,
    presetIndex: store.get(LS.preset, 0) || 0,
  };
  let lastTrackId = store.get(LS.lastTrack, null);

  function applyTrack(t) {
    if (!t) return;
    const id = t.id || t.uri;
    const changed = id !== state.trackId;
    state.trackId = id;
    state.title = t.name || "";
    state.artist = (t.artists || []).map((a) => a.name).join(", ");
    state.album = (t.album && t.album.name) || "";
    const imgs = (t.album && t.album.images) || [];
    state.artUrl = (imgs[0] && imgs[0].url) || "";
    state.durationMs = t.duration_ms || 0;
    if (changed) onTrackChanged(id);
  }

  function setPosition(ms, playing) {
    state.positionMs = ms || 0;
    state.lastTick = performance.now();
    state.playing = !!playing;
  }

  function currentPosition() {
    if (!state.playing) return state.positionMs;
    return Math.min(state.durationMs || Infinity, state.positionMs + (performance.now() - state.lastTick));
  }

  function onSdkState(s) {
    if (!s) return;
    const t = s.track_window && s.track_window.current_track;
    if (t) applyTrack({ id: t.id, uri: t.uri, name: t.name, artists: t.artists, album: t.album, duration_ms: s.duration });
    setPosition(s.position, !s.paused);
    state.deviceIsLocal = true; state.hasDevice = true; state.deviceName = DEVICE_NAME;
    renderMeta();
  }

  let pollTimer = null;
  async function poll() {
    clearTimeout(pollTimer);
    try {
      const p = await api("/me/player");
      if (p && p.item) {
        applyTrack(p.item);
        // If the SDK is reporting for this device, trust its position (it is more precise)
        const local = !!(p.device && sdkDeviceId && p.device.id === sdkDeviceId);
        if (!local) setPosition(p.progress_ms, p.is_playing);
        state.deviceIsLocal = local;
        state.hasDevice = true;
        state.deviceName = (p.device && p.device.name) || "";
      } else if (p && p.device) {
        state.hasDevice = true; state.deviceName = p.device.name; setPosition(0, false);
      } else {
        state.hasDevice = false; state.deviceName = ""; setPosition(currentPosition(), false);
      }
    } catch (e) {
      if (!/Not signed in|expired/.test(e.message)) console.warn("poll:", e.message);
    }
    renderMeta();
    pollTimer = setTimeout(poll, state.deviceIsLocal ? 5000 : 2500);
  }

  /* ---------------- controls ---------------- */
  async function ensureDevice() {
    if (state.hasDevice) return true;
    await initSdk();
    if (!sdkDeviceId) return false;
    await api("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [sdkDeviceId], play: false }) });
    state.hasDevice = true; state.deviceIsLocal = true; state.deviceName = DEVICE_NAME;
    return true;
  }

  async function control(action) {
    try {
      if (action === "toggle") {
        if (state.playing) {
          await api("/me/player/pause", { method: "PUT" });
          setPosition(currentPosition(), false);
        } else {
          if (!(await ensureDevice())) return toast("No Spotify device is active. Open Spotify on any device, or allow this tab to become one (Premium).");
          if (state.deviceIsLocal && sdkPlayer && state.trackId) await sdkPlayer.resume();
          else await api("/me/player/play", { method: "PUT" });
          setPosition(currentPosition(), true);
        }
      } else if (action === "next") {
        await api("/me/player/next", { method: "POST" });
      } else if (action === "prev") {
        await api("/me/player/previous", { method: "POST" });
      }
      renderMeta();
      setTimeout(poll, 350);
    } catch (e) {
      if (e.reason === "NO_ACTIVE_DEVICE") toast("Nothing is playing yet. Start a song in Spotify, or press play to play here.");
      else if (e.reason === "PREMIUM_REQUIRED" || e.status === 403) toast("Spotify only allows playback control with Premium.");
      else toast(e.message);
    }
  }

  async function seekTo(fraction) {
    if (!state.durationMs) return;
    const ms = Math.round(fraction * state.durationMs);
    setPosition(ms, state.playing);
    renderMeta();
    try { await api("/me/player/seek?position_ms=" + ms, { method: "PUT" }); } catch (e) { toast(e.message); }
  }

  /* ---------------- 5. palette extraction ---------------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    h = ((h % 1) + 1) % 1; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return "#" + to(f(0)) + to(f(8)) + to(f(4));
  }
  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /** Returns { c1, c2, c3 } as HSL triples, from an already-loaded <img>. */
  function extractPalette(img) {
    const N = 72;
    const c = document.createElement("canvas"); c.width = N; c.height = N;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    let data;
    try { ctx.drawImage(img, 0, 0, N, N); data = ctx.getImageData(0, 0, N, N).data; }
    catch { return null; } // tainted canvas: no CORS
    const buckets = new Map(); // hue bucket -> {w, h, s, l, n}
    let grayW = 0, grayL = 0, grayN = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (l < 0.06 || l > 0.96) continue;
      if (s < 0.12) { grayW += 1; grayL += l; grayN++; continue; }
      const key = Math.floor(h * 18);
      const w = s * (1 - Math.abs(l - 0.5) * 1.2) + 0.05;
      const b = buckets.get(key) || { w: 0, h: 0, s: 0, l: 0, n: 0 };
      b.w += w; b.h += h * w; b.s += s * w; b.l += l * w; b.n++;
      buckets.set(key, b);
    }
    const ranked = [...buckets.values()].filter((b) => b.n > 6).sort((a, b) => b.w - a.w).map((b) => [b.h / b.w, b.s / b.w, b.l / b.w]);
    if (ranked.length === 0) {
      // monochrome art: warm neutral accent so the record still looks intentional
      const l = grayN ? grayL / grayN : 0.5;
      return { c1: [0.09, 0.35, clamp(l, 0.45, 0.7)], c2: [0.08, 0.15, 0.3], c3: [0.65, 0.1, 0.2], mono: true };
    }
    // pick colors with distinct hues
    const picked = [ranked[0]];
    for (const col of ranked.slice(1)) {
      if (picked.length >= 3) break;
      const dh = Math.min(...picked.map((p) => { const d = Math.abs(p[0] - col[0]); return Math.min(d, 1 - d); }));
      if (dh > 0.08) picked.push(col);
    }
    while (picked.length < 3) { const base = picked[picked.length - 1]; picked.push([base[0] + 0.5 / 3, base[1] * 0.8, clamp(base[2] * 0.8, 0.2, 0.6)]); }
    return { c1: picked[0], c2: picked[1], c3: picked[2], mono: false };
  }

  const defaultPalette = { c1: [0.1, 0.62, 0.56], c2: [0.06, 0.5, 0.32], c3: [0.7, 0.16, 0.2], mono: false };
  let palette = defaultPalette;

  function applyPaletteToCss(p) {
    const root = document.documentElement.style;
    const accent = [p.c1[0], clamp(p.c1[1], 0.35, 0.85), clamp(p.c1[2], 0.45, 0.68)];
    root.setProperty("--c1", hslToHex(...accent));
    root.setProperty("--c2", hslToHex(p.c2[0], clamp(p.c2[1], 0.25, 0.8), clamp(p.c2[2], 0.3, 0.6)));
    root.setProperty("--c3", hslToHex(p.c3[0], clamp(p.c3[1], 0.2, 0.7), clamp(p.c3[2], 0.25, 0.55)));
    // Background: same hues, much quieter. Sits far behind the objects.
    root.setProperty("--bg-a", hslToHex(p.c1[0], clamp(p.c1[1] * 0.55, 0.12, 0.45), 0.26));
    root.setProperty("--bg-b", hslToHex(p.c2[0], clamp(p.c2[1] * 0.5, 0.1, 0.4), 0.2));
    root.setProperty("--bg-c", hslToHex(p.c3[0], clamp(p.c3[1] * 0.45, 0.08, 0.35), 0.17));
    root.setProperty("--ink", accent[2] > 0.58 ? "#111" : "#fff");
    const base = hslToHex(p.c1[0], 0.18, 0.09);
    document.querySelector(".bg-base").style.background = `radial-gradient(120% 90% at 50% 40%, ${base} 0%, #0b0b0e 100%)`;
  }

  /* ---------------- 6. vinyl renderer ---------------- */
  const vinyl = $("vinyl");
  const vctx = vinyl.getContext("2d");
  const SIZE = 1024, R = SIZE / 2, LABEL_R = 197, GROOVE_IN = 212, GROOVE_OUT = 500;
  let coverImg = null; // loaded HTMLImageElement for the label

  // deterministic PRNG so a track always renders the same speckles / waves
  function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  function renderVinyl(preset, pal, seedStr) {
    const ctx = vctx;
    const rnd = mulberry32(hashStr(seedStr || "seed"));
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();

    const hex = (hsl, s, l) => hslToHex(hsl[0], s ?? hsl[1], l ?? hsl[2]);
    const c1 = pal.c1, c2 = pal.c2, c3 = pal.c3;
    const isTranslucent = preset === "translucent";

    // ---- body ----
    if (preset === "solid") {
      const g = ctx.createRadialGradient(R, R, LABEL_R, R, R, R);
      g.addColorStop(0, hex(c1, clamp(c1[1], 0.4, 0.85), clamp(c1[2], 0.34, 0.52)));
      g.addColorStop(1, hex(c1, clamp(c1[1], 0.4, 0.85), clamp(c1[2] - 0.12, 0.22, 0.42)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    } else if (preset === "black") {
      const g = ctx.createRadialGradient(R, R, LABEL_R, R, R, R);
      g.addColorStop(0, "#1a1a1d"); g.addColorStop(1, "#0d0d0f");
      ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    } else if (preset === "speckled") {
      // dark tinted base with flecks of the palette
      ctx.fillStyle = hex(c2, clamp(c2[1] * 0.6, 0.1, 0.5), 0.13); ctx.fillRect(0, 0, SIZE, SIZE);
      const flecks = [
        [hex(c1, clamp(c1[1], 0.5, 0.9), clamp(c1[2], 0.45, 0.65)), 900, 1.2, 4.5],
        [hex(c3, clamp(c3[1], 0.3, 0.8), clamp(c3[2], 0.4, 0.6)), 500, 1, 3.5],
        ["#f2ede4", 380, 0.8, 2.6],
        [hex(c2, clamp(c2[1], 0.3, 0.8), clamp(c2[2] + 0.2, 0.5, 0.7)), 400, 1, 3],
      ];
      for (const [color, count, minR, maxR] of flecks) {
        ctx.fillStyle = color;
        for (let i = 0; i < count; i++) {
          const a = rnd() * Math.PI * 2, r = LABEL_R + 6 + Math.sqrt(rnd()) * (R - LABEL_R - 10);
          const x = R + Math.cos(a) * r, y = R + Math.sin(a) * r;
          const s = minR + rnd() * (maxR - minR);
          ctx.globalAlpha = 0.55 + rnd() * 0.45;
          ctx.beginPath(); ctx.ellipse(x, y, s * (0.8 + rnd() * 0.8), s, a, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    } else if (preset === "translucent") {
      const g = ctx.createRadialGradient(R, R, LABEL_R, R, R, R);
      const col = [c1[0], clamp(c1[1], 0.5, 0.95), clamp(c1[2], 0.45, 0.6)];
      const [r1, g1, b1] = hexToRgb(hex(col));
      g.addColorStop(0, `rgba(${r1},${g1},${b1},0.40)`);
      g.addColorStop(0.85, `rgba(${r1},${g1},${b1},0.50)`);
      g.addColorStop(1, `rgba(${r1},${g1},${b1},0.68)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    } else if (preset === "wavy") {
      // marbled swirl of the three palette colors, computed per pixel
      const img = ctx.createImageData(SIZE, SIZE);
      const d = img.data;
      const A = hexToRgb(hex(c1, clamp(c1[1], 0.5, 0.9), clamp(c1[2], 0.45, 0.6)));
      const B = hexToRgb(hex(c2, clamp(c2[1], 0.4, 0.9), clamp(c2[2], 0.28, 0.5)));
      const C = hexToRgb(hex(c3, clamp(c3[1], 0.3, 0.85), clamp(c3[2], 0.2, 0.45)));
      const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, lobes = 2 + Math.floor(rnd() * 3);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const dx = x - R, dy = y - R, r = Math.hypot(dx, dy);
          const i = (y * SIZE + x) * 4;
          if (r > R) { d[i + 3] = 0; continue; }
          const th = Math.atan2(dy, dx);
          const w = 0.5 + 0.5 * Math.sin(th * lobes + r * 0.028 + ph1 + 1.6 * Math.sin(th * (lobes + 1) - r * 0.012 + ph2));
          const v = 0.5 + 0.5 * Math.sin(r * 0.05 - th * 2 + ph2 * 0.7 + 1.2 * w);
          // three-way blend: w picks between A and B, v folds in C
          let cr = A[0] + (B[0] - A[0]) * w, cg = A[1] + (B[1] - A[1]) * w, cb = A[2] + (B[2] - A[2]) * w;
          const k = v * 0.45;
          cr += (C[0] - cr) * k; cg += (C[1] - cg) * k; cb += (C[2] - cb) * k;
          d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      // re-establish clip after putImageData (it ignores clipping)
      ctx.restore(); ctx.save(); ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
    }

    // ---- grooves ----
    const dark = preset === "black" ? 0.0 : 0.22;
    const light = preset === "black" ? 0.06 : 0.05;
    ctx.lineWidth = 1;
    for (let r = GROOVE_IN; r < GROOVE_OUT; r += 2.2) {
      const isLight = ((r - GROOVE_IN) / 2.2) % 2 < 1;
      ctx.strokeStyle = isLight ? `rgba(255,255,255,${light})` : `rgba(0,0,0,${isTranslucent ? 0.16 : dark || 0.35})`;
      ctx.beginPath(); ctx.arc(R, R, r, 0, Math.PI * 2); ctx.stroke();
    }
    // track breaks: a few slightly glossier bands
    const breaks = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < breaks; i++) {
      const r = GROOVE_IN + 20 + rnd() * (GROOVE_OUT - GROOVE_IN - 40);
      ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(R, R, r, 0, Math.PI * 2); ctx.stroke();
    }
    // lead-in and lead-out flats
    ctx.lineWidth = 1;
    const flat = (r0, r1) => { const g = ctx.createRadialGradient(R, R, r0, R, R, r1); g.addColorStop(0, "rgba(255,255,255,0.05)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(R, R, r1, 0, Math.PI * 2); ctx.arc(R, R, r0, 0, Math.PI * 2, true); ctx.fill(); };
    flat(GROOVE_OUT, R - 4); flat(LABEL_R + 2, GROOVE_IN);

    // radial sheen (subtle, the CSS gloss adds the moving highlight)
    const sheen = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    sheen.addColorStop(0, "rgba(255,255,255,0.10)"); sheen.addColorStop(0.5, "rgba(255,255,255,0)"); sheen.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, SIZE, SIZE);

    // outer rim
    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(R, R, R - 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(R, R, R - 6, 0, Math.PI * 2); ctx.stroke();

    // ---- label ----
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, LABEL_R, 0, Math.PI * 2); ctx.clip();
    if (coverImg && coverImg.complete && coverImg.naturalWidth) {
      try { ctx.drawImage(coverImg, R - LABEL_R, R - LABEL_R, LABEL_R * 2, LABEL_R * 2); }
      catch { ctx.fillStyle = hex(c1); ctx.fillRect(0, 0, SIZE, SIZE); }
    } else {
      const g = ctx.createRadialGradient(R, R, 10, R, R, LABEL_R);
      g.addColorStop(0, hex(c1, clamp(c1[1], 0.4, 0.9), 0.62)); g.addColorStop(1, hex(c1, clamp(c1[1], 0.4, 0.9), 0.42));
      ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    }
    // paper texture + inner ring on the label
    const lab = ctx.createRadialGradient(R, R, LABEL_R * 0.6, R, R, LABEL_R);
    lab.addColorStop(0, "rgba(0,0,0,0)"); lab.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = lab; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(R, R, LABEL_R + 1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(R, R, LABEL_R + 4, 0, Math.PI * 2); ctx.stroke();
    // spindle hole
    ctx.fillStyle = "#0a0a0c"; ctx.beginPath(); ctx.arc(R, R, 13, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  /* ---------------- 7. background, tonearm, spin loop ---------------- */
  // Tonearm geometry in turntable units (must match styles.css .platter / .tonearm / .arm)
  const GEO = { pivot: [0.88, 0.14], center: [0.42, 0.46], L: 0.60, rOut: 0.39 * (GROOVE_OUT / R), rIn: 0.39 * (GROOVE_IN / R), restDeg: -8 };
  function armAngleFor(progress) {
    const [px, py] = GEO.pivot, [cx, cy] = GEO.center;
    const dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy);
    const r = GEO.rOut - (GEO.rOut - GEO.rIn) * clamp(progress, 0, 1);
    const cosT = clamp((d * d + GEO.L * GEO.L - r * r) / (2 * d * GEO.L), -1, 1);
    const theta = Math.acos(cosT);
    const base = Math.atan2(dy, dx);
    return ((base - theta) * 180) / Math.PI - 90;
  }

  const recordEl = $("record");
  const armEl = document.querySelector(".arm");
  let spinAngle = 0, spinSpeed = 0, lastFrame = performance.now();
  let lastArmDeg = null;

  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    const target = state.playing ? RPM_DEG_PER_S : 0;
    const k = state.playing ? 2.2 : 1.4; // spin-up quicker than coast-down
    spinSpeed += (target - spinSpeed) * Math.min(1, dt * k);
    if (!state.playing && spinSpeed < 0.5) spinSpeed = 0;
    spinAngle = (spinAngle + spinSpeed * dt) % 360;
    recordEl.style.transform = `rotate(${spinAngle}deg)`;

    // tonearm
    const progress = state.durationMs ? currentPosition() / state.durationMs : 0;
    const deg = state.playing ? armAngleFor(progress) : GEO.restDeg;
    if (lastArmDeg === null || Math.abs(deg - lastArmDeg) > 0.02) { armEl.style.transform = `rotate(${deg}deg)`; lastArmDeg = deg; }

    // progress bar (only while playing; renderMeta handles the rest)
    if (state.playing && state.durationMs) updateProgressUi();
    requestAnimationFrame(frame);
  }

  /* ---------------- 8. UI ---------------- */
  const fmt = (ms) => { ms = Math.max(0, ms | 0); const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  function updateProgressUi() {
    const pos = currentPosition();
    const pct = state.durationMs ? (pos / state.durationMs) * 100 : 0;
    $("bar-fill").style.width = pct + "%";
    $("bar-knob").style.left = pct + "%";
    $("t-cur").textContent = fmt(pos);
    $("t-dur").textContent = fmt(state.durationMs);
    $("bar").setAttribute("aria-valuenow", Math.round(pct));
  }

  function renderMeta() {
    $("title").textContent = state.title || (state.hasDevice ? "Nothing playing" : "Nothing playing");
    $("artist").textContent = state.artist || (state.hasDevice ? "Pick a song on Spotify, or press play." : "Press play to play here, or start Spotify on any device.");
    $("album").textContent = state.album || "";
    $("icon-play").classList.toggle("hidden", state.playing);
    $("icon-pause").classList.toggle("hidden", !state.playing);
    $("playpause").setAttribute("aria-label", state.playing ? "Pause" : "Play");
    const pill = $("device-pill");
    pill.textContent = !state.hasDevice ? "No active device" : state.deviceIsLocal ? "Playing in this tab" : "Playing on " + state.deviceName;
    $("preset-btn").textContent = PRESET_LABELS[PRESETS[state.presetIndex % PRESETS.length]];
    document.title = state.title ? `${state.title} · ${state.artist} — Fora Vinyl` : "Fora Vinyl";
    updateProgressUi();
  }

  function onTrackChanged(id) {
    // Advance the preset once per new track (not on page refresh of the same track)
    if (lastTrackId && lastTrackId !== id) state.presetIndex = (state.presetIndex + 1) % PRESETS.length;
    lastTrackId = id; store.set(LS.lastTrack, id); store.set(LS.preset, state.presetIndex);
    loadArtAndRender();
  }

  let artLoadSeq = 0;
  function loadArtAndRender() {
    const seq = ++artLoadSeq;
    const cover = $("cover");
    const url = state.artUrl;
    if (!url) {
      coverImg = null; cover.removeAttribute("src"); cover.alt = "";
      palette = defaultPalette; applyPaletteToCss(palette);
      renderVinyl(PRESETS[state.presetIndex], palette, "none"); return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (seq !== artLoadSeq) return;
      coverImg = img;
      cover.src = url; cover.alt = state.album ? `Album art for ${state.album}` : "Album art";
      palette = extractPalette(img) || defaultPalette;
      applyPaletteToCss(palette);
      renderVinyl(PRESETS[state.presetIndex], palette, state.trackId || url);
    };
    img.onerror = () => {
      if (seq !== artLoadSeq) return;
      coverImg = null; cover.src = url;
      palette = defaultPalette; applyPaletteToCss(palette);
      renderVinyl(PRESETS[state.presetIndex], palette, state.trackId || url);
    };
    img.src = url;
  }

  let toastTimer = null;
  function toast(msg, ms = 4200) {
    const el = $("toast");
    el.textContent = msg; el.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
  }

  function show(id) { for (const s of ["setup", "login", "player"]) $(s).classList.toggle("hidden", s !== id); }

  function wireUi() {
    $("redirect-uri").textContent = redirectUri();
    $("redirect-uri").addEventListener("click", () => { navigator.clipboard && navigator.clipboard.writeText(redirectUri()).then(() => toast("Redirect URI copied")); });
    $("setup-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("client-id").value.trim();
      if (!/^[a-fA-F0-9]{32}$/.test(id)) return toast("That doesn't look like a Spotify Client ID (32 hex characters).");
      store.set(LS.clientId, id);
      beginLogin();
    });
    $("login-btn").addEventListener("click", beginLogin);
    $("change-client").addEventListener("click", () => { store.del(LS.clientId); store.del(LS.tokens); route(); });
    $("logout").addEventListener("click", logout);
    $("playpause").addEventListener("click", () => control("toggle"));
    $("next").addEventListener("click", () => control("next"));
    $("prev").addEventListener("click", () => control("prev"));
    $("preset-btn").addEventListener("click", () => {
      state.presetIndex = (state.presetIndex + 1) % PRESETS.length; store.set(LS.preset, state.presetIndex);
      renderVinyl(PRESETS[state.presetIndex], palette, state.trackId || "none"); renderMeta();
    });
    // Full screen: button, F key, and an idle timer that hides the chrome
    const playerEl = $("player");
    const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    if (!fsSupported) $("fullscreen").classList.add("hidden");
    const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const toggleFullscreen = async () => {
      try {
        if (isFs()) await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
        else { const el = document.documentElement; await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen()); }
      } catch (e) { toast("Full screen isn't available here: " + e.message); }
    };
    let idleTimer = null;
    const wake = () => {
      playerEl.classList.remove("idle");
      clearTimeout(idleTimer);
      if (isFs()) idleTimer = setTimeout(() => playerEl.classList.add("idle"), 3200);
    };
    const onFsChange = () => {
      const on = isFs();
      playerEl.classList.toggle("is-fullscreen", on);
      $("icon-expand").classList.toggle("hidden", on);
      $("icon-compress").classList.toggle("hidden", !on);
      $("fullscreen").setAttribute("title", on ? "Exit full screen (F)" : "Full screen (F)");
      wake();
    };
    $("fullscreen").addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    for (const ev of ["mousemove", "mousedown", "touchstart", "keydown"]) document.addEventListener(ev, wake, { passive: true });
    window.__toggleFullscreen = toggleFullscreen;

    $("bar").addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); });
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); control("toggle"); }
      else if (e.code === "ArrowRight" && e.shiftKey) control("next");
      else if (e.code === "ArrowLeft" && e.shiftKey) control("prev");
      else if (e.key.toLowerCase() === "v") $("preset-btn").click();
      else if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) window.__toggleFullscreen();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }

  async function route() {
    const clientId = store.get(LS.clientId);
    if (!clientId) return show("setup");
    if (!store.get(LS.tokens)) return show("login");
    show("player");
    renderVinyl(PRESETS[state.presetIndex], palette, "boot");
    renderMeta();
    poll();
    initSdk();
  }

  async function boot() {
    wireUi();
    requestAnimationFrame(frame);
    const q = new URLSearchParams(location.search);
    if (q.get("error")) { toast("Spotify login was cancelled: " + q.get("error")); history.replaceState({}, "", redirectUri()); }
    if (q.get("code")) {
      try { await finishLogin(q.get("code"), q.get("state")); }
      catch (e) { toast(e.message, 8000); }
      history.replaceState({}, "", redirectUri());
    }
    route();
  }

  // Expose a tiny hook for local previews / screenshots (no Spotify needed)
  window.__foraVinylPreview = (track, opts = {}) => {
    show("player");
    if (opts.preset != null) state.presetIndex = Math.max(0, PRESETS.indexOf(opts.preset));
    state.hasDevice = true; state.deviceName = opts.deviceName || "Preview"; state.deviceIsLocal = true;
    state.trackId = null; lastTrackId = track.id; // keep the forced preset
    applyTrack(track); // triggers onTrackChanged -> art + vinyl render
    setPosition(opts.positionMs || 0, !!opts.playing);
    renderMeta();
  };

  boot();
})();
