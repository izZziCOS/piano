# Piano Practice

A piano-learning website that runs entirely in the browser. It has no build step, no backend and no accounts. Progress is saved in your browser's local storage.

## What's inside

| Section | What it does |
| --- | --- |
| **Learn to read** | An 11-chapter path through reading sheet music: the staff, the clefs, ledger lines, the grand staff, note lengths, rests, time signatures, accidentals, key signatures and reading tips. Each chapter has examples you can listen to and a link to practise that skill. |
| **Sheet music** | Beginner exercises and songs through to intermediate pieces, drawn as real notation. There's also a **random sheet** you can configure (clef, major or minor keys with up to 4 ♯/♭, range up to 4 ledger lines, simple or varied rhythm, 4/4 or 3/4, chords, extra accidentals) and a **weak notes** sheet built from your mistakes. There are two modes:<br>• **Play it**: play the highlighted notes on the piano. The music waits for you. You can practise either hand or both; the other hand plays along.<br>• **Name the notes**: a reading test. Type each note's name (`C`, `F#`, `Bb`…) or tap the on-screen buttons. It's untimed by default, or set a 1- or 2-minute **speed test**, which keeps loading new sheets and reports correct notes per minute. |
| **Note quiz** | One note at a time on the treble or bass staff. You answer on the piano. |
| **Scales & chords** | Scales and chords on any root, correctly spelled (D harmonic minor ends in C♯, not D♭), highlighted on the keyboard and playable. |
| **Free play** | The piano on its own. |

**Spaced repetition:** every note you name in a reading test or the note quiz is recorded per clef. Notes you miss, or answer slowly, are chosen more often in random sheets and the quiz, and they make up the *weak notes* sheet. Notes you know well come up less often.

**The piano** is a full 88-key keyboard (A0–C8), always on screen. You can play it with:

- **Mouse or touch**
- **Computer keyboard**: `A`–`;` for the white keys, `W E T Y U O P` for the black keys, and `Z`/`X` to change octave
- **A MIDI keyboard**: press *Connect MIDI* (Chrome and Edge). A MIDI sustain pedal works too.

**Sound** is a sampled Yamaha C5 grand: the [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC BY 3.0), about 2 MB, with a built-in synth while it loads. Hold **Space** for the sustain pedal, or click *Pedal* to keep it down.

Sheet music is drawn with [VexFlow](https://www.vexflow.com) (MIT licence), which is included in `site/vendor/`. All progress is stored in your browser.

## Project layout

```
site/                 ← everything that gets published
  index.html
  css/style.css
  js/                 ← ES modules (main.js is the entry point)
    pieces.js         ← sheet-music library
    generator.js      ← random and weak-note sheets
    stats.js          ← per-note spaced-repetition statistics
    learn.js          ← "Learn to read" chapters
  samples/salamander/ ← piano samples (CC BY 3.0)
  vendor/             ← VexFlow
tests/site.test.mjs   ← browser tests (run before every deploy)
.github/workflows/deploy.yml   ← GitHub Pages deployment
Dockerfile, nginx.conf, compose.yaml   ← local hosting with Docker
```

### Adding a piece

Add an entry to `PIECES` in [site/js/pieces.js](site/js/pieces.js). Notes are written as `Name+Octave:beats`, for example `C4` (one beat), `G4:2` (two beats), `F#5:0.5` (an eighth note), `R:1` (a rest) or `C3+E3+G3:4` (a chord). `|` marks bar lines; it's optional and only there to make the notes easier to read. `rh` is drawn on the treble staff and `lh` on the bass staff.

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

The tests serve `site/` locally and drive a real Chrome through puppeteer-core. They check every section, all pieces and 144 combinations of random-sheet settings, playing and grading, note spelling, the pedal, sample loading and the phone layout. They also fail if anything logs a console error. If Chrome isn't installed in the usual place, set `CHROME_PATH`.

## Deploy to GitHub Pages

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml). The **test** job runs first, and the `site/` folder is published only if every test passes. Pull requests run the tests without deploying.

One-time setup: in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

The site is then served at `https://<your-user>.github.io/<repo-name>/`. All paths are relative, so it works from a sub-path. You can also run the workflow by hand from the **Actions** tab.
