const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';

async function main() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: true
    });
    
    sock.ev.on('creds.update', saveCreds);

    let messages = [];

    sock.ev.on('messages.upsert', async ({ messages: newMsgs, type }) => {
        console.log(`[messages.upsert] type=${type} count=${newMsgs.length}`);
        for (const m of newMsgs) {
            if (m.key?.remoteJid === TARGET_GROUP_ID) {
                messages.push(m);
                const sender = (m.key.participant || '').split('@')[0];
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
                const isAudio = !!m.message?.audioMessage;
                const audioSeconds = m.message?.audioMessage?.seconds;
                const ts = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
                console.log(`>>> [${ts}] Sender: ${sender} | Audio: ${isAudio} (${audioSeconds}s) | Text: "${text}"`);
            }
        }
    });

    sock.ev.on('messaging-history.set', ({ messages: histMsgs, chats }) => {
        console.log(`[messaging-history.set] count=${histMsgs?.length}`);
        for (const m of (histMsgs || [])) {
            if (m.key?.remoteJid === TARGET_GROUP_ID) {
                messages.push(m);
                const sender = (m.key.participant || '').split('@')[0];
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
                const isAudio = !!m.message?.audioMessage;
                const audioSeconds = m.message?.audioMessage?.seconds;
                const ts = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
                console.log(`>>> [HIST] [${ts}] Sender: ${sender} | Audio: ${isAudio} (${audioSeconds}s) | Text: "${text}"`);
            }
        }
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('[CONNECTED]');
            console.log('Attempting fetchMessageHistory for Zero7 group...');
            try {
                // Try requesting history from phone
                await sock.fetchMessageHistory(50, { remoteJid: TARGET_GROUP_ID });
                console.log('fetchMessageHistory requested.');
            } catch (err) {
                console.log('fetchMessageHistory error:', err.message);
            }
        }
    });

    // Run for 30 seconds
    setTimeout(() => {
        console.log(`\nFinished listening. Total Zero7 messages collected: ${messages.length}`);
        fs.writeFileSync(path.join(__dirname, 'zero7_captured.json'), JSON.stringify(messages, null, 2));
        process.exit(0);
    }, 30000);
}

main().catch(console.error);