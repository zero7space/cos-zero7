const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const QR_PATH = path.join(__dirname, 'qr_scan.png');

async function start() {
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

    sock.ev.on('connection.update', async (u) => {
        if (u.qr) {
            await QRCode.toFile(QR_PATH, u.qr, { width: 400, margin: 2 });
            console.log('[QR READY] Saved to ' + QR_PATH);
        }
        if (u.connection === 'open') {
            const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'unknown';
            console.log('[CONNECTED] Phone: ' + phone);
            console.log('[SUCCESS] WhatsApp linked! Waiting for history...');
        }
        if (u.connection === 'close') {
            const code = (u.lastDisconnect?.error instanceof Boom) ? u.lastDisconnect.error.output.statusCode : 0;
            console.log('[DISCONNECTED] Code: ' + code);
            if (code === DisconnectReason.loggedOut) {
                console.log('[LOGGED OUT] Need to re-scan QR');
            } else if (code === 515) {
                console.log('[RESTART] Reconnecting...');
                setTimeout(start, 3000);
            } else {
                console.log('[RECONNECTING] in 3s...');
                setTimeout(start, 3000);
            }
        }
    });

    let msgCount = 0;
    sock.ev.on('messaging-history.set', ({ messages, chats }) => {
        msgCount += (messages || []).length;
        console.log(`[HISTORY] ${messages?.length || 0} messages, ${chats?.length || 0} chats (total: ${msgCount})`);
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        console.log(`[MSG] type=${type} count=${messages.length}`);
    });
}

console.log('Starting personal WhatsApp link...');
console.log('Waiting for QR...');
start();

// Keep alive
setTimeout(() => {
    console.log('[TIMEOUT] Exiting after 5 minutes');
    process.exit(0);
}, 300000);