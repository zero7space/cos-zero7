const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Remaining audios to download
const TARGET_AUDIOS = {
    '3A8AF58E2D563CEFC8FA': 'Mayank_Truman_Shah',
    '3ACE0233465FDAD0ADEB': 'Devdas_Suvarna',
    '3AEF242070B6AD9FEC81': 'Babu_Gupta',
    '3A547CDC520CF773A0A5': 'Vikass_K_Dhannuka',
    '3A0E9925956A828084F8': 'Amit_Shah',
    '3AC58C40E3A583495A9C': 'Raj',
    '3A33565F805BA534B016': 'Pooja_Deora'
};

async function main() {
    console.log('=== Downloading Remaining Zero7 Audios ===');
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

    const downloaded = new Set();

    async function checkAndDownload(m) {
        if (!m.key || m.key.remoteJid !== TARGET_GROUP_ID) return;
        const id = m.key.id;
        if (!TARGET_AUDIOS[id] || downloaded.has(id)) return;

        const leadName = TARGET_AUDIOS[id];
        downloaded.add(id);
        console.log(`\n[TARGET FOUND] ID: ${id} => ${leadName}`);
        
        try {
            const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) });
            const mime = m.message?.audioMessage?.mimetype || 'audio/mp4';
            const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'mp3';
            const fileName = `wa_${leadName}_${Date.now()}.${ext}`;
            const filePath = path.join(DOWNLOADS_DIR, fileName);
            fs.writeFileSync(filePath, buffer);
            console.log(`[SAVED] ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
        } catch (err) {
            console.error(`[ERROR] Failed to download ${leadName}: ${err.message}`);
        }
    }

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of (messages || [])) await checkAndDownload(m);
    });

    sock.ev.on('messaging-history.set', async ({ messages }) => {
        for (const m of (messages || [])) await checkAndDownload(m);
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('[CONNECTED] Querying group history...');
            try {
                await sock.fetchMessageHistory(100, { remoteJid: TARGET_GROUP_ID }, null);
            } catch (e) {}

            setTimeout(() => {
                console.log(`\nTotal downloaded: ${downloaded.size}/${Object.keys(TARGET_AUDIOS).length}`);
                process.exit(0);
            }, 35000);
        }
    });
}

main().catch(console.error);
