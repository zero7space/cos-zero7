const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const https = require('https');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const CRM_URL = 'https://cos.zero7.space';
const CRM_EMAIL = 'abhijeet@zero7.space';
const CRM_PASSWORD = 'admin123';

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.request({
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + (urlObj.search || ''),
            method: options.method || 'GET',
            headers: options.headers || {}
        }, (res) => {
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

async function uploadRecordingToCRM(leadId, filePath, fileName, mimeType, notes, token) {
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const fileBytes = fs.readFileSync(filePath);
    
    let body = '';
    body += `--${boundary}\r\nContent-Disposition: form-data; name="outcome"\r\n\r\nConnected\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n${notes}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="duration_minutes"\r\n\r\n5\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="recording"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    
    const bodyStart = Buffer.from(body, 'utf8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const fullBody = Buffer.concat([bodyStart, fileBytes, bodyEnd]);
    
    const urlObj = new URL(`${CRM_URL}/api/leads/${leadId}/calls`);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': fullBody.length,
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(fullBody);
        req.end();
    });
}

async function addNoteToCRM(leadId, text, token) {
    return httpRequest(`${CRM_URL}/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ content: text })
    });
}

function normalize(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchLead(text, leads) {
    if (!text) return null;
    const clean = text.trim();
    const cleanNorm = normalize(clean);
    if (!cleanNorm || cleanNorm.length < 3) return null;

    // 1. Direct phone match
    const phones = text.match(/(?:\+?91)?[\s-]?(\d{10})/g);
    if (phones) {
        for (const p of phones) {
            const digits = p.replace(/\D/g, '').slice(-10);
            const found = leads.find(l => (l.phone || '').replace(/\D/g, '').slice(-10) === digits);
            if (found) return found;
        }
    }

    // 2. Exact or substring name match
    for (const lead of leads) {
        if (!lead.name) continue;
        const lNorm = normalize(lead.name);
        if (cleanNorm.includes(lNorm) || lNorm.includes(cleanNorm)) {
            return lead;
        }
        // First name + last name components
        const parts = lead.name.toLowerCase().split(/\s+/).filter(p => p.length >= 4);
        for (const part of parts) {
            if (['kumar', 'sharma', 'singh', 'patil', 'shah', 'gupta', 'lead'].includes(part)) continue;
            if (cleanNorm.includes(normalize(part))) {
                return lead;
            }
        }
    }

    // Specific aliases known in Zero7 group
    const aliases = {
        'hetsanghvi': 'Het Sanghavi',
        'muntashirgandhi': 'Mustanshir Gandhi',
        'jayshreedeewakar': 'Jayashree Diwakar',
        'devdassurana': 'Devdas Suvarna',
        'vikasskdhanukka': 'Vikass K Dhannuka',
        'rajclient': 'Raj',
        'mohdiqbalshaikh': 'Mohd Iqbal Shaikh',
        'shubhamrai': 'Subham Rai',
        'mayanktrumanshah': 'Mayank Truman Shah',
        'sauravgarg': 'Saurav Garg',
        'deepumandal': 'Deepu Mandal',
        'nareshvyas': 'Naresh Vyas',
        'poojadeora': 'pooja deora',
        'babugupta': 'Babu Gupta',
        'amitshah': 'Amit Shah',
        'ronaksejpal': 'Ronak Sejpal'
    };

    for (const [alias, targetName] of Object.entries(aliases)) {
        if (cleanNorm.includes(alias)) {
            const found = leads.find(l => normalize(l.name) === normalize(targetName));
            if (found) return found;
        }
    }

    return null;
}

async function main() {
    console.log('=== Zero7 Group Recording & Note Sync Engine ===\n');

    // 1. CRM Login & Inventory
    const loginRes = await httpRequest(`${CRM_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: CRM_EMAIL, password: CRM_PASSWORD })
    });
    const crmToken = loginRes.data.token;
    console.log('[CRM] Logged in successfully.');

    const leadsRes = await httpRequest(`${CRM_URL}/api/leads`, {
        headers: { 'Authorization': `Bearer ${crmToken}` }
    });
    const leads = leadsRes.data || [];
    console.log(`[CRM] Loaded ${leads.length} leads.`);

    // Check existing call recordings
    const existingAudios = new Set();
    const existingNotes = new Set();

    for (const l of leads) {
        const det = await httpRequest(`${CRM_URL}/api/leads/${l.id}`, {
            headers: { 'Authorization': `Bearer ${crmToken}` }
        });
        const acts = det.data?.activity || [];
        for (const a of acts) {
            if (a.type === 'call' && a.recording_file_name) {
                existingAudios.add(l.id);
            }
            if (a.type === 'note' && a.notes) {
                existingNotes.add(a.notes.substring(0, 50).toLowerCase());
            }
        }
    }
    console.log(`[CRM] Leads with existing recordings: ${existingAudios.size}`);

    // 2. Connect to WhatsApp
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: true,
        markOnlineOnConnect: false
    });
    
    sock.ev.on('creds.update', saveCreds);

    const messageMap = new Map(); // id -> WAMessage

    function store(m) {
        if (!m.key || m.key.remoteJid !== TARGET_GROUP_ID) return;
        messageMap.set(m.key.id, m);
    }

    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const m of (messages || [])) store(m);
    });

    sock.ev.on('messaging-history.set', ({ messages }) => {
        for (const m of (messages || [])) store(m);
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('[WA] Connected! Fetching history...');
            try {
                await sock.fetchMessageHistory(100, { remoteJid: TARGET_GROUP_ID }, null);
            } catch (e) {
                console.log('History query dispatched.');
            }

            // Wait 12 seconds to collect all messages
            setTimeout(async () => {
                const all = Array.from(messageMap.values());
                console.log(`\n[COLLECTED] Total ${all.length} messages from Zero7 group.`);

                // Sort chronologically
                all.sort((a, b) => (Number(a.messageTimestamp) || 0) - (Number(b.messageTimestamp) || 0));

                let syncedRecordings = 0;
                let syncedNotes = 0;

                for (let i = 0; i < all.length; i++) {
                    const m = all[i];
                    const msg = m.message;
                    if (!msg) continue;

                    const id = m.key.id;
                    const isAudio = !!msg.audioMessage || (msg.documentMessage?.mimetype?.includes('audio'));
                    const text = msg.conversation || msg.extendedTextMessage?.text || msg.documentMessage?.fileName || '';
                    const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
                    const timeStr = new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                    const sender = (m.key.participant || '').split('@')[0];

                    if (isAudio) {
                        // Look backward (up to 3 messages) or forward (up to 3 messages) for lead name
                        let matchedLead = null;
                        let matchedText = '';

                        // Check forward first (e.g. Audio sent, then "Mayank Truman Shah" sent 14s later)
                        for (let f = 1; f <= 3 && (i + f) < all.length; f++) {
                            const fMsg = all[i + f];
                            const fText = fMsg.message?.conversation || fMsg.message?.extendedTextMessage?.text || '';
                            const fTs = fMsg.messageTimestamp ? Number(fMsg.messageTimestamp) * 1000 : 0;
                            if (fTs - ts > 300000) break; // more than 5 mins apart
                            const found = matchLead(fText, leads);
                            if (found) {
                                matchedLead = found;
                                matchedText = fText;
                                break;
                            }
                        }

                        // If not found, check backward (e.g. "Het Sanghvi" sent, then Audio sent right after)
                        if (!matchedLead) {
                            for (let b = 1; b <= 3 && (i - b) >= 0; b++) {
                                const bMsg = all[i - b];
                                const bText = bMsg.message?.conversation || bMsg.message?.extendedTextMessage?.text || '';
                                const bTs = bMsg.messageTimestamp ? Number(bMsg.messageTimestamp) * 1000 : 0;
                                if (ts - bTs > 300000) break;
                                const found = matchLead(bText, leads);
                                if (found) {
                                    matchedLead = found;
                                    matchedText = bText;
                                    break;
                                }
                            }
                        }

                        if (matchedLead) {
                            console.log(`\n[PAIR FOUND] Audio (${id}) <==> Lead: ${matchedLead.name} (${matchedLead.id}) [Triggered by: "${matchedText}"]`);
                            
                            if (existingAudios.has(matchedLead.id)) {
                                console.log(`  -> Already has recording in CRM. Skipping duplicate.`);
                            } else {
                                console.log(`  -> Downloading media...`);
                                try {
                                    const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                                    const mime = msg.audioMessage?.mimetype || 'audio/mp4';
                                    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'mp3';
                                    const cleanName = matchedLead.name.replace(/[^a-zA-Z0-9]/g, '_');
                                    const fileName = `wa_${cleanName}_${Date.now()}.${ext}`;
                                    const filePath = path.join(DOWNLOADS_DIR, fileName);
                                    fs.writeFileSync(filePath, buffer);
                                    console.log(`  -> Saved: ${fileName} (${(buffer.length/1024).toFixed(1)} KB)`);

                                    console.log(`  -> Uploading to CRM...`);
                                    const res = await uploadRecordingToCRM(
                                        matchedLead.id,
                                        filePath,
                                        fileName,
                                        mime,
                                        `WhatsApp call recording from ${sender} in Zero7 group [${timeStr}]: ${matchedText}`,
                                        crmToken
                                    );
                                    console.log(`  -> CRM Upload Result: HTTP ${res.status}`);
                                    existingAudios.add(matchedLead.id);
                                    syncedRecordings++;
                                } catch (dlErr) {
                                    console.error(`  -> Failed to download/upload: ${dlErr.message}`);
                                }
                            }
                        } else {
                            console.log(`[UNMATCHED AUDIO] ID: ${id} at ${timeStr}`);
                        }
                    } else if (text && text.length > 15) {
                        // Check if text is a note for a lead
                        const matchedLead = matchLead(text, leads);
                        if (matchedLead) {
                            const snippet = text.substring(0, 50).toLowerCase();
                            if (!existingNotes.has(snippet)) {
                                console.log(`\n[NOTE FOUND] "${text.substring(0, 60)}..." for ${matchedLead.name}`);
                                await addNoteToCRM(
                                    matchedLead.id,
                                    `[WhatsApp Zero7 Group - ${sender} (${timeStr})]\n${text}`,
                                    crmToken
                                );
                                existingNotes.add(snippet);
                                syncedNotes++;
                            }
                        }
                    }
                }

                console.log(`\n========================================`);
                console.log(`SYNC COMPLETE:`);
                console.log(`  - Call Recordings Synced: ${syncedRecordings}`);
                console.log(`  - Notes Synced: ${syncedNotes}`);
                console.log(`========================================\n`);

                setTimeout(() => process.exit(0), 1000);
            }, 12000);
        }
    });
}

main().catch(console.error);
