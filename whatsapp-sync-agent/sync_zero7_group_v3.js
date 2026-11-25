/**
 * Zero7 CRM - WhatsApp Group Synchronizer v3
 * Features:
 *  - Two-way lead matching (Audio followed by lead name OR Lead name followed by audio)
 *  - Strict CRM deduplication (checks existing calls & notes before inserting)
 *  - Automatic audio download & CRM upload with Deepgram auto-transcription
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CRM_URL = 'https://cos.zero7.space';
const CRM_EMAIL = 'abhijeet@zero7.space';
const CRM_PASSWORD = 'admin123';
const TARGET_GROUP_ID = '120363426285521103@g.us';

// Use auth_personal which is verified and connected
const AUTH_DIR = path.join(__dirname, 'auth_personal');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const logger = pino({ level: 'silent' });

let crmToken = null;
let crmLeads = [];
const processedMsgIds = new Set();
let existingAudiosByLead = new Set(); // lead_id set
let existingNotesByLead = new Map();  // lead_id -> Set of note content snippets

// Buffer for audios waiting for lead name: [{ msg, time, sender, mimeType }]
let pendingAudios = [];
let lastContextLead = null;
let lastContextTime = 0;

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);
        const reqOpts = {
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https') ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
        };
        const req = mod.request(reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function crmLogin() {
    try {
        const resp = await httpRequest(`${CRM_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: CRM_EMAIL, password: CRM_PASSWORD })
        });
        crmToken = resp.data.token;
        console.log('[CRM] Logged in successfully');
        return true;
    } catch (e) {
        console.error('[CRM] Login failed:', e.message);
        return false;
    }
}

async function loadCRMInventory() {
    try {
        const resp = await httpRequest(`${CRM_URL}/api/leads`, {
            headers: { 'Authorization': `Bearer ${crmToken}` }
        });
        crmLeads = resp.data || [];
        console.log(`[CRM] Loaded ${crmLeads.length} leads`);

        existingAudiosByLead.clear();
        existingNotesByLead.clear();

        // Load activities for all leads to prevent any duplicate sync
        for (const l of crmLeads) {
            const detailResp = await httpRequest(`${CRM_URL}/api/leads/${l.id}`, {
                headers: { 'Authorization': `Bearer ${crmToken}` }
            });
            const acts = detailResp.data?.activity || [];
            const callsWithAudio = acts.filter(a => a.type === 'call' && a.recording_file_name);
            if (callsWithAudio.length > 0) {
                existingAudiosByLead.add(l.id);
            }
            const notes = acts.filter(a => a.type === 'note');
            const noteSnippets = new Set(notes.map(n => (n.notes || '').substring(0, 40).toLowerCase()));
            existingNotesByLead.set(l.id, noteSnippets);
        }
        console.log(`[CRM] Inventory loaded: ${existingAudiosByLead.size} leads have existing audio recordings`);
        return true;
    } catch (e) {
        console.error('[CRM] Failed to load inventory:', e.message);
        return false;
    }
}

function normalizePhone(phone) {
    if (!phone) return '';
    const digits = phone.replace(/[^0-9]/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
}

function findLead(text) {
    if (!text) return null;
    const clean = text.toLowerCase();

    // 1. Phone number match
    const phones = text.match(/(?:\+?91)?[\s-]?(\d{10})/g);
    if (phones) {
        for (const p of phones) {
            const norm = normalizePhone(p);
            const found = crmLeads.find(l => normalizePhone(l.phone) === norm);
            if (found) return found;
        }
    }

    // 2. Exact or partial full name match
    for (const lead of crmLeads) {
        if (lead.name && lead.name.length >= 3) {
            const lName = lead.name.toLowerCase();
            if (clean.includes(lName)) return lead;
            
            // First name + last name check (ignore common stop words)
            const parts = lName.split(/\s+/).filter(p => p.length >= 4);
            for (const part of parts) {
                if (['kumar', 'sharma', 'singh', 'patil', 'shah', 'gupta', 'lead'].includes(part)) continue;
                if (clean.includes(part)) return lead;
            }
        }
    }
    return null;
}

async function uploadAudio(lead, msg, sender, timeStr, customNote) {
    if (existingAudiosByLead.has(lead.id)) {
        console.log(`[DEDUP SKIP] Lead ${lead.name} already has an audio recording in CRM.`);
        return false;
    }

    console.log(`[DOWNLOAD] Downloading audio for ${lead.name}...`);
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
        const mime = msg.message?.audioMessage?.mimetype || 'audio/mp4';
        const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'mp3';
        const cleanName = lead.name.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `wa_${cleanName}_${Date.now()}.${ext}`;
        const filePath = path.join(DOWNLOADS_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
        console.log(`[SAVED] ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

        // Upload to CRM
        const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
        let body = '';
        body += `--${boundary}\r\nContent-Disposition: form-data; name="outcome"\r\n\r\nConnected\r\n`;
        body += `--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n${customNote || `WhatsApp call recording from ${sender} in Zero7 group [${timeStr}]`}\r\n`;
        body += `--${boundary}\r\nContent-Disposition: form-data; name="duration_minutes"\r\n\r\n5\r\n`;
        body += `--${boundary}\r\nContent-Disposition: form-data; name="recording"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`;

        const bodyStart = Buffer.from(body, 'utf8');
        const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const fullBody = Buffer.concat([bodyStart, buffer, bodyEnd]);

        const urlObj = new URL(`${CRM_URL}/api/leads/${lead.id}/calls`);
        await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${crmToken}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': fullBody.length,
                }
            }, (res) => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    console.log(`[CRM] Uploaded recording to ${lead.name} (HTTP ${res.statusCode}) - auto-transcription queued!`);
                    existingAudiosByLead.add(lead.id);
                    resolve(d);
                });
            });
            req.on('error', reject);
            req.write(fullBody);
            req.end();
        });
        return true;
    } catch (err) {
        console.error(`[ERROR] Audio upload failed: ${err.message}`);
        return false;
    }
}

async function addNote(lead, text, sender, timeStr) {
    const existing = existingNotesByLead.get(lead.id) || new Set();
    const snippet = text.substring(0, 40).toLowerCase();
    if (existing.has(snippet)) {
        console.log(`[DEDUP SKIP] Note already exists for ${lead.name}`);
        return false;
    }

    try {
        await httpRequest(`${CRM_URL}/api/leads/${lead.id}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${crmToken}` },
            body: JSON.stringify({ content: `[WhatsApp Zero7 Group - ${sender} (${timeStr})]\n${text}` })
        });
        existing.add(snippet);
        existingNotesByLead.set(lead.id, existing);
        console.log(`[CRM] Added note to ${lead.name}: "${text.substring(0, 50)}..."`);
        return true;
    } catch (e) {
        console.error(`[ERROR] Note failed: ${e.message}`);
        return false;
    }
}

async function handleMessage(sock, m) {
    if (!m.key || !m.message) return;
    const msgId = m.key.id;
    if (processedMsgIds.has(msgId)) return;
    processedMsgIds.add(msgId);

    if (m.key.remoteJid !== TARGET_GROUP_ID) return;

    const msg = m.message;
    const isAudio = !!msg.audioMessage || (msg.documentMessage?.mimetype?.includes('audio'));
    let text = msg.conversation || msg.extendedTextMessage?.text || msg.documentMessage?.fileName || '';
    if (msg.imageMessage?.caption) text = msg.imageMessage.caption;
    if (msg.videoMessage?.caption) text = msg.videoMessage.caption;

    const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
    const timeStr = new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const sender = (m.key.participant || '').split('@')[0] || 'Team';

    console.log(`\n[ZERO7 MSG] [${timeStr}] Sender: ${sender}`);
    if (isAudio) console.log(`   MEDIA: AUDIO (${msg.audioMessage?.seconds || 0}s)`);
    if (text) console.log(`   TEXT: "${text}"`);

    // Check if this text or audio matches a lead
    let matchedLead = findLead(text);

    if (isAudio) {
        if (matchedLead) {
            console.log(`   -> Audio matched lead directly: ${matchedLead.name}`);
            await uploadAudio(matchedLead, m, sender, timeStr, text);
            lastContextLead = matchedLead;
            lastContextTime = ts;
        } else if (lastContextLead && (ts - lastContextTime < 180000)) {
            // Case 1: Lead name was sent BEFORE the audio (within 3 mins)
            console.log(`   -> Audio matched previous lead context: ${lastContextLead.name}`);
            await uploadAudio(lastContextLead, m, sender, timeStr, `Audio following note for ${lastContextLead.name}`);
        } else {
            // Case 2: Audio sent FIRST, waiting for lead name below it!
            console.log(`   -> Audio has no immediate lead match. Queuing in pendingAudios...`);
            pendingAudios.push({ m, ts, sender, timeStr });
        }
    } else if (text) {
        if (matchedLead) {
            console.log(`   -> Text matched lead: ${matchedLead.name}`);
            lastContextLead = matchedLead;
            lastContextTime = ts;

            // Check Case 2: Were there any pending audios sent right before this lead name?
            const recentAudios = pendingAudios.filter(pa => (ts - pa.ts) < 300000); // within 5 mins
            if (recentAudios.length > 0) {
                console.log(`   [MATCH!] Found ${recentAudios.length} pending audio(s) sent before this lead name (${matchedLead.name})!`);
                for (const pa of recentAudios) {
                    await uploadAudio(matchedLead, pa.m, pa.sender, pa.timeStr, `Audio followed by lead name "${text}"`);
                }
                // Clear matched audios from pending queue
                pendingAudios = pendingAudios.filter(pa => (ts - pa.ts) >= 300000);
            }

            // Also add text note if it has informative content
            if (text.length > 5 && !text.startsWith('http')) {
                await addNote(matchedLead, text, sender, timeStr);
            }
        } else {
            console.log(`   [INFO] Text did not match any CRM lead.`);
        }
    }
}

async function start() {
    console.log('=== Zero7 Group WhatsApp Synchronizer v3 Starting ===');
    await crmLogin();
    await loadCRMInventory();

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        syncFullHistory: true,
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log(`\n[CONNECTED] Zero7 Group Sync active as ${sock.user?.id?.split(':')[0]}`);
            console.log(`Listening for messages in Zero7 group (${TARGET_GROUP_ID})...\n`);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[DISCONNECTED] Reconnecting: ${shouldReconnect}...`);
            if (shouldReconnect) setTimeout(start, 5000);
        }
    });

    sock.ev.on('messaging-history.set', async ({ messages }) => {
        for (const m of (messages || [])) {
            await handleMessage(sock, m);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of (messages || [])) {
            await handleMessage(sock, m);
        }
    });
}

start().catch(console.error);