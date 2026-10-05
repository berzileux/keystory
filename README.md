# keystory

A typing test that uses passages from public-domain literature, and shows which fingers and keys slow you down.

Status: corpus pipeline, keystroke engine and web UI. See "Web UI" below.

## Commands

    npm install
    npm test                 # vitest
    npm run typecheck        # tsc --noEmit
    npm run corpus:fixture   # run the pipeline on the bundled test book, output in .tmp/
    npm run corpus:build     # download the books in corpus/sources.json and write public/corpus/

## Testing locally

There is no web UI yet, so local testing means two things: reviewing the corpus and typing in the terminal.

    npm run corpus:build            # needs internet; writes public/corpus/
    npm run corpus:sample           # counts, 15 random passages to read, and .tmp/corpus-words.txt
    npm run play                    # terminal typing test on a random passage
    npm run play -- --difficulty hard
    npm run play -- --reset         # clear saved tests

Read the sampled passages and scan `.tmp/corpus-words.txt` for unsuitable words. Add them to `corpus/blocklist.txt` and rebuild.

`npm run play` saves your key presses to `.keystory/presses.json` (git-ignored), so each run adds to the same picture. After each test it prints your wpm and a keyboard heatmap in the terminal. Do 5 to 10 runs to see the confidence note change. It needs a terminal with 24-bit colour (Windows Terminal, iTerm2 and the VS Code terminal all qualify) and must run in a real terminal, not piped.

`corpus:build` downloads from gutenberg.org into `corpus/raw/` (git-ignored) the first time, then reuses the local files. Pass `--offline` to forbid downloads.

## Corpus pipeline (`corpus/src`)

1. Strip the Project Gutenberg header and footer, and verify the file's exact
   header title (`gutenbergTitle` in `corpus/sources.json`) matches, so a wrong
   id fails loudly. This is a strict match after normalising case/punctuation/
   whitespace, not a substring check - a bundled edition (for example
   Gutenberg's "Walden, and On The Duty Of Civil Disobedience") is rejected
   even though "Walden" reads as a substring of it.
2. If a source declares `startMarker` (with an optional `occurrence`, default
   1), everything before the Nth occurrence of that exact string is discarded
   before paragraph splitting - this cuts off dedications, prefaces, tables of
   contents and similar front matter that would otherwise leak into passages.
   Symmetrically, `endMarker`/`endOccurrence` discards everything from the Nth
   occurrence onward (the marker itself excluded), for a second work bundled
   after the one wanted - this is how `walden` keeps only "Walden" out of
   Gutenberg id 205's "Walden, and On The Duty Of Civil Disobedience" (the
   only plain-text edition; id 26289 is audio-only, no text at all). A
   declared marker that isn't found makes the build fail loudly rather than
   silently keep the unwanted text.
3. Normalise to typeable ASCII: curly quotes, dashes, ellipses, accents and ligatures. Anything else is rejected.
4. Drop headings, then cut passages of 25 to 60 words from consecutive sentences inside one paragraph. A source may opt in to `stripLeadingNumerals` (default false) to remove a Roman-numeral section prefix such as "XVI. " from the start of a sentence before this step - set on `marcus-aurelius-meditations` only, since its translation numbers every entry.
5. Reject passages with digits, unbalanced quotes or parentheses, or a term from `corpus/blocklist.txt`. Remove duplicates.
6. Score difficulty (word length, punctuation density, rare words) and bucket into easy, medium and hard terciles of the corpus.

Sources must be published before 1931. That is a guard, not legal advice: confirm each source for your jurisdiction. The corpus currently has 10 active books.

Each source in `corpus/sources.json` has a `status`: `"active"` (included in
the build; its raw file is downloaded once if missing, then reused),
`"archived"` (a reserve - excluded from the build, its raw file is kept and
never touched, no network access for it), or `"retired"` (excluded from the
build, and its raw file in `corpus/raw/` is deleted; its entry stays in
`sources.json` as a permanent reference, never renumbered or removed).
Absent means `active`. Any other value - wrong case, a number, a typo - is a
build error naming the source, raised before anything on disk changes; a
leftover `ttl` key (the field `status` replaced) is also a build error. To
archive an active book, set its `status` to `"archived"` - its raw file is
left alone. To bring an archived or retired book back, set its `status` to
`"active"` and run `npm run corpus:build`: it downloads the raw file only if
it is missing. `npm run corpus:build -- --dry-run` prints which raw files
would be deleted, which sources are active, and which would be fetched,
without changing anything.

Active books as of this writing: Pride and Prejudice, Alice's Adventures in
Wonderland, Frankenstein, Treasure Island, Dracula, The Adventures of
Sherlock Holmes, The Picture of Dorian Gray, The Time Machine, Walden, and
Meditations (Marcus Aurelius). `corpus/sources.json` also keeps 10 archived
reserves (poetry and fairy-tale/fable collections by Dickinson, Frost,
Tagore, Andersen and Aesop) and 2 retired entries (Moby-Dick; Stray Birds,
whose short numbered aphorisms yield too few passages under the 25-60 word
passage rule to be worth a reserve slot).

`corpus/blocklist.txt` holds ban entries: any word or phrase that
demeans a person or group when used about them (racial/ethnic/national/
religious slurs and epithets, dated exonyms, dehumanising group labels,
ableist insults and slurs, misogynistic/sexual/sexual-orientation epithets).
Each entry carries a short reason comment. Matching (`findBlocked` in
`corpus/src/passages.ts`, shared by the build and by `corpus:ban` below, so
the two can never disagree) is case-insensitive and whole-word; an entry also
matches its own possessive forms (`'s` and a trailing `'`) but not a plain
plural or other variant - those are listed as their own entries. An entry
containing a space or hyphen matches as a phrase, treating hyphen, space and
runs of whitespace as equivalent separators (`half-caste` also matches
"half caste"). It is a curated list, not an exhaustive one, and it only
catches listed words and phrases - hostile depiction using no listed word
cannot be caught this way. Read a sample of the output before publishing.

`npm run corpus:ban` scans an already-built corpus (default `public/corpus`,
override with `--dir <path>`; blocklist defaults to `corpus/blocklist.txt`,
override with `--blocklist <file>`) against the current blocklist and removes
every matching passage in place, first to last. Surviving passage ids are
NOT renumbered; `index.json`'s per-source and easy/medium/hard totals are
recomputed, but a surviving passage's own difficulty LABEL is not
recalculated. `--dry-run` prints the same report and writes nothing.
`--check` writes nothing and exits with code 1 if any passage still matches
(0 if clean) - useful as a gate in a script. Both the build and `corpus:ban`
write every changed file to a temporary name and rename it, so a failure
partway through never leaves the corpus half-written.

`public/corpus/` (the generated output) is committed to this repo, not
git-ignored - only `corpus/raw/` (the downloaded source texts) is.

## Texts

Passages are edited excerpts from public-domain books, sourced from
[Project Gutenberg](https://www.gutenberg.org). Thank you to Project
Gutenberg and its volunteers for making these books freely available.
Keystory is not affiliated with or endorsed by Project Gutenberg.

## Engine (`src/engine`)

- `session.ts`: pure reducer (`createSession`, `typeChar`, `typeChars`, `backspace`, `finish`, `expire`, `extend`). Time is passed in, never read from a clock.
- `result.ts`: wpm, raw wpm, accuracy, consistency, character counts.
- `keystats.ts`: per-key latency and error rate. Latency is adjusted for the finger movement that led into each key, because raw per-key latency mostly measures which keys follow awkward movements. Includes finger, hand and row summaries and the confidence tiers behind the "5 to 10 tests" note.
- `constants.ts`: thresholds. These are starting defaults, not statistically derived.

## Open decisions

- Licence: none chosen yet.
- Name: `keystory` is a working name. Check GitHub and trademarks before publishing.


## Web UI

React + Vite single page app in `src/ui/`. The terminal tools (`npm run play`, `npm run corpus:sample`) stay for developer testing.

```
npm run corpus:build   # writes public/corpus (needed once; the UI shows a hint if it is missing)
npm run dev            # http://localhost:5173
npm run build          # static site in dist/
npm run preview        # serve dist/ locally
```

Deploying: upload the contents of `dist/` to any static host. `base` is `./`, so sub-paths work. Run `corpus:build` before `build` so `dist/corpus` exists.

History (key presses, test count, preferences, and the last 200 seen passage ids for the no-repeat rule) is stored in the browser's localStorage under `keystory:v1`, capped at 15000 presses. Nothing is sent to a server.

Notes: mobile text input is best effort. Typing speed is measured client side, so it cannot back a public leaderboard without server-side validation. The passage is rendered as a window of words around the cursor rather than the whole text, so the DOM stays bounded in time mode; the window size and step are the constants in `src/ui/window.ts`. Besides timed mode (default 60s), passage mode types a fixed amount of text with no clock: one passage, or about 100/250/500 words joined from several passages picked to land close to that target.

## Deploy

The repository includes `Dockerfile`, `nginx/` and `cloudbuild.yaml`, modelled on the `letter-duel` deployment. The image builds the site with Node, then serves `dist/` (including `public/corpus/`, which must be committed - see below) with nginx as a non-root user on port 8080, which is what Cloud Run expects.

Try the image locally first:

```bash
docker build -t keystory .
docker run --rm -p 8080:8080 keystory
# http://localhost:8080  and  http://localhost:8080/healthz
```

One-time setup (run by hand; replace `PROJECT_ID` and `REGION`):

```bash
gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com --project=PROJECT_ID

# Only if the repository named in cloudbuild.yaml's _REPO substitution does not
# already exist in this project (keystory defaults to reusing letter-duel's):
gcloud artifacts repositories create letter-duel --repository-format=docker --location=REGION --project=PROJECT_ID

# The Cloud Build service account needs these roles to push the image and deploy it:
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# To trigger builds automatically on push, connect the repository in Cloud
# Build and point a trigger at cloudbuild.yaml on the main branch.
```

Manual build without a trigger (`$COMMIT_SHA` is otherwise empty):

```bash
gcloud builds submit --config=cloudbuild.yaml --substitutions=COMMIT_SHA=$(git rev-parse HEAD) --project=PROJECT_ID
```

The pipeline installs, typechecks and tests first - a failing test or type error stops the build before anything is pushed or deployed - then builds the image, pushes it to Artifact Registry tagged with the commit SHA only (never `latest`), and deploys it to Cloud Run. `--allow-unauthenticated` makes the site public, matching a typing-test site with no accounts. Change `_REGION`, `_REPO` and `_SERVICE` at the top of `cloudbuild.yaml` for a different target.

After a deploy, check by hand against the Cloud Run URL: `curl -sI SERVICE_URL/` shows the security headers and `Cache-Control: no-cache`; `curl -sI SERVICE_URL/assets/<a hashed file>` shows `Cache-Control: public, max-age=31536000, immutable`; `curl -sI -H "Accept-Encoding: gzip" SERVICE_URL/corpus/index.json` shows `Content-Encoding: gzip`; `curl -sI SERVICE_URL/healthz` returns 200; and a passage completes with no browser console errors.

`nginx/security-headers.conf` sends a Content-Security-Policy that allows only this origin and Google Fonts. If a new external script, image host or API is ever added, update that file to match.
