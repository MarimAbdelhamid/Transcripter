/**
 * Transcripter – Live German Lecture Transcriber
 * script.js  |  Groq Whisper Large v3 + LLaMA translation + Library
 */

'use strict';

/* ================================================================
   Constants
   ================================================================ */
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const WHISPER_MODEL    = 'whisper-large-v3';
const TRANSLATE_MODEL  = 'llama-3.1-8b-instant';
const CHUNK_DURATION   = 15000;
const MIN_BLOB_BYTES   = 2000;
const LS_KEY_API       = 'transcripter-groq-key';
const LS_KEY_THEME     = 'transcripter-theme';
const LS_KEY_LIBRARY   = 'transcripter-library';

const COURSES = [
    {
        id:    'Compiler',
        short: 'Compiler',
        color: '#3b82f6',
        vocab: 'Compiler, Lexer, Parser, Token, Grammatik, Syntaxanalyse, Semantik, Codegenerierung, Symboltabelle, Parserbaum, Interpreter.',
    },
    {
        id:    'Algorithmen und Datenstruktur',
        short: 'AlgDS',
        color: '#10b981',
        vocab: 'Algorithmus, Sortieren, Laufzeit, Komplexität, O-Notation, Rekursion, Graph, Baum, Heap, Hashing, Dynamische Programmierung, Greedy.',
    },
    {
        id:    'Rechnerarchitektur',
        short: 'Rechnerarch',
        color: '#8b5cf6',
        vocab: 'Prozessor, Register, Cache, Pipeline, Speicher, Befehlssatz, ALU, CPU, RAM, Interrupt, Assembler, Mikroprozessor.',
    },
    {
        id:    'Betriebssystem und Datenkommunikation',
        short: 'BetriebsOS',
        color: '#f59e0b',
        vocab: 'Prozess, Thread, Scheduler, Semaphor, Deadlock, Speicherverwaltung, TCP, IP, Protokoll, Netzwerk, Socket, Kernel.',
    },
];

const BASE_PROMPT = 'Vorlesung, Universität, Definition, Theorem, Satz, Beweis, Beispiel, Aufgabe, Lösung, Wichtig, Merke, Fazit.';

/* ================================================================
   DOM References
   ================================================================ */
const apiKeyCard        = document.getElementById('apiKeyCard');
const apiKeyInput       = document.getElementById('apiKeyInput');
const saveKeyBtn        = document.getElementById('saveKeyBtn');
const apiKeyBanner      = document.getElementById('apiKeyBanner');
const changeKeyBtn      = document.getElementById('changeKeyBtn');

const courseGroup       = document.getElementById('courseGroup');
const lectureInput      = document.getElementById('lectureInput');

const startBtn          = document.getElementById('startBtn');
const stopBtn           = document.getElementById('stopBtn');
const clearBtn          = document.getElementById('clearBtn');
const copyBtn           = document.getElementById('copyBtn');
const saveLibBtn        = document.getElementById('saveLibBtn');
const exportTxtBtn      = document.getElementById('exportTxt');
const exportPdfBtn      = document.getElementById('exportPdf');
const themeToggle       = document.getElementById('themeToggle');
const themeIcon         = document.getElementById('themeIcon');

const transcriptEl      = document.getElementById('transcript');
const processingBar     = document.getElementById('processingBar');
const processingLabel   = document.getElementById('processingLabel');
const statusTextEl      = document.getElementById('statusText');
const pulseRing         = document.getElementById('pulseRing');
const sentenceCount     = document.getElementById('sentenceCount');
const chunkProgressWrap = document.getElementById('chunkProgressWrap');
const chunkProgressBar  = document.getElementById('chunkProgressBar');
const chunkLabel        = document.getElementById('chunkLabel');
const chunkTimerEl      = document.getElementById('chunkTimer');
const toast             = document.getElementById('toast');

const srcMicBtn         = document.getElementById('srcMicBtn');
const srcTeamsBtn       = document.getElementById('srcTeamsBtn');
const noiseCleanBtn     = document.getElementById('noiseCleanBtn');
const translateBtn      = document.getElementById('translateBtn');
const teamsTip          = document.getElementById('teamsTip');

const libraryBtn        = document.getElementById('libraryBtn');
const libraryModal      = document.getElementById('libraryModal');
const libraryOverlay    = document.getElementById('libraryOverlay');
const libraryClose      = document.getElementById('libraryClose');
const libraryFilter     = document.getElementById('libraryFilter');
const libraryList       = document.getElementById('libraryList');

/* ================================================================
   State
   ================================================================ */
let apiKey          = '';
let isRecording     = false;
let mediaRecorder   = null;
let audioStream     = null;
let audioCtx        = null;
let currentChunks   = [];
let chunkTimer      = null;
let progressTimer   = null;
let chunkStart      = 0;
let segments        = [];        // [{text, time, translation}]
let darkMode        = false;
let processingCount = 0;
let audioMode       = 'mic';
let noiseCleanOn    = true;
let translateOn     = false;
let selectedCourse  = COURSES[0].id;

/* ================================================================
   Keyword Definitions
   ================================================================ */
const KEYWORDS = [
    { pattern: /\b(Definition|definiert|definieren)\b/gi,               cls: 'kw-definition' },
    { pattern: /\b(Wichtig|wichtige[rns]?|Achtung|Hinweis)\b/gi,       cls: 'kw-wichtig'    },
    { pattern: /\b(Beispiel|beispielsweise|zum\s+Beispiel|z\.B\.)\b/gi, cls: 'kw-beispiel'  },
    { pattern: /\b(Theorem|Satz|Korollar|Lemma|Beweis)\b/gi,            cls: 'kw-theorem'    },
    { pattern: /\b(Merke|Fazit|Zusammenfassung|Schluss)\b/gi,           cls: 'kw-merke'      },
    { pattern: /\b(Aufgabe|Übung|Hausaufgabe)\b/gi,                     cls: 'kw-aufgabe'    },
];

/* ================================================================
   Course Management
   ================================================================ */
function getActiveCourse() {
    return COURSES.find(c => c.id === selectedCourse) || COURSES[0];
}

function setCourse(courseId) {
    selectedCourse = courseId;
    document.querySelectorAll('.btn-course').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.course === courseId);
    });
}

courseGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-course');
    if (btn) setCourse(btn.dataset.course);
});

/* ================================================================
   API Key Management
   ================================================================ */
function loadApiKey() {
    apiKey = localStorage.getItem(LS_KEY_API) || '';
    if (apiKey) showKeyBanner(); else showKeyCard();
}

function saveApiKey() {
    const val = apiKeyInput.value.trim();
    if (!val.startsWith('gsk_') || val.length < 20) {
        showToast('⚠️ Doesn\'t look like a valid Groq key (should start with gsk_)');
        return;
    }
    apiKey = val;
    localStorage.setItem(LS_KEY_API, apiKey);
    apiKeyInput.value = '';
    showKeyBanner();
    showToast('✅ API key saved — ready to record!');
}

function clearApiKey() {
    apiKey = '';
    localStorage.removeItem(LS_KEY_API);
    showKeyCard();
    showToast('🔑 API key removed');
}

function showKeyCard() {
    apiKeyCard.classList.remove('hidden');
    apiKeyBanner.classList.add('hidden');
    startBtn.disabled = true;
}

function showKeyBanner() {
    apiKeyCard.classList.add('hidden');
    apiKeyBanner.classList.remove('hidden');
    startBtn.disabled = false;
}

/* ================================================================
   Audio Source
   ================================================================ */
function setAudioMode(mode) {
    audioMode = mode;
    srcMicBtn.classList.toggle('active',   mode === 'mic');
    srcTeamsBtn.classList.toggle('active', mode === 'screen');
    teamsTip.classList.toggle('hidden',    mode === 'mic');
}

function toggleNoiseClean() {
    noiseCleanOn = !noiseCleanOn;
    noiseCleanBtn.classList.toggle('active', noiseCleanOn);
    showToast(noiseCleanOn ? '✨ Noise Clean ON' : '🔇 Noise Clean OFF');
}

function toggleTranslate() {
    translateOn = !translateOn;
    translateBtn.classList.toggle('active', translateOn);
    document.querySelectorAll('.segment-translation').forEach(el => {
        el.classList.toggle('hidden', !translateOn);
    });
    showToast(translateOn
        ? '🌍 Translation ON — English appears below each segment'
        : '🌍 Translation OFF');
}

async function getRawStream() {
    if (audioMode === 'mic') {
        return navigator.mediaDevices.getUserMedia({
            audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 },
            video: false,
        });
    }
    const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    display.getVideoTracks().forEach(t => t.stop());
    if (display.getAudioTracks().length === 0) {
        display.getTracks().forEach(t => t.stop());
        throw new Error('no_audio');
    }
    return display;
}

async function buildProcessedStream(rawStream) {
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const source   = ctx.createMediaStreamSource(rawStream);
    const highPass = ctx.createBiquadFilter();
    highPass.type  = 'highpass';
    highPass.frequency.value = 80;
    highPass.Q.value = 0.7;
    const comp           = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value      = 10;
    comp.ratio.value     = 3;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.15;
    const dest = ctx.createMediaStreamDestination();
    source.connect(highPass);
    highPass.connect(comp);
    comp.connect(dest);
    return { ctx, processedStream: dest.stream };
}

/* ================================================================
   Recording
   ================================================================ */
async function startRecording() {
    if (isRecording) return;
    if (!apiKey) { showToast('⚠️ Please save your Groq API key first'); return; }

    let rawStream;
    try {
        rawStream = await getRawStream();
    } catch (err) {
        if (err.message === 'no_audio')  showToast('💻 No audio track — tick "Share system audio"');
        else if (audioMode === 'screen') showToast('💻 Screen capture cancelled');
        else                             showToast('🎤 Microphone access denied');
        return;
    }

    rawStream.getTracks().forEach(t => t.addEventListener('ended', () => { if (isRecording) stopRecording(); }));
    audioStream = rawStream;

    let recordingStream = rawStream;
    if (noiseCleanOn) {
        try {
            const { ctx, processedStream } = await buildProcessedStream(rawStream);
            audioCtx = ctx;
            recordingStream = processedStream;
        } catch (e) { console.warn('Web Audio pipeline failed:', e); }
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) currentChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
        const blob = new Blob(currentChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        currentChunks = [];
        if (blob.size >= MIN_BLOB_BYTES) await transcribeChunk(blob);
        if (isRecording) startChunk();
    };

    isRecording = true;
    setUIRecording(true);
    startChunk();
    const course = getActiveCourse();
    const lec    = lectureInput.value.trim();
    showToast(`▶ ${course.id}${lec ? ' · ' + lec : ''} — recording`);
}

function startChunk() {
    currentChunks = [];
    chunkStart    = Date.now();
    mediaRecorder.start();
    updateChunkProgress();
    chunkTimer = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, CHUNK_DURATION);
}

function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    clearTimeout(chunkTimer);
    clearInterval(progressTimer);
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
    if (audioCtx)    { audioCtx.close().catch(() => {}); audioCtx = null; }
    chunkProgressWrap.classList.add('hidden');
    setUIRecording(false);
    showToast('⏹ Stopped — final chunk processing…');
}

/* ================================================================
   Groq Whisper Transcription
   ================================================================ */
async function transcribeChunk(blob) {
    processingCount++;
    updateProcessingBar('Transcribing with Whisper Large v3…');

    const course   = getActiveCourse();
    const formData = new FormData();
    const ext      = blob.type.includes('ogg') ? 'ogg' : 'webm';
    formData.append('file',            blob, `chunk.${ext}`);
    formData.append('model',           WHISPER_MODEL);
    formData.append('language',        'de');
    formData.append('response_format', 'text');
    formData.append('prompt',          BASE_PROMPT + ' ' + course.vocab);

    try {
        const res = await fetch(GROQ_WHISPER_URL, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body:    formData,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err?.error?.message || `HTTP ${res.status}`;
            if (res.status === 401) { showToast('❌ Invalid API key'); stopRecording(); }
            else showToast(`⚠️ Groq error: ${msg}`);
            return;
        }
        const text = (await res.text()).trim();
        if (text) await addSegment(text);
    } catch (err) {
        console.error('Transcription error:', err);
        showToast('⚠️ Network error — check your connection');
    } finally {
        processingCount--;
        updateProcessingBar();
    }
}

/* ================================================================
   Groq LLaMA Translation
   ================================================================ */
async function translateText(germanText) {
    if (!apiKey || !germanText.trim()) return '';
    try {
        const res = await fetch(GROQ_CHAT_URL, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: TRANSLATE_MODEL,
                messages: [
                    {
                        role:    'system',
                        content: 'You translate German university computer science lecture text to clear English. Return ONLY the translation, nothing else.',
                    },
                    { role: 'user', content: germanText },
                ],
                temperature: 0.1,
                max_tokens:  600,
            }),
        });
        if (!res.ok) return '';
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    } catch {
        return '';
    }
}

/* ================================================================
   Transcript Rendering
   ================================================================ */
function createSegmentEl(seg, isNew) {
    const div = document.createElement('div');
    div.className = 'segment' + (isNew ? ' new-segment' : '');

    const timeSpan = document.createElement('span');
    timeSpan.className   = 'segment-time';
    timeSpan.textContent = seg.time;

    const body = document.createElement('div');
    body.className = 'segment-body';

    const textSpan = document.createElement('span');
    textSpan.className   = 'segment-text';
    textSpan.innerHTML   = highlightKeywords(escapeHtml(seg.text));

    const trSpan = document.createElement('span');
    trSpan.className = 'segment-translation' + (translateOn ? '' : ' hidden');
    if (seg.translation) trSpan.textContent = '→ ' + seg.translation;

    body.appendChild(textSpan);
    body.appendChild(trSpan);
    div.appendChild(timeSpan);
    div.appendChild(body);
    return div;
}

async function addSegment(text) {
    const time = getTimestamp();
    const seg  = { text, time, translation: '' };
    segments.push(seg);

    const ph = transcriptEl.querySelector('.placeholder-msg');
    if (ph) ph.remove();

    const div = createSegmentEl(seg, true);
    transcriptEl.appendChild(div);
    setTimeout(() => div.classList.remove('new-segment'), 2000);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    updateCounter();

    if (translateOn) {
        const trSpan = div.querySelector('.segment-translation');
        if (trSpan) { trSpan.textContent = '→ …'; trSpan.classList.add('pending'); }
        updateProcessingBar('Translating…');
        const tr = await translateText(text);
        seg.translation = tr;
        if (trSpan) {
            trSpan.classList.remove('pending');
            trSpan.textContent = tr ? '→ ' + tr : '';
        }
        updateProcessingBar();
    }
}

function renderAll() {
    transcriptEl.innerHTML = '';
    if (segments.length === 0) {
        transcriptEl.innerHTML = `<p class="placeholder-msg">
            Choose your <strong>course</strong> and lecture number above, then click <strong>Start</strong>.<br>
            Audio is sent to Groq every 15 s and transcribed in German.<br>
            Enable <strong>🌍 Translate EN</strong> to see English below each line.
        </p>`;
        sentenceCount.textContent = '0 segments';
        return;
    }
    segments.forEach(seg => transcriptEl.appendChild(createSegmentEl(seg, false)));
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    updateCounter();
}

function updateCounter() {
    sentenceCount.textContent = `${segments.length} segment${segments.length === 1 ? '' : 's'}`;
}

/* ================================================================
   UI State
   ================================================================ */
function setUIRecording(recording) {
    startBtn.disabled = recording;
    stopBtn.disabled  = !recording;
    pulseRing.classList.toggle('hidden', !recording);
    chunkProgressWrap.classList.toggle('hidden', !recording);
    statusTextEl.textContent = recording ? 'Recording — chunk sent every 15 s' : 'Ready to transcribe';
}

function updateProcessingBar(msg) {
    if (msg) {
        processingLabel.textContent = msg;
        processingBar.classList.remove('hidden');
    } else if (processingCount <= 0) {
        processingBar.classList.add('hidden');
    }
}

function updateChunkProgress() {
    clearInterval(progressTimer);
    chunkProgressBar.style.width = '0%';
    chunkLabel.textContent = 'Recording chunk…';
    progressTimer = setInterval(() => {
        const elapsed = Date.now() - chunkStart;
        const pct     = Math.min((elapsed / CHUNK_DURATION) * 100, 100);
        chunkProgressBar.style.width = pct + '%';
        chunkTimerEl.textContent = `${Math.floor(elapsed / 1000)}s / ${CHUNK_DURATION / 1000}s`;
        if (pct >= 100) { chunkLabel.textContent = 'Sending to Groq…'; clearInterval(progressTimer); }
    }, 200);
}

/* ================================================================
   Clear & Copy
   ================================================================ */
function clearTranscript() {
    segments = [];
    renderAll();
    showToast('🗑 Transcript cleared');
}

function copyAll() {
    if (segments.length === 0) { showToast('⚠️ Nothing to copy yet'); return; }
    const text = segments.map(({ time, text, translation }) => {
        return translation ? `[${time}] ${text}\n         → ${translation}` : `[${time}] ${text}`;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('📋 Copied!')).catch(() => {
        const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        showToast('📋 Copied!');
    });
}

/* ================================================================
   Export Helpers
   ================================================================ */
function buildExportFilename(courseShort, lecture) {
    const lec = (lecture || 'Lecture').replace(/\s+/g, '_');
    return `${courseShort}_${lec}_${dateFilename()}`;
}

function exportSegmentsAsTxt(segs, course, courseShort, lecture, date) {
    const hasEN = segs.some(s => s.translation);
    const header = [
        `Course:  ${course}`,
        `Lecture: ${lecture}`,
        `Date:    ${date}`,
        `Model:   Groq ${WHISPER_MODEL}${hasEN ? ' + LLaMA EN translation' : ''}`,
        '─'.repeat(60),
        '',
    ];
    const lines = segs.map(({ time, text, translation }) =>
        translation ? `[${time}]  ${text}\n           → ${translation}` : `[${time}]  ${text}`
    );
    const blob = new Blob([[...header, ...lines].join('\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    downloadURL(url, buildExportFilename(courseShort, lecture) + '.txt');
    URL.revokeObjectURL(url);
    showToast('📄 TXT downloaded');
}

function exportSegmentsAsPdf(segs, course, lecture, date) {
    const hasEN = segs.some(s => s.translation);
    const rows  = segs.map(({ time, text, translation }) => {
        const tr = translation ? `<div class="tr-en">→ ${escapeHtml(translation)}</div>` : '';
        return `<tr><td class="ts">[${time}]</td><td>${escapeHtml(text)}${tr}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>${escapeHtml(course)} – ${escapeHtml(lecture)}</title>
<style>
    @page { margin:2cm }
    body  { font-family:'Segoe UI',Arial,sans-serif; color:#1e293b; font-size:11pt }
    h1    { font-size:16pt; margin-bottom:4px }
    .meta { color:#64748b; font-size:9pt; margin-bottom:20px }
    table { width:100%; border-collapse:collapse }
    td    { padding:5px 8px; vertical-align:top; border-bottom:1px solid #e2e8f0; line-height:1.55 }
    .ts   { color:#94a3b8; font-family:monospace; font-size:9pt; white-space:nowrap; width:54px }
    .tr-en{ font-size:9.5pt; color:#3b82f6; margin-top:3px; font-style:italic }
</style></head><body>
<h1>🎓 ${escapeHtml(course)}</h1>
<p class="meta">Lecture: ${escapeHtml(lecture)} · Date: ${escapeHtml(date)} · ${segs.length} segments · Groq ${WHISPER_MODEL}${hasEN ? ' + EN' : ''}</p>
<table>${rows}</table></body></html>`;

    const win = window.open('', '_blank');
    if (!win) { showToast('⚠️ Allow pop-ups and try again'); return; }
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
    showToast('📑 PDF print dialog opened — choose "Save as PDF"');
}

function exportTxt() {
    if (segments.length === 0) { showToast('⚠️ Nothing to export yet'); return; }
    const c = getActiveCourse();
    exportSegmentsAsTxt(segments, c.id, c.short, lectureInput.value.trim() || 'Lecture', new Date().toLocaleDateString('de-DE'));
}

function exportPdf() {
    if (segments.length === 0) { showToast('⚠️ Nothing to export yet'); return; }
    const c = getActiveCourse();
    exportSegmentsAsPdf(segments, c.id, lectureInput.value.trim() || 'Lecture', new Date().toLocaleDateString('de-DE'));
}

/* ================================================================
   Library — Save / Load / Render / Delete
   ================================================================ */
function loadLibrary() {
    try { return JSON.parse(localStorage.getItem(LS_KEY_LIBRARY) || '[]'); }
    catch { return []; }
}

function saveToLibrary() {
    if (segments.length === 0) { showToast('⚠️ Nothing to save — record some audio first'); return; }
    const lib     = loadLibrary();
    const course  = getActiveCourse();
    const lecture = lectureInput.value.trim() || `Session ${lib.length + 1}`;
    const now     = new Date();
    lib.unshift({
        id:          String(now.getTime()),
        course:      course.id,
        courseShort: course.short,
        courseColor: course.color,
        lecture,
        date:        now.toLocaleDateString('de-DE'),
        savedAt:     now.toISOString(),
        segments:    segments.map(s => ({ ...s })),
    });
    localStorage.setItem(LS_KEY_LIBRARY, JSON.stringify(lib));
    showToast(`💾 Saved: ${course.id} › ${lecture}`);
}

function openLibrary() {
    libraryModal.classList.remove('hidden');
    renderLibrary(libraryFilter.value);
}

function closeLibrary() {
    libraryModal.classList.add('hidden');
}

function renderLibrary(courseFilter) {
    const lib      = loadLibrary();
    const filtered = courseFilter ? lib.filter(e => e.course === courseFilter) : lib;

    if (filtered.length === 0) {
        libraryList.innerHTML = `<p class="library-empty">No saved lectures${courseFilter ? ' for this course' : ''} yet.<br>Record a lecture and click <strong>💾 Save</strong>.</p>`;
        return;
    }

    libraryList.innerHTML = '';
    filtered.forEach(entry => {
        const hasEN = entry.segments.some(s => s.translation);
        const item  = document.createElement('div');
        item.className = 'library-item';
        item.innerHTML = `
            <div class="lib-item-header">
                <span class="lib-course-badge" style="background:${entry.courseColor}20;color:${entry.courseColor};border-color:${entry.courseColor}60">${escapeHtml(entry.courseShort || entry.course)}</span>
                <span class="lib-date">${escapeHtml(entry.date)}</span>
            </div>
            <div class="lib-lecture">${escapeHtml(entry.lecture)}</div>
            <div class="lib-meta">${entry.segments.length} segments${hasEN ? ' &nbsp;·&nbsp; 🌍 EN translation' : ''}</div>
            <div class="lib-actions">
                <button class="btn btn-export lib-txt" data-id="${entry.id}">📄 TXT</button>
                <button class="btn btn-export lib-pdf" data-id="${entry.id}">📑 PDF</button>
                <button class="btn-lib-delete" data-id="${entry.id}" title="Delete">🗑</button>
            </div>`;
        libraryList.appendChild(item);
    });

    libraryList.querySelectorAll('.lib-txt').forEach(btn =>
        btn.addEventListener('click', () => {
            const e = loadLibrary().find(x => x.id === btn.dataset.id);
            if (e) exportSegmentsAsTxt(e.segments, e.course, e.courseShort, e.lecture, e.date);
        })
    );
    libraryList.querySelectorAll('.lib-pdf').forEach(btn =>
        btn.addEventListener('click', () => {
            const e = loadLibrary().find(x => x.id === btn.dataset.id);
            if (e) exportSegmentsAsPdf(e.segments, e.course, e.lecture, e.date);
        })
    );
    libraryList.querySelectorAll('.btn-lib-delete').forEach(btn =>
        btn.addEventListener('click', () => {
            const lib = loadLibrary().filter(x => x.id !== btn.dataset.id);
            localStorage.setItem(LS_KEY_LIBRARY, JSON.stringify(lib));
            renderLibrary(libraryFilter.value);
            showToast('🗑 Deleted');
        })
    );
}

/* ================================================================
   Theme
   ================================================================ */
function toggleTheme() {
    darkMode = !darkMode;
    document.body.classList.toggle('dark-mode',  darkMode);
    document.body.classList.toggle('light-mode', !darkMode);
    themeIcon.textContent = darkMode ? '☀️' : '🌙';
    localStorage.setItem(LS_KEY_THEME, darkMode ? 'dark' : 'light');
}

function loadTheme() {
    if (localStorage.getItem(LS_KEY_THEME) === 'dark') {
        darkMode = true;
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
        themeIcon.textContent = '☀️';
    }
}

/* ================================================================
   Utilities
   ================================================================ */
function highlightKeywords(html) {
    KEYWORDS.forEach(({ pattern, cls }) => {
        pattern.lastIndex = 0;
        html = html.replace(pattern, m => `<span class="${cls}">${m}</span>`);
    });
    return html;
}

function escapeHtml(t) {
    return String(t)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getTimestamp() {
    return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function dateFilename() {
    const d = new Date();
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
        '_',
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0'),
    ].join('');
}

function downloadURL(url, filename) {
    const a = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

let toastTimer = null;
function showToast(msg, ms = 3200) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), ms);
}

/* ================================================================
   Event Listeners
   ================================================================ */
saveKeyBtn.addEventListener('click',  saveApiKey);
changeKeyBtn.addEventListener('click', clearApiKey);
apiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveApiKey(); });

srcMicBtn.addEventListener('click',    () => setAudioMode('mic'));
srcTeamsBtn.addEventListener('click',  () => setAudioMode('screen'));
noiseCleanBtn.addEventListener('click', toggleNoiseClean);
translateBtn.addEventListener('click',  toggleTranslate);

startBtn.addEventListener('click',    startRecording);
stopBtn.addEventListener('click',     stopRecording);
clearBtn.addEventListener('click',    clearTranscript);
copyBtn.addEventListener('click',     copyAll);
saveLibBtn.addEventListener('click',  saveToLibrary);
exportTxtBtn.addEventListener('click', exportTxt);
exportPdfBtn.addEventListener('click', exportPdf);
themeToggle.addEventListener('click', toggleTheme);

libraryBtn.addEventListener('click',     openLibrary);
libraryClose.addEventListener('click',   closeLibrary);
libraryOverlay.addEventListener('click', closeLibrary);
libraryFilter.addEventListener('change', () => renderLibrary(libraryFilter.value));

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space')                        { e.preventDefault(); isRecording ? stopRecording() : startRecording(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); clearTranscript(); }
    if (e.key === 'Escape')                         closeLibrary();
});

/* ================================================================
   Init
   ================================================================ */
(function init() {
    loadTheme();
    loadApiKey();
    console.info(
        '%cTranscripter – Groq Whisper + LLaMA\n%cSpace = Start/Stop  |  Ctrl+K = Clear  |  Esc = Close library',
        'font-size:13px;font-weight:bold;color:#3b82f6;',
        'font-size:11px;color:#64748b;'
    );
})();
