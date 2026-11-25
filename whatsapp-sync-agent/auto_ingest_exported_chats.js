/**
 * Zero7 CRM - WhatsApp Export Auto-Ingest + Live Daemon (V2)
 * 
 * Automatically captures, unzips, parses, and syncs exported WhatsApp chats (.zip or .txt)
 * sent to any chat or inbox. Matches leads by phone number or name, extracts full message history,
 * and inserts directly into the CRM database!
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const AdmZip = require('adm-zip');

const CRM_URL = 'https://cos.zero7.space';
const CRM_EMAIL = 'abhijeet@zero7.space';
const CRM_PASSWORD = 'admin123';
const MY_PHONE = '9993202900';
const AUTH_DIR = path.join(__dirname, 'auth_personal');
const EXPORTS_DIR = path.join(__dirname, 'exported_chats');

if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

let crmToken = null;
let crmLeads = [];
let crmPhones = {}; // norm_phone -> lead_id
let lidToPhone = new Map();

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

function normalizePhone(num) {
    if (!num) return '';
    const digits = num.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : '';
}

async function fetchLeads() {
    try {
        const resp = await httpRequest(`${CRM_URL}/api/leads`, {
            headers: { 'Authorization': `Bearer ${crmToken}` }
        });
        crmLeads = (resp.data || []).filter(l => l.phone && l.phone.length >= 10 && !l.phone.includes('test'));
        crmPhones = {};
        for (const l of crmLeads) {
            const norm = normalizePhone(l.phone);
            if (norm) crmPhones[norm] = l.id;
        }
        console.log(`[CRM] Loaded ${crmLeads.length} valid leads (${Object.keys(crmPhones).length} unique phones)`);
        return true;
    } catch (e) {
        console.error('[CRM] Failed to fetch leads:', e.message);
        return false;
    }
}

function loadLidMappings() {
    const files = fs.readdirSync(AUTH_DIR);
    for (const file of files) {
        if (file.startsWith('lid-mapping-') && file.includes('reverse')) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, file), 'utf8'));
                const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
                lidToPhone.set(lid, content.replace(/\D/g, ''));
            } catch (e) {}
        }
    }
    console.log(`[LID] Loaded ${lidToPhone.size} LID reverse mappings`);
}

async function syncToCRM(messages) {
    if (!messages || messages.length === 0) return 0;
    try {
        const resp = await httpRequest(`${CRM_URL}/api/whatsapp/messages/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${crmToken}` },
            body: JSON.stringify({ account_phone: MY_PHONE, messages })
        });
        return resp.data?.inserted || 0;
    } catch (e) {
        console.error('[CRM SYNC ERROR]:', e.message);
        return 0;
    }
}

/**
 * Match a lead from filename or text content
 */
function findMatchingLead(fileName, textContent) {
    const cleanName = (fileName || '').toLowerCase();
    
    // 1. Extract any 10-digit number sequence from filename
    // e.g. "WhatsApp Chat with +91 98192 62248.zip" -> 9819262248
    const digitsInFileName = fileName.replace(/\D/g, '');
    if (digitsInFileName.length >= 10) {
        const phoneCandidate = digitsInFileName.slice(-10);
        const match = crmLeads.find(l => normalizePhone(l.phone) === phoneCandidate);
        if (match) return match;
    }

    // 2. Check each CRM lead's phone against filename or text sample
    const sample = cleanName + '\n' + textContent.slice(0, 2000);
    for (const lead of crmLeads) {
        const norm = normalizePhone(lead.phone);
        if (norm && norm.length === 10 && sample.includes(norm)) {
            return lead;
        }
    }

    // 3. Try to match lead full name or business name in filename
    for (const lead of crmLeads) {
        if (lead.name && lead.name.length >= 4) {
            if (cleanName.includes(lead.name.toLowerCase())) {
                return lead;
            }
        }
        if (lead.business_name && lead.business_name.length >= 5) {
            if (cleanName.includes(lead.business_name.toLowerCase())) {
                return lead;
            }
        }
    }

    // 4. Match individual name tokens (e.g. "Naresh" and "Vyas")
    for (const lead of crmLeads) {
        if (lead.name) {
            const parts = lead.name.toLowerCase().split(/\s+/).filter(p => p.length >= 4);
            if (parts.length > 0 && parts.every(p => cleanName.includes(p))) {
                return lead;
            }
        }
    }

    return null;
}

/**
 * Parse standard WhatsApp chat export text (.txt)
 */
function parseWhatsAppChatExport(text, leadPhone) {
    const lines = text.split(/\r?\n/);
    const messages = [];

    // Supports formats:
    // [15/09/26, 8:55:00 PM] Sender: Message
    // 15/09/2026, 8:55 pm - Sender: Message
    // 15/09/26, 20:55 - Sender: Message
    // 9/15/26, 8:55 PM - Sender: Message
    const regex = /^\[?(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apAP][mM])?)\]?\s*(?:-\s*)?([^:]+?):\s*(.*)$/;

    let currentMsg = null;

    for (const line of lines) {
        if (line.includes('Messages and calls are end-to-end encrypted') || line.includes('created this group') || line.includes('security code changed')) {
            continue;
        }

        const match = line.match(regex);
        if (match) {
            if (currentMsg) messages.push(currentMsg);

            const dateStr = match[1];
            const timeStr = match[2];
            const sender = match[3].trim();
            const body = match[4].trim();

            const isMe = sender.toLowerCase().includes('you') || sender.includes('Abhijeet') || sender.includes(MY_PHONE) || (sender.replace(/\D/g, '').slice(-10) === MY_PHONE.slice(-10));

            let msgType = 'text';
            let cleanBody = body;
            if (body.includes('<attached:') || body.includes('(file attached)') || body.includes('image omitted') || body.includes('photo omitted')) {
                cleanBody = '[Photo]'; msgType = 'image';
            } else if (body.includes('video omitted')) {
                cleanBody = '[Video]'; msgType = 'video';
            } else if (body.includes('audio omitted') || body.includes('voice call')) {
                cleanBody = '[Audio]'; msgType = 'audio';
            } else if (body.includes('document omitted') || body.includes('.pdf') || body.includes('.docx')) {
                cleanBody = '[Document]'; msgType = 'document';
            }

            let isoTimestamp = new Date().toISOString();
            try {
                const dateParts = dateStr.split(/[\/\.-]/);
                let day, month, year;
                if (dateParts[0].length === 4) {
                    year = dateParts[0]; month = dateParts[1]; day = dateParts[2];
                } else if (parseInt(dateParts[1], 10) > 12) {
                    month = dateParts[0]; day = dateParts[1]; year = dateParts[2];
                } else {
                    day = dateParts[0]; month = dateParts[1]; year = dateParts[2];
                }
                if (year.length === 2) year = '20' + year;

                const timeParts = timeStr.trim().split(/\s+/);
                const clock = timeParts[0].split(':');
                let hours = parseInt(clock[0], 10);
                const mins = clock[1] || '00';
                const secs = clock[2] || '00';
                if (timeParts[1]) {
                    const ampm = timeParts[1].toUpperCase();
                    if (ampm.includes('P') && hours < 12) hours += 12;
                    if (ampm.includes('A') && hours === 12) hours = 0;
                }
                isoTimestamp = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${mins}:${secs}`;
            } catch (e) {
                isoTimestamp = new Date().toISOString();
            }

            currentMsg = {
                lead_phone: leadPhone,
                direction: isMe ? 'outgoing' : 'incoming',
                message_text: cleanBody,
                message_type: msgType,
                timestamp: isoTimestamp,
                wa_message_id: 'wa_export_' + Math.random().toString(36).substring(2, 12),
                status: 'delivered'
            };
        } else if (currentMsg) {
            currentMsg.message_text += '\n' + line;
        }
    }

    if (currentMsg) messages.push(currentMsg);
    return messages;
}

async function processFileBuffer(fileName, buffer, remoteJid) {
    console.log(`\n📄 [PROCESSING DOCUMENT] "${fileName}" (${buffer.length} bytes) from ${remoteJid || 'disk'}`);

    // Save binary file to disk
    const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const savePath = path.join(EXPORTS_DIR, safeName);
    fs.writeFileSync(savePath, buffer);
    console.log(`  [SAVED] Stored binary file at ${savePath}`);

    let chatText = '';

    // If it's a zip file, extract _chat.txt
    if (fileName.toLowerCase().endsWith('.zip')) {
        try {
            const zip = new AdmZip(buffer);
            const zipEntries = zip.getEntries();
            console.log(`  [ZIP CONTENTS] ${zipEntries.length} files inside zip:`);
            let chatEntry = null;
            for (const entry of zipEntries) {
                console.log(`    - ${entry.entryName} (${entry.header.size} bytes)`);
                if (entry.entryName.toLowerCase().endsWith('.txt') || entry.entryName.toLowerCase().includes('chat')) {
                    chatEntry = entry;
                }
            }

            if (chatEntry) {
                chatText = chatEntry.getData().toString('utf8');
                console.log(`  ✓ [UNZIPPED] Found chat file "${chatEntry.entryName}" (${chatText.length} chars)`);
            } else {
                console.log('  ❌ No .txt chat log found inside zip.');
                return;
            }
        } catch (zipErr) {
            console.error('  ❌ Error unzipping:', zipErr.message);
            return;
        }
    } else {
        chatText = buffer.toString('utf8');
    }

    // Match lead
    const matchedLead = findMatchingLead(fileName, chatText);
    if (!matchedLead) {
        console.log('  ⚠ Could not automatically match lead for file:', fileName);
        console.log('  Sample preview:');
        console.log('  ' + chatText.slice(0, 200).replace(/\n/g, ' '));
        return;
    }

    const leadPhone = normalizePhone(matchedLead.phone);
    console.log(`  ✓ [MATCHED LEAD] ${matchedLead.name} (${matchedLead.business_name || 'No Biz'}) | Phone: ${matchedLead.phone} (Norm: ${leadPhone})`);

    const parsedMessages = parseWhatsAppChatExport(chatText, leadPhone);
    console.log(`  [PARSED] Extracted ${parsedMessages.length} messages.`);

    if (parsedMessages.length > 0) {
        console.log(`  [SYNCING] Inserting into Zero7 CRM...`);
        // Sync in chunks of 50
        let totalInserted = 0;
        for (let i = 0; i < parsedMessages.length; i += 50) {
            const chunk = parsedMessages.slice(i, i + 50);
            const inserted = await syncToCRM(chunk);
            totalInserted += inserted;
        }
        console.log(`\n🎉 [SUCCESS] Inserted ${totalInserted}/${parsedMessages.length} messages for ${matchedLead.name} into CRM!`);
        console.log(`   Direct CRM link: ${CRM_URL}/#/leads/${matchedLead.id}\n`);
    }
}

async function start() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Zero7 CRM - WhatsApp Export Auto-Ingest + Live Daemon (V2) ║');
    console.log('║  Listens for exported chats (.zip or .txt) in your inbox    ║');
    console.log('║  Automatically unzips, parses & syncs to CRM lead chats    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n[START] Account: Abhijeet Personal (${MY_PHONE})`);

    loadLidMappings();
    await crmLogin();
    await fetchLeads();

    setInterval(async () => { await fetchLeads(); }, 30 * 60 * 1000);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Windows)', 'Desktop', '120.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log(`\n[CONNECTED] ✓ Active as ${sock.user?.id?.split(':')[0]}`);
            console.log('🚀 Ready! Any exported chat sent to your inbox will be auto-ingested!\n');
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[DISCONNECTED] Code: ${statusCode} | Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(start, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const m of messages) {
            const jid = m.key?.remoteJid || '';
            const msg = m.message;
            if (!msg) continue;

            // 1. Check if message is a document (.zip or .txt)
            if (msg.documentMessage) {
                const doc = msg.documentMessage;
                const fileName = doc.fileName || 'document.zip';
                console.log(`\n📥 [NEW DOCUMENT RECEIVED] "${fileName}" from ${jid}`);
                try {
                    const buffer = await downloadMediaMessage(m, 'buffer', {});
                    await processFileBuffer(fileName, buffer, jid);
                } catch (err) {
                    console.error('  ❌ Error downloading document:', err.message);
                }
                continue;
            }

            // 2. Real-time lead message
            let leadPhone = null;
            if (jid.endsWith('@s.whatsapp.net')) {
                const norm = normalizePhone(jid);
                if (norm in crmPhones) leadPhone = norm;
            } else if (jid.endsWith('@lid')) {
                const lidNum = jid.split('@')[0].split(':')[0];
                const mapped = lidToPhone.get(lidNum);
                if (mapped) {
                    const norm = normalizePhone(mapped);
                    if (norm in crmPhones) leadPhone = norm;
                }
            }

            if (leadPhone) {
                const isFromMe = !!m.key.fromMe;
                let msgText = msg.conversation || msg.extendedTextMessage?.text || '';
                let msgType = 'text';
                if (msg.imageMessage) { msgType = 'image'; msgText = msg.imageMessage.caption || '[Photo]'; }
                else if (msg.videoMessage) { msgType = 'video'; msgText = msg.videoMessage.caption || '[Video]'; }
                else if (msg.audioMessage) { msgType = 'audio'; msgText = '[Voice note]'; }

                if (msgText) {
                    console.log(`[REALTIME MSG] ${isFromMe ? '↗ (You)' : '↙ (Lead)'} [${leadPhone}]: "${msgText.substring(0, 60)}"`);
                    await syncToCRM([{
                        lead_phone: leadPhone,
                        direction: isFromMe ? 'outgoing' : 'incoming',
                        message_text: msgText,
                        message_type: msgType,
                        timestamp: new Date().toISOString(),
                        wa_message_id: m.key.id,
                        status: 'delivered'
                    }]);
                }
            }
        }
    });
}

start().catch(console.error);
