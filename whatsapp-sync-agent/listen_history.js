const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const https = require('https');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

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

async function main() {
    const loginRes = await httpRequest(`${CRM_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: CRM_EMAIL, password: CRM_PASSWORD })
    });
    const crmToken = loginRes.data.token;
    
    const leadsRes = await httpRequest(`${CRM_URL}/api/leads`, {
        headers: { 'Authorization': `Bearer ${crmToken}` }
    });
    const leads = leadsRes.data || [];
    const mayankLead = leads.find(l => l.name && l.name.includes('Mayank'));
    console.log('Mayank Lead:', mayankLead?.name, mayankLead?.id);

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

    let processed = false;

    async function handleMsg(m) {
        if (!m.key || m.key.remoteJid !== TARGET_GROUP_ID) return;
        const id = m.key.id;
        const isAudio = !!m.message?.audioMessage;
        const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
        console.log(`[ARRIVED] ID: ${id} | audio: ${isAudio} | text: "${text.substring(0, 40)}"`);

        if ((isAudio || id === '3A8AF58E2D563CEFC8FA') && !processed) {
            processed = true;
            console.log(`--> Downloading audio for Mayank Truman Shah...`);
            try {
                const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                const mime = m.message?.audioMessage?.mimetype || 'audio/mp4';
                const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'mp3';
                const fileName = `wa_Mayank_Truman_Shah_${Date.now()}.${ext}`;
                const filePath = path.join(DOWNLOADS_DIR, fileName);
                fs.writeFileSync(filePath, buffer);
                console.log(`--> Saved audio: ${filePath} (${(buffer.length/1024).toFixed(1)} KB)`);

                if (mayankLead) {
                    console.log(`--> Uploading to CRM...`);
                    const res = await uploadRecordingToCRM(
                        mayankLead.id,
                        filePath,
                        fileName,
                        mime,
                        `WhatsApp call recording (300s / 5 mins) from Zero7 group [16/9/2026, 5:34 pm]`,
                        crmToken
                    );
                    console.log(`--> CRM Upload Result: HTTP ${res.status}`);
                }
            } catch (e) {
                console.error('Download/upload failed:', e);
            }
        }
    }

    sock.ev.on('messages.upsert', async ({ messages }) => {
        console.log(`[EVENT messages.upsert] ${messages?.length || 0} messages`);
        for (const m of (messages || [])) await handleMsg(m);
    });

    sock.ev.on('messaging-history.set', async ({ messages }) => {
        console.log(`[EVENT messaging-history.set] ${messages?.length || 0} messages`);
        for (const m of (messages || [])) await handleMsg(m);
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('[CONNECTED] Requesting group history...');
            try {
                const qId = await sock.fetchMessageHistory(50, { remoteJid: TARGET_GROUP_ID }, null);
                console.log(`fetchMessageHistory dispatched, query ID: ${qId}`);
            } catch (e) {
                console.error('fetchMessageHistory error:', e.message);
            }

            setTimeout(() => {
                console.log('\nExiting after 15s wait.');
                process.exit(0);
            }, 15000);
        }
    });
}

main().catch(console.error);
