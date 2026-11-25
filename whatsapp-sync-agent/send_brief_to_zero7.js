const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_personal');
const TARGET_GROUP_ID = '120363426285521103@g.us';
const BRIEF_MD_PATH = path.join(__dirname, '..', 'scratch', 'MEETING_LEADS_BRIEF_OCT_2026.md');

const SUMMARY_TEXT = `*ZERO7 TEAM STRATEGIC SYNC & LEADS EXECUTION ROADMAP*
*Date*: October 5–6, 2026
*Participants*: Abhijeet & Shailesh
*Target Sheet*: https://docs.google.com/spreadsheets/d/1hYCgiSy1upKN7BqsILAL5vSz1O-6wrLNyxK7XZldCxI/edit?gid=1855228300#gid=1855228300
*Basis*: Review of "Lead form - Higher intent" across call recordings

---
*KEY STRATEGIC DECISIONS*
1. *High-Ticket Conversion Focus*: Top priority on Vishal Dama, Ashish Shrivastav, Subham Rai, and Vivek Kedia.
2. *Standardized Modular Rollout*: Deploy core Billing + Inventory module for retail/trading leads (e.g., Babu Gupta / Guru Kripa Electronics @ ₹30k–40k) instead of building custom accounting engines.
3. *Strict Prototype Gate*: Stop building unvetted speculative prototypes for budget-constrained leads (e.g., Mohd Iqbal Shaikh). Qualify budget readiness first.

---
*PRIORITY LEADS & ACTION ITEMS*

1. *Vishal Dama — Unique Security & Access Systems (Row 66)* [HOT DEAL]
• Scope: Security equipment installation, AMC warranty & technician workflows (30+3 day delivery).
• Action: Deliver live prototype link over WhatsApp & schedule closure call for agreement/milestone payments.
• Owners: Abhijeet & Shailesh

2. *Ashish Shrivastav — City Bike Rental, Bhopal (Row 74)* [HIGH PRIORITY]
• Scope: Vehicle fleet availability, diesel/fuel costing, trip logging & automated billing slips.
• Action: Verify prototype status in CRM & call Ashish to review daily reporting workflow.
• Owners: Shailesh & Abhijeet

3. *Subham Rai — Gaurika Fresh Foods (Row 50)* [ENTERPRISE - ₹100 Cr+ turnover]
• Scope: Enterprise farm-to-container banana export supply chain ERP (similar to Shakun Industries).
• Action: Adapt Shakun enterprise architecture deck and schedule discovery call.
• Owner: Abhijeet

4. *Vivek Kedia — Signature World (Row 36)* [GARMENT ERP]
• Scope: Garment manufacturing ERP; remove non-core modules to fit budget.
• Action: Send revised phased milestone quotation.
• Owner: Shailesh

5. *Babu Gupta — Guru Kripa Electronics, Mumbai (Row 17)* [5 STORES]
• Scope: Centralized multi-store billing & inventory.
• Action: Pitch standard POS/Inventory module @ ₹35k with Tally export bridge (no custom accounting).
• Owner: Shailesh

6. *Anshul Bajaj — Anshul Bajaj & Associates (Row 6)* [CAD / LISP]
• Scope: CAD automation / LISP scripting for 3D structural frames.
• Action: Send re-engagement follow-up apologizing for deployment delay & schedule technical scoping.
• Owner: Abhijeet

7. *Pooja Deora — Aashish Agency (Row 47)*
• Action: Review submitted SOP requirements from email & prepare workflow proposal.
• Owner: Shailesh

8. *Manthan Mehta — Giriraj Plastic (Row 81)*
• Action: Call after 11:00 AM to assess requirement fit against 20% customization scope.
• Owner: Shailesh

9. *Shalini Sharma — Mahalaxmi Green Venture (Row 82)*
• Action: Call between 1:00 PM – 2:00 PM today to finalize software needs.
• Owner: Shailesh

10. *Mohd Iqbal Shaikh — Building Material Supplier (Row 51)*
• Action: Gatekeep — Send standard catalog pricing, do not build speculative prototype until budget is verified.
• Owner: Shailesh

---
*IMMEDIATE SCHEDULE*
• *Oct 6*: Send prototype to Vishal Dama (Abhijeet)
• *Oct 7*: City Bike Rental demo call (Shailesh & Abhijeet)
• *Oct 7*: Revised quotation to Vivek Kedia (Shailesh)
• *Oct 7*: Re-engagement follow-up to Anshul Bajaj (Abhijeet)
• *Oct 8*: Enterprise scoping with Subham Rai (Abhijeet)
• *Oct 8*: Standard POS pitch to Babu Gupta (Shailesh)

Attached is the complete .md roadmap file with full transcript references and details.`;

async function run() {
    console.log('[WA] Initializing Baileys socket with auth_personal...');
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'warn' }),
        printQRInTerminal: false,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'connecting') {
            console.log('[WA] Connecting to WhatsApp...');
        } else if (connection === 'open') {
            console.log('[WA] Connected successfully!');
            
            try {
                // 1. Send the Markdown document
                if (fs.existsSync(BRIEF_MD_PATH)) {
                    console.log(`[WA] Sending markdown document: ${BRIEF_MD_PATH} to ${TARGET_GROUP_ID}`);
                    const fileBuffer = fs.readFileSync(BRIEF_MD_PATH);
                    const docResult = await sock.sendMessage(TARGET_GROUP_ID, {
                        document: fileBuffer,
                        mimetype: 'text/markdown',
                        fileName: 'ZERO7_LEADS_EXECUTION_ROADMAP_OCT_2026.md',
                        caption: 'Zero7 Leads Execution Roadmap & Action Brief (October 2026)'
                    });
                    console.log('[WA] Document sent! ID:', docResult.key.id);
                } else {
                    console.warn('[WA] Brief file not found at', BRIEF_MD_PATH);
                }

                // Short delay
                await new Promise(res => setTimeout(res, 2000));

                // 2. Send the detailed text summary
                console.log(`[WA] Sending summary text to ${TARGET_GROUP_ID}...`);
                const textResult = await sock.sendMessage(TARGET_GROUP_ID, {
                    text: SUMMARY_TEXT
                });
                console.log('[WA] Text summary sent! ID:', textResult.key.id);

                console.log('[WA] All messages dispatched successfully. Waiting 5s before exit...');
                await new Promise(res => setTimeout(res, 5000));
                
                await sock.end(undefined);
                process.exit(0);
            } catch (err) {
                console.error('[WA] Error sending message:', err);
                process.exit(1);
            }
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[WA] Connection closed with code ${statusCode}. Reconnecting: ${shouldReconnect}`);
            if (!shouldReconnect) {
                console.error('[WA] Session logged out! Re-authentication required.');
                process.exit(1);
            }
        }
    });
}

run().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});
