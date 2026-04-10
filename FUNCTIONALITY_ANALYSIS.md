# Transcripter - Complete Functionality Analysis

> **Project**: Transcripter – German Lecture Transcriber  
> **Tech Stack**: Pure HTML5 + CSS3 + Vanilla JavaScript (zero dependencies, no build step)  
> **External APIs**: Groq Whisper Large v3 (transcription) + Groq LLaMA 3.1 8B (translation)  
> **Deployment**: GitHub Pages (static site)  
> **Source Files**: `index.html` (247 lines), `script.js` (811 lines), `style.css` (692 lines)

---

## 1. API Key Management

**Files**: `script.js` lines 160–195, `index.html` lines 32–58

| What it does | How it works |
|---|---|
| **Save API key** | User enters Groq key in the input field. Validates format (must start with `gsk_` and be at least 20 chars). Stores in `localStorage` under key `transcripter-groq-key`. |
| **Load API key on startup** | `loadApiKey()` runs at init (line 805). Reads from `localStorage`. If found, shows the green banner; if not, shows the setup card. |
| **Show/hide key card vs. banner** | When no key is saved: shows the yellow API Key Card with input field + Save button. When a key is saved: hides the card and shows the compact green banner "Groq API key active". |
| **Change/remove key** | Clicking "Change key" on the banner calls `clearApiKey()` which removes the key from `localStorage` and shows the setup card again. |
| **Start button gating** | When no API key is saved, `startBtn.disabled = true` — the user cannot start recording without a valid key. |
| **Enter key shortcut** | Pressing Enter in the API key input field triggers `saveApiKey()` (line 772). |

---

## 2. Course & Lecture Selection

**Files**: `script.js` lines 21–56, 142–155, `index.html` lines 60–90

| What it does | How it works |
|---|---|
| **3 course groups** | Defined in `COURSE_GROUPS` array: **Informatik** (5 courses), **Wirtschaftsinformatik** (6 courses), **Mehdi** (1 test course). Total: 12 courses. |
| **Course dropdown** | HTML `<select>` with `<optgroup>` labels matching the 3 groups. Default selection: Compiler. |
| **Course-specific vocabulary** | Each course has a `vocab` string with domain-specific German terms (e.g., Compiler course: "Lexer, Parser, Token, Grammatik, Syntaxanalyse…"). This vocabulary is sent as the `prompt` parameter to Whisper to improve transcription accuracy for technical terms. |
| **Course metadata** | Each course stores: `id` (full name), `short` (abbreviation for filenames), `color` (hex for UI badges), `vocab` (domain terms). |
| **Flat lookup** | `COURSES` array (line 55) flattens all groups for O(1) lookup by `id` via `getActiveCourse()`. |
| **Lecture input** | Free-text field (max 24 chars) for entering the lecture number/name (e.g., "VL 1"). Used in export filenames and library entries. |
| **Course change listener** | `courseSelect` change event updates `selectedCourse` and `selectedGroup` state variables (line 153). |

---

## 3. Audio Source Selection

**Files**: `script.js` lines 200–262, `index.html` lines 117–136

| What it does | How it works |
|---|---|
| **Microphone mode** (default) | Calls `navigator.mediaDevices.getUserMedia()` with `noiseSuppression: true`, `echoCancellation: true`, `autoGainControl: true`, `channelCount: 1`. |
| **Teams/Screen mode** | Calls `navigator.mediaDevices.getDisplayMedia()` to capture screen or app audio. Immediately stops the video track (only audio needed). If no audio track is present, throws `'no_audio'` error with a toast telling the user to tick "Share system audio". |
| **Toggle buttons** | Two buttons (`srcMicBtn`, `srcTeamsBtn`) toggle the `.active` class. Only one can be active at a time. |
| **Teams instruction tip** | When screen mode is selected, a blue-bordered tip box appears explaining how to capture Teams audio on Windows ("Share system audio" checkbox) and macOS (needs BlackHole virtual device). Hidden when mic mode is active. |

---

## 4. Noise Cleaning (Web Audio Processing)

**Files**: `script.js` lines 207–209, 243–262, 284–291

| What it does | How it works |
|---|---|
| **Toggle** | `noiseCleanBtn` toggles `noiseCleanOn` state. Active by default (starts ON). Shows toast "Noise Clean ON/OFF". |
| **High-pass filter** | Creates a `BiquadFilter` of type `'highpass'` at 80 Hz with Q=0.7. Removes low-frequency rumble (air conditioning, traffic, room noise). |
| **Dynamic compressor** | Creates a `DynamicsCompressor` with threshold=-24dB, knee=10, ratio=3, attack=0.003s, release=0.15s. Evens out volume spikes and quiet passages for more consistent audio. |
| **Audio pipeline** | `buildProcessedStream()` chains: raw microphone stream → `MediaStreamSource` → high-pass filter → compressor → `MediaStreamDestination`. Returns the processed stream for recording. |
| **Graceful fallback** | If the Web Audio pipeline fails (line 290), it catches the error, logs a warning, and falls back to the raw unprocessed stream. Recording still works. |

---

## 5. Recording Pipeline (15-Second Chunked Recording)

**Files**: `script.js` lines 267–333

| What it does | How it works |
|---|---|
| **Start recording** | `startRecording()` checks for API key, requests audio stream, sets up `MediaRecorder` with preferred MIME type `audio/webm;codecs=opus`. |
| **Chunk-based recording** | Audio is recorded in 15-second chunks (`CHUNK_DURATION = 15000ms`). Each chunk is a complete audio segment sent independently to Groq. |
| **Chunk cycle** | `startChunk()` → starts `MediaRecorder` → after 15s a `setTimeout` fires `mediaRecorder.stop()` → `onstop` handler creates a Blob from collected data → if blob >= 2000 bytes (`MIN_BLOB_BYTES`) it calls `transcribeChunk()` → then immediately starts the next chunk via `startChunk()`. |
| **Minimum blob size** | Blobs smaller than 2000 bytes are silently discarded (likely silence or too short to be useful). |
| **MediaRecorder MIME** | Prefers `audio/webm;codecs=opus` if supported. Falls back to browser default if not. |
| **Track ended handling** | If the audio track ends externally (e.g., user stops screen share), recording automatically stops (line 281). |
| **Stop recording** | `stopRecording()` clears the chunk timer, stops MediaRecorder, stops all audio tracks, closes AudioContext, hides progress bar, resets UI. Final chunk is still processed. |

---

## 6. Groq Whisper Transcription

**Files**: `script.js` lines 338–373

| What it does | How it works |
|---|---|
| **API endpoint** | `POST https://api.groq.com/openai/v1/audio/transcriptions` |
| **Model** | `whisper-large-v3` — OpenAI's most accurate speech-to-text model, hosted on Groq for fast inference. |
| **Request format** | `FormData` with: `file` (audio blob as `.webm` or `.ogg`), `model`, `language: 'de'` (German), `response_format: 'text'`, `prompt` (base academic terms + course-specific vocabulary). |
| **Vocabulary prompting** | The `prompt` field includes `BASE_PROMPT` ("Vorlesung, Universität, Definition, Theorem…") concatenated with the active course's `vocab` string. This helps Whisper correctly recognize domain-specific terms. |
| **Authentication** | `Authorization: Bearer {apiKey}` header with the user's Groq API key. |
| **Error handling** | 401 → "Invalid API key" toast + stops recording. Other HTTP errors → shows error message from API response. Network errors → "check your connection" toast. |
| **Processing indicator** | Increments `processingCount` before the API call, decrements after. Shows/hides the blue processing bar with spinner. |
| **Result handling** | Successful response text (trimmed) is passed to `addSegment()` to display in the transcript. |

---

## 7. German-to-English Translation (LLaMA)

**Files**: `script.js` lines 378–403

| What it does | How it works |
|---|---|
| **API endpoint** | `POST https://api.groq.com/openai/v1/chat/completions` |
| **Model** | `llama-3.1-8b-instant` — fast inference model for translation. |
| **System prompt** | "You translate German university computer science lecture text to clear English. Return ONLY the translation, nothing else." |
| **Parameters** | `temperature: 0.1` (near-deterministic for consistent translations), `max_tokens: 600`. |
| **When it runs** | Only when `translateOn === true`. Called inside `addSegment()` after each new German segment is added. |
| **Pending state** | While translating, the translation line shows "→ …" with a blinking animation (CSS class `.pending`). |
| **Error handling** | On any failure, silently returns empty string — translation line stays empty, no crash. |

---

## 8. Transcript Rendering & Keyword Highlighting

**Files**: `script.js` lines 408–480, 720–726, 130–137

| What it does | How it works |
|---|---|
| **Segment structure** | Each segment is `{ text, time, translation }` stored in the `segments` array. |
| **Segment DOM element** | `createSegmentEl()` builds: outer `.segment` div → `.segment-time` span (HH:MM:SS timestamp) + `.segment-body` div → `.segment-text` span (German text with keywords highlighted) + `.segment-translation` span (English text, hidden if translate is off). |
| **New segment animation** | New segments get class `.new-segment` (yellow highlight background) which is removed after 2 seconds. CSS `fadeInUp` animation slides segments in. |
| **Auto-scroll** | After adding each segment, scrolls the transcript panel to the bottom: `transcriptEl.scrollTop = transcriptEl.scrollHeight`. |
| **Segment counter** | Status bar shows "X segments" badge, updated on every `addSegment()` and `renderAll()`. |
| **Placeholder message** | When no segments exist, shows instructions: "Save your Groq API key, choose your course…". Removed when first segment is added. |
| **6 keyword categories** | Regex-based highlighting applied via `highlightKeywords()`: |
| | - **Definition** (blue): `Definition`, `definiert`, `definieren` |
| | - **Wichtig** (red): `Wichtig`, `wichtige[rns]`, `Achtung`, `Hinweis` |
| | - **Beispiel** (green): `Beispiel`, `beispielsweise`, `zum Beispiel`, `z.B.` |
| | - **Theorem** (purple): `Theorem`, `Satz`, `Korollar`, `Lemma`, `Beweis` |
| | - **Merke** (amber): `Merke`, `Fazit`, `Zusammenfassung`, `Schluss` |
| | - **Aufgabe** (pink): `Aufgabe`, `Übung`, `Hausaufgabe` |
| **XSS protection** | `escapeHtml()` sanitizes text before inserting into DOM (escapes `&`, `<`, `>`, `"`). Keywords are highlighted AFTER escaping, so no injection is possible. |
| **Keyword legend** | Visual chip bar below the transcript panel shows all 6 categories with their colors. |

---

## 9. Transcript Actions (Clear, Copy)

**Files**: `script.js` lines 518–534

| What it does | How it works |
|---|---|
| **Clear transcript** | `clearTranscript()` resets `segments = []`, calls `renderAll()` (restores placeholder), shows toast. |
| **Copy all** | `copyAll()` formats all segments as `[HH:MM:SS] German text` (with `→ English translation` on next line if present), copies to clipboard via `navigator.clipboard.writeText()`. |
| **Clipboard fallback** | If the modern Clipboard API fails (e.g., non-HTTPS), falls back to creating a hidden `<textarea>`, selecting it, and using `document.execCommand('copy')`. |

---

## 10. Export (TXT and PDF)

**Files**: `script.js` lines 539–605

| What it does | How it works |
|---|---|
| **TXT export** | `exportTxt()` → `exportSegmentsAsTxt()` builds a plain text file with header (course, lecture, date, model info, separator line) followed by timestamped segments. Downloads as `.txt` file. |
| **Filename format** | `{courseShort}_{lecture}_{YYYYMMDD_HHMM}.txt` — e.g., `Compiler_VL1_20260410_1430.txt`. |
| **PDF export** | `exportPdf()` → `exportSegmentsAsPdf()` generates a complete HTML document with inline CSS, opens it in a new browser tab, and triggers `window.print()` for the browser's "Save as PDF" dialog. |
| **PDF content** | Includes: course name as header, metadata line (lecture, date, segment count, model), table with timestamps and text. English translations shown in blue italic below German text. |
| **Translations in exports** | Both TXT and PDF automatically include English translations if any segments have them. The header notes "LLaMA EN translation" if present. |
| **Empty check** | Both export functions check `segments.length === 0` and show a warning toast if nothing to export. |
| **Shared by Library** | The same `exportSegmentsAsTxt()` and `exportSegmentsAsPdf()` functions are reused by the Library to export saved lectures. |

---

## 11. Lecture Library (Save, Browse, Filter, Delete, Export)

**Files**: `script.js` lines 610–695, `index.html` lines 206–240

| What it does | How it works |
|---|---|
| **Save to library** | `saveToLibrary()` stores the current transcript with full metadata: unique `id` (timestamp), `course`, `courseShort`, `courseColor`, `courseGroup`, `courseGroupLabel`, `lecture`, `date`, `savedAt` (ISO), and a deep copy of all `segments`. Saved to `localStorage` key `transcripter-library` as JSON array. New entries are prepended (most recent first). |
| **Open library** | Clicking the book icon (header) opens a slide-in modal panel from the right side with backdrop overlay + blur. |
| **Close library** | Click the X button, click the overlay, or press Escape. |
| **Filter by course** | Dropdown at the top of the library panel with all 12 courses grouped the same way as the main course selector. Filters the displayed entries. "All Courses" shows everything. |
| **Library item display** | Each saved entry shows: course badge (colored pill with short name), date, lecture name, segment count, whether it has EN translations. |
| **Export from library** | Each library item has TXT and PDF export buttons that call the same shared export functions with the saved entry's data. |
| **Delete from library** | Each item has a delete button. Filters the entry out of localStorage and re-renders the list. Shows "Deleted" toast. |
| **Empty state** | When no saved lectures exist (or none match the filter), shows: "No saved lectures yet. Record a lecture and click Save." |
| **Data persistence** | All library data is in `localStorage`. Survives page reloads and browser restarts. Cleared only by explicit delete or browser data clearing. |

---

## 12. Theme Toggle (Light/Dark Mode)

**Files**: `script.js` lines 700–715, `style.css` lines 7–79

| What it does | How it works |
|---|---|
| **Toggle** | `toggleTheme()` flips `darkMode` boolean, toggles `dark-mode` / `light-mode` classes on `<body>`, updates icon (moon/sun). |
| **Persistence** | Saves preference to `localStorage` key `transcripter-theme`. Loaded at startup by `loadTheme()`. |
| **Light theme** | Soft blue/white palette: `#f0f4f8` background, `#ffffff` surfaces, `#1e293b` text. |
| **Dark theme** | Slate palette: `#0f172a` background, `#1e293b` surfaces, `#e2e8f0` text. |
| **CSS variables** | Both themes define 20+ CSS custom properties (colors, shadows, backgrounds) that cascade to all components automatically. |

---

## 13. UI State Management

**Files**: `script.js` lines 485–513

| What it does | How it works |
|---|---|
| **Recording state UI** | `setUIRecording(recording)`: enables/disables Start/Stop buttons, shows/hides pulse ring animation and chunk progress bar, updates status text ("Recording — chunk sent every 15 s" vs "Ready to transcribe"). |
| **Processing bar** | Blue bar with spinner below the panel header. Shows "Transcribing with Whisper Large v3…" or "Translating…". Hidden when `processingCount` drops to 0. Supports overlapping operations. |
| **Chunk progress bar** | During recording: shows a green-to-blue gradient bar filling from 0% to 100% over 15 seconds. Updates every 200ms with timer display "Xs / 15s". At 100% shows "Sending to Groq…". |

---

## 14. Toast Notifications

**Files**: `script.js` lines 759–765, `style.css` lines 558–570

| What it does | How it works |
|---|---|
| **Show toast** | `showToast(msg, ms)` sets text content, removes `.hidden` class, auto-hides after `ms` milliseconds (default 3200ms). |
| **Appearance** | Fixed position at bottom center of screen. Dark pill-shaped badge with white text. Fade+slide transition. |
| **Debouncing** | Clears any existing timer before setting a new one, so rapid toasts don't stack. |

---

## 15. Keyboard Shortcuts

**Files**: `script.js` lines 793–798

| Shortcut | Action | Condition |
|---|---|---|
| **Space** | Start or Stop recording (toggle) | Only when focus is NOT on an `<input>` or `<select>` element |
| **Ctrl+K** (or Cmd+K) | Clear transcript | Only when focus is NOT on an input |
| **Escape** | Close library modal | Always |

---

## 16. Responsive Design

**Files**: `style.css` lines 684–691

| Breakpoint | Changes |
|---|---|
| **Below 640px** | Hides "Powered by Groq · Whisper Large v3" subtitle. Status bar switches to vertical layout. Buttons get smaller padding/font. Transcript panel reduces height (240–360px). Course select goes full width. Library panel takes full viewport width. |

---

## 17. Deployment Pipeline

**Files**: `.github/workflows/pages.yml`

| What it does | How it works |
|---|---|
| **Trigger** | Runs on push to `main` or `master` branch, or manual workflow dispatch. |
| **Process** | Checks out repo, creates orphan `gh-pages` branch with only `index.html`, `style.css`, `script.js`, `.nojekyll`. Force-pushes to `gh-pages`. |
| **Result** | GitHub Pages serves the app as a static site over HTTPS. |

---

## Summary of All Working Features

1. **API Key Management** — save, load, validate, remove Groq API key (localStorage)
2. **Course Selection** — 12 courses in 3 groups with domain-specific vocabulary
3. **Lecture Naming** — free text input for lecture number/name
4. **Microphone Capture** — browser mic with noise suppression, echo cancellation, auto gain
5. **Screen/Teams Audio Capture** — capture app/system audio via getDisplayMedia
6. **Web Audio Noise Cleaning** — high-pass filter (80Hz) + dynamic compressor pipeline
7. **15-Second Chunked Recording** — continuous recording split into 15s segments
8. **Groq Whisper Transcription** — German speech-to-text with course vocabulary prompting
9. **Groq LLaMA Translation** — German-to-English translation per segment
10. **Real-Time Transcript Display** — timestamped segments with fade-in animation
11. **Keyword Auto-Highlighting** — 6 color-coded academic term categories
12. **Copy Transcript** — clipboard copy with timestamps and translations
13. **Clear Transcript** — reset all segments
14. **TXT Export** — download formatted text file with header and all segments
15. **PDF Export** — print-to-PDF via browser with styled HTML table
16. **Lecture Library** — save, browse, filter by course, export, delete saved transcripts
17. **Dark/Light Theme** — toggle with persistence in localStorage
18. **Toast Notifications** — feedback for all user actions
19. **Keyboard Shortcuts** — Space (record), Ctrl+K (clear), Escape (close library)
20. **Responsive Layout** — mobile-friendly under 640px
21. **GitHub Pages Deployment** — automated via GitHub Actions
22. **XSS Protection** — HTML escaping on all user/API-generated text
