/**
 * Transcripter – Live German Lecture Transcriber
 * script.js  |  Groq + Whisper Large v3 edition
 *
 * Flow:
 *  1. User saves Groq API key (stored in localStorage, never in code)
 *  2. On Start: getUserMedia → MediaRecorder
 *  3. Every CHUNK_DURATION ms: stop recorder → send audio blob to Groq Whisper API
 *  4. Groq returns accurate German text → render segment with timestamp + keyword highlights
 *  5. Repeat until user clicks Stop
 */

'use strict';

/* ================================================================
   Constants
   ================================================================ */
const GROQ_API_URL    = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL   = 'whisper-large-v3';
const CHUNK_DURATION  = 15000;   // ms per audio chunk sent to Groq
const MIN_BLOB_BYTES  = 2000;    // skip chunks that are too small (silence)
const LS_KEY_API      = 'transcripter-groq-key';
const LS_KEY_THEME    = 'transcripter-theme';

// Whisper prompt: primes the model with academic German vocabulary for better accuracy
const WHISPER_PROMPT  =
    'Vorlesung, Universität, Definition, Theorem, Satz, Beweis, Beispiel, ' +
    'Aufgabe, Lösung, Wichtig, Merke, Fazit, Zusammenfassung, Semester, ' +
    'Korollar, Lemma, Algorithmus, Funktion, Variable, Gleichung.';

/* ================================================================
   DOM References
   ================================================================ */
const apiKeyCard        = document.getElementById('apiKeyCard');
const apiKeyInput       = document.getElementById('apiKeyInput');
const saveKeyBtn        = document.getElementById('saveKeyBtn');
const apiKeyBanner      = document.getElementById('apiKeyBanner');
const changeKeyBtn      = document.getElementById('changeKeyBtn');

const startBtn          = document.getElementById('startBtn');
const stopBtn           = document.getElementById('stopBtn');
const clearBtn          = document.getElementById('clearBtn');
const copyBtn           = document.getElementById('copyBtn');
const exportTxtBtn      = document.getElementById('exportTxt');
const exportPdfBtn      = document.getElementById('exportPdf');
const themeToggle       = document.getElementById('themeToggle');
const themeIcon         = document.getElementById('themeIcon');

const transcriptEl      = document.getElementById('transcript');
const processingBar     = document.getElementById('processingBar');
const statusTextEl      = document.getElementById('statusText');
const pulseRing         = document.getElementById('pulseRing');
const sentenceCount     = document.getElementById('sentenceCount');
const chunkProgressWrap = document.getElementById('chunkProgressWrap');
const chunkProgressBar  = document.getElementById('chunkProgressBar');
const chunkLabel        = document.getElementById('chunkLabel');
const chunkTimerEl      = document.getElementById('chunkTimer');
const toast             = document.getElementById('toast');

/* ================================================================
   State
   ================================================================ */
let apiKey          = '';
let isRecording     = false;
let mediaRecorder   = null;
let audioStream     = null;
let currentChunks   = [];
let chunkTimer      = null;
let progressTimer   = null;       // drives the progress bar UI
let chunkStart      = 0;          // timestamp when current chunk started
let segments        = [];         // [{text, time}] – full transcript
let darkMode        = false;
let processingCount = 0;          // how many chunks currently being processed

/* ================================================================
   Keyword Definitions
   ================================================================ */
const KEYWORDS = [
    { pattern: /\b(Definition|definiert|definieren)\b/gi,              cls: 'kw-definition' },
    { pattern: /\b(Wichtig|wichtige[rns]?|Achtung|Hinweis)\b/gi,      cls: 'kw-wichtig'    },
    { pattern: /\b(Beispiel|beispielsweise|zum\s+Beispiel|z\.B\.)\b/gi, cls: 'kw-beispiel'  },
    { pattern: /\b(Theorem|Satz|Korollar|Lemma|Beweis)\b/gi,           cls: 'kw-theorem'    },
    { pattern: /\b(Merke|Fazit|Zusammenfassung|Schluss)\b/gi,          cls: 'kw-merke'      },
    { pattern: /\b(Aufgabe|Übung|Hausaufgabe)\b/gi,                    cls: 'kw-aufgabe'    },
];

/* ================================================================
   API Key Management
   ================================================================ */
function loadApiKey() {
    apiKey = localStorage.getItem(LS_KEY_API) || '';
    if (apiKey) {
        showKeyBanner();
    } else {
        showKeyCard();
    }
}

function saveApiKey() {
    const val = apiKeyInput.value.trim();
    if (!val.startsWith('gsk_') || val.length < 20) {
        showToast('⚠️ That doesn\'t look like a valid Groq key (should start with gsk_)');
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
   Recording — MediaRecorder + Groq
   ================================================================ */
async function startRecording() {
    if (isRecording) return;
    if (!apiKey) { showToast('⚠️ Please save your Groq API key first'); return; }

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
        showToast('🎤 Microphone access denied — please allow it in browser settings');
        return;
    }

    // Pick a supported MIME type (Chrome: webm/opus; fallback to default)
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : '';

    mediaRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) currentChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
        const blob = new Blob(currentChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        currentChunks = [];

        if (blob.size >= MIN_BLOB_BYTES) {
            await transcribeChunk(blob);
        }

        // Start next chunk immediately if still recording
        if (isRecording) startChunk();
    };

    isRecording = true;
    setUIRecording(true);
    startChunk();
    showToast('🎤 Recording started — speaking every 15 s will be transcribed');
}

function startChunk() {
    currentChunks = [];
    chunkStart    = Date.now();

    mediaRecorder.start();
    updateChunkProgress();   // kick off the progress bar

    chunkTimer = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();   // triggers onstop → transcribeChunk → startChunk
        }
    }, CHUNK_DURATION);
}

function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    clearTimeout(chunkTimer);
    clearInterval(progressTimer);

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();   // will still transcribe the final partial chunk
    }

    // Stop all mic tracks
    if (audioStream) {
        audioStream.getTracks().forEach(t => t.stop());
        audioStream = null;
    }

    chunkProgressWrap.classList.add('hidden');
    setUIRecording(false);
    showToast('⏹ Recording stopped — final chunk is being processed');
}

/* ================================================================
   Groq Whisper API Call
   ================================================================ */
async function transcribeChunk(blob) {
    processingCount++;
    updateProcessingBar();

    const formData = new FormData();
    // Groq needs a filename with extension to detect format
    const ext      = (blob.type.includes('ogg') ? 'ogg' : 'webm');
    formData.append('file',            blob, `chunk.${ext}`);
    formData.append('model',           WHISPER_MODEL);
    formData.append('language',        'de');           // German
    formData.append('response_format', 'text');         // plain text response
    formData.append('prompt',          WHISPER_PROMPT); // academic German context

    try {
        const response = await fetch(GROQ_API_URL, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body:    formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const msg = err?.error?.message || `HTTP ${response.status}`;

            if (response.status === 401) {
                showToast('❌ Invalid API key — please check and update it');
                stopRecording();
            } else {
                showToast(`⚠️ Groq error: ${msg}`);
            }
            return;
        }

        const text = (await response.text()).trim();
        if (text) addSegment(text);

    } catch (err) {
        console.error('Transcription fetch error:', err);
        showToast('⚠️ Network error — check your connection');
    } finally {
        processingCount--;
        updateProcessingBar();
    }
}

/* ================================================================
   Transcript Rendering
   ================================================================ */
function addSegment(text) {
    const time = getTimestamp();
    segments.push({ text, time });

    // Remove placeholder
    const ph = transcriptEl.querySelector('.placeholder-msg');
    if (ph) ph.remove();

    const div = document.createElement('div');
    div.className = 'segment new-segment';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'segment-time';
    timeSpan.textContent = time;

    const textSpan = document.createElement('span');
    textSpan.className = 'segment-text';
    textSpan.innerHTML = highlightKeywords(escapeHtml(text));

    div.appendChild(timeSpan);
    div.appendChild(textSpan);
    transcriptEl.appendChild(div);

    // Remove "new" highlight after 2 s
    setTimeout(() => div.classList.remove('new-segment'), 2000);

    // Auto-scroll
    transcriptEl.scrollTop = transcriptEl.scrollHeight;

    // Update counter
    sentenceCount.textContent = `${segments.length} segment${segments.length === 1 ? '' : 's'}`;
}

function renderAll() {
    transcriptEl.innerHTML = '';
    if (segments.length === 0) {
        transcriptEl.innerHTML = `<p class="placeholder-msg">Save your Groq API key above, then click <strong>Start</strong>.<br>Audio is sent to Groq every 15 seconds and transcribed in German.</p>`;
        sentenceCount.textContent = '0 segments';
        return;
    }
    segments.forEach(({ text, time }) => {
        const div = document.createElement('div');
        div.className = 'segment';
        const ts = document.createElement('span');
        ts.className = 'segment-time';
        ts.textContent = time;
        const tx = document.createElement('span');
        tx.className = 'segment-text';
        tx.innerHTML = highlightKeywords(escapeHtml(text));
        div.appendChild(ts);
        div.appendChild(tx);
        transcriptEl.appendChild(div);
    });
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
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

    statusTextEl.textContent = recording
        ? 'Recording — chunk sent every 15 s'
        : 'Ready to transcribe';
}

function updateProcessingBar() {
    if (processingCount > 0) {
        processingBar.classList.remove('hidden');
    } else {
        processingBar.classList.add('hidden');
    }
}

/* Animates the chunk progress bar from 0 → 100% over CHUNK_DURATION */
function updateChunkProgress() {
    clearInterval(progressTimer);
    chunkProgressBar.style.width = '0%';
    chunkLabel.textContent = 'Recording chunk…';

    progressTimer = setInterval(() => {
        const elapsed = Date.now() - chunkStart;
        const pct     = Math.min((elapsed / CHUNK_DURATION) * 100, 100);
        const secs    = Math.floor(elapsed / 1000);

        chunkProgressBar.style.width = pct + '%';
        chunkTimerEl.textContent = `${secs}s / ${CHUNK_DURATION / 1000}s`;

        if (pct >= 100) {
            chunkLabel.textContent = 'Sending to Groq…';
            clearInterval(progressTimer);
        }
    }, 200);
}

/* ================================================================
   Text Helpers
   ================================================================ */
function highlightKeywords(html) {
    KEYWORDS.forEach(({ pattern, cls }) => {
        pattern.lastIndex = 0;
        html = html.replace(pattern, (m) => `<span class="${cls}">${m}</span>`);
    });
    return html;
}

function escapeHtml(t) {
    return t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ================================================================
   Clear
   ================================================================ */
function clearTranscript() {
    segments = [];
    renderAll();
    showToast('🗑 Transcript cleared');
}

/* ================================================================
   Export – TXT
   ================================================================ */
function exportTxt() {
    if (segments.length === 0) { showToast('⚠️ Nothing to export yet'); return; }

    const header = [
        'German Lecture Transcript',
        `Generated: ${new Date().toLocaleString('de-DE')}`,
        `Model: Groq ${WHISPER_MODEL} · Language: de`,
        '─'.repeat(50),
        '',
    ];
    const lines  = segments.map(({ time, text }) => `[${time}]  ${text}`);
    const blob   = new Blob([[...header, ...lines].join('\n')], { type: 'text/plain;charset=utf-8' });
    const url    = URL.createObjectURL(blob);

    downloadURL(url, `transcript_${dateFilename()}.txt`);
    URL.revokeObjectURL(url);
    showToast('📄 TXT downloaded');
}

/* ================================================================
   Export – PDF  (print dialog)
   ================================================================ */
function exportPdf() {
    if (segments.length === 0) { showToast('⚠️ Nothing to export yet'); return; }

    const rows = segments.map(({ time, text }) =>
        `<tr><td class="ts">[${time}]</td><td>${escapeHtml(text)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Lecture Transcript</title>
<style>
    @page { margin: 2cm; }
    body  { font-family:'Segoe UI',Arial,sans-serif; color:#1e293b; font-size:11pt; }
    h1    { font-size:16pt; margin-bottom:4px; }
    .meta { color:#64748b; font-size:9pt; margin-bottom:20px; }
    table { width:100%; border-collapse:collapse; }
    td    { padding:5px 8px; vertical-align:top; border-bottom:1px solid #e2e8f0; line-height:1.55; }
    .ts   { color:#94a3b8; font-family:monospace; font-size:9pt; white-space:nowrap; width:54px; }
</style></head><body>
<h1>🎓 German Lecture Transcript</h1>
<p class="meta">Generated: ${new Date().toLocaleString('de-DE')} · ${segments.length} segments · Groq ${WHISPER_MODEL}</p>
<table>${rows}</table>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) { showToast('⚠️ Allow pop-ups and try again'); return; }
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
    showToast('📑 PDF print dialog opened — choose "Save as PDF"');
}

/* ================================================================
   Copy to Clipboard
   ================================================================ */
function copyAll() {
    if (segments.length === 0) { showToast('⚠️ Nothing to copy yet'); return; }

    const text = segments.map(({ time, text }) => `[${time}] ${text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast('📋 Copied to clipboard!');
    }).catch(() => {
        // Fallback
        const ta = Object.assign(document.createElement('textarea'), {
            value: text, style: 'position:fixed;opacity:0'
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋 Copied to clipboard!');
    });
}

/* ================================================================
   Theme Toggle
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
   Utility
   ================================================================ */
function getTimestamp() {
    return new Date().toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function dateFilename() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0'),
            '_', String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0')].join('');
}

function downloadURL(url, filename) {
    const a = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/* ================================================================
   Toast
   ================================================================ */
let toastTimer = null;
function showToast(msg, ms = 3000) {
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
apiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveApiKey(); });

startBtn.addEventListener('click',    startRecording);
stopBtn.addEventListener('click',     stopRecording);
clearBtn.addEventListener('click',    clearTranscript);
copyBtn.addEventListener('click',     copyAll);
exportTxtBtn.addEventListener('click', exportTxt);
exportPdfBtn.addEventListener('click', exportPdf);
themeToggle.addEventListener('click', toggleTheme);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space')                       { e.preventDefault(); isRecording ? stopRecording() : startRecording(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); clearTranscript(); }
});

/* ================================================================
   Init
   ================================================================ */
(function init() {
    loadTheme();
    loadApiKey();

    console.info(
        '%cTranscripter – Groq Whisper Large v3\n%cSpace = Start/Stop  |  Ctrl+K = Clear',
        'font-size:13px;font-weight:bold;color:#3b82f6;',
        'font-size:11px;color:#64748b;'
    );
})();
