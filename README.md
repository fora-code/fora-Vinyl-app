# Fora Vinyl

A virtual record player for your Spotify now-playing, in the spirit of MD Vinyl. Open it in Chrome, connect Spotify, and the current track shows up as album art plus a record themed from the artwork's colors, spinning on a turntable with a tonearm that tracks the song's progress.

**Live:** https://fora-code.github.io/fora-vinyl-app/

## What it does

- Signs in to Spotify directly from the browser (PKCE, no server, nothing stored outside your browser).
- Turns the Chrome tab into a Spotify device (Web Playback SDK, Premium required) so pressing play works with nothing else open. If Spotify is already playing on your phone or desktop, it shows and controls that instead.
- Extracts a palette from the album art and renders the record on a canvas in one of five styles that cycle with each new song: solid color, classic black, speckled, translucent, wavy. Press `V` or click the style pill to cycle manually.
- Tonearm lifts to its rest when paused, lands on the outer groove on play, and sweeps inward as the track plays. The record spins up and coasts down.
- Background is a soft, blurred, desaturated wash from the same palette so it sits behind the objects instead of competing with them.
- Controls: previous, play/pause, next. Click the progress bar to seek. Space toggles play, Shift+Arrow skips.

## One-time setup (about two minutes)

The app needs a Spotify *Client ID*. Spotify gives every developer their own for free.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create app**.
2. Name it anything (for example `Fora Vinyl`).
3. Under **Redirect URIs**, add exactly: `https://fora-code.github.io/fora-vinyl-app/`
   (the app shows this URI on its setup screen with a click-to-copy, so you can grab it from there).
4. Under **APIs used**, tick **Web API** and **Web Playback SDK**. Save.
5. Open the app's settings page in the dashboard and copy the **Client ID**.
6. Open the live site, paste the Client ID, click **Connect Spotify**, and approve the permissions.

The Client ID is saved in your browser's local storage. Use **Use a different Client ID** on the sign-in screen to change it.

### Notes

- Spotify only allows playback control (play, pause, skip) and in-browser audio on **Premium** accounts. On Free the turntable still displays what's playing.
- New Spotify apps start in "development mode", which is fine for personal use. If you want other people to sign in, add their Spotify emails under **User Management** in the dashboard.
- Chrome may block audio until you've clicked something on the page; the first press of play handles that.

## Run locally

It's plain HTML/CSS/JS, no build step.

```sh
python3 -m http.server 8123
# open http://127.0.0.1:8123/
```

Add `http://127.0.0.1:8123/` as a second redirect URI in your Spotify app for local use (Spotify requires `127.0.0.1` rather than `localhost`).

## Project layout

```
index.html   markup for the setup, sign-in, and player screens
styles.css   layout, turntable, tonearm, background
app.js       auth, Spotify Web API + Playback SDK, palette extraction, vinyl renderer, animation
```

## Ideas for next steps

- Volume and shuffle controls
- More vinyl styles (split color, picture disc, glow-in-the-dark)
- Lyrics or queue panel
- A "sleeve" transition when the track changes
