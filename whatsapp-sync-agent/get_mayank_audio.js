const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

const TARGET_MSG_ID = '3A8AF58E2D563CEFC8FA';

async function main() {
    console.log('=== Requesting Mayank Audio Resend ===');
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

    let downloaded = false;

    async function handleMsg(m) {
        if (!m.key) return;
        const id = m.key.id;
        if (id === TARGET_MSG_ID && !downloaded) {
            downloaded = true;
            console.log('\n[FOUND TARGET!] Downloading Mayank 300s audio...');
            try {
                const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                const mime = m.message?.audioMessage?.mimetype || 'audio/mp4';
                const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'mp3';
                const fileName = `wa_Mayank_Truman_Shah_Actual_${Date.now()}.${ext}`;
                const filePath = path.join(DOWNLOADS_DIR, fileName);
                fs.writeFileSync(filePath, buffer);
                console.log(`[SUCCESS] Saved: ${fileName} (${(buffer.length/1024).toFixed(1)} KB)`);
                setTimeout(() => process.exit(0), 1000);
            } catch (err) {
                console.error('Download error:', err.message);
            }
        }
    }

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of (messages || [])) await handleMsg(m);
    });

    sock.ev.on('messaging-history.set', async ({ messages }) => {
        for (const m of (messages || [])) await handleMsg(m);
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('[CONNECTED]');

            // Request placeholder resend
            const key = {
                remoteJid: TARGET_GROUP_ID,
                id: TARGET_MSG_ID,
                fromMe: false,
                participant: '4377242796129@s.whatsapp.net'
            };

            console.log('Sending requestPlaceholderResend for', TARGET_MSG_ID);
            try {
                if (sock.requestPlaceholderResend) {
                    await sock.requestPlaceholderResend(key);
                    console.log('requestPlaceholderResend sent.');
                }
            } catch (e) {
                console.log('requestPlaceholderResend error:', e.message);
            }

            // Also try with lid participant
            const keyLid = {
                remoteJid: TARGET_GROUP_ID,
                id: TARGET_MSG_ID,
                fromMe: false,
                participant: '4377242796129@lid'
            };
            try {
                if (sock.requestPlaceholderResend) {
                    await sock.requestPlaceholderResend(keyLid);
                    console.log('requestPlaceholderResend (LID) sent.');
                }
            } catch (e) {}

            setTimeout(() => {
                if (!downloaded) console.log('Timeout waiting for target message.');
                process.exit(0);
            }, 15000);
        }
    });
}

main().catch(console.error);
