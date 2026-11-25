/**
 * Zero7 CRM - On-Demand WhatsApp History Sync
 * 
 * Connects to WhatsApp, fetches message history for ALL CRM leads
 * that have LID mappings, and syncs to CRM.
 * 
 * After completion, restarts the live sync daemon.
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
let crmPhones = {}; // norm_phone -> lead_id
let lidToPhone = new Map();
let phoneToLid = new Map();

// Preload all LID mappings from disk
function loadLidMappings() {
    console.log('[LID] Pre-loading LID mappings from disk...');
    const files = fs.readdirSync(AUTH_DIR);
    let reverseCount = 0, directCount = 0;
    for (const file of files) {
        if (file.startsWith('lid-mapping-')) {
            const fullPath = path.join(AUTH_DIR, file);
            try {
                const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (file.includes('reverse')) {
                    const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
                    const phone = content.replace(/\D/g, '');
                    lidToPhone.set(lid, phone);
                    reverseCount++;
                } else {
                    const phone = file.replace('lid-mapping-', '').replace('.json', '');
                    const lid = content.replace(/\D/g, '');
                    phoneToLid.set(phone, lid);
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
    const resp = await httpRequest(`${CRM_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: CRM_EMAIL, password: CRM_PASSWORD })
    });
    crmToken = resp.data.token;
    console.log('[CRM] Logged in');
}

async function fetchPhones() {
    const resp = await httpRequest(`${CRM_URL}/api/leads/phones`, {
        headers: { 'Authorization': `Bearer ${crmToken}` }
    });
    crmPhones = resp.data || {};
    console.log(`[CRM] ${Object.keys(crmPhones).length} lead phones`);
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

// Get the list of lead phones that have LID mappings (matched leads)
function getMatchedLeads() {
    const matched = [];
    for (const [phone, leadId] of Object.entries(crmPhones)) {
        // Check if we have a LID mapping for this phone  
        const fullPhone = phone.length === 10 ? '91' + phone : phone;
        if (phoneToLid.has(fullPhone) || phoneToLid.has(phone)) {
            const lid = phoneToLid.get(fullPhone) || phoneToLid.get(phone);
            matched.push({
                phone,
                fullPhone,
                leadId,
                lid,
                phoneJid: fullPhone + '@s.whatsapp.net',
                lidJid: lid + '@lid'
            });
        }
    }
    return matched;
}

async function main() {
    console.log('=== Zero7 CRM - On-Demand WhatsApp History Fetch ===\n');
    
    loadLidMappings();
    await crmLogin();
    await fetchPhones();
    
    const matchedLeads = getMatchedLeads();
    console.log(`\n[MATCH] Found ${matchedLeads.length} CRM leads with WhatsApp LID mappings:`);
    matchedLeads.forEach(l => console.log(`  - ${l.phone} (lead: ${l.leadId}, LID: ${l.lid})`));
    
    if (matchedLeads.length === 0) {
        console.log('[ERROR] No matched leads found. Exiting.');
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    let resolveConnected;
    const connectedPromise = new Promise(r => resolveConnected = r);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Windows)', 'Desktop', '120.0.0'],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
    });

    sock.ev.on('creds.update', saveCreds);

    let connected = false;
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.warn('[AUTH] QR required - session expired! Cannot proceed.');
            process.exit(1);
        }
        if (connection === 'open') {
            connected = true;
            console.log(`[CONNECTED] as ${sock.user?.id?.split(':')[0]}`);
            resolveConnected();
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`[DISCONNECTED] Code: ${code}`);
            if (code !== DisconnectReason.loggedOut && !connected) {
                console.log('Reconnecting in 3s...');
                setTimeout(main, 3000);
            }
        }
    });

    // Collect all messages from history sync events
    let totalSynced = 0;
    let historyBatches = 0;
    const pendingLeads = new Set(matchedLeads.map(l => l.phone));
    const syncedPerLead = {};
    
    sock.ev.on('messaging-history.set', async ({ chats, messages, contacts }) => {
        historyBatches++;
        console.log(`\n[HISTORY BATCH #${historyBatches}] Received: ${messages?.length || 0} messages, ${chats?.length || 0} chats`);
        
        if (messages && messages.length > 0) {
            const parsedBatch = [];
            for (const m of messages) {
                const parsed = parseMessage(m);
                if (parsed) {
                    parsedBatch.push(parsed);
                    if (!syncedPerLead[parsed.lead_phone]) syncedPerLead[parsed.lead_phone] = 0;
                    syncedPerLead[parsed.lead_phone]++;
                }
            }
            
            if (parsedBatch.length > 0) {
                // Sync in chunks of 50 to avoid large payloads
                for (let i = 0; i < parsedBatch.length; i += 50) {
                    const chunk = parsedBatch.slice(i, i + 50);
                    const inserted = await syncToCRM(chunk);
                    totalSynced += inserted;
                    console.log(`  → Synced ${inserted} messages (chunk ${Math.floor(i/50) + 1})`);
                }
                console.log(`  → Total lead messages in batch: ${parsedBatch.length}`);
            }
        }
        
        // Also extract LID mappings from contacts if available
        if (contacts && contacts.length > 0) {
            for (const c of contacts) {
                if (c.id && c.lid) {
                    const phone = normalizePhone(c.id);
                    const lid = c.lid.split('@')[0].split(':')[0];
                    lidToPhone.set(lid, phone);
                    phoneToLid.set(phone, lid);
                }
            }
        }
    });

    // Wait for connection
    await connectedPromise;
    console.log('\n[FETCHING] Starting on-demand history requests...\n');
    
    // Wait a moment for connection to stabilize
    await new Promise(r => setTimeout(r, 3000));
    
    // Process each matched lead sequentially with delays
    let leadIdx = 0;
    for (const lead of matchedLeads) {
        leadIdx++;
        console.log(`\n[${leadIdx}/${matchedLeads.length}] Requesting history for ${lead.phone} (lead: ${lead.leadId})...`);
        
        try {
            // Use the phone JID as remoteJid 
            const msgKey = {
                remoteJid: lead.phoneJid,
                fromMe: false,
                id: 'FFFFFFFFFFFFFFFFFFFFFFFF'  // synthetic "max" message ID
            };
            
            // Use current timestamp in milliseconds - this tells WhatsApp to send
            // messages older than this timestamp
            const now = Date.now();
            
            const result = await sock.fetchMessageHistory(
                50,      // max 50 messages per request
                msgKey,
                now      // messages older than now
            );
            console.log(`  → Request sent (session: ${result?.substring(0,20)}...)`);
        } catch (e) {
            console.error(`  → Error for ${lead.phone}: ${e.message}`);
        }
        
        // Wait between requests to avoid rate limiting and allow responses to arrive
        await new Promise(r => setTimeout(r, 5000));
    }
    
    // Wait for all history responses to arrive
    console.log('\n[WAITING] Waiting 60s for all history responses...');
    await new Promise(r => setTimeout(r, 60000));
    
    // Summary
    console.log('\n=== HISTORY SYNC SUMMARY ===');
    console.log(`Total batches received: ${historyBatches}`);
    console.log(`Total messages synced to CRM: ${totalSynced}`);
    console.log(`\nPer-lead breakdown:`);
    for (const [phone, count] of Object.entries(syncedPerLead)) {
        const leadId = crmPhones[phone] || 'unknown';
        console.log(`  ${phone} (${leadId}): ${count} messages`);
    }
    
    const unsyncedLeads = matchedLeads.filter(l => !syncedPerLead[l.phone]);
    if (unsyncedLeads.length > 0) {
        console.log(`\nLeads with NO messages received:`);
        unsyncedLeads.forEach(l => console.log(`  - ${l.phone} (${l.leadId})`));
    }
    
    console.log('\n[DONE] History fetch complete. Disconnecting...');
    sock.end(undefined);
    
    // Exit cleanly after a moment
    setTimeout(() => process.exit(0), 3000);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
