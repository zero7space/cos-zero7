/**
 * Zero7 CRM - WhatsApp History + Live Sync (Combined)
 * 
 * Phase 1: Connects with reset accountSyncCounter=0 → WhatsApp pushes full history
 *          Captures all messaging-history.set batches and syncs lead messages to CRM
 * Phase 2: After history completes, continues as live sync daemon for new messages
 * 
 * NO QR SCAN NEEDED — uses existing auth keys from auth_personal/
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const CRM_URL = 'https://cos.zero7.space';
const CRM_EMAIL = 'abhijeet@zero7.space';
const CRM_PASSWORD = 'admin123';
const MY_PHONE = '9993202900';
const AUTH_DIR = path.join(__dirname, 'auth_personal');

let crmToken = null;
let crmPhones = {};
let lidToPhone = new Map();
let phoneToLid = new Map();

// Stats
let historyBatches = 0;
let totalHistoryMessages = 0;
let totalHistorySynced = 0;
let totalLiveMessages = 0;
let syncedPerLead = {};
let historyPhase = true;

function loadLidMappings() {
    console.log('[LID] Pre-loading LID mappings from disk...');
    const files = fs.readdirSync(AUTH_DIR);
    let reverseCount = 0, directCount = 0;
    for (const file of files) {
        if (file.startsWith('lid-mapping-')) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, file), 'utf8'));
                if (file.includes('reverse')) {
                    const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
                    lidToPhone.set(lid, content.replace(/\D/g, ''));
                    reverseCount++;
                } else {
                    const phone = file.replace('lid-mapping-', '').replace('.json', '');
                    phoneToLid.set(phone, content.replace(/\D/g, ''));
                    directCount++;
                }
            } catch (e) {}
        }
    }
    console.log(`[LID] Loaded ${reverseCount} reverse + ${directCount} direct mappings.`);
}

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

async function fetchPhones() {
    try {
        const resp = await httpRequest(`${CRM_URL}/api/leads/phones`, {
            headers: { 'Authorization': `Bearer ${crmToken}` }
        });
        crmPhones = resp.data || {};
        console.log(`[CRM] Loaded ${Object.keys(crmPhones).length} lead phones from CRM`);
        return true;
    } catch (e) {
        console.error('[CRM] Failed to fetch phones:', e.message);
        return false;
    }
}

function normalizePhone(jidOrPhone) {
    if (!jidOrPhone) return '';
    const num = jidOrPhone.split('@')[0].replace(/\D/g, '');
    return num.length >= 10 ? num.slice(-10) : num;
}

function resolveToLeadPhone(jid) {
    if (!jid) return null;
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return null;

    if (jid.endsWith('@s.whatsapp.net')) {
        const norm = normalizePhone(jid);
        if (norm in crmPhones) return norm;
    }

    if (jid.endsWith('@lid')) {
        const lidNum = jid.split('@')[0].split(':')[0];
        const mappedPhone = lidToPhone.get(lidNum);
        if (mappedPhone) {
            const norm = normalizePhone(mappedPhone);
            if (norm in crmPhones) return norm;
        }
    }

    const directNorm = normalizePhone(jid);
    if (directNorm in crmPhones) return directNorm;
    return null;
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
        console.error('[SYNC ERROR]:', e.message);
        return 0;
    }
}

function parseMessage(m) {
    if (!m.key || !m.message) return null;
    const jid = m.key.remoteJid || '';
    const leadPhone = resolveToLeadPhone(jid);
    if (!leadPhone) return null;

    const fromMe = !!m.key.fromMe;
    const msg = m.message;
    let text = msg.conversation || msg.extendedTextMessage?.text || '';
    let type = 'text';
    let caption = null;

    if (msg.imageMessage) { type = 'image'; caption = msg.imageMessage.caption || ''; text = caption || '[Photo]'; }
    else if (msg.videoMessage) { type = 'video'; caption = msg.videoMessage.caption || ''; text = caption || '[Video]'; }
    else if (msg.audioMessage) { type = 'audio'; text = '[Voice note]'; }
    else if (msg.documentMessage) { type = 'document'; caption = msg.documentMessage.fileName || ''; text = caption || '[Document]'; }
    else if (msg.stickerMessage) { type = 'sticker'; text = '[Sticker]'; }
    else if (msg.contactMessage) { type = 'contact'; text = `[Contact: ${msg.contactMessage.displayName || ''}]`; }
    else if (msg.locationMessage) { type = 'location'; text = '[Location]'; }
    else if (msg.templateMessage) {
        type = 'template';
        text = msg.templateMessage.hydratedTemplate?.hydratedContentText || 
               msg.templateMessage.hydratedFourRowTemplate?.hydratedContentText || '[Template Message]';
    }
    else if (msg.protocolMessage || msg.reactionMessage || msg.senderKeyDistributionMessage) return null;

    if (!text && msg.viewOnceMessage) {
        const inner = msg.viewOnceMessage.message;
        if (inner?.imageMessage) { type = 'image'; text = '[View Once Photo]'; }
        else if (inner?.videoMessage) { type = 'video'; text = '[View Once Video]'; }
        else { text = '[View Once Message]'; }
    }
    if (!text) {
        const msgKeys = Object.keys(msg).filter(k => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(k));
        if (msgKeys.length > 0) { type = msgKeys[0].replace('Message', ''); text = `[${type}]`; }
    }
    if (!text) return null;

    const ts = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000).toISOString() : new Date().toISOString();

    return {
        lead_phone: leadPhone,
        direction: fromMe ? 'outgoing' : 'incoming',
        message_text: text,
        message_type: type,
        media_caption: caption,
        timestamp: ts,
        wa_message_id: m.key.id,
        status: 'delivered'
    };
}

async function processMessageBatch(messages, source) {
    const parsed = [];
    for (const m of messages) {
        const p = parseMessage(m);
        if (p) {
            parsed.push(p);
            if (!syncedPerLead[p.lead_phone]) syncedPerLead[p.lead_phone] = 0;
            syncedPerLead[p.lead_phone]++;
        }
    }
    
    if (parsed.length > 0) {
        let totalInserted = 0;
        // Sync in chunks of 50
        for (let i = 0; i < parsed.length; i += 50) {
            const chunk = parsed.slice(i, i + 50);
            const inserted = await syncToCRM(chunk);
            totalInserted += inserted;
        }
        console.log(`  [${source}] → ${totalInserted} inserted (${parsed.length} matched leads out of ${messages.length} total)`);
        return totalInserted;
    }
    return 0;
}

async function start() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Zero7 CRM - WhatsApp History Sync + Live Daemon           ║');
    console.log('║  Phase 1: Full history re-sync (accountSyncCounter reset)  ║');
    console.log('║  Phase 2: Live message monitoring                          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n[START] Account: Abhijeet Personal (${MY_PHONE})`);

    loadLidMappings();
    await crmLogin();
    await fetchPhones();

    // Re-fetch phones every 30 minutes
    setInterval(async () => { await fetchPhones(); }, 30 * 60 * 1000);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`\n[AUTH] accountSyncCounter: ${state.creds.accountSyncCounter}`);
    console.log(`[AUTH] processedHistoryMessages: ${state.creds.processedHistoryMessages?.length || 0}`);

    if (state.creds.accountSyncCounter === 0) {
        console.log('[AUTH] ✓ Sync counter is 0 — WhatsApp will push FULL history on connect');
    } else {
        console.log('[AUTH] ⚠ Sync counter > 0 — history sync may be skipped');
    }

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'warn' }),  // Show warnings so we can see history sync logs
        printQRInTerminal: false,
        browser: ['Chrome (Windows)', 'Desktop', '120.0.0'],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
        shouldSyncHistoryMessage: () => true  // Accept ALL history sync types
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr, receivedPendingNotifications }) => {
        if (qr) {
            console.error('[AUTH] ❌ QR code displayed — auth session may have expired!');
            console.error('[AUTH] This should NOT happen. Check auth_personal/ folder.');
            // Don't exit — let the user see this
        }
        if (connection === 'open') {
            console.log(`\n[CONNECTED] ✓ Personal WhatsApp active as ${sock.user?.id?.split(':')[0]}`);
            console.log('[WAITING] Waiting for history sync from phone...\n');
        }
        if (receivedPendingNotifications) {
            console.log('[SYNC] Received pending notifications signal — history sync should follow');
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[DISCONNECTED] Code: ${statusCode} | Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(start, 5000);
            }
        }
    });

    // ═══════════════════════════════════════════════════
    // PHASE 1: History Sync — captures past messages
    // ═══════════════════════════════════════════════════
    sock.ev.on('messaging-history.set', async ({ chats, messages, contacts, isLatest, progress, syncType }) => {
        historyBatches++;
        const msgCount = messages?.length || 0;
        const chatCount = chats?.length || 0;
        totalHistoryMessages += msgCount;

        console.log(`\n[HISTORY BATCH #${historyBatches}] ${msgCount} messages, ${chatCount} chats (syncType: ${syncType}, progress: ${progress}%, isLatest: ${isLatest})`);

        // Process messages
        if (messages && messages.length > 0) {
            const inserted = await processMessageBatch(messages, `HISTORY #${historyBatches}`);
            totalHistorySynced += inserted;
        }

        // Extract new LID mappings from contacts
        if (contacts && contacts.length > 0) {
            let newMappings = 0;
            for (const c of contacts) {
                if (c.id && c.lid) {
                    const phone = normalizePhone(c.id);
                    const lid = c.lid.split('@')[0].split(':')[0];
                    if (!lidToPhone.has(lid)) newMappings++;
                    lidToPhone.set(lid, phone);
                    phoneToLid.set(phone, lid);
                }
            }
            if (newMappings > 0) console.log(`  [LID] Discovered ${newMappings} new LID mappings from contacts`);
        }

        // Check if history sync is complete
        if (progress === 100 || isLatest === true) {
            console.log('\n╔══════════════════════════════════════════════╗');
            console.log('║  HISTORY SYNC COMPLETE                       ║');
            console.log('╚══════════════════════════════════════════════╝');
            printSummary();
            historyPhase = false;
            console.log('\n[LIVE] Transitioning to real-time message monitoring...');
            console.log(`[READY] Actively monitoring conversations for ${Object.keys(crmPhones).length} leads\n`);
        }
    });

    // Track history sync status events
    sock.ev.on('messaging-history.status', ({ syncType, status, explicit }) => {
        console.log(`[HISTORY STATUS] syncType: ${syncType}, status: ${status}, explicit: ${explicit}`);
        if (status === 'complete') {
            if (historyPhase) {
                console.log('\n[HISTORY] Sync phase complete.');
                printSummary();
                historyPhase = false;
                console.log(`\n[LIVE] Now monitoring ${Object.keys(crmPhones).length} leads in real-time...\n`);
            }
        }
    });

    // ═══════════════════════════════════════════════════
    // PHASE 2: Live Sync — captures new messages
    // ═══════════════════════════════════════════════════
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const valid = [];
        for (const m of messages) {
            const parsed = parseMessage(m);
            if (parsed) {
                console.log(`[MSG] ${parsed.direction === 'outgoing' ? '↗ (You)' : '↙ (Lead)'} [${parsed.lead_phone}]: "${parsed.message_text.substring(0, 70)}"`);
                valid.push(parsed);
            }
        }
        if (valid.length > 0) {
            const count = await syncToCRM(valid);
            totalLiveMessages += count;
            console.log(`[SYNCED] Inserted ${count}/${valid.length} live message(s) to CRM.`);
        }
    });

    // Update LID mappings from new contacts
    sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            if (c.id && c.lid) {
                const phone = normalizePhone(c.id);
                const lid = c.lid.split('@')[0].split(':')[0];
                lidToPhone.set(lid, phone);
                phoneToLid.set(phone, lid);
            }
        }
    });

    // Also listen for LID mapping updates
    sock.ev.on('lid-mapping.update', (mapping) => {
        if (mapping?.lid && mapping?.pn) {
            const lid = mapping.lid.split('@')[0].split(':')[0];
            const phone = mapping.pn.replace(/\D/g, '');
            lidToPhone.set(lid, phone);
            phoneToLid.set(phone, lid);
            console.log(`[LID] New mapping: ${lid} → ${phone}`);
        }
    });

    // Set a timeout: if no history arrives within 60 seconds, transition to live mode
    setTimeout(() => {
        if (historyPhase && historyBatches === 0) {
            console.log('\n[TIMEOUT] No history batches received after 60s.');
            console.log('[TIMEOUT] WhatsApp may have already synced this data. Transitioning to live mode.');
            historyPhase = false;
            printSummary();
            console.log(`\n[LIVE] Now monitoring ${Object.keys(crmPhones).length} leads in real-time...\n`);
        }
    }, 60000);
}

function printSummary() {
    console.log('\n--- SYNC SUMMARY ---');
    console.log(`History batches received: ${historyBatches}`);
    console.log(`Total history messages processed: ${totalHistoryMessages}`);
    console.log(`Total messages synced to CRM: ${totalHistorySynced}`);
    console.log(`Live messages synced: ${totalLiveMessages}`);
    
    const leadEntries = Object.entries(syncedPerLead);
    if (leadEntries.length > 0) {
        console.log(`\nPer-lead breakdown:`);
        for (const [phone, count] of leadEntries.sort((a,b) => b[1] - a[1])) {
            const leadId = crmPhones[phone] || 'unknown';
            console.log(`  ${phone} (${leadId}): ${count} messages`);
        }
    } else {
        console.log('\nNo lead messages found in history batch.');
    }
    console.log('--- END SUMMARY ---');
}

start().catch(console.error);
