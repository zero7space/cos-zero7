const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';

async function main() {
    console.log('=== Checking Zero7 WhatsApp Group for Recent Messages & Audio ===');
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
    
    let messagesList = [];

    function record(m) {
        if (!m.key) return;
        const remoteJid = m.key.remoteJid;
        if (remoteJid !== TARGET_GROUP_ID) return;

        const msg = m.message;
        if (!msg) return;

        const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
        const timeStr = new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const sender = (m.key.participant || '').split('@')[0];
        
        let text = msg.conversation || msg.extendedTextMessage?.text || '';
        let isAudio = !!msg.audioMessage || (msg.documentMessage?.mimetype?.includes('audio'));
        let isDoc = !!msg.documentMessage;
        let docName = msg.documentMessage?.fileName || '';
        let audioSeconds = msg.audioMessage?.seconds;
        let caption = msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || '';

        messagesList.push({
            id: m.key.id,
            ts,
            timeStr,
            sender,
            text,
            isAudio,
            audioSeconds,
            isDoc,
            docName,
            caption,
            raw: m
        });

        console.log(`[MSG FOUND] [${timeStr}] Sender: ${sender} | Audio: ${isAudio} (${audioSeconds || 0}s) | Doc: ${docName || 'No'} | Text: "${text}" | Caption: "${caption}"`);
    }

    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const m of (messages || [])) record(m);
    });

    sock.ev.on('messaging-history.set', ({ messages }) => {
        for (const m of (messages || [])) record(m);
    });

    sock.ev.on('connection.update', async (u) => {
        if (u.connection === 'open') {
            console.log(`[CONNECTED] Logged in as ${sock.user?.id?.split(':')[0]}`);
            console.log('Listening for offline queue / sync packets for 15 seconds...');

            setTimeout(async () => {
                console.log(`\n=== Inspection Complete: Total ${messagesList.length} messages found ===\n`);
                messagesList.sort((a, b) => a.ts - b.ts);
                
                fs.writeFileSync(
                    path.join(__dirname, 'latest_zero7_inspection.json'),
                    JSON.stringify(messagesList.map(m => ({
                        id: m.id,
                        ts: m.ts,
                        timeStr: m.timeStr,
                        sender: m.sender,
                        text: m.text,
                        isAudio: m.isAudio,
                        audioSeconds: m.audioSeconds,
                        docName: m.docName,
                        caption: m.caption
                    })), null, 2)
                );

                process.exit(0);
            }, 15000);
        }
        if (u.connection === 'close') {
            console.log('[CLOSED]', u.lastDisconnect?.error?.message);
        }
    });
}

main().catch(console.error);
