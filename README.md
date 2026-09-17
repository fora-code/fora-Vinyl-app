# Fora Vinyl

A virtual record player for your Spotify now-playing, in the spirit of MD Vinyl. Open it in Chrome, connect Spotify, and the current track shows up as album art plus a record themed from the artwork's colors, spinning on a turntable with a tonearm that tracks the song's progress.

**Live:** https://fora-code.github.io/fora-Vinyl-app/

## What it does

- Signs in to Spotify directly from the browser (PKCE, no server, nothing stored outside your browser).
- Turns the Chrome tab into a Spotify device (Web Playback SDK, Premium required) so pressing play works with nothing else open. If Spotify is already playing on your phone or desktop, it shows and controls that instead.
- Extracts a palette from the album art and renders the record on a canvas in one of five styles that cycle with each new song: solid color, classic black, speckled, translucent, wavy. Press `V` or click the style pill to cycle manually.
- Tonearm lifts to its rest when paused, lands on the outer groove on play, and sweeps inward as the track plays. The record spins up and coasts down.
- Background is the album's own colours, lifted and kept saturated, so the whole room changes with every record; type flips dark automatically on very pale artwork.
- **Appearance**: Light or Dark in settings, or press `D`. Both build the room from the album's colours; Light lifts them, Dark sinks them.
- Controls: previous, play/pause, next. Click the progress bar to seek. Space toggles play, Shift+Arrow skips.
- **Tap the record** to play or pause, the way putting a hand on a real one stops it. **Drag the record** round to scrub: it follows your finger, the needle tracks with it, and it seeks when you let go. One full turn moves 15 seconds (`SECONDS_PER_TURN` in app.js if you want it finer or coarser). Works with mouse and touch.
- **Settings** live behind the gear, top right: playback device, vinyl style, full screen, clean view and sign out.
- **Clean view**: double-click the background and everything but the cover, record and needle fades away. Double-click again, or press Escape, to bring it back.
- Full screen from the settings panel or `F`. In full screen the remaining chrome fades out after a few seconds of stillness.
- **Library** (`L`, or the shelf icon top right): your saved albums and playlists as records on a shelf, spines out. Slide along it with the wheel or by dragging; the one under the cursor turns to show its cover; click it and it starts from track one. On touch, the centred record is the one that turns, and a second tap plays it. There's a filter box for big collections.
- **Volume**: the speaker button next to the transport controls slides out a fader wired to Spotify's own volume. Arrow keys up and down nudge it. Spotify refuses volume changes on some devices (the iPhone app is the usual one), and the app says so rather than failing quietly.
- **Themes**, picked in settings: Classic, Dark Wood, Clear Acrylic, Art Only (just the cover, big), Sleeve (the record slides two-thirds out of its jacket to spin, and back in when you pause), and two illustrated rooms built on painted backdrops (`scene-lofi.jpg`, `scene-cyber.jpg`): the live record, tonearm and cover sit exactly where the painted ones are, with animated rain on the lofi window and drifting dust in the neon room. The backdrops are reference pictures Chris supplied; the neon one appears to be a specific artist's work, so swap or license it before sharing the app widely.

### A note on scratching

Dragging the record seeks, but it does not play the audio backwards. Spotify's Web Playback SDK decodes through a DRM-protected pipeline that Web Audio cannot attach to, so reversing, pitching or even reading the waveform is blocked at the browser level. No amount of code gets round it; it would need a local audio file instead of a stream.

## Using it

Open the live link, click **Continue with Spotify**, approve the permissions, and you're on the turntable. The app's Spotify Client ID is built in, so there is nothing to configure.

Everyone who opens the site signs in to their own Spotify account and sees only their own music. There is no server and no shared state: tokens live in each person's browser and nowhere else.

### Adding other people

The Spotify app behind this runs in Development Mode, which allows up to 25 named users. To let someone else sign in, open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) > the Fora Vinyl app > **Settings** > **User Management**, and add their name and the email on their Spotify account. Anyone not on that list gets an error at the Spotify login screen.

Going fully public would need Spotify to grant Extended Quota Mode, which they now reserve for registered businesses with an existing user base. The practical alternative is for a person to bring their own Spotify app, which the next section covers.

### Bringing your own Client ID

On the sign-in screen, **Use a different Client ID** opens the setup screen, where a viewer can point the app at their own free Spotify app instead. They need to create one in the dashboard with `https://fora-code.github.io/fora-Vinyl-app/` as a Redirect URI and **Web API** plus **Web Playback SDK** ticked. The ID is stored only in their browser.

The built-in Client ID is the public half of the credentials, not the client secret. It appears in every authorization URL by design, and Spotify will only ever redirect back to the URI registered on the app, so publishing it is safe.

### Notes

- Spotify only allows playback control (play, pause, skip) and in-browser audio on **Premium** accounts. On Free the turntable still displays what's playing.
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
index.html   markup for the setup, sign-in, player, settings and library screens
styles.css   layout, turntable, tonearm, background, shelf, volume
themes.css   the seven themes; room themes place the live record, arm and cover over the painted backdrop
app.js       auth, Spotify Web API + Playback SDK, palette extraction, vinyl renderer, animation, themes, volume
library.js   the shelf: fetches saved albums and playlists, renders spines, plays on pick
scenes.js    the two rooms: backdrop image plus animated SVG overlay (rain, dust)
scene-*.jpg  the painted backdrops
```

Permissions: this version reads your library, which earlier sign-ins never asked for, so the first load signs you out once and Spotify asks you to approve again.

## Ideas for next steps

- Shuffle and repeat controls
- More vinyl styles (split color, picture disc, glow-in-the-dark)
- Lyrics or queue panel
- A "sleeve" transition when the track changes
