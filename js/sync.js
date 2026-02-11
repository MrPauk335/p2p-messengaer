// Synchronization & P2P Logic
Object.assign(App.prototype, {
    // 1. Discover my other trusted devices
    discoverMyDevices() {
        if (!this.myDevices || this.myDevices.length === 0) return;
        this.myDevices.forEach(peerId => {
            if (peerId !== this.peer.id) {
                const conn = this.peer.connect(peerId);
                conn.on('open', () => {
                    this.connections[peerId] = conn;
                    console.log('Connected to trusted device:', peerId);
                    // Share current state
                    this.broadcastSync();
                });
            }
        });
    },

    // 2. Add Trusted Device
    addTrustedDevice(peerId) {
        if (!this.myDevices.includes(peerId) && peerId !== this.peer.id) {
            this.myDevices.push(peerId);
            localStorage.setItem('p2p_my_devices', JSON.stringify(this.myDevices));
            console.log('Added trusted device:', peerId);
            this.showToast("Новое устройство добавлено в доверенные 🛡️");
        }
    },

    // 3. Start Sync Pull
    async startSyncPull() {
        const partialId = document.getElementById('syncInputCode').value.trim().toLowerCase();
        if (!partialId) return this.showToast("Введите ID или код");

        document.getElementById('syncTargetStatus').innerText = "Подключение к устройству...";
        console.log('Syncing with:', partialId);

        let targetId = partialId;
        if (!targetId.includes('_dev_') && !targetId.startsWith('p2p_user_') && !targetId.startsWith('u_')) {
            targetId = this.normalizeId(targetId);
        }

        // Timeout for connection
        const timeout = setTimeout(() => {
            document.getElementById('syncTargetStatus').innerText = "Запрос затянулся. Попробуйте нажать кнопку ещё раз или проверьте интернет.";
        }, 12000);

        // Use temp peer if this.peer is null (pre-login sync)
        let activePeer = this.peer;
        if (!activePeer) {
            this.logSync("Создание временного соединения...");
            activePeer = await this.initTempPeerForSync();
            if (!activePeer) {
                clearTimeout(timeout);
                return this.showToast("Не удалось создать соединение ⚠️");
            }
        }

        if (targetId === this.myId || targetId === activePeer.id) {
            return this.showToast("Нельзя соединиться с самим собой ⚠️");
        }

        // Standard connection with explicit JSON serialization
        this.logSync("Connecting to: " + targetId);
        const conn = activePeer.connect(targetId, { serialization: 'json' });

        conn.on('open', () => {
            clearTimeout(timeout);
            this.logSync("Connection OPEN! Sending handshake...");
            document.getElementById('syncTargetStatus').innerText = "Соединение установлено! Ожидайте подтверждения...";
            conn.send({ type: 'sync_pull' });
        });

        conn.on('data', (data) => {
            this.logSync("Data received: " + data.type);
            if (data.type === 'sync_push') {
                document.getElementById('syncTargetStatus').innerText = "Данные получены, синхронизация...";
                // If using temp peer (pre-login), apply as new profile
                if (this.tempPeer) {
                    this.applyImportedProfile(data.payload);
                } else {
                    this.processSyncData(data.payload);
                }
            }
        });

        conn.on('error', (err) => {
            clearTimeout(timeout);
            console.error('Sync Connect Error:', err);
            this.logSync("Error: " + err.type);
            document.getElementById('syncTargetStatus').innerText = "Ошибка: " + err.type;
        });

        conn.on('close', () => {
            this.logSync("Connection CLOSED");
        });
    },

    // 4. Process Sync Data
    async processSyncData(data) {
        if (!data) return;
        this.contacts = data.contacts || {};
        this.history = data.history || {};
        this.groups = data.groups || {};

        // Save imported data
        this.saveContacts(true);
        this.saveGroups(true);
        this.saveMsgMigration(true);
        this.refreshContacts();

        this.showToast("Синхронизация успешна! ✅");
        setTimeout(() => location.reload(), 1000);
    },

    // 5. Broadcast Sync Update
    async broadcastSync() {
        if (!this.myDevices.length) return;
        const payload = {
            type: 'auto_sync',
            contacts: this.contacts,
            groups: this.groups,
            history: this.history
        };

        Object.keys(this.connections).forEach(id => {
            if (this.myDevices.includes(id)) {
                this.connections[id].send(payload);
            }
        });
    },

    relayToMyDevices(payload) {
        Object.keys(this.connections).forEach(id => {
            if (this.myDevices.includes(id)) {
                this.connections[id].send(payload);
            }
        });
    },

    showSyncOverlay(mode) {
        document.getElementById('sync-overlay').style.display = 'flex';
        const sourceView = document.getElementById('syncSourceView');
        const targetView = document.getElementById('syncTargetView');

        if (mode === 'source') {
            sourceView.style.display = 'block';
            targetView.style.display = 'none';
            // Show the FULL Peer ID for guaranteed connectivity
            const syncId = (this.peer && this.peer.id) ? this.peer.id : this.myId;
            document.getElementById('syncCodeDisplay').innerText = syncId;
            document.getElementById('syncSourceStatus').innerText = "Ожидание подключения...";
        } else {
            sourceView.style.display = 'none';
            targetView.style.display = 'block';
            document.getElementById('syncInputCode').value = '';
            document.getElementById('syncTargetStatus').innerText = "";
        }
    },

    async handleSyncPush(conn) {
        this.addTrustedDevice(conn.peer); // Bidirectional trust
        const data = {
            nick: this.myNick,
            uid: this.myId,
            color: this.myColor,
            pass: this.myPass,
            secret: this.mySecret,
            contacts: this.contacts,
            history: this.history,
            groups: this.groups,
            encrypted: !!this.myPass
        };
        document.getElementById('syncSourceStatus').innerText = "Передача данных...";
        conn.send({ type: 'sync_push', payload: data });
        setTimeout(() => {
            document.getElementById('sync-overlay').style.display = 'none';
            this.showToast("Синхронизация завершена! ✅");
        }, 1000);
    },

    // --- Pre-Login Sync Functions ---

    startPreLoginSync() {
        document.getElementById('setup-overlay').style.display = 'none';
        document.getElementById('sync-overlay').style.display = 'flex';
        document.getElementById('syncSourceView').style.display = 'none';
        document.getElementById('syncTargetView').style.display = 'block';
        document.getElementById('syncInputCode').value = '';
        document.getElementById('syncTargetStatus').innerText = "Введите Source ID с другого устройства";
    },

    async initTempPeerForSync() {
        return new Promise((resolve) => {
            const tempId = 'sync_temp_' + Math.random().toString(36).substr(2, 8);
            console.log('[PreLoginSync] Creating temp peer:', tempId);

            const peer = new Peer(tempId, {
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                },
                debug: 1
            });

            peer.on('open', () => {
                console.log('[PreLoginSync] Temp peer ready:', tempId);
                this.tempPeer = peer;
                resolve(peer);
            });

            peer.on('error', (err) => {
                console.error('[PreLoginSync] Temp peer error:', err);
                this.logSync("Ошибка: " + err.type);
                resolve(null);
            });

            setTimeout(() => {
                if (!peer.open) {
                    console.error('[PreLoginSync] Temp peer timeout');
                    peer.destroy();
                    resolve(null);
                }
            }, 10000);
        });
    },

    applyImportedProfile(data) {
        console.log('[PreLoginSync] Applying imported profile:', data.nick);

        if (data.nick) localStorage.setItem('p2p_nick', data.nick);
        if (data.uid) localStorage.setItem('p2p_uid', data.uid);
        if (data.color) localStorage.setItem('p2p_color', data.color);
        if (data.pass) localStorage.setItem('p2p_pass', data.pass);
        if (data.secret) localStorage.setItem('p2p_secret', data.secret);
        if (data.contacts) localStorage.setItem('p2p_contacts', JSON.stringify(data.contacts));
        if (data.history) localStorage.setItem('p2p_history', JSON.stringify(data.history));
        if (data.groups) localStorage.setItem('p2p_groups', JSON.stringify(data.groups));
        if (data.privKey) localStorage.setItem('p2p_priv_key', data.privKey);
        if (data.pubKey) localStorage.setItem('p2p_pub_key', data.pubKey);
        if (data.tgBound) localStorage.setItem('p2p_tg_bound', 'true');

        if (this.tempPeer) {
            this.tempPeer.destroy();
            this.tempPeer = null;
        }

        this.showToast("✅ Профиль импортирован! Перезагрузка...");
        setTimeout(() => location.reload(), 1500);
    }
});
