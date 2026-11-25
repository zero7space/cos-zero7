const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, proto } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const https = require('https');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const NARESH_JID = '919820449022@s.whatsapp.net';
const NARESH_ALT_JID = '9820449022@s.whatsapp.net';

async function main() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Windows)', 'Desktop', '120.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        console.log(`[messages.upsert] type=${type} count=${messages.length}`);
        for (const m of messages) {
            const jid = m.key?.remoteJid || '';
            if (jid.includes('9820449022')) {
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '[Media]';
                console.log(`FOUND NARESH MSG: [${m.key.fromMe ? 'OUT' : 'IN'}] ${text}`);
            }
        }
    });

    sock.ev.on('messaging-history.set', ({ messages, chats }) => {
        console.log(`[history.set] msgs=${messages?.length} chats=${chats?.length}`);
        for (const m of (messages || [])) {
            const jid = m.key?.remoteJid || '';
            if (jid.includes('9820449022')) {
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '[Media]';
                console.log(`FOUND NARESH HIST MSG: [${m.key.fromMe ? 'OUT' : 'IN'}] ${text}`);
            }
        }
    });

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('[CONNECTED] as', sock.user?.id);
            console.log('Sending HISTORY_SYNC_ON_DEMAND for Naresh Vyas...');
            try {
                // Request 50 messages for Naresh Vyas
                const pdoMessage = {
                    historySyncOnDemandRequest: {
                        chatJid: NARESH_JID,
                        oldestMsgFromMe: false,
                        oldestMsgId: '',
                        oldestMsgTimestampMs: Date.now(),
                        onDemandMsgCount: 50
                    },
                    peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND
                };
                // Send peer data operation message
                if (sock.sendPeerDataOperationMessage) {
                    await sock.sendPeerDataOperationMessage(pdoMessage);
                    console.log('PDO request sent via sendPeerDataOperationMessage');
                } else {
                    console.log('sendPeerDataOperationMessage not available on socket directly');
                }
            } catch (err) {
                console.log('PDO error:', err.message);
            }
        }
    });

    setTimeout(() => {
        console.log('Timeout reached. Exiting.');
        process.exit(0);
    }, 20000);
}

main().catch(console.error);