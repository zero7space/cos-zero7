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
    
    let groupMessages = [];

    function processMsg(m) {
        if (m.key?.remoteJid !== TARGET_GROUP_ID) return;
        const msg = m.message;
        if (!msg) return;
        
        let text = msg.conversation || msg.extendedTextMessage?.text || '';
        const isAudio = !!msg.audioMessage;
        const isDoc = !!msg.documentMessage;
        const docName = msg.documentMessage?.fileName || '';
        const isVoice = msg.audioMessage?.ptt;
        const seconds = msg.audioMessage?.seconds;
        const caption = msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || '';
        const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
        const timeStr = new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const sender = (m.key.participant || '').split('@')[0];
        
        groupMessages.push({
            id: m.key.id,
            ts,
            timeStr,
            sender,
            isAudio,
            isVoice,
            seconds,
            isDoc,
            docName,
            text,
            caption,
            rawMsg: m
        });
    }

    sock.ev.on('messaging-history.set', ({ messages }) => {
        for (const m of (messages || [])) {
            processMsg(m);
        }
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const m of (messages || [])) {
            processMsg(m);
        }
    });

    sock.ev.on('connection.update', async (u) => {
        if (u.connection === 'open') {
            console.log('[CONNECTED] Connected to WA as ' + sock.user?.id);
            
            // Wait 5 seconds to collect history
            setTimeout(async () => {
                // Sort by timestamp
                groupMessages.sort((a, b) => a.ts - b.ts);
                console.log(`\n=== Total Zero7 Group Messages Found: ${groupMessages.length} ===\n`);
                
                // Show last 25 messages
                const recent = groupMessages.slice(-25);
                recent.forEach((item, idx) => {
                    console.log(`[${idx+1}] [${item.timeStr}] Sender: ${item.sender}`);
                    if (item.isAudio) console.log(`     AUDIO: ${item.seconds}s, PTT/Voice: ${item.isVoice}, ID: ${item.id}`);
                    if (item.isDoc) console.log(`     DOC: ${item.docName}, ID: ${item.id}`);
                    if (item.text) console.log(`     TEXT: "${item.text}"`);
                    if (item.caption) console.log(`     CAPTION: "${item.caption}"`);
                });
                
                // Save to file for further processing
                fs.writeFileSync(path.join(__dirname, 'recent_zero7.json'), JSON.stringify(groupMessages, null, 2));
                console.log('\nSaved to recent_zero7.json');
                
                setTimeout(() => process.exit(0), 1000);
            }, 8000);
        }
        if (u.connection === 'close') {
            console.log('[CLOSED]', u.lastDisconnect?.error?.message);
        }
    });
}

main().catch(console.error);