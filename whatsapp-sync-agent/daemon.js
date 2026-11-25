/**
 * Zero7 CRM - 24/7 Always-On Multi-Account WhatsApp Sync Daemon
 * 
 * Runs continuously on DigitalOcean Droplet:
 *  1. Multi-Account Management (Personal + Zero7 Central) with isolated token stores
 *  2. Real-time Live 1-on-1 Lead Message Sync (Incoming from lead & Outgoing to lead)
 *  3. Zero7 Team Group Monitoring (Audio recordings + team notes matched to leads)
 *  4. Historical Catch-Up Sync upon connection
 *  5. In-CRM Admin Dashboard QR scanning and session management (Port 8085 API)
 *  6. Anti-ban companion precautions (markOnlineOnConnect: false, desktop client identifier)
 */

// WebCrypto polyfill for Node.js 18 Baileys compatibility
const crypto = require('crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
}

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage;

async function loadBaileys() {
    const b = await import('@whiskeysockets/baileys');
    makeWASocket = b.default || b.makeWASocket;
    useMultiFileAuthState = b.useMultiFileAuthState;
    DisconnectReason = b.DisconnectReason;
    fetchLatestBaileysVersion = b.fetchLatestBaileysVersion;
    downloadMediaMessage = b.downloadMediaMessage;
}

const pino = require('pino');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const QRCode = require('qrcode');

// Configuration
const CRM_BASE_URL = process.env.CRM_URL || 'http://127.0.0.1:8000';
const CRM_FALLBACK_URL = 'https://cos.zero7.space';
const CRM_EMAIL = process.env.CRM_EMAIL || 'abhijeet@zero7.space';
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'admin123';
const TARGET_GROUP_ID = '120363426285521103@g.us'; // Zero7 team group
const CONTROL_PORT = 8085;

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const logger = pino({ level: 'warn' });

// Global Shared State
let crmToken = null;
let activeCrmBaseUrl = CRM_BASE_URL;
let crmPhones = {};        // normalized 10-digit phone -> lead_id
let crmLeads = [];         // full lead objects
let lastContextLead = null;
let lastContextTime = 0;
let pendingAudios = [];    // [{ msg, time, sender, mimeType, accountId }]
const processedMsgIds = new Set();

// ── 1. HTTP Client Helper ────────────────────────────────────

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);
        const reqOpts = {
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https') ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 15000
        };

        const req = mod.request(reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data }); }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request to ${url} timed out`));
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function crmLogin() {
    const urls = [CRM_BASE_URL, CRM_FALLBACK_URL];
    for (const base of urls) {
        try {
            const resp = await httpRequest(`${base}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: CRM_EMAIL, password: CRM_PASSWORD })
            });
            if (resp.status === 200 && resp.data?.token) {
                crmToken = resp.data.token;
                activeCrmBaseUrl = base;
                console.log(`[CRM] Logged in successfully via ${base}`);
                return true;
            }
        } catch (e) {
            // try next url
        }
    }
    console.error('[CRM] Login failed on all URLs.');
    return false;
}

async function fetchCRMInventory() {
    if (!crmToken) await crmLogin();
    if (!crmToken) return false;

    const base = activeCrmBaseUrl;
    try {
        const phoneResp = await httpRequest(`${base}/api/leads/phones`, {
            headers: { 'Authorization': `Bearer ${crmToken}` }
        });
        if (phoneResp.status === 200 && phoneResp.data) {
            crmPhones = phoneResp.data;
        }

        const leadsResp = await httpRequest(`${base}/api/leads`, {
            headers: { 'Authorization': `Bearer ${crmToken}` }
        });
        if (leadsResp.status === 200 && Array.isArray(leadsResp.data)) {
            crmLeads = leadsResp.data;
        }

        console.log(`[CRM] Inventory updated: ${Object.keys(crmPhones).length} lead phone numbers, ${crmLeads.length} total leads`);
        return true;
    } catch (e) {
        console.error('[CRM] Failed to fetch inventory:', e.message);
        return false;
    }
}

let isFetchingInventory = false;
async function ensureCRMInventory(retries = 10, delayMs = 2000) {
    if (isFetchingInventory) return true;
    isFetchingInventory = true;
    try {
        for (let i = 0; i < retries; i++) {
            const ok = await fetchCRMInventory();
            if (ok && Object.keys(crmPhones).length > 0) {
                return true;
            }
            console.warn(`[CRM] Inventory fetch attempt ${i + 1}/${retries} failed or empty. Retrying in ${delayMs / 1000}s...`);
            await new Promise(r => setTimeout(r, delayMs));
            delayMs = Math.min(delayMs * 1.5, 8000);
        }
        return Object.keys(crmPhones).length > 0;
    } finally {
        isFetchingInventory = false;
    }
}

async function registerAccountInCRM(phoneNumber, label) {
    if (!phoneNumber) return;
    if (!crmToken) await crmLogin();
    try {
        await httpRequest(`${activeCrmBaseUrl}/api/whatsapp/accounts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${crmToken}`
            },
            body: JSON.stringify({ phone_number: phoneNumber, label: label })
        });
        console.log(`[CRM] Account registered/confirmed in CRM: ${phoneNumber} (${label})`);
    } catch (e) {
        console.warn(`[CRM] Warning registering account ${phoneNumber}:`, e.message);
    }
}

async function syncMessagesToCRM(messages, accountPhone) {
    if (!messages || messages.length === 0) return 0;
    if (!crmToken) await crmLogin();

    try {
        const resp = await httpRequest(`${activeCrmBaseUrl}/api/whatsapp/messages/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${crmToken}`
            },
            body: JSON.stringify({
                account_phone: accountPhone,
                messages: messages
            })
        });
        return resp.data?.inserted || 0;
    } catch (e) {
        console.error('[CRM] Sync error:', e.message);
        return 0;
    }
}

async function uploadAudioToLead(lead, filePath, fileName, mimeType, notes) {
    if (!crmToken) await crmLogin();
    const boundary = '----Zero7Boundary' + Math.random().toString(36).substring(2);
    const fileBytes = fs.readFileSync(filePath);

    let body = '';
    body += `--${boundary}\r\nContent-Disposition: form-data; name="outcome"\r\n\r\nConnected\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n${notes || 'WhatsApp call recording from Zero7 group'}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="duration_minutes"\r\n\r\n5\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="recording"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;

    const bodyStart = Buffer.from(body, 'utf8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const fullBody = Buffer.concat([bodyStart, fileBytes, bodyEnd]);

    try {
        const urlObj = new URL(`${activeCrmBaseUrl}/api/leads/${lead.id}/calls`);
        return new Promise((resolve, reject) => {
            const req = (activeCrmBaseUrl.startsWith('https') ? https : http).request({
                hostname: urlObj.hostname,
                port: urlObj.port || (activeCrmBaseUrl.startsWith('https') ? 443 : 80),
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${crmToken}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': fullBody.length,
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    console.log(`[AUDIO SYNC] Uploaded recording for ${lead.name} (HTTP ${res.statusCode})`);
                    resolve(data);
                });
            });
            req.on('error', reject);
            req.write(fullBody);
            req.end();
        });
    } catch (e) {
        console.error(`[AUDIO SYNC] Failed to upload audio for ${lead.name}:`, e.message);
    }
}

async function uploadLeadMedia(lead, fileBuffer, fileName, mimeType, messageType, caption, waMessageId, accountPhone) {
    if (!crmToken) await crmLogin();
    const boundary = '----Zero7Boundary' + Math.random().toString(36).substring(2);

    let body = '';
    body += `--${boundary}\r\nContent-Disposition: form-data; name="lead_phone"\r\n\r\n${lead.phone || ''}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="wa_message_id"\r\n\r\n${waMessageId || ''}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="media_type"\r\n\r\n${messageType || 'image'}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption || ''}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="account_phone"\r\n\r\n${accountPhone || ''}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;

    const bodyStart = Buffer.from(body, 'utf8');
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const fullBody = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

    try {
        const urlObj = new URL(`${activeCrmBaseUrl}/api/whatsapp/media/upload`);
        return new Promise((resolve) => {
            const req = (activeCrmBaseUrl.startsWith('https') ? https : http).request({
                hostname: urlObj.hostname,
                port: urlObj.port || (activeCrmBaseUrl.startsWith('https') ? 443 : 80),
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${crmToken}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': fullBody.length,
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        console.log(`[MEDIA SYNC] Uploaded ${messageType} for ${lead.name} to Drive (HTTP ${res.statusCode})`);
                        resolve(parsed);
                    } catch {
                        resolve({ status: 'raw', data });
                    }
                });
            });
            req.on('error', (err) => {
                console.error(`[MEDIA SYNC] Error uploading media for ${lead.name}:`, err.message);
                resolve(null);
            });
            req.write(fullBody);
            req.end();
        });
    } catch (e) {
        console.error(`[MEDIA SYNC] Exception uploading media for ${lead.name}:`, e.message);
        return null;
    }
}

async function addNoteToLead(leadId, noteText) {
    if (!crmToken) await crmLogin();
    try {
        await httpRequest(`${activeCrmBaseUrl}/api/leads/${leadId}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${crmToken}`
            },
            body: JSON.stringify({ content: noteText })
        });
        console.log(`[NOTE SYNC] Note added to lead ${leadId}: "${noteText.substring(0, 40)}..."`);
    } catch (e) {
        console.error(`[NOTE SYNC] Note error:`, e.message);
    }
}

async function syncZero7GroupMessageToCRM(payload) {
    if (!crmToken) await crmLogin();
    try {
        await httpRequest(`${activeCrmBaseUrl}/api/whatsapp/zero7/group-messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${crmToken}`
            },
            body: JSON.stringify(payload)
        });
        console.log(`[GROUP SYNC] Zero7 group message synced to CRM: "${(payload.message_text || '').substring(0, 40)}"`);
    } catch (e) {
        console.warn(`[GROUP SYNC] Group message sync warning:`, e.message);
    }
}

// ── 2. Phone & LID Resolution ────────────────────────────────

function normalizePhone(jidOrPhone) {
    if (!jidOrPhone) return '';
    const clean = jidOrPhone.split('@')[0].split(':')[0].replace(/\D/g, '');
    return clean.length >= 10 ? clean.slice(-10) : clean;
}

function findLeadInText(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    // 1. Phone number match in text
    const phones = text.match(/(?:\+?91)?[\s-]?(\d{10})/g);
    if (phones) {
        for (const p of phones) {
            const norm = normalizePhone(p);
            const found = crmLeads.find(l => normalizePhone(l.phone) === norm);
            if (found) return found;
        }
    }

    // 2. Full name match
    for (const lead of crmLeads) {
        if (lead.name && lead.name.length >= 3) {
            const lName = lead.name.toLowerCase();
            if (lower.includes(lName)) return lead;

            const parts = lName.split(/\s+/).filter(p => p.length >= 4);
            for (const part of parts) {
                if (['kumar', 'sharma', 'singh', 'patil', 'shah', 'gupta', 'lead', 'private', 'limited'].includes(part)) continue;
                if (lower.includes(part)) return lead;
            }
        }
    }
    return null;
}

// ── 3. WhatsApp Account Controller (Isolated per Account) ───

class WhatsAppAccount {
    constructor(config) {
        this.id = config.id;
        this.label = config.label;
        this.defaultPhone = config.defaultPhone;
        this.authDir = config.authDir;

        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }

        this.sock = null;
        this.status = 'initializing'; // 'connected' | 'qr_ready' | 'connecting' | 'disconnected' | 'logged_out'
        this.phone = this.defaultPhone;
        this.userName = '';
        this.qrRaw = null;
        this.qrDataUrl = null;
        this.qrGeneratedAt = null;
        this.connectedAt = null;
        this.messagesSynced = 0;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.lidToPhone = new Map();
        this.phoneToLid = new Map();

        this.loadLidMappings();
    }

    loadLidMappings() {
        try {
            if (!fs.existsSync(this.authDir)) return;
            const files = fs.readdirSync(this.authDir);
            let count = 0;
            for (const file of files) {
                if (file.startsWith('lid-mapping-')) {
                    try {
                        const content = JSON.parse(fs.readFileSync(path.join(this.authDir, file), 'utf8'));
                        if (file.includes('reverse')) {
                            const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
                            const phone = content.replace(/\D/g, '');
                            this.lidToPhone.set(lid, phone);
                            this.phoneToLid.set(phone, lid);
                            count++;
                        } else {
                            const phone = file.replace('lid-mapping-', '').replace('.json', '');
                            const lid = content.replace(/\D/g, '');
                            this.phoneToLid.set(phone, lid);
                            this.lidToPhone.set(lid, phone);
                            count++;
                        }
                    } catch (e) {}
                }
            }
            if (count > 0) {
                console.log(`[${this.id}] Loaded ${count} bidirectional LID mappings`);
            }
        } catch (e) {
            console.warn(`[${this.id}] Warning reading LID mappings:`, e.message);
        }
    }

    resolveToLeadPhone(jid) {
        if (!jid) return null;
        if (jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return null;
        if (jid.endsWith('@g.us')) return null;

        // 1. Direct phone JID (e.g. 918085892345@s.whatsapp.net)
        if (jid.endsWith('@s.whatsapp.net')) {
            const norm = normalizePhone(jid);
            if (norm in crmPhones) return norm;
            if (this.id === 'central' && norm && norm.length >= 10) return norm;
            if (norm && (norm.includes('9993202900') || norm.includes('9479007951'))) return norm;
        }

        // 2. LID (privacy ID e.g. 17978884153481@lid)
        if (jid.endsWith('@lid')) {
            const lidNum = jid.split('@')[0].split(':')[0];
            let mappedPhone = this.lidToPhone.get(lidNum);

            // If not cached in memory, check on-disk mapping files
            if (!mappedPhone) {
                const files = fs.existsSync(this.authDir) ? fs.readdirSync(this.authDir) : [];
                for (const f of files) {
                    if (f.startsWith('lid-mapping-') && !f.includes('reverse')) {
                        try {
                            const content = JSON.parse(fs.readFileSync(path.join(this.authDir, f), 'utf8'));
                            if (content.replace(/\D/g, '') === lidNum) {
                                mappedPhone = f.replace('lid-mapping-', '').replace('.json', '');
                                this.lidToPhone.set(lidNum, mappedPhone);
                                this.phoneToLid.set(mappedPhone, lidNum);
                                console.log(`[${this.id}] Dynamically resolved LID: ${lidNum} -> ${mappedPhone}`);
                                break;
                            }
                        } catch (e) {}
                    }
                }
            }

            if (mappedPhone) {
                const norm = normalizePhone(mappedPhone);
                if (norm in crmPhones) return norm;
                if (this.id === 'central' && norm && norm.length >= 10) return norm;
                if (norm && (norm.includes('9993202900') || norm.includes('9479007951'))) return norm;
            }
        }

        // 3. Fallback direct normalization
        const directNorm = normalizePhone(jid);
        if (directNorm in crmPhones) return directNorm;
        // For central account, also capture incoming messages even if not yet in CRM leads
        if (this.id === 'central' && directNorm && directNorm.length >= 10) {
            return directNorm;
        }
        if (directNorm && (directNorm.includes('9993202900') || directNorm.includes('9479007951'))) {
            return directNorm;
        }

        return null;
    }

    parseMessage(m) {
        if (!m.key || !m.message) return null;
        const jid = m.key.remoteJid || '';
        const leadPhone = this.resolveToLeadPhone(jid);
        if (!leadPhone) return null;

        const fromMe = !!m.key.fromMe;
        const msg = m.message;
        let text = msg.conversation || msg.extendedTextMessage?.text || '';
        let type = 'text';
        let caption = null;

        if (msg.imageMessage) {
            type = 'image';
            caption = msg.imageMessage.caption || '';
            text = caption || '[Photo]';
        } else if (msg.videoMessage) {
            type = 'video';
            caption = msg.videoMessage.caption || '';
            text = caption || '[Video]';
        } else if (msg.audioMessage) {
            type = 'audio';
            text = '[Voice note]';
        } else if (msg.documentMessage) {
            type = 'document';
            caption = msg.documentMessage.fileName || '';
            text = caption || '[Document]';
        } else if (msg.stickerMessage) {
            type = 'sticker';
            text = '[Sticker]';
        } else if (msg.contactMessage) {
            type = 'contact';
            text = `[Contact: ${msg.contactMessage.displayName || ''}]`;
        } else if (msg.locationMessage) {
            type = 'location';
            text = '[Location]';
        } else if (msg.templateMessage) {
            type = 'template';
            text = msg.templateMessage.hydratedTemplate?.hydratedContentText ||
                   msg.templateMessage.hydratedFourRowTemplate?.hydratedContentText || '[Template Message]';
        } else if (msg.protocolMessage || msg.reactionMessage || msg.senderKeyDistributionMessage) {
            return null;
        }

        if (!text && msg.viewOnceMessage) {
            const inner = msg.viewOnceMessage.message;
            if (inner?.imageMessage) { type = 'image'; text = '[View Once Photo]'; }
            else if (inner?.videoMessage) { type = 'video'; text = '[View Once Video]'; }
            else { text = '[View Once Message]'; }
        }

        if (!text) {
            const msgKeys = Object.keys(msg).filter(k => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(k));
            if (msgKeys.length > 0) {
                type = msgKeys[0].replace('Message', '');
                text = `[${type}]`;
            }
        }
        if (!text) return null;

        const ts = m.messageTimestamp
            ? new Date(Number(m.messageTimestamp) * 1000).toISOString()
            : new Date().toISOString();

        return {
            lead_phone: leadPhone,
            direction: fromMe ? 'outgoing' : 'incoming',
            message_text: text,
            message_type: type,
            media_caption: caption,
            timestamp: ts,
            wa_message_id: m.key.id,
            status: 'delivered'
        };
    }

    async processZero7GroupMessage(msg) {
        if (!msg.message || !msg.key) return;
        const msgId = msg.key.id;
        if (processedMsgIds.has(msgId)) return;
        processedMsgIds.add(msgId);

        const m = msg.message;
        const sender = (msg.key.participant || msg.key.remoteJid || '').split('@')[0];
        const time = Number(msg.messageTimestamp || Math.floor(Date.now() / 1000));
        const timeStr = new Date(time * 1000).toISOString();

        const isAudio = !!(m.audioMessage || (m.documentMessage && (m.documentMessage.mimetype || '').includes('audio')));
        const text = m.conversation || m.extendedTextMessage?.text || '';

        // Audio message received in Zero7 group
        if (isAudio) {
            const mimeType = m.audioMessage?.mimetype || m.documentMessage?.mimetype || 'audio/ogg; codecs=opus';
            console.log(`[${this.id}] [GROUP AUDIO] Audio from ${sender} at ${timeStr}`);

            if (lastContextLead && (time - lastContextTime) <= 300) {
                console.log(`[${this.id}] [GROUP MATCH] Paired audio with recently mentioned lead: ${lastContextLead.name}`);
                await this.downloadAndUploadAudio(msg, lastContextLead, sender, timeStr, mimeType);
            } else {
                pendingAudios.push({ msg, time, sender, mimeType, accountId: this.id });
                pendingAudios = pendingAudios.filter(a => (time - a.time) < 600);
            }
            return;
        }

        // Text message in group
        let matchedLead = null;
        if (text) {
            matchedLead = findLeadInText(text);
            if (matchedLead) {
                console.log(`[${this.id}] [GROUP LEAD] Lead identified: "${matchedLead.name}" (${matchedLead.id})`);
                lastContextLead = matchedLead;
                lastContextTime = time;

                const matchedAudioIdx = pendingAudios.findIndex(a => Math.abs(time - a.time) <= 300);
                if (matchedAudioIdx !== -1) {
                    const pending = pendingAudios.splice(matchedAudioIdx, 1)[0];
                    console.log(`[${this.id}] [GROUP MATCH] Paired pending audio with lead: ${matchedLead.name}`);
                    await this.downloadAndUploadAudio(pending.msg, matchedLead, pending.sender, timeStr, pending.mimeType);
                }

                const cleanText = text.trim();
                if (cleanText.length > 5 && !cleanText.toLowerCase().startsWith('http')) {
                    await addNoteToLead(matchedLead.id, `Zero7 Team Note: ${cleanText}`);
                }
            }
        }

        // Always sync the group message to CRM for Sentinel Agent context synthesis
        await syncZero7GroupMessageToCRM({
            wa_message_id: msgId,
            sender_phone: sender,
            sender_name: sender,
            message_text: text || (isAudio ? '[Voice Note]' : ''),
            is_audio: isAudio ? 1 : 0,
            timestamp: timeStr,
            linked_lead_id: matchedLead ? matchedLead.id : null,
            matched_lead_name: matchedLead ? matchedLead.name : null
        });
    }

    async downloadAndUploadAudio(msg, lead, sender, timeStr, mimeType) {
        try {
            if (!this.sock) return;
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                logger,
                reuploadRequest: this.sock.updateMediaMessage
            });
            if (!buffer || buffer.length === 0) {
                console.warn(`[${this.id}] Failed to download media for ${lead.name}`);
                return;
            }

            const ext = mimeType.includes('m4a') || mimeType.includes('mp4') ? 'm4a' : 'ogg';
            const fileName = `wa_${lead.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${ext}`;
            const filePath = path.join(DOWNLOADS_DIR, fileName);
            fs.writeFileSync(filePath, buffer);

            console.log(`[${this.id}] Audio saved: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);
            await uploadAudioToLead(lead, filePath, fileName, mimeType, `Call recording from WhatsApp Zero7 group (posted by ${sender})`);
        } catch (e) {
            console.error(`[${this.id}] Audio download error for ${lead.name}:`, e.message);
        }
    }

    async handleLeadMedia(m, parsed) {
        try {
            if (!this.sock) return;
            const senderPhone = parsed.lead_phone;
            let targetLeadPhone = senderPhone;
            let leadId = crmPhones[senderPhone];
            let lead = crmLeads.find(l => normalizePhone(l.phone) === senderPhone);

            // Special handling: Admin (9993202900) forwarding or dispatching client media
            const isAdmin = senderPhone.includes('9993202900');
            if (isAdmin) {
                const textToCheck = `${parsed.message_text || ''} ${parsed.media_caption || ''}`;
                const matchedLead = findLeadInText(textToCheck);
                if (matchedLead) {
                    leadId = matchedLead.id;
                    lead = matchedLead;
                    targetLeadPhone = normalizePhone(lead.phone) || '7587452172';
                    console.log(`[${this.id}] [ADMIN DISPATCH] Media from admin (9993202900) matched to lead: ${lead.name} (${lead.id})`);
                } else {
                    leadId = 'admin_media';
                    lead = { id: 'admin_media', phone: senderPhone, name: 'Admin Upload' };
                }
            } else if (!leadId) {
                console.log(`[${this.id}] [MEDIA] Sender ${senderPhone} is not a registered CRM lead. Skipping media download.`);
                return;
            }

            console.log(`[${this.id}] [MEDIA INGEST] Downloading ${parsed.message_type} for Lead: ${lead.name} (${targetLeadPhone})...`);

            const buffer = await downloadMediaMessage(m, 'buffer', {}, {
                logger,
                reuploadRequest: this.sock.updateMediaMessage
            });

            if (!buffer || buffer.length === 0) {
                console.warn(`[${this.id}] [MEDIA] Received empty buffer for ${lead.name}`);
                return;
            }

            let ext = 'bin';
            let mimeType = 'application/octet-stream';
            const msgObj = m.message || {};
            const imgMsg = msgObj.imageMessage || msgObj.viewOnceMessage?.message?.imageMessage;
            const docMsg = msgObj.documentMessage;
            const audioMsg = msgObj.audioMessage;
            const vidMsg = msgObj.videoMessage || msgObj.viewOnceMessage?.message?.videoMessage;

            if (parsed.message_type === 'image') {
                mimeType = imgMsg?.mimetype || 'image/jpeg';
                ext = mimeType.includes('png') ? 'png' : 'jpg';
            } else if (parsed.message_type === 'audio') {
                mimeType = audioMsg?.mimetype || 'audio/ogg; codecs=opus';
                ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'ogg';
            } else if (parsed.message_type === 'document') {
                mimeType = docMsg?.mimetype || 'application/pdf';
                const origName = docMsg?.fileName || '';
                ext = origName.includes('.') ? origName.split('.').pop().toLowerCase() : 'pdf';
            } else if (parsed.message_type === 'video') {
                mimeType = vidMsg?.mimetype || 'video/mp4';
                ext = 'mp4';
            }

            const fileName = `wa_${targetLeadPhone}_${Date.now()}_${(parsed.wa_message_id || '').slice(-6)}.${ext}`;

            // 1. Save safety copy partitioned strictly by lead phone
            const leadDir = path.join(DOWNLOADS_DIR, 'lead_media', targetLeadPhone);
            if (!fs.existsSync(leadDir)) fs.mkdirSync(leadDir, { recursive: true });
            const localPath = path.join(leadDir, fileName);
            fs.writeFileSync(localPath, buffer);
            console.log(`[${this.id}] [MEDIA SAVED] Stored safety copy: ${localPath} (${(buffer.length / 1024).toFixed(1)} KB)`);

            // If it's a ZIP archive, auto-extract contents into lead folder
            if (ext === 'zip' || (docMsg?.fileName || '').toLowerCase().endsWith('.zip')) {
                try {
                    const extractDir = path.join(leadDir, 'extracted_' + Date.now());
                    fs.mkdirSync(extractDir, { recursive: true });
                    const { execSync } = require('child_process');
                    execSync(`python3 -m zipfile -e "${localPath}" "${extractDir}"`);
                    console.log(`[${this.id}] [ZIP EXTRACTED] Unpacked to: ${extractDir}`);
                } catch (zErr) {
                    console.error(`[${this.id}] [ZIP EXTRACTION ERROR]`, zErr.message);
                }
            }

            // 2. Upload directly to Lead Google Drive folder & update CRM
            const uploadRes = await uploadLeadMedia(
                lead, buffer, fileName, mimeType, parsed.message_type, parsed.media_caption, parsed.wa_message_id, this.phone
            );
            if (uploadRes && (uploadRes.embed_url || uploadRes.drive_url)) {
                parsed.media_url = uploadRes.embed_url || uploadRes.drive_url;
                console.log(`[${this.id}] [MEDIA SYNCED] Linked to Drive: ${parsed.media_url}`);
            }
        } catch (err) {
            console.error(`[${this.id}] [MEDIA ERROR] Failed processing lead media for ${parsed.lead_phone}:`, err.message);
        }
    }

    async start() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (!makeWASocket) {
            await loadBaileys();
        }

        this.status = 'connecting';
        console.log(`[${this.id}] Starting Baileys socket (${this.label}) in ${this.authDir}...`);

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                auth: state,
                logger,
                printQRInTerminal: false,
                browser: ['Zero7 CRM', 'Desktop', '1.0.0'],
                markOnlineOnConnect: false, // Anti-ban companion precaution
                generateHighQualityLinkPreview: false,
                getMessage: async () => undefined,
                shouldSyncHistoryMessage: () => true
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                if (qr) {
                    this.qrRaw = qr;
                    this.qrGeneratedAt = new Date().toISOString();
                    try {
                        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
                        this.status = 'qr_ready';
                        console.log(`[${this.id}] ✓ QR Code ready for in-browser scanning (${this.label})`);
                    } catch (err) {
                        console.error(`[${this.id}] QR generation error:`, err.message);
                    }
                }

                if (connection === 'open') {
                    this.status = 'connected';
                    this.qrRaw = null;
                    this.qrDataUrl = null;
                    this.reconnectAttempts = 0;
                    this.connectedAt = new Date().toISOString();

                    const me = this.sock.user;
                    this.phone = me ? normalizePhone(me.id) : this.defaultPhone;
                    this.userName = me?.name || this.label;

                    console.log(`[${this.id}] ✓ CONNECTED: ${this.phone} (${this.userName})`);
                    await registerAccountInCRM(this.phone, this.label);
                    await ensureCRMInventory();
                }

                if (connection === 'close') {
                    this.status = 'disconnected';
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                    console.log(`[${this.id}] Closed. Status: ${statusCode}, LoggedOut: ${isLoggedOut}`);

                    if (isLoggedOut) {
                        this.status = 'logged_out';
                        this.clearAuthFiles();
                        console.log(`[${this.id}] Session logged out. Preparing fresh QR code in 3s...`);
                        this.reconnectTimer = setTimeout(() => this.start(), 3000);
                    } else {
                        this.reconnectAttempts++;
                        const delay = Math.min(this.reconnectAttempts * 3000, 30000);
                        console.log(`[${this.id}] Reconnecting in ${delay / 1000}s...`);
                        this.reconnectTimer = setTimeout(() => this.start(), delay);
                    }
                }
            });

            // ── Live Messages ──
            this.sock.ev.on('messages.upsert', async ({ messages }) => {
                if (!messages || messages.length === 0) return;

                // Ensure CRM inventory is always loaded
                if (Object.keys(crmPhones).length === 0) {
                    await ensureCRMInventory();
                }

                const directLeadMessages = [];

                for (const m of messages) {
                    if (!m.key?.remoteJid) continue;
                    const jid = m.key.remoteJid;

                    // Zero7 team group
                    if (jid === TARGET_GROUP_ID || jid.includes(TARGET_GROUP_ID.split('@')[0])) {
                        await this.processZero7GroupMessage(m);
                        continue;
                    }

                    // Direct lead chats
                    const parsed = this.parseMessage(m);
                    if (parsed) {
                        const dirIcon = parsed.direction === 'outgoing' ? '↗ [YOU]' : '↙ [LEAD]';
                        console.log(`[${this.id}] [MSG] ${dirIcon} (${parsed.lead_phone}): "${parsed.message_text.substring(0, 50)}"`);

                        // Automated Lead Media Download and Google Drive Sync
                        if (['image', 'video', 'audio', 'document'].includes(parsed.message_type)) {
                            await this.handleLeadMedia(m, parsed);
                        }

                        directLeadMessages.push(parsed);
                    } else {
                        console.log(`[${this.id}] [MSG UPSERT] Unmatched JID: ${jid} (fromMe: ${m.key?.fromMe})`);
                    }
                }

                if (directLeadMessages.length > 0) {
                    const count = await syncMessagesToCRM(directLeadMessages, this.phone);
                    this.messagesSynced += count;
                    console.log(`[${this.id}] Synced ${count}/${directLeadMessages.length} message(s) to CRM.`);
                }
            });

            // ── Catch-up History ──
            this.sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
                const count = messages?.length || 0;
                console.log(`[${this.id}] History catch-up batch of ${count} messages`);

                if (contacts && contacts.length > 0) {
                    for (const c of contacts) {
                        if (c.id && c.lid) {
                            const p = normalizePhone(c.id);
                            const lid = c.lid.split('@')[0].split(':')[0];
                            this.lidToPhone.set(lid, p);
                            this.phoneToLid.set(p, lid);
                        }
                    }
                }

                if (messages && messages.length > 0) {
                    const leadMsgs = [];
                    for (const m of messages) {
                        const parsed = this.parseMessage(m);
                        if (parsed) {
                            if (['image', 'video', 'audio', 'document'].includes(parsed.message_type)) {
                                try { await this.handleLeadMedia(m, parsed); } catch (e) {}
                            }
                            leadMsgs.push(parsed);
                        }
                    }
                    if (leadMsgs.length > 0) {
                        const inserted = await syncMessagesToCRM(leadMsgs, this.phone);
                        this.messagesSynced += inserted;
                        console.log(`[${this.id}] Inserted ${inserted} catch-up messages across leads.`);
                    }
                }
            });

            // ── Contact Updates & LID Mappings ──
            this.sock.ev.on('contacts.upsert', (contacts) => {
                for (const c of contacts) {
                    if (c.id && c.lid) {
                        const p = normalizePhone(c.id);
                        const lid = c.lid.split('@')[0].split(':')[0];
                        this.lidToPhone.set(lid, p);
                        this.phoneToLid.set(p, lid);
                    }
                }
            });

            this.sock.ev.on('lid-mapping.update', (mapping) => {
                if (mapping?.lid && mapping?.pn) {
                    const lid = mapping.lid.split('@')[0].split(':')[0];
                    const p = mapping.pn.replace(/\D/g, '');
                    this.lidToPhone.set(lid, p);
                    this.phoneToLid.set(p, lid);
                }
            });

        } catch (err) {
            console.error(`[${this.id}] Socket initialization error:`, err);
            this.status = 'error';
            this.reconnectAttempts++;
            this.reconnectTimer = setTimeout(() => this.start(), 5000);
        }
    }

    clearAuthFiles() {
        try {
            if (fs.existsSync(this.authDir)) {
                const files = fs.readdirSync(this.authDir);
                for (const f of files) {
                    fs.unlinkSync(path.join(this.authDir, f));
                }
                console.log(`[${this.id}] Cleared auth credentials in ${this.authDir}`);
            }
        } catch (e) {
            console.warn(`[${this.id}] Error clearing auth files:`, e.message);
        }
    }

    async disconnect() {
        console.log(`[${this.id}] Admin requested disconnect.`);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        try {
            if (this.sock) {
                await this.sock.logout().catch(() => {});
                this.sock.end(new Error('Admin disconnected'));
            }
        } catch (e) {}

        this.clearAuthFiles();
        this.status = 'disconnected';
        this.qrRaw = null;
        this.qrDataUrl = null;
        this.connectedAt = null;
        this.phone = this.defaultPhone;
        this.reconnectAttempts = 0;

        // Auto-restart cleanly to generate fresh QR
        setTimeout(() => this.start(), 1500);
        return { success: true, message: `${this.label} session reset. Generating fresh QR.` };
    }

    async reconnect() {
        console.log(`[${this.id}] Admin requested reconnect.`);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        try {
            if (this.sock) {
                this.sock.end(new Error('Admin reconnect'));
            }
        } catch (e) {}
        this.reconnectAttempts = 0;
        setTimeout(() => this.start(), 1000);
        return { success: true, message: `${this.label} reconnecting...` };
    }

    async fetchChatHistory(chatJidOrPhone, count = 50) {
        if (!this.sock) {
            console.warn(`[${this.id}] Cannot fetch chat history: socket not connected.`);
            return false;
        }
        let chatJid = chatJidOrPhone;
        if (!chatJid.includes('@')) {
            const clean = chatJid.replace(/\D/g, '');
            chatJid = clean.length === 10 ? `91${clean}@s.whatsapp.net` : `${clean}@s.whatsapp.net`;
        }
        console.log(`[${this.id}] Requesting on-demand chat history for ${chatJid}...`);
        try {
            const b = await import('@whiskeysockets/baileys');
            const proto = b.proto;
            if (this.sock.sendPeerDataOperationMessage && proto) {
                const pdoMessage = {
                    historySyncOnDemandRequest: {
                        chatJid: chatJid,
                        oldestMsgFromMe: false,
                        oldestMsgId: '',
                        oldestMsgTimestampMs: Date.now(),
                        onDemandMsgCount: count
                    },
                    peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND
                };
                await this.sock.sendPeerDataOperationMessage(pdoMessage);
                console.log(`[${this.id}] PDO history sync request sent for ${chatJid}`);
                return true;
            }
        } catch (e) {
            console.error(`[${this.id}] PDO request error:`, e.message);
        }
        return false;
    }

    async sendMessage(recipientPhone, text) {

        if (!this.sock) {
            throw new Error(`WhatsApp account ${this.id} socket is not initialized.`);
        }
        if (this.status !== 'connected') {
            throw new Error(`WhatsApp account ${this.id} is not connected (current status: ${this.status}).`);
        }
        let jid;
        const rawRecipient = String(recipientPhone).trim();
        if (rawRecipient.endsWith('@g.us') || rawRecipient.includes('@g.us')) {
            jid = rawRecipient;
        } else {
            let clean = rawRecipient.replace(/\D/g, '');
            if (clean.length === 10) clean = '91' + clean;
            jid = clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
        }

        console.log(`[${this.id}] Sending WhatsApp message to ${jid}: "${text.substring(0, 50)}..."`);
        const result = await this.sock.sendMessage(jid, { text: text });
        console.log(`[${this.id}] Message dispatched successfully! Message ID: ${result?.key?.id}`);

        return {
            wa_message_id: result?.key?.id,
            timestamp: new Date().toISOString(),
            remoteJid: result?.key?.remoteJid || jid,
            status: 'delivered'
        };
    }

    getStatus() {

        return {
            id: this.id,
            label: this.label,
            phone: this.phone,
            userName: this.userName,
            status: this.status,
            connectedAt: this.connectedAt,
            hasQr: !!this.qrDataUrl,
            qrGeneratedAt: this.qrGeneratedAt,
            messagesSynced: this.messagesSynced
        };
    }
}

// ── 4. Account Instances ──────────────────────────────────────

const accounts = {
    personal: new WhatsAppAccount({
        id: 'personal',
        label: 'Abhijeet Personal',
        defaultPhone: '9993202900',
        authDir: path.join(__dirname, 'auth_personal')
    }),
    central: new WhatsAppAccount({
        id: 'central',
        label: 'Zero7 Central',
        defaultPhone: '9479007951',
        authDir: path.join(__dirname, 'auth_central')
    })
};

// ── 5. HTTP Control Server on Port 8085 (Admin API) ─────────

function startControlServer() {
    const server = http.createServer(async (req, res) => {
        // Local/internal access check
        const clientIp = req.socket.remoteAddress || '';
        const isInternal = clientIp.includes('127.0.0.1') ||
                           clientIp.includes('172.17.') ||
                           clientIp === '::1' ||
                           clientIp === '::ffff:127.0.0.1';

        if (!isInternal) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Access denied: internal network only' }));
        }

        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = urlObj.pathname;
        const method = req.method;

        res.setHeader('Content-Type', 'application/json');

        // GET /status
        if (method === 'GET' && pathname === '/status') {
            const statusReport = {
                uptime: process.uptime(),
                accounts: {
                    personal: accounts.personal.getStatus(),
                    central: accounts.central.getStatus()
                }
            };
            res.writeHead(200);
            return res.end(JSON.stringify(statusReport));
        }

        // GET /qr/:accountId
        if (method === 'GET' && pathname.startsWith('/qr/')) {
            const accId = pathname.replace('/qr/', '').trim();
            const acc = accounts[accId];
            if (!acc) {
                res.writeHead(404);
                return res.end(JSON.stringify({ error: `Account ${accId} not found` }));
            }

            res.writeHead(200);
            return res.end(JSON.stringify({
                accountId: acc.id,
                label: acc.label,
                status: acc.status,
                phone: acc.phone,
                hasQr: !!acc.qrDataUrl,
                qrDataUrl: acc.qrDataUrl,
                qrGeneratedAt: acc.qrGeneratedAt
            }));
        }

        // POST /disconnect/:accountId
        if (method === 'POST' && pathname.startsWith('/disconnect/')) {
            const accId = pathname.replace('/disconnect/', '').trim();
            const acc = accounts[accId];
            if (!acc) {
                res.writeHead(404);
                return res.end(JSON.stringify({ error: `Account ${accId} not found` }));
            }
            const result = await acc.disconnect();
            res.writeHead(200);
            return res.end(JSON.stringify(result));
        }

        // POST /reconnect/:accountId
        if (method === 'POST' && pathname.startsWith('/reconnect/')) {
            const accId = pathname.replace('/reconnect/', '').trim();
            const acc = accounts[accId];
            if (!acc) {
                res.writeHead(404);
                return res.end(JSON.stringify({ error: `Account ${accId} not found` }));
            }
            const result = await acc.reconnect();
            res.writeHead(200);
            return res.end(JSON.stringify(result));
        }

        // POST /sync-chat/:accountId
        if (method === 'POST' && pathname.startsWith('/sync-chat/')) {
            const accId = pathname.replace('/sync-chat/', '').trim();
            const acc = accounts[accId];
            if (!acc) {
                res.writeHead(404);
                return res.end(JSON.stringify({ error: `Account ${accId} not found` }));
            }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const target = parsed.target || parsed.phone || '918085892345';
                    const count = parsed.count || 50;
                    const ok = await acc.fetchChatHistory(target, count);
                    res.writeHead(200);
                    return res.end(JSON.stringify({ success: ok, accountId: acc.id, target }));
                } catch (err) {
                    res.writeHead(500);
                    return res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // POST /send-message/:accountId
        if (method === 'POST' && pathname.startsWith('/send-message/')) {
            const accId = pathname.replace('/send-message/', '').trim();
            const acc = accounts[accId];
            if (!acc) {
                res.writeHead(404);
                return res.end(JSON.stringify({ error: `Account ${accId} not found` }));
            }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const recipient = parsed.recipient_phone || parsed.phone || parsed.target;
                    const text = parsed.message_text || parsed.text || parsed.message;
                    if (!recipient || !text) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ error: 'recipient_phone and message_text are required' }));
                    }
                    const sent = await acc.sendMessage(recipient, text);
                    res.writeHead(200);
                    return res.end(JSON.stringify({ success: true, ...sent }));
                } catch (err) {
                    console.error(`[CONTROL API] Failed to send message via ${accId}:`, err.message);
                    res.writeHead(500);
                    return res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // POST /send-group-message/zero7 (Strictly restricted to Zero7 team group only, zdro7 alias supported)
        if (method === 'POST' && (pathname === '/send-group-message/zero7' || pathname === '/send-group-message/zdro7' || pathname.startsWith('/send-group-message/'))) {
            const requestedTarget = pathname.replace('/send-group-message/', '').trim().toLowerCase();
            // STRICT SECURITY ENFORCEMENT: Only Zero7 group allowed!
            if (requestedTarget && requestedTarget !== 'zero7' && requestedTarget !== 'zdro7' && requestedTarget !== TARGET_GROUP_ID) {
                res.writeHead(403);
                return res.end(JSON.stringify({ 
                    error: `Forbidden: Sentinel Agent is strictly restricted to sending messages to the Zero7 group only. Destination '${requestedTarget}' is denied.` 
                }));
            }

            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const text = parsed.message_text || parsed.text || parsed.message;
                    if (!text || !String(text).trim()) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ error: 'message_text is required' }));
                    }

                    // Account selection: Strictly enforce Central account ('central', Zero7 Consultancy: 9479007951)
                    // The Sentinel agent MUST ALWAYS dispatch from the Central account, NEVER personal.
                    let activeAcc = null;
                    const reqAccount = (parsed.account || 'central').toLowerCase();

                    if (reqAccount === 'personal') {
                        if (accounts.personal && accounts.personal.status === 'connected') {
                            activeAcc = accounts.personal;
                        }
                    } else {
                        // Default and mandatory for Sentinel: Central account (9479007951)
                        if (accounts.central && accounts.central.status === 'connected') {
                            activeAcc = accounts.central;
                        }
                    }

                    if (!activeAcc) {
                        res.writeHead(503);
                        return res.end(JSON.stringify({ 
                            error: 'Central WhatsApp account (Zero7 Consultancy: 9479007951) is not currently connected. Dispatch aborted to prevent sending from personal account.',
                            central_status: accounts.central?.status
                        }));
                    }

                    console.log(`[CONTROL API] Dispatching Sentinel nag to Zero7 group (${TARGET_GROUP_ID}) via Central account ${activeAcc.id} (${activeAcc.phone})...`);
                    const sent = await activeAcc.sendMessage(TARGET_GROUP_ID, String(text).trim());
                    res.writeHead(200);
                    return res.end(JSON.stringify({ 
                        success: true, 
                        group_name: 'Zero7',
                        group_id: TARGET_GROUP_ID,
                        dispatched_via: activeAcc.id,
                        account_phone: activeAcc.phone,
                        ...sent 
                    }));
                } catch (err) {
                    console.error('[CONTROL API] Failed to send Zero7 group message:', err.message);
                    res.writeHead(500);
                    return res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Endpoint not found' }));

    });

    server.listen(CONTROL_PORT, '0.0.0.0', () => {
        console.log(`[CONTROL API] WhatsApp Daemon HTTP API listening on port ${CONTROL_PORT}`);
    });
}

// ── 6. Master Lifecycle Runner ───────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Zero7 CRM - 24/7 Always-On Multi-Account WhatsApp Sync Daemon   ║');
    console.log('║  Accounts: Personal (9993202900) & Zero7 Central (9479007951)    ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    await crmLogin();
    await ensureCRMInventory();

    // Inventory refresh every 5 mins
    setInterval(fetchCRMInventory, 5 * 60 * 1000);

    // Start HTTP control server on port 8085
    startControlServer();

    // Start both WhatsApp accounts
    await accounts.personal.start();
    await accounts.central.start();
}

main().catch(err => {
    console.error('[FATAL ERROR IN DAEMON MAIN]', err);
    process.exit(1);
});
