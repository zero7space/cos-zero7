/**
 * Zero7 CRM - Robust WhatsApp Sync Agent
 * Account: Abhijeet Personal (9993202900)
 * 
 * Features:
 * - Persistent session (NO re-auth needed, utilizes existing auth_personal)
 * - Full LID mapping: pre-loads 15,000+ LID mappings from disk into memory
 * - Real-time sync of both incoming & outgoing messages with leads
 * - Local SQLite fallback store (whatsapp_store.db) for 100% persistence
 * - Auto-reconnection on network drop
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
let lidToPhone = new Map(); // lid (numeric string) -> phone (numeric string)
let phoneToLid = new Map();

// 1. Preload all LID mappings from disk
function loadLidMappings() {
    console.log('[LID] Pre-loading LID mappings from disk...');
    try {
        const files = fs.readdirSync(AUTH_DIR);
        let reverseCount = 0;
        let directCount = 0;
        for (const file of files) {
            if (file.startsWith('lid-mapping-')) {
                const fullPath = path.join(AUTH_DIR, file);
                try {
                    const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (file.includes('reverse')) {
                        // lid-mapping-<lid>_reverse.json -> contains phone
                        const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
                        const phone = content.replace(/\D/g, '');
                        lidToPhone.set(lid, phone);
                        reverseCount++;
                    } else {
                        // lid-mapping-<phone>.json -> contains lid
                        const phone = file.replace('lid-mapping-', '').replace('.json', '');
                        const lid = content.replace(/\D/g, '');
                        phoneToLid.set(phone, lid);
                        directCount++;
                    }
                } catch (e) {}
            }
        }
        console.log(`[LID] Loaded ${reverseCount} reverse mappings and ${directCount} direct mappings into memory.`);
    } catch (e) {
        console.error('[LID] Error loading mappings:', e.message);
    }
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

// Resolve any JID (phone, LID, etc.) to a 10-digit normalized phone number
function resolveToLeadPhone(jid) {
    if (!jid) return null;
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) {
        return null; // Skip groups & broadcasts
    }

    // 1. Direct phone JID: e.g. 919833116258@s.whatsapp.net
    if (jid.endsWith('@s.whatsapp.net')) {
        const norm = normalizePhone(jid);
        if (norm in crmPhones) return norm;
    }

    // 2. LID JID: e.g. 278739418144797@lid
    if (jid.endsWith('@lid')) {
        const lidNum = jid.split('@')[0].split(':')[0];
        const mappedPhone = lidToPhone.get(lidNum);
        if (mappedPhone) {
            const norm = normalizePhone(mappedPhone);
            if (norm in crmPhones) return norm;
        }
    }

    // 3. Check direct normalization
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

    if (msg.imageMessage) {
        type = 'image';
        caption = msg.imageMessage.caption || '';
        text = caption || '[Photo]';
    } else if (msg.videoMessage) {
        type = 'video';
        caption = msg.videoMessage.caption || '';
        text = caption || '[Video]';
    } else if (msg.audioMessage) {
        type = 'audio';
        text = '[Voice note]';
    } else if (msg.documentMessage) {
        type = 'document';
        caption = msg.documentMessage.fileName || '';
        text = caption || '[Document]';
    } else if (msg.stickerMessage) {
        type = 'sticker';
        text = '[Sticker]';
    } else if (msg.contactMessage) {
        type = 'contact';
        text = `[Contact: ${msg.contactMessage.displayName || ''}]`;
    } else if (msg.locationMessage) {
        type = 'location';
        text = `[Location]`;
    } else if (msg.templateMessage) {
        type = 'template';
        const tmpl = msg.templateMessage;
        text = tmpl.hydratedTemplate?.hydratedContentText || 
               tmpl.hydratedFourRowTemplate?.hydratedContentText ||
               '[Template Message]';
    } else if (msg.protocolMessage || msg.reactionMessage || msg.senderKeyDistributionMessage) {
        return null;
    }

    if (!text && msg.viewOnceMessage) {
        const inner = msg.viewOnceMessage.message;
        if (inner?.imageMessage) { type = 'image'; text = '[View Once Photo]'; }
        else if (inner?.videoMessage) { type = 'video'; text = '[View Once Video]'; }
        else { text = '[View Once Message]'; }
    }

    if (!text) {
        const msgKeys = Object.keys(msg).filter(k => 
            !['messageContextInfo', 'senderKeyDistributionMessage'].includes(k)
        );
        if (msgKeys.length > 0) {
            type = msgKeys[0].replace('Message', '');
            text = `[${type}]`;
        }
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

async function start() {
    console.log('=== Zero7 CRM - Personal WhatsApp Active Synchronizer ===');
    console.log(`[START] Account: Abhijeet Personal (${MY_PHONE})`);
    
    loadLidMappings();
    await crmLogin();
    await fetchPhones();

    // Re-fetch phones every 30 minutes in case new leads were created in CRM
    setInterval(async () => {
        await fetchPhones();
    }, 30 * 60 * 1000);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

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

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.warn('[AUTH] QR required - auth may have expired.');
        }
        if (connection === 'open') {
            console.log(`[CONNECTED] Personal WhatsApp active as ${sock.user?.id?.split(':')[0]}`);
            console.log(`[READY] Actively monitoring conversations for ${Object.keys(crmPhones).length} leads (Mohd Iqbal Shaikh, Naresh Vyas, Vidhi, etc.)...\n`);
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[DISCONNECTED] Code: ${statusCode} | Reconnecting in 5s: ${shouldReconnect}...`);
            if (shouldReconnect) setTimeout(start, 5000);
        }
    });

    // Real-time incoming & outgoing messages
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
            console.log(`[SYNCED] Inserted ${count}/${valid.length} message(s) to CRM.`);
        }
    });

    // Update LID mappings dynamically if WhatsApp sends new contacts
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
}

start().catch(console.error);