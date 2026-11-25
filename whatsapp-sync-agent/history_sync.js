const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const AUTH_DIR = path.join(__dirname, 'auth_central');
const QR_PATH = path.join(__dirname, 'qr_central.png');

function httpReq(url, method, body, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const opts = { hostname: parsed.hostname, port: 443, path: parsed.pathname + parsed.search, method, headers: { 'Content-Type': 'application/json', ...headers } };
        const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } }); });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function normalizePhone(jid) {
    if (!jid) return '';
    const num = jid.split('@')[0].replace(/\D/g, '');
    return num.length >= 10 ? num.slice(-10) : num;
}

async function main() {
    console.log('Logging into CRM...');
    const loginResp = await httpReq(`${CONFIG.crm_url}/api/auth/login`, 'POST', { email: CONFIG.crm_email, password: CONFIG.crm_password });
    const token = loginResp.token;
    console.log('CRM login OK');

    const phones = await httpReq(`${CONFIG.crm_url}/api/leads/phones`, 'GET', null, { Authorization: `Bearer ${token}` });
    console.log(`CRM has ${Object.keys(phones).length} lead phones`);
    console.log('Sample phones:', Object.keys(phones).slice(0, 5).join(', '));

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version, auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Zero7 CRM', 'Chrome', '120.0'],
        syncFullHistory: true,
        markOnlineOnConnect: false,
        getMessage: async () => undefined
    });

    sock.ev.on('creds.update', saveCreds);

    let allMessages = [];
    let connected = false;

    sock.ev.on('connection.update', async (u) => {
        if (u.qr) {
            await QRCode.toFile(QR_PATH, u.qr, { width: 400, margin: 2 });
            console.log(`\nQR SAVED => ${QR_PATH}\nScan with WhatsApp (9479007951) now!\n`);
        }
        if (u.connection === 'open') {
            connected = true;
            const me = sock.user?.id || '';
            console.log(`CONNECTED as ${normalizePhone(me)}`);
            if (fs.existsSync(QR_PATH)) fs.unlinkSync(QR_PATH);
        }
        if (u.connection === 'close') {
            console.log('DISCONNECTED:', u.lastDisconnect?.error?.output?.statusCode);
        }
    });

    // Listen ALL events for debugging
    sock.ev.on('messages.upsert', ({ messages, type }) => {
        console.log(`[messages.upsert] type=${type} count=${messages.length}`);
        let leadCount = 0;
        for (const msg of messages) {
            const jid = msg.key?.remoteJid || '';
            if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;
            const phone = normalizePhone(jid);
            const isLead = phone in phones;
            const m = msg.message || {};
            let text = m.conversation || m.extendedTextMessage?.text || '';
            if (m.imageMessage) text = m.imageMessage.caption || '[Image]';
            if (m.audioMessage) text = '[Audio]';
            if (m.videoMessage) text = m.videoMessage.caption || '[Video]';
            if (m.documentMessage) text = m.documentMessage.fileName || '[Document]';
            if (!text) text = '[' + Object.keys(m)[0] + ']';
            
            if (isLead) {
                leadCount++;
                allMessages.push({
                    lead_phone: phone, direction: msg.key.fromMe ? 'outgoing' : 'incoming',
                    message_text: text, message_type: m.imageMessage ? 'image' : m.audioMessage ? 'audio' : 'text',
                    timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
                    wa_message_id: msg.key.id, status: 'delivered'
                });
                console.log(`  LEAD ${phone}: ${msg.key.fromMe ? '>' : '<'} ${text.substring(0,80)}`);
            }
        }
        if (leadCount > 0) console.log(`  => ${leadCount} lead messages in this batch`);
    });

    sock.ev.on('messaging-history.set', ({ messages, chats, contacts, isLatest }) => {
        console.log(`[HISTORY] msgs=${messages?.length} chats=${chats?.length} contacts=${contacts?.length} isLatest=${isLatest}`);
        let leadCount = 0;
        for (const msg of (messages || [])) {
            const jid = msg.key?.remoteJid || '';
            if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;
            const phone = normalizePhone(jid);
            if (phone in phones) {
                leadCount++;
                const m = msg.message || {};
                let text = m.conversation || m.extendedTextMessage?.text || '';
                if (m.imageMessage) text = m.imageMessage.caption || '[Image]';
                if (m.audioMessage) text = '[Audio]';
                if (!text) text = '[' + (Object.keys(m)[0] || 'unknown') + ']';
                allMessages.push({
                    lead_phone: phone, direction: msg.key.fromMe ? 'outgoing' : 'incoming',
                    message_text: text, message_type: 'text',
                    timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
                    wa_message_id: msg.key.id, status: 'delivered'
                });
                console.log(`  HIST ${phone}: ${msg.key.fromMe ? '>' : '<'} ${text.substring(0,60)}`);
            }
        }
        console.log(`  => ${leadCount} lead messages from history`);
    });

    // Sync after 3 minutes
    setTimeout(async () => {
        console.log(`\n=== FINAL: ${allMessages.length} CRM messages captured ===`);
        if (allMessages.length > 0) {
            const accountPhone = normalizePhone(sock.user?.id || '');
            for (let i = 0; i < allMessages.length; i += 50) {
                const batch = allMessages.slice(i, i + 50);
                const resp = await httpReq(`${CONFIG.crm_url}/api/whatsapp/messages/sync`, 'POST', 
                    { account_phone: accountPhone, messages: batch }, { Authorization: `Bearer ${token}` });
                console.log(`Synced batch ${Math.floor(i/50)+1}: inserted=${resp.inserted}/${batch.length}`);
            }
        }
        console.log('Done!');
        setTimeout(() => process.exit(0), 5000);
    }, 180000);

    console.log('Waiting 3 minutes for history...');
}
main().catch(e => { console.error(e); process.exit(1); });