const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');

async function main() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (u) => {
        if (u.connection === 'open') {
            console.log('[CONNECTED]');
            try {
                const groups = await sock.groupFetchAllParticipating();
                console.log(`Found ${Object.keys(groups).length} groups.`);
                for (const [jid, g] of Object.entries(groups)) {
                    console.log(`GROUP: "${g.subject}" | ID: ${jid} | Participants: ${g.participants?.length}`);
                }
            } catch (err) {
                console.error('Error fetching groups:', err.message);
            }
            setTimeout(() => process.exit(0), 1000);
        }
    });
}

main().catch(console.error);