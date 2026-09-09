# Fora Vinyl

A virtual record player for your Spotify now-playing, in the spirit of MD Vinyl. Open it in Chrome, connect Spotify, and the current track shows up as album art plus a record themed from the artwork's colors, spinning on a turntable with a tonearm that tracks the song's progress.

**Live:** https://fora-code.github.io/fora-Vinyl-app/

## What it does

- Signs in to Spotify directly from the browser (PKCE, no server, nothing stored outside your browser).
- Turns the Chrome tab into a Spotify device (Web Playback SDK, Premium required) so pressing play works with nothing else open. If Spotify is already playing on your phone or desktop, it shows and controls that instead.
- Extracts a palette from the album art and renders the record on a canvas in one of five styles that cycle with each new song: solid color, classic black, speckled, translucent, wavy. Press `V` or click the style pill to cycle manually.
- Tonearm lifts to its rest when paused, lands on the outer groove on play, and sweeps inward as the track plays. The record spins up and coasts down.
- Background is a soft, blurred, desaturated wash from the same palette so it sits behind the objects instead of competing with them.
- Controls: previous, play/pause, next. Click the progress bar to seek. Space toggles play, Shift+Arrow skips.
- Full screen: click the expand icon top right or press `F`. In full screen the top bar and controls fade out after a few seconds of no mouse movement, leaving just the turntable.

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
index.html   markup for the setup, sign-in, and player screens
styles.css   layout, turntable, tonearm, background
app.js       auth, Spotify Web API + Playback SDK, palette extraction, vinyl renderer, animation
```

## Ideas for next steps

- Volume and shuffle controls
- More vinyl styles (split color, picture disc, glow-in-the-dark)
- Lyrics or queue panel
- A "sleeve" transition when the track changes
