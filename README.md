# Piano Practice

A piano-learning website that runs entirely in the browser. It has no build step, no backend and no accounts. Progress is saved in your browser's local storage, and can optionally be synced between devices through a private GitHub Gist.

## What's inside

| Section | What it does |
| --- | --- |
| **Learn to read** | A 12-chapter path through reading sheet music: the staff, the clefs, ledger lines, the grand staff, note lengths, rests, time signatures, accidentals, key signatures, fingering/ties/dynamics/repeats, and reading tips. Each chapter has examples you can listen to and a link to practise that skill. |
| **Sheet music** | Beginner exercises and songs through to intermediate pieces, drawn as real notation. There's also a **random sheet** you can configure (clef, major or minor keys with up to 4 ♯/♭, range up to 4 ledger lines, simple or varied rhythm, 4/4 or 3/4, chords, extra accidentals) and a **weak notes** sheet built from your mistakes. There are three modes:<br>• **Play it**: play the notes on the piano. The music waits for you. Keyboard **hints** can always show, fade out after three clean notes in a row, or stay off so you really read; they come back if you miss the same note twice. You can practise either hand or both; the other hand plays along.<br>• **At tempo**: a one-bar count-in, then play along with an optional metronome. Each note is scored on time, early, late or missed, adjusted for audio latency, and you find out whether you tend to rush or drag.<br>• **Name the notes**: a reading test. Type each note's name (`C`, `F#`, `Bb`…) or tap the on-screen buttons. It's untimed by default, or set a 1- or 2-minute **speed test**, which keeps loading new sheets and reports correct notes per minute. |
| **Note quiz** | One note at a time on the treble or bass staff. You answer on the piano. |
| **Ear training** | **Find the note** (after a reference C), **name the interval** (up, down or together, in three difficulty levels, with a familiar song for each interval), and **play it back** (3–5 note melodies). |
| **Scales & chords** | Scales and chords on any root, correctly spelled (D harmonic minor ends in C♯, not D♭), highlighted on the keyboard and playable. |
| **Free play** | The piano on its own. |
| **Progress** | Today's notes against a daily goal, your streak, a 5-week practice calendar, a heatmap of accuracy for every note on the treble and bass staves, and correct notes per minute over time (with a table view). The top bar shows today's goal and your streak on every page. |

**Spaced repetition:** every note you name in a reading test or the note quiz is recorded per clef. Notes you miss, or answer slowly, are chosen more often in random sheets and the quiz, and they make up the *weak notes* sheet. Notes you know well come up less often.

**The piano** is a full 88-key keyboard (A0–C8), always on screen. You can play it with:

- **Mouse or touch**
- **Computer keyboard**: `A`–`;` for the white keys, `W E T Y U O P` for the black keys, and `Z`/`X` to change octave
- **A MIDI keyboard**: press *Connect MIDI* (Chrome and Edge). A MIDI sustain pedal works too.

**Sound** is a sampled Yamaha C5 grand: the [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC BY 3.0), recorded at **three dynamic levels**, so soft notes really sound softer and darker. The medium layer (about 2.3 MB) loads first and the piano is playable as soon as it's in; the soft and loud layers follow in the background, about 6.9 MB in total. The built-in synth plays until then. Dynamics in the music (*p*, *mf*, *f*…) change how hard playback strikes the keys. Hold **Space** for the sustain pedal, or click *Pedal* to keep it down.

**Sync between devices (optional):** on the Progress page, paste a GitHub token that has only the **gist** permission ([create one](https://github.com/settings/tokens/new?scopes=gist&description=Piano%20Practice%20sync)). The site keeps your progress in a secret gist called `piano-practice.json` and syncs it when you open the site, every 15 seconds or so while you practise, and when you leave. Use the same token on each device. When two devices practise between syncs, their progress is merged: daily counts and best scores take the higher value, and speed tests and finished chapters are combined. Device settings such as volume aren't synced. The token stays in that browser only. Other pages hosted at the same `github.io` address can read it, so don't give it any other permission.

Sheet music is drawn with [VexFlow](https://www.vexflow.com) (MIT licence), which is included in `site/vendor/`. All progress is stored in your browser.

## Project layout

```
site/                 ← everything that gets published
  index.html
  css/style.css
  js/                 ← ES modules (main.js is the entry point)
    pieces.js         ← sheet-music library
    sheet.js          ← parsing and drawing notation (VexFlow)
    sheetpractice.js  ← play-along, at-tempo and name-the-notes modes
    generator.js      ← random and weak-note sheets
    stats.js          ← per-note spaced-repetition statistics, daily goal, streak, speed history
    ear.js            ← ear training
    progress.js       ← progress page
    sync.js           ← optional GitHub Gist sync and merging
    learn.js          ← "Learn to read" chapters
  samples/salamander/ ← piano samples (CC BY 3.0)
  vendor/             ← VexFlow
tests/site.test.mjs   ← browser tests (run before every deploy)
.github/workflows/deploy.yml   ← GitHub Pages deployment
Dockerfile, nginx.conf, compose.yaml   ← local hosting with Docker
```

### Adding a piece

Add an entry to `PIECES` in [site/js/pieces.js](site/js/pieces.js). `rh` is drawn on the treble staff and `lh` on the bass staff. The note format:

| Write | Means |
| --- | --- |
| `C4`, `G4:2`, `F#5:0.5`, `Bb3:1.5` | a note and its length in beats (default 1; 0.5 is an eighth, 1.5 a dotted quarter) |
| `R:1` | a rest |
| `C3+E3+G3:4` | a chord |
| `E4@3`, `C3+E3+G3@5+3+1` | fingering (1 is the thumb) |
| `C4:2~ C4:4` | a tie: the first note is held into the second |
| `!mf` | a dynamic marking (`pp p mp mf f ff`) for the notes that follow |
| `\|` | a bar line (optional, only for readability) |

Add `repeat: true` to play the whole piece twice behind repeat signs, and `pickup: 1` for a one-beat pickup bar.

## Run locally

The site uses ES modules, so it has to be served over HTTP; opening the file directly won't work.

**With Docker:**

```sh
docker compose up -d --build
# open http://localhost:8080
docker compose down        # stop it
```

**Without Docker:**

```sh
python -m http.server 8000 --directory site
# open http://localhost:8000
```

## Tests

```sh
npm install
npm test
```

The tests serve `site/` locally and drive a real Chrome through puppeteer-core. They check every section, all pieces and 144 combinations of random-sheet settings, playing and grading, note spelling, the pedal, sample loading and the phone layout. They also check the new features: keyboard hints, timing scores (a robot player hits notes on the beat and deliberately skips some), notation (fingering, ties, dynamics, repeats), ear training, the progress page, and syncing two devices through a mocked GitHub API. They also fail if anything logs a console error. If Chrome isn't installed in the usual place, set `CHROME_PATH`.

## Deploy to GitHub Pages

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml). The **test** job runs first, and the `site/` folder is published only if every test passes. Pull requests run the tests without deploying.

One-time setup: in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

The site is then served at `https://<your-user>.github.io/<repo-name>/`. All paths are relative, so it works from a sub-path. You can also run the workflow by hand from the **Actions** tab.
