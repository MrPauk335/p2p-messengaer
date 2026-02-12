class App {
    constructor() {
        this.peer = null;
        this.tempPeer = null; // For pre-login sync
        this.connections = {};
        this.myId = '';

        // Persistent Device Suffix for stable Peer IDs
        let savedSuffix = localStorage.getItem('p2p_device_suffix');
        if (!savedSuffix) {
            savedSuffix = Math.random().toString(36).substr(2, 4);
            localStorage.setItem('p2p_device_suffix', savedSuffix);
        }
        this.deviceSuffix = savedSuffix;

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
        this.is2faEnabled = false;
        this.incognitoMode = localStorage.getItem('p2p_incognito') === 'true';
        this.burnTimer = parseInt(localStorage.getItem('p2p_burn_timer') || '0');
        this.notificationsEnabled = localStorage.getItem('p2p_notifications') === 'true';
        this.ipCheckEnabled = localStorage.getItem('p2p_ip_check') === 'true';

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
        // Now loaded from crypto.js (prototype extension)
        if (this.loadEncryptedData) {
            await this.loadEncryptedData();
        } else {
            console.error("Critical: loadEncryptedData not found!");
        }

        if (savedNick && savedUid && savedPass) {
            this.myNick = savedNick;
            this.myId = savedUid;
            this.myColor = savedColor || '#0084ff';
            this.myPass = savedPass;
            this.mySecret = savedSecret || '';

            if (localStorage.getItem('p2p_is_locked') === 'true') {
                document.getElementById('lock-overlay').style.display = 'flex';
                this.updateMyProfileUI();
            } else {
                this.start();
                this.checkIP();
            }
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
                document.getElementById('chatArea').style.display = 'none';
                // On mobile "Back", we show sidebar (which is default visible on desktop)
                // But if we are in "mobile view", sidebar is hidden when chat is open.
                // toggleSidebar() handles showing sidebar.
                // But here we want to reset state.
                const sidebar = document.getElementById('sidebar');
                if (window.innerWidth <= 768) {
                    sidebar.style.display = 'flex';
                }
                const empty = document.getElementById('emptyChat');
                if (empty) empty.style.display = 'flex'; // Show empty state

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
                if (status && this.activeChatId) status.innerText = "Собеседник оффлайн (Проверьте ID)";
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

            // Send my profile info eagerly
            conn.send({
                type: 'profile',
                info: {
                    name: this.myNick,
                    color: this.myColor
                }
            });
        });

        conn.on('data', async (data) => {
            if (data.type === 'profile') {
                // Update Contact Info
                if (data.info) {
                    if (!this.contacts[conn.peer]) {
                        // Create partial contact if not exists (e.g. they added me, I didn't add them yet)
                        // But usually we only add specific contacts.
                        // If we are connected, it means we accepted connection?
                        // PeerJS accepts all connections by default.
                        // So we might receive profile from stranger.
                        // We should probably NOT add them automatically unless we want to?
                        // But for "Loading..." case, we HAVE them in contacts (via Hash add).
                    }
                    if (this.contacts[conn.peer]) {
                        this.contacts[conn.peer].name = data.info.name || this.contacts[conn.peer].name;
                        this.contacts[conn.peer].color = data.info.color || this.contacts[conn.peer].color;
                        this.saveContacts();
                        this.refreshContacts();
                        if (this.activeChatId === conn.peer) this.updateChatHeader();
                    }
                }
            } else if (data.type === 'msg') {
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

        const msgObj = {
            text: text,
            side: side,
            senderId: senderId,
            timestamp: Date.now()
        };

        this.history[id].push(msgObj);

        // Save Encrypted (only if NOT Incognito)
        if (!this.incognitoMode) {
            await this.saveMsgMigration(silent);
        }

        if (this.activeChatId === id) {
            this.renderHistory(id);
            // Scroll to bottom
            const container = document.getElementById('messages');
            if (container) container.scrollTop = container.scrollHeight;
        } else if (side === 'them' && !silent) {
            this.showToast(`Сообщение от ${this.contacts[id] ? this.contacts[id].name : id}`);
            this.sendNotification(this.contacts[id] ? this.contacts[id].name : 'Новое сообщение', text);
        }

        if (this.contacts[id]) {
            this.contacts[id].last = (side === 'me' ? 'Вы: ' : '') + text;
            if (!this.incognitoMode) this.saveContacts(silent);
            this.refreshContacts();
        } else if (this.groups[id]) {
            this.groups[id].last = text;
            if (!this.incognitoMode) this.saveGroups(silent);
            this.refreshContacts();
        }

        // Burn Timer Logic
        if (this.burnTimer > 0) {
            setTimeout(() => {
                // Remove from memory
                if (this.history[id]) {
                    const idx = this.history[id].indexOf(msgObj);
                    if (idx > -1) {
                        this.history[id].splice(idx, 1);
                        // Update UI if active
                        if (this.activeChatId === id) this.renderHistory(id);
                        // Save changes (if not incognito) to remove from disk
                        if (!this.incognitoMode) this.saveMsgMigration(true);
                    }
                }
            }, this.burnTimer * 1000);
        }
    }

    sendNotification(title, body) {
        if (!this.notificationsEnabled) return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body: body, icon: 'icon.png' });
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
