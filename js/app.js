const DEVICE_SUFFIX = Math.random().toString(36).substr(2, 4);

class App {
    constructor() {
        this.peer = null;
        this.tempPeer = null; // For pre-login sync
        this.connections = {};
        this.myId = '';
        this.deviceSuffix = DEVICE_SUFFIX;

        // Data Store
        this.contacts = {};
        this.groups = {};
        this.history = {};
        this.myDevices = []; // List of trusted device IDs

        // Security
        this.myNick = '';
        this.myColor = '#0084ff';
        this.myPass = ''; // Hashed password
        this.mySecret = ''; // 2FA Secret
        this.is2faEnabled = false;

        // E2EE
        this.identityKeyPair = null;
        this.sessionSecrets = {}; // peerId -> CryptoKey

        // UI State
        this.activeChatId = null;
    }

    async init() {
        // Load settings
        const savedNick = localStorage.getItem('p2p_nick');
        const savedUid = localStorage.getItem('p2p_uid');
        const savedColor = localStorage.getItem('p2p_color');
        const savedPass = localStorage.getItem('p2p_pass');
        const savedSecret = localStorage.getItem('p2p_secret');
        const savedDevices = localStorage.getItem('p2p_my_devices');

        if (savedDevices) this.myDevices = JSON.parse(savedDevices);

        // Load Encrypted Data
        await this.loadEncryptedData();

        if (savedNick && savedUid && savedPass) {
            this.myNick = savedNick;
            this.myId = savedUid;
            this.myColor = savedColor || '#0084ff';
            this.myPass = savedPass;
            this.mySecret = savedSecret || '';

            this.start();
        } else {
            // New user setup
            document.getElementById('setup-overlay').style.display = 'flex';
        }

        // Global Event Listeners (UI)
        document.getElementById('msgInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Prevent accidental back navigation on mobile
        history.pushState(null, null, location.href);
        window.onpopstate = () => {
            if (this.activeChatId) {
                document.getElementById('chat-screen').style.display = 'none';
                document.getElementById('welcome-screen').style.display = 'flex';
                this.activeChatId = null;
                history.pushState(null, null, location.href);
            }
        };
    }

    start() {
        this.updateMyProfileUI();

        // Use a unique connection ID (Base ID + Suffix) to allow multiple devices for same user
        const connectionId = `${this.myId}_dev_${this.deviceSuffix}`;
        console.log('Connecting with ID:', connectionId);

        this.peer = new Peer(connectionId, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            },
            debug: 1
        });

        this.peer.on('open', (id) => {
            console.log('Peer ID:', id);
            this.updateMyProfileUI(); // Show online status
            this.checkHash();
            this.reconnect();
            this.discoverMyDevices();
        });

        this.peer.on('connection', (conn) => this.handleConnection(conn));

        this.peer.on('error', (err) => {
            console.error("Peer Error:", err.type, err);
            const status = document.getElementById('chatStatus');
            const myIdDisplay = document.getElementById('myIdDisplay');

            if (err.type === 'unavailable-id') {
                this.showToast('Ошибка: Этот никнейм уже используется на другом устройстве ⚠️');
                if (status) status.innerText = "Конфликт: ID уже в сети";
                if (myIdDisplay) myIdDisplay.innerText = "Ошибка: ID занят";
            } else if (err.type === 'peer-unavailable') {
                if (status && this.activeChatId) status.innerText = "Собеседник оффлайн";
            } else if (err.type === 'network') {
                if (status) status.innerHTML = "Ошибка сети <span style='cursor:pointer; text-decoration:underline;' onclick='app.reconnect()'>🔄 Повтор</span>";
                if (myIdDisplay) myIdDisplay.innerHTML = `${this.myId} <br> <span style="color:var(--danger)">Ошибка сети 📶</span>`;
            }
            this.updateMyProfileUI();
        });

        this.peer.on('disconnected', () => {
            this.updateMyProfileUI();
            setTimeout(() => { if (this.peer.disconnected) this.peer.reconnect(); }, 5000);
        });

        this.refreshContacts();
    }

    // Core Connection Handler
    handleConnection(conn) {
        conn.on('open', () => {
            this.connections[conn.peer] = conn;
            if (this.contacts[conn.peer]) {
                this.updateChatHeader();
                this.refreshContacts(); // update online status dot
            }
        });

        conn.on('data', async (data) => {
            if (data.type === 'msg') {
                // Decrypt if needed
                let text = data.text;
                if (data.encrypted) {
                    text = await this.decryptSessionMsg(conn.peer, data.payload, data.iv);
                }

                this.saveMsg(conn.peer, text, 'them', data.senderId);

                // Auto-Relay to my other devices if it's a message for ME or from a group
                if (!data.isRelay) {
                    this.relayToMyDevices({
                        ...data,
                        isRelay: true
                    });
                }
            } else if (data.type === 'auto_sync') {
                this.processSyncData(data);
            } else if (data.type === 'sync_pull') {
                this.handleSyncPush(conn);
            } else if (data.type === 'sync_push') {
                this.processSyncData(data.payload);
            }
        });

        conn.on('close', () => {
            // Cleanup if needed
        });
    }

    async saveMsg(id, text, side, senderId = null, silent = false) {
        if (!this.history[id]) this.history[id] = [];

        this.history[id].push({
            text: text,
            side: side,
            senderId: senderId,
            timestamp: Date.now()
        });

        // Save Encrypted
        await this.saveMsgMigration(silent);

        if (this.activeChatId === id) {
            this.renderHistory(id);
            // Scroll to bottom
            const container = document.getElementById('messages');
            if (container) container.scrollTop = container.scrollHeight;
        } else if (side === 'them' && !silent) {
            this.showToast(`Сообщение от ${this.contacts[id] ? this.contacts[id].name : id}`);
        }

        if (this.contacts[id]) {
            this.contacts[id].last = (side === 'me' ? 'Вы: ' : '') + text;
            this.saveContacts(silent);
            this.refreshContacts();
        } else if (this.groups[id]) {
            this.groups[id].last = text;
            this.saveGroups(silent);
            this.refreshContacts();
        }
    }

    // Kept core sending logic here for now
    async sendMessage() {
        const text = document.getElementById('msgInput').value.trim();
        if (!text || !this.activeChatId) return;

        document.getElementById('msgInput').value = '';
        this.saveMsg(this.activeChatId, text, 'me');

        // Check if Group
        if (this.groups[this.activeChatId]) {
            this.groups[this.activeChatId].members.forEach(async memberId => {
                if (memberId === this.myId) return;
                // ... (group send logic placeholder - needs robust handling from sync.js/connections)
            });
        } else {
            // Direct Message
            const conn = this.connections[this.activeChatId];
            if (conn && conn.open) {
                const encrypted = await this.encryptSessionMsg(this.activeChatId, text);
                if (encrypted) {
                    conn.send({ type: 'msg', text: '🔒 Encrypted', encrypted: true, payload: encrypted.payload, iv: encrypted.iv });
                } else {
                    conn.send({ type: 'msg', text: text });
                }
            }
        }
    }

    reconnect() {
        if (this.peer && this.peer.disconnected) {
            this.peer.reconnect();
        } else if (!this.peer || this.peer.destroyed) {
            this.start();
        }

        Object.keys(this.contacts).forEach(id => {
            if (!this.connections[id] || !this.connections[id].open) {
                const conn = this.peer.connect(id, { serialization: 'json' });
                this.handleConnection(conn);
            }
        });
    }

    // Placeholders for modular methods to prevent errors if loaded out of order
    // But since index.html loads them after app.js, the prototype extensions will happen
    // BEFORE window.app = new App() is called (if we structured it right).
    // Actually, App class is defined here. Extensions run. THEN instance created.
}
