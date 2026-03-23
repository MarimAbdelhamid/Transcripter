/**
 * Transcripter – Live German Lecture Transcriber
 * script.js
 *
 * Features:
 *  - Web Speech API (de-DE) continuous mode with interim results
 *  - Pause-based sentence detection via final results + inactivity timer
 *  - Automatic punctuation (capitalisation + period on sentence end)
 *  - Keyword highlighting for common German academic terms
 *  - Timestamp per sentence
 *  - Auto-scroll with "new sentence" flash
 *  - Export: .txt and .pdf (via print dialog)
 *  - Copy all to clipboard
 *  - Dark / Light mode toggle
 *  - Toast notifications
 */

'use strict';

/* ================================================================
   DOM References
   ================================================================ */
const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const clearBtn        = document.getElementById('clearBtn');
const copyBtn         = document.getElementById('copyBtn');
const exportTxtBtn    = document.getElementById('exportTxt');
const exportPdfBtn    = document.getElementById('exportPdf');
const themeToggle     = document.getElementById('themeToggle');
const themeIcon       = document.getElementById('themeIcon');
const transcriptEl    = document.getElementById('transcript');
const interimBox      = document.getElementById('interimBox');
const interimTextEl   = document.getElementById('interimText');
const statusTextEl    = document.getElementById('statusText');
const pulseRing       = document.getElementById('pulseRing');
const sentenceCount   = document.getElementById('sentenceCount');
const toast           = document.getElementById('toast');

/* ================================================================
   State
   ================================================================ */
let recognition       = null;   // SpeechRecognition instance
let isRecording       = false;
let sentences         = [];     // Array of { text, time } – the full transcript
let pendingText       = '';     // Accumulated text not yet committed to a sentence
let inactivityTimer   = null;   // Timer: commit pendingText after silence
let restartTimer      = null;   // Auto-restart on unexpected stop
let darkMode          = false;

// Inactivity threshold: commit a new sentence after N ms of silence
const INACTIVITY_MS = 1800;

/* ================================================================
   Keyword Definitions
   Words are matched case-insensitively; spans receive a CSS class.
   ================================================================ */
const KEYWORDS = [
    { pattern: /\b(Definition|definiert|definieren)\b/gi, cls: 'kw-definition' },
    { pattern: /\b(Wichtig|wichtige[rns]?|Achtung|Hinweis)\b/gi,    cls: 'kw-wichtig'    },
    { pattern: /\b(Beispiel|beispielsweise|zum Beispiel|z\.B\.)\b/gi, cls: 'kw-beispiel'  },
    { pattern: /\b(Theorem|Satz|Korollar|Lemma|Beweis)\b/gi,         cls: 'kw-theorem'    },
    { pattern: /\b(Merke|Fazit|Zusammenfassung|Schluss)\b/gi,        cls: 'kw-merke'      },
    { pattern: /\b(Aufgabe|Übung|Hausaufgabe)\b/gi,                  cls: 'kw-aufgabe'    },
];

/* ================================================================
   Speech Recognition Setup
   ================================================================ */
function createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        showToast('❌ Web Speech API not supported. Use Google Chrome.');
        startBtn.disabled = true;
        return null;
    }

    const rec = new SpeechRecognition();
    rec.lang              = 'de-DE';   // German (Germany)
    rec.continuous        = true;      // Keep listening until manually stopped
    rec.interimResults    = true;      // Show partial results live
    rec.maxAlternatives   = 1;

    /* ---------- onresult ---------- */
    rec.onresult = (event) => {
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text   = result[0].transcript;

            if (result.isFinal) {
                // Accumulate final words into pendingText
                pendingText += (pendingText ? ' ' : '') + text.trim();

                // Reset inactivity timer: commit sentence after silence
                resetInactivityTimer();

            } else {
                interimTranscript += text;
            }
        }

        // Show live interim text
        if (interimTranscript.trim()) {
            interimBox.classList.remove('hidden');
            interimTextEl.textContent = interimTranscript;
        } else if (!pendingText) {
            interimTextEl.textContent = '';
        }
    };

    /* ---------- onerror ---------- */
    rec.onerror = (event) => {
        // 'no-speech' is normal during pauses – ignore it
        if (event.error === 'no-speech') return;

        console.warn('SpeechRecognition error:', event.error);

        if (event.error === 'not-allowed') {
            showToast('🎤 Microphone access denied. Please allow access.');
            stopRecording(false);
            return;
        }

        if (event.error === 'network') {
            showToast('⚠️ Network error – retrying…');
        }
    };

    /* ---------- onend ---------- */
    // The browser may stop recognition unexpectedly; restart if still recording.
    rec.onend = () => {
        if (isRecording) {
            // Commit any pending text before restart
            commitPending();

            // Brief delay then restart
            restartTimer = setTimeout(() => {
                if (isRecording) {
                    try { rec.start(); } catch (_) { /* already started */ }
                }
            }, 300);
        }
    };

    return rec;
}

/* ================================================================
   Inactivity Timer  – commits pendingText as a sentence
   ================================================================ */
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(commitPending, INACTIVITY_MS);
}

function commitPending() {
    clearTimeout(inactivityTimer);
    if (!pendingText.trim()) return;

    const raw       = pendingText.trim();
    const formatted = formatSentence(raw);
    addSentence(formatted);

    pendingText = '';
    interimTextEl.textContent = '';
    interimBox.classList.add('hidden');
}

/* ================================================================
   Text Formatting
   ================================================================ */

/**
 * Capitalise first letter, ensure trailing punctuation.
 */
function formatSentence(text) {
    if (!text) return text;

    // Capitalise first character
    let result = text.charAt(0).toUpperCase() + text.slice(1);

    // Add period if sentence doesn't end with punctuation
    if (!/[.!?,;:]$/.test(result.trimEnd())) {
        result = result.trimEnd() + '.';
    }

    return result;
}

/**
 * Wrap matched keywords in <span> with appropriate CSS class.
 * Operates on HTML (XSS-safe because we escape before calling this).
 */
function highlightKeywords(html) {
    KEYWORDS.forEach(({ pattern, cls }) => {
        // Reset lastIndex (regex is stateful when using 'g')
        pattern.lastIndex = 0;
        html = html.replace(pattern, (match) =>
            `<span class="${cls}">${match}</span>`
        );
    });
    return html;
}

/**
 * Escape HTML entities to prevent XSS when setting innerHTML.
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ================================================================
   Transcript Rendering
   ================================================================ */

/**
 * Add a finalised sentence to the transcript.
 */
function addSentence(text) {
    if (!text.trim()) return;

    const time = getTimestamp();
    sentences.push({ text, time });

    // Remove placeholder if present
    const placeholder = transcriptEl.querySelector('.placeholder-msg');
    if (placeholder) placeholder.remove();

    // Build sentence element
    const div = document.createElement('div');
    div.className = 'sentence new-sentence';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'sentence-time';
    timeSpan.textContent = time;

    const textSpan = document.createElement('span');
    textSpan.className = 'sentence-text';
    textSpan.innerHTML = highlightKeywords(escapeHtml(text));

    div.appendChild(timeSpan);
    div.appendChild(textSpan);
    transcriptEl.appendChild(div);

    // Remove "new" highlight after 1.5 s
    setTimeout(() => div.classList.remove('new-sentence'), 1500);

    // Auto-scroll to bottom
    transcriptEl.scrollTop = transcriptEl.scrollHeight;

    // Update sentence counter
    sentenceCount.textContent = `${sentences.length} sentence${sentences.length === 1 ? '' : 's'}`;
}

/**
 * Re-render all sentences (used after clear + undo, if needed in future).
 */
function renderAll() {
    transcriptEl.innerHTML = '';
    if (sentences.length === 0) {
        transcriptEl.innerHTML = `<p class="placeholder-msg">Click <strong>Start</strong> to begin recording your German lecture.<br>Speak clearly — transcription appears in real time.</p>`;
        sentenceCount.textContent = '0 sentences';
        return;
    }
    sentences.forEach(({ text, time }) => {
        const div = document.createElement('div');
        div.className = 'sentence';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'sentence-time';
        timeSpan.textContent = time;

        const textSpan = document.createElement('span');
        textSpan.className = 'sentence-text';
        textSpan.innerHTML = highlightKeywords(escapeHtml(text));

        div.appendChild(timeSpan);
        div.appendChild(textSpan);
        transcriptEl.appendChild(div);
    });
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    sentenceCount.textContent = `${sentences.length} sentence${sentences.length === 1 ? '' : 's'}`;
}

/* ================================================================
   Recording Controls
   ================================================================ */
function startRecording() {
    if (isRecording) return;

    if (!recognition) {
        recognition = createRecognition();
        if (!recognition) return;
    }

    try {
        recognition.start();
    } catch (err) {
        console.warn('Recognition start error:', err);
        return;
    }

    isRecording = true;
    setUIRecording(true);
    showToast('🎤 Recording started – speak in German');
}

function stopRecording(showNotification = true) {
    if (!isRecording) return;

    isRecording = false;
    clearTimeout(inactivityTimer);
    clearTimeout(restartTimer);

    // Commit any lingering pending text
    commitPending();

    try { recognition.stop(); } catch (_) { /* ignore */ }

    interimTextEl.textContent = '';
    interimBox.classList.add('hidden');

    setUIRecording(false);
    if (showNotification) showToast('⏹ Recording stopped');
}

function clearTranscript() {
    sentences   = [];
    pendingText = '';

    interimTextEl.textContent = '';
    interimBox.classList.add('hidden');

    renderAll();
    showToast('🗑 Transcript cleared');
}

/* ================================================================
   UI State Helper
   ================================================================ */
function setUIRecording(recording) {
    startBtn.disabled = recording;
    stopBtn.disabled  = !recording;

    if (recording) {
        statusTextEl.textContent = 'Listening… speak now';
        pulseRing.classList.remove('hidden');
    } else {
        statusTextEl.textContent = isRecording ? 'Listening…' : 'Ready to transcribe';
        pulseRing.classList.add('hidden');
    }
}

/* ================================================================
   Export – TXT
   ================================================================ */
function exportTxt() {
    if (sentences.length === 0) {
        showToast('⚠️ Nothing to export yet');
        return;
    }

    const lines = sentences.map(({ time, text }) => `[${time}]  ${text}`);
    const header = [
        'German Lecture Transcript',
        `Generated: ${new Date().toLocaleString('de-DE')}`,
        '─'.repeat(50),
        '',
    ];

    const content  = [...header, ...lines].join('\n');
    const blob     = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url      = URL.createObjectURL(blob);
    const filename = `transcript_${dateFilename()}.txt`;

    downloadURL(url, filename);
    URL.revokeObjectURL(url);
    showToast('📄 TXT downloaded');
}

/* ================================================================
   Export – PDF  (opens print dialog; user saves as PDF)
   ================================================================ */
function exportPdf() {
    if (sentences.length === 0) {
        showToast('⚠️ Nothing to export yet');
        return;
    }

    const rows = sentences.map(({ time, text }) => `
        <tr>
            <td class="ts">[${time}]</td>
            <td>${escapeHtml(text)}</td>
        </tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>German Lecture Transcript</title>
<style>
    @page { margin: 2cm; }
    body   { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 11pt; }
    h1     { font-size: 16pt; margin-bottom: 4px; }
    .meta  { color: #64748b; font-size: 9pt; margin-bottom: 20px; }
    table  { width: 100%; border-collapse: collapse; }
    td     { padding: 5px 8px; vertical-align: top; border-bottom: 1px solid #e2e8f0; line-height: 1.5; }
    .ts    { color: #94a3b8; font-family: monospace; font-size: 9pt; white-space: nowrap; width: 54px; }
</style>
</head>
<body>
<h1>🎓 German Lecture Transcript</h1>
<p class="meta">Generated: ${new Date().toLocaleString('de-DE')} · ${sentences.length} sentences · Language: de-DE</p>
<table>${rows}</table>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) {
        showToast('⚠️ Allow pop-ups and try again');
        return;
    }
    win.document.write(html);
    win.document.close();

    // Small delay so the browser renders before print dialog opens
    win.onload = () => win.print();
    showToast('📑 PDF print dialog opened – save as PDF');
}

/* ================================================================
   Copy to Clipboard
   ================================================================ */
function copyAll() {
    if (sentences.length === 0) {
        showToast('⚠️ Nothing to copy yet');
        return;
    }

    const text = sentences.map(({ time, text }) => `[${time}] ${text}`).join('\n');

    navigator.clipboard.writeText(text).then(() => {
        showToast('📋 Copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity  = '0';
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
    document.body.classList.toggle('dark-mode', darkMode);
    document.body.classList.toggle('light-mode', !darkMode);
    themeIcon.textContent = darkMode ? '☀️' : '🌙';
    localStorage.setItem('transcripter-theme', darkMode ? 'dark' : 'light');
}

function loadTheme() {
    const saved = localStorage.getItem('transcripter-theme');
    if (saved === 'dark') {
        darkMode = true;
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
        themeIcon.textContent = '☀️';
    }
}

/* ================================================================
   Utility Functions
   ================================================================ */

/** Format current time as HH:MM:SS */
function getTimestamp() {
    return new Date().toLocaleTimeString('de-DE', {
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/** Date string suitable for filenames */
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

/** Trigger a file download from a URL */
function downloadURL(url, filename) {
    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/* ================================================================
   Toast Notification
   ================================================================ */
let toastTimer = null;

function showToast(message, duration = 2800) {
    toast.textContent = message;
    toast.classList.remove('hidden');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

/* ================================================================
   Event Listeners
   ================================================================ */
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click',  () => stopRecording(true));
clearBtn.addEventListener('click', clearTranscript);
copyBtn.addEventListener('click',  copyAll);
exportTxtBtn.addEventListener('click', exportTxt);
exportPdfBtn.addEventListener('click', exportPdf);
themeToggle.addEventListener('click', toggleTheme);

/* Keyboard shortcuts */
document.addEventListener('keydown', (e) => {
    // Space bar = toggle recording (only when not focused on a button)
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        isRecording ? stopRecording(true) : startRecording();
    }
    // Ctrl/Cmd + K = clear
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        clearTranscript();
    }
});

/* ================================================================
   Initialisation
   ================================================================ */
(function init() {
    loadTheme();

    // Check API availability immediately and disable start if unsupported
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        statusTextEl.textContent = 'Web Speech API not supported';
        startBtn.disabled = true;
        showToast('❌ Please use Google Chrome for speech recognition', 6000);
    }

    console.info(
        '%cTranscripter – Live German Lecture Transcriber\n%cShortcuts: Space = Start/Stop  |  Ctrl+K = Clear',
        'font-size:14px; font-weight:bold; color:#3b82f6;',
        'font-size:11px; color:#64748b;'
    );
})();
