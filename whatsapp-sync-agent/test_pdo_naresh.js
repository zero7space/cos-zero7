const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, proto, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const NARESH_PHONE_JID = '919820449022@s.whatsapp.net';
const NARESH_LID_JID = '206875840786491@lid';

async function test() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    console.log('[INIT] Starting test for Naresh Vyas history sync...');
    console.log('[INIT] My JID in creds:', state.creds.me?.id);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'debug' }),
        printQRInTerminal: false,
        browser: ['Chrome (Windows)', 'Desktop', '120.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        console.log('[CONN]', connection, lastDisconnect?.error?.message || '');
        if (connection === 'open') {
            console.log('[OPEN] Connected successfully!');
            
            // Try onWhatsApp first to verify presence
            const checkPhone = await sock.onWhatsApp('919820449022');
            console.log('[onWhatsApp Phone]:', JSON.stringify(checkPhone));

            // Wait 2s
            await new Promise(r => setTimeout(r, 2000));

            // Try sending HISTORY_SYNC_ON_DEMAND with NARESH_LID_JID
            console.log('\n--- Sending PDO with LID JID ---');
            try {
                const pdoLid = {
                    historySyncOnDemandRequest: {
                        chatJid: NARESH_LID_JID,
                        oldestMsgFromMe: false,
                        oldestMsgId: '',
                        oldestMsgTimestampMs: Date.now(),
                        onDemandMsgCount: 50
                    },
                    peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND
                };
                const resLid = await sock.sendPeerDataOperationMessage(pdoLid);
                console.log('[PDO LID Sent] result:', resLid);
            } catch (e) {
                console.log('[PDO LID Error]:', e.message);
            }

            await new Promise(r => setTimeout(r, 4000));

            // Try sending HISTORY_SYNC_ON_DEMAND with NARESH_PHONE_JID
            console.log('\n--- Sending PDO with PHONE JID ---');
            try {
                const pdoPhone = {
                    historySyncOnDemandRequest: {
                        chatJid: NARESH_PHONE_JID,
                        oldestMsgFromMe: false,
                        oldestMsgId: '',
                        oldestMsgTimestampMs: Date.now(),
                        onDemandMsgCount: 50
                    },
                    peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND
                };
                const resPhone = await sock.sendPeerDataOperationMessage(pdoPhone);
                console.log('[PDO Phone Sent] result:', resPhone);
            } catch (e) {
                console.log('[PDO Phone Error]:', e.message);
            }

            await new Promise(r => setTimeout(r, 4000));

            // Try FULL_HISTORY_SYNC_ON_DEMAND
            console.log('\n--- Sending FULL_HISTORY_SYNC_ON_DEMAND ---');
            try {
                const pdoFull = {
                    peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,
                    fullHistorySyncOnDemandRequest: {}
                };
                const resFull = await sock.sendPeerDataOperationMessage(pdoFull);
                console.log('[PDO Full Sent] result:', resFull);
            } catch (e) {
                console.log('[PDO Full Error]:', e.message);
            }
        }
    });

    sock.ev.on('messaging-history.set', (data) => {
        console.log('\n>>> [EVENT: messaging-history.set] RECEIVED!');
        console.log('    Messages count:', data.messages?.length || 0);
        console.log('    Chats count:', data.chats?.length || 0);
        for (const m of (data.messages || [])) {
            const jid = m.key?.remoteJid || '';
            const text = m.message?.conversation || m.message?.extendedTextMessage?.text || Object.keys(m.message || {})[0];
            console.log(`    MSG [${jid}]: ${text?.substring(0, 60)}`);
        }
    });

    sock.ev.on('messages.upsert', (data) => {
        console.log('\n>>> [EVENT: messages.upsert] count:', data.messages?.length);
        for (const m of data.messages) {
            const jid = m.key?.remoteJid || '';
            const text = m.message?.conversation || m.message?.extendedTextMessage?.text || Object.keys(m.message || {})[0];
            console.log(`    UPSERT [${jid}]: ${text?.substring(0, 60)}`);
        }
    });

    // Wait 25 seconds then close
    setTimeout(() => {
        console.log('\n[TEST FINISHED] Closing socket.');
        sock.end();
        process.exit(0);
    }, 25000);
}

test().catch(console.error);
