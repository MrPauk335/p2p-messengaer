const app = {
    peer: null,
    myId: localStorage.getItem('p2p_uid'),
    myNick: localStorage.getItem('p2p_nick'),
    myPass: localStorage.getItem('p2p_pass'),
    mySecret: localStorage.getItem('p2p_secret'),
    lastIp: localStorage.getItem('p2p_last_ip'),
    myColor: localStorage.getItem('p2p_color') || '#0084ff',
    contacts: {},
    history: {},
    connections: {},
    groups: {},
    activeChatId: null,
    setupMode: 'reg',
    ipCheck: localStorage.getItem('p2p_ip_check') !== 'false',
    tgEnabled: localStorage.getItem('p2p_tg_enabled') === 'true',
    tgToken: '8508148034:AAFJRU766RAY1Rt6-XfYB6_PbEpZ7WwgND4',
    tgChatId: localStorage.getItem('p2p_tg_chatid') || '',
    tempSecret: null,
    tgLoginActive: false,
    tempChatId: '',
    deferredPrompt: null,
    currentContext: 'home', // 'home' or gid
    isElectron: (window.process && window.process.type) || navigator.userAgent.toLowerCase().includes('electron'),
    myDevices: JSON.parse(localStorage.getItem('p2p_my_devices') || '[]'),
    deviceSuffix: Math.random().toString(36).substring(2, 6), // Unique for this session

    normalizeId(id) {
        if (!id) return '';
        const prefix = id.startsWith('u_') ? 'u_' : 'p2p_user_';
        const clean = id.replace('p2p_user_', '').replace('u_', '').toLowerCase().replace(/[^a-z0-9\_]/g, '');
        return prefix + clean;
    },
    dbKey: null, // Derived key for local encryption
    identityKeyPair: null, // ECDH KeyPair
    sessionSecrets: {}, // Shared secrets for active chats
    peerPublicKeys: {}, // Raw public keys for fingerprints
    incognitoMode: localStorage.getItem('p2p_incognito') === 'true',
    burnTimer: parseInt(localStorage.getItem('p2p_burn_timer') || '0'),

    async generateIdentityKey() {
        this.identityKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            ['deriveKey', 'deriveBits']
        );
    },

    async exportPublicKey() {
        if (!this.identityKeyPair) await this.generateIdentityKey();
        const exported = await crypto.subtle.exportKey('spki', this.identityKeyPair.publicKey);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    },

    async importPublicKey(keyB64) {
        const keyData = new Uint8Array(atob(keyB64).split('').map(c => c.charCodeAt(0)));
        return await crypto.subtle.importKey(
            'spki',
            keyData,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        );
    },

    async deriveSharedSecret(peerPublicKey) {
        return await crypto.subtle.deriveKey(
            { name: 'ECDH', public: peerPublicKey },
            this.identityKeyPair.privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    async deriveKey(password) {
        if (!password) return null;
        const msgUint8 = new TextEncoder().encode(password);
        const hash = await crypto.subtle.digest('SHA-256', msgUint8);
        return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    },

    async encrypt(data) {
        if (!this.myPass) return JSON.stringify(data);
        if (!this.dbKey) this.dbKey = await this.deriveKey(this.myPass);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(JSON.stringify(data));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.dbKey, encoded);

        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);

        return btoa(String.fromCharCode(...combined));
    },

    async decrypt(cipherB64) {
        if (!this.myPass) {
            try { return JSON.parse(cipherB64); } catch (e) { return null; }
        }
        if (!this.dbKey) this.dbKey = await this.deriveKey(this.myPass);

        try {
            const combined = new Uint8Array(atob(cipherB64).split('').map(c => c.charCodeAt(0)));
            const iv = combined.slice(0, 12);
            const data = combined.slice(12);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.dbKey, data);
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            console.error("Decryption failed", e);
            return null;
        }
    },

    async encryptSessionMsg(peerId, text) {
        const secret = this.sessionSecrets[peerId];
        if (!secret) return null;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, secret, encoded);
        return {
            payload: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
            iv: btoa(String.fromCharCode(...iv))
        };
    },

    async decryptSessionMsg(peerId, payload, ivB64) {
        const secret = this.sessionSecrets[peerId];
        if (!secret) return null;
        try {
            const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
            const data = new Uint8Array(atob(payload).split('').map(c => c.charCodeAt(0)));
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, secret, data);
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("Session decryption failed", e);
            return "[Ошибка дешифровки E2EE]";
        }
    },

    init() {
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                document.getElementById('sidebar-backdrop').style.display = 'none';
                document.getElementById('sidebar').classList.remove('hidden');
            }
        });

        // Инициализация палитры в сетапе
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.onclick = () => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                this.myColor = dot.dataset.color;
            };
        });

        if (!this.myNick) {
            this.genSecret();
            document.getElementById('setup-overlay').style.display = 'flex';
            this.generateIdentityKey().then(() => {
                this.updateMyProfileUI();
            });
        } else {
            this.generateIdentityKey().then(() => {
                this.updateMyProfileUI();
                this.loadEncryptedData().then(() => {
                    this.checkIP();
                    this.startTgPolling();
                    this.updateEncryptionStatus();
                });
            });
        }
        window.addEventListener('hashchange', () => this.checkHash());

        // Heartbeat for status
        setInterval(() => {
            this.updateMyProfileUI();
            if (this.activeChatId) {
                const conn = this.connections[this.activeChatId];
                const isOnline = conn && conn.open;
                this.updateOnlineStatus(this.activeChatId, !!isOnline);
            }
        }, 3000);
        this.initPWA();
        if (this.isElectron) {
            const installBox = document.getElementById('p2pInstallContainer');
            if (installBox) installBox.style.display = 'none';
        } else {
            const installBox = document.getElementById('p2pInstallContainer');
            if (installBox) installBox.style.display = 'block';
        }
        this.updateRailGroups();
    },

    initPWA() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            console.log('PWA Prompt deferred');
        });
    },

    async promptInstall() {
        if (!this.deferredPrompt) {
            this.showToast('Уже установлено или пока недоступно 📱');
            return;
        }
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('User installed PWA');
        }
        this.deferredPrompt = null;
    },

    genSecret() {
        const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        this.tempSecret = secret;
        const box = document.getElementById('setup-secret-box');
        if (box) box.style.display = 'block';
    },

    setSetupMode(mode) {
        this.setupMode = mode;
        const isReg = mode === 'reg';

        document.getElementById('setupTitle').innerText = isReg ? 'Создать профиль' : 'Войти в аккаунт';
        document.getElementById('setupDesc').innerText = isReg ? 'Выберите имя, цвет и пароль' : 'Введите данные вашего аккаунта';

        document.getElementById('modeReg').classList.toggle('active', isReg);
        document.getElementById('modeReg').style.background = isReg ? 'var(--accent)' : '#252525';
        document.getElementById('modeLogin').classList.toggle('active', !isReg);
        document.getElementById('modeLogin').style.background = !isReg ? 'var(--accent)' : '#252525';

        document.getElementById('setupColors').style.display = isReg ? 'flex' : 'none';

        // Login specific fields
        const choice = document.getElementById('login-2fa-choice');
        if (choice) choice.style.display = isReg ? 'none' : 'block';

        document.getElementById('setupSecretInput').style.display = 'none';
        document.getElementById('login-tg-wait').style.display = 'none';

        document.getElementById('setup-secret-box').style.display = (isReg && this.tempSecret) ? 'block' : 'none';
        document.getElementById('setupBtn').innerText = isReg ? 'Начать работу' : 'Войти';
    },

    setLogin2fa(type) {
        if (type === 'key') {
            document.getElementById('setupSecretInput').style.display = 'block';
            document.getElementById('login-tg-wait').style.display = 'none';
            document.getElementById('setupSecretInput').focus();
        }
    },

    async requestLoginTg() {
        const name = document.getElementById('setupName').value.trim();
        if (!name) return alert("Сначала введите никнейм!");

        document.getElementById('login-2fa-choice').style.display = 'none';
        document.getElementById('login-tg-wait').style.display = 'block';
        document.getElementById('setupTgCodeInput').style.display = 'none';

        this.tgLoginActive = true;
        this.pollTgLogin();
    },

    async pollTgLogin() {
        if (!this.tgLoginActive) return;

        try {
            const res = await fetch(`https://api.telegram.org/bot${this.tgToken}/getUpdates?offset=-1&limit=5`);
            const data = await res.json();

            if (data.ok && data.result && data.result.length > 0) {
                const latest = data.result[data.result.length - 1];
                const msg = latest.message;
                this.lastTgUpdateId = latest.update_id;

                if (msg && msg.text && msg.text.toLowerCase().trim() === '/login') {
                    const cid = msg.chat.id.toString();
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    this.tg2faCode = code;
                    this.tempChatId = cid;

                    await this.sendToCustomTg(cid, `🔐 Код для восстановления аккаунта <b>${this.esc(document.getElementById('setupName').value)}</b>:\n\n<tg-spoiler>${code}</tg-spoiler>`);

                    document.getElementById('loginTgStatus').innerHTML = "✅ Код отправлен!";
                    document.getElementById('setupTgCodeInput').style.display = 'block';
                    document.getElementById('setupTgCodeInput').focus();
                    this.tgLoginActive = false;
                    return;
                }
            }
        } catch (e) { }

        if (this.tgLoginActive) setTimeout(() => this.pollTgLogin(), 3000);
    },

    async sendToCustomTg(chatId, text) {
        try {
            const url = `https://api.telegram.org/bot${this.tgToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(text)}&parse_mode=HTML`;
            await fetch(url, { mode: 'no-cors' });
            return true;
        } catch (e) { return false; }
    },

    openSettings() {
        document.getElementById('settings-overlay').style.display = 'flex';
        document.getElementById('settingIpCheck').checked = this.ipCheck;
        document.getElementById('keyWarning').style.display = this.ipCheck ? 'block' : 'none';

        document.getElementById('settingTgEnabled').checked = this.tgEnabled;
        document.getElementById('tgSettings').style.display = this.tgEnabled ? 'block' : 'none';

        const isLinked = !!this.tgChatId;
        document.getElementById('tgPairingContainer').style.display = isLinked ? 'none' : 'block';
        document.getElementById('tgLinkedContainer').style.display = isLinked ? 'block' : 'none';
        if (isLinked) document.getElementById('tgChatIdLabel').innerText = this.tgChatId;

        document.getElementById('tgPairingCodeDisplay').style.display = 'none';
        document.getElementById('tgPairingStatus').innerText = 'Привяжите аккаунт, чтобы получать 2FA и команды (/logout).';
        document.getElementById('tgPairBtn').disabled = false;
    },

    toggleIpCheck(val) {
        this.ipCheck = val;
        localStorage.setItem('p2p_ip_check', val);
        document.getElementById('keyWarning').style.display = val ? 'block' : 'none';
    },

    toggleTg(val) {
        this.tgEnabled = val;
        localStorage.setItem('p2p_tg_enabled', val);
        document.getElementById('tgSettings').style.display = val ? 'block' : 'none';
    },

    async startTgPairing() {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        this.pairingCode = code;

        const display = document.getElementById('tgPairingCodeDisplay');
        display.innerText = `${code.slice(0, 3)} ${code.slice(3)}`;
        display.style.display = 'block';

        document.getElementById('tgPairingStatus').innerText = "Отправьте этот код боту @p2p2fabot...";
        document.getElementById('tgPairBtn').disabled = true;

        this.isPairing = true;
        this.pollTgPairing();
    },

    async pollTgPairing() {
        if (!this.isPairing) return;

        try {
            const res = await fetch(`https://api.telegram.org/bot${this.tgToken}/getUpdates?offset=-10&limit=10&timeout=5`);
            const data = await res.json();

            if (data.ok && data.result) {
                for (const update of data.result) {
                    const msg = update.message;
                    if (msg && msg.text && msg.text.replace(/\s/g, '') === this.pairingCode) {
                        this.tgChatId = msg.chat.id.toString();
                        localStorage.setItem('p2p_tg_chatid', this.tgChatId);

                        this.isPairing = false;
                        this.showToast("Telegram успешно привязан! 🎉");
                        this.openSettings(); // Refresh UI
                        return;
                    }
                }
            }
        } catch (e) { console.error("Polling error:", e); }

        if (this.isPairing) setTimeout(() => this.pollTgPairing(), 3000);
    },

    unlinkTg() {
        if (confirm("Отключить уведомления в Telegram?")) {
            this.tgChatId = '';
            localStorage.removeItem('p2p_tg_chatid');
            this.isPairing = false;
            this.openSettings();
        }
    },

    async testTg() {
        if (!this.tgChatId) return alert("Сначала привяжите аккаунт!");

        const ok = await this.sendToTg(`🛡️ Связь с P2P Messenger установлена!\n\nВаш Ключ Безопасности:\n<tg-spoiler>${this.mySecret}</tg-spoiler>`, true);
        if (ok) this.showToast("Ключ отправлен в Telegram! ✈️");
        else alert("Ошибка отправки! Убедитесь, что вы не заблокировали бота.");
    },

    async sendToTg(text, useKeyboard = false) {
        if (!this.tgEnabled || !this.tgToken || !this.tgChatId) return false;
        try {
            let url = `https://api.telegram.org/bot${this.tgToken}/sendMessage?chat_id=${this.tgChatId}&text=${encodeURIComponent(text)}&parse_mode=HTML`;

            if (useKeyboard) {
                const markup = {
                    keyboard: [
                        [{ text: "📊 Статус" }, { text: "🚫 Выйти" }],
                        [{ text: "❓ Помощь" }, { text: "🎧 Поддержка" }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                };
                url += `&reply_markup=${encodeURIComponent(JSON.stringify(markup))}`;
            }

            await fetch(url, { mode: 'no-cors' });
            return true;
        } catch (e) { return false; }
    },

    async checkIP() {
        if (!this.ipCheck) return this.checkSecurity();

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
            const data = await res.json();
            clearTimeout(timeoutId);
            const currentIp = data.ip;

            if (this.lastIp && this.lastIp !== currentIp) {
                this.show2faStep('choice');
                document.getElementById('ip-overlay').style.display = 'flex';
            } else {
                localStorage.setItem('p2p_last_ip', currentIp);
                this.lastIp = currentIp;
                this.start(); // Auto-unlock if IP matches
            }
        } catch (e) {
            console.warn("IP check failed, falling back to password");
            this.checkSecurity();
        }
    },

    show2faStep(step) {
        document.getElementById('ipFirstStep').style.display = step === 'choice' ? 'block' : 'none';
        document.getElementById('ipKeyInputStep').style.display = step === 'key' ? 'block' : 'none';
        document.getElementById('ipTgInputStep').style.display = step === 'tg' ? 'block' : 'none';

        const tgBtn = document.getElementById('btnTgCodeReq');
        if (tgBtn) {
            tgBtn.disabled = !this.tgChatId;
            tgBtn.style.opacity = this.tgChatId ? '1' : '0.5';
            tgBtn.title = this.tgChatId ? '' : 'Telegram не привязан';
        }
    },

    async requestTg2fa() {
        if (!this.tgChatId) return;
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        this.tg2faCode = code;

        const ok = await this.sendToTg(`🛡️ Код подтверждения входа для <b>${this.esc(this.myNick)}</b>:\n\n<tg-spoiler>${code}</tg-spoiler>\n\nЕсли это не вы, нажмите <b>🚫 Выйти</b> для блокировки сессии.`, true);
        if (ok) {
            this.show2faStep('tg');
            this.showToast('Код отправлен! ✈️');
        } else {
            alert("Ошибка связи с Telegram!");
        }
    },

    verifyTg2fa() {
        const input = document.getElementById('ipTgCodeInput').value.trim();
        if (input === this.tg2faCode) {
            this.success2fa();
        } else {
            document.getElementById('tgIpError').innerText = "Неверный код!";
        }
    },

    verifySecret() {
        const input = document.getElementById('ipSecretInput').value.trim();
        if (input === this.mySecret) {
            this.success2fa();
        } else {
            document.getElementById('ipError').innerText = "Неверный секретный ключ!";
        }
    },

    success2fa() {
        document.getElementById('ip-overlay').style.display = 'none';
        this.updateIpAndStart();
    },

    async updateIpAndStart() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
            const d = await res.json();
            clearTimeout(timeoutId);
            localStorage.setItem('p2p_last_ip', d.ip);
            this.lastIp = d.ip;
        } catch (e) {
            console.warn("IP update failed during start/reg", e);
        }
        this.checkSecurity();
    },

    checkSecurity() {
        if (this.myPass) {
            this.showLock();
        } else {
            this.start();
        }
    },

    showLock() {
        document.getElementById('lock-overlay').style.display = 'flex';
        document.getElementById('lockNick').innerText = this.myNick;
        const av = document.getElementById('lockAvatar');
        av.innerText = this.myNick.charAt(0).toUpperCase();
        av.style.background = this.myColor;
        document.getElementById('lockPass').focus();
    },

    unlock() {
        const pass = document.getElementById('lockPass').value;
        if (pass === this.myPass) {
            document.getElementById('lock-overlay').style.display = 'none';
            this.start();
        } else {
            document.getElementById('lockError').innerText = "Неверный пароль";
        }
    },

    async finishSetup() {
        const name = document.getElementById('setupName').value.trim();
        const pass = document.getElementById('setupPass').value.trim();
        const secret = document.getElementById('setupSecretInput').value.trim();
        const tgCode = document.getElementById('setupTgCodeInput').value.trim();

        if (name.length < 2) {
            return document.getElementById('setupError').innerText = "Слишком короткое имя";
        }
        if (!pass) {
            return document.getElementById('setupError').innerText = "Пароль обязателен для защиты";
        }

        if (this.setupMode === 'login') {
            if (!secret && !tgCode) {
                return document.getElementById('setupError').innerText = "Выберите способ входа и получите код";
            }
            if (tgCode && tgCode !== this.tg2faCode) {
                return document.getElementById('setupError').innerText = "Неверный код из Telegram";
            }
        }

        document.getElementById('setupBtn').innerText = this.setupMode === 'reg' ? "Проверка имени..." : "Вход...";
        document.getElementById('setupBtn').disabled = true;

        const testPeerId = this.normalizeId(name);

        if (this.setupMode === 'reg') {
            const isTaken = await this.checkIdTaken(testPeerId);
            if (isTaken) {
                document.getElementById('setupBtn').innerText = "Начать работу";
                document.getElementById('setupBtn').disabled = false;
                document.getElementById('setupError').innerHTML = `Этот никнейм уже занят! <br> Если это ваш аккаунт, перейдите во вкладку <a href="#" onclick="app.setSetupMode('login')" style="color:var(--accent); text-decoration:underline;">Вход</a>.`;
                return;
            }
            this.mySecret = this.tempSecret;
        } else {
            if (tgCode) {
                this.tgChatId = this.tempChatId;
                this.tgEnabled = true;
                localStorage.setItem('p2p_tg_chatid', this.tgChatId);
                localStorage.setItem('p2p_tg_enabled', 'true');
                // Generate a real new secret key if restored via TG
                const newSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                this.mySecret = newSecret;
            } else {
                this.mySecret = secret;
            }
        }

        this.myNick = name;
        this.myId = testPeerId;
        this.myPass = pass;

        localStorage.setItem('p2p_nick', this.myNick);
        localStorage.setItem('p2p_uid', this.myId);
        localStorage.setItem('p2p_color', this.myColor);
        localStorage.setItem('p2p_pass', this.myPass);
        localStorage.setItem('p2p_secret', this.mySecret);

        if (this.tgEnabled) {
            this.sendToTg(`🛡️ Ваш Ключ Безопасности для аккаунта <b>${this.esc(this.myNick)}</b>:\n\n<tg-spoiler>${this.mySecret}</tg-spoiler>`, true);
        }

        await this.updateIpAndStart();

        document.getElementById('setup-overlay').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('setup-overlay').style.display = 'none';
            this.start();
        }, 300);
    },

    async checkIdTaken(id) {
        return new Promise((resolve) => {
            const p = new Peer(id);
            p.on('open', () => { p.destroy(); resolve(false); });
            p.on('error', (err) => {
                if (err.type === 'unavailable-id') { p.destroy(); resolve(true); }
                else { p.destroy(); resolve(false); }
            });
            setTimeout(() => { if (!p.destroyed) { p.destroy(); resolve(false); } }, 5000);
        });
    },

    start() {
        this.updateMyProfileUI();

        // Use a unique connection ID (Base ID + Suffix) to allow multiple devices for same user
        const connectionId = `${this.myId}_dev_${this.deviceSuffix}`;
        console.log('Connecting with ID:', connectionId);

        this.peer = new Peer(connectionId, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ],
                iceCandidatePoolSize: 10
            },
            debug: 1
        });

        this.peer.on('open', (id) => {
            console.log('Peer ID:', id);
            this.updateMyProfileUI(); // Update to show "Online"
            this.checkHash();
            this.reconnect();

            // Try to discover my other devices
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
    },

    updateMyProfileUI() {
        if (!this.myNick) {
            document.getElementById('myNickDisplay').innerText = "Загрузка...";
            return;
        }
        document.getElementById('myNickDisplay').innerText = this.myNick;
        const myId = document.getElementById('myIdDisplay');
        if (myId) {
            let statusText = '<span style="color:var(--danger)">Оффлайн 🔴</span>';
            if (this.peer) {
                if (this.peer.open) statusText = '<span style="color:var(--success)">В сети 🟢</span>';
                else if (this.peer.disconnected) statusText = '<span style="color:var(--warning)" onclick="app.reconnect()" title="Нажмите для переподключения">Отключен 🟡 (Нажать 🔄)</span>';
                else statusText = '<span style="color:var(--accent)">Подключение... 📡</span>';
            }
            myId.innerHTML = `${this.myId} <br> <span style="font-size:10px; cursor:pointer;" onclick="app.reconnect()">${statusText}</span>`;
        }
        const avatar = document.getElementById('myAvatarDisplay');
        if (avatar) {
            avatar.innerText = this.myNick.charAt(0).toUpperCase();
            avatar.style.background = this.myColor || '#555';
        }
        if (document.getElementById('editName')) {
            document.getElementById('editName').value = this.myNick;
        }
    },

    toggleIncognito(enabled) {
        this.incognitoMode = enabled;
        localStorage.setItem('p2p_incognito', enabled);
        this.showToast(enabled ? 'Инкогнито: История не сохраняется 🕶️' : 'Инкогнито выключено');
    },

    setBurnTimer(seconds) {
        this.burnTimer = parseInt(seconds);
        localStorage.setItem('p2p_burn_timer', seconds);
        this.showToast(seconds > 0 ? `Автоудаление: ${seconds} сек ⏳` : 'Автоудаление выключено');
    },

    toggleIpCheck(enabled) {
        this.ipCheck = enabled;
        localStorage.setItem('p2p_ip_check', enabled);
        this.showToast(enabled ? 'Проверка по IP включена 🛡️' : 'Проверка по IP выключена 🔓');
    },

    toggleTg(enabled) {
        this.tgEnabled = enabled;
        localStorage.setItem('p2p_tg_enabled', enabled);
        this.updateTgSettingsUI();
        if (enabled) {
            this.startTgPolling();
            this.showToast('Telegram 2FA включен 🤖');
        }
    },

    async startTgPairing() {
        const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
        this.pairingCode = pairingCode;
        this.isPairing = true;

        document.getElementById('tgPairingCodeDisplay').innerText = pairingCode.split('').join(' ');
        document.getElementById('tgPairingCodeDisplay').style.display = 'block';
        document.getElementById('tgPairBtn').style.display = 'none';
        document.getElementById('tgPairingStatus').innerText = "Отправьте этот код боту @p2p2fabot";

        if (!this.tgLoginActive) {
            this.tgLoginActive = true;
            this.pollTgCommands();
        }
    },

    unlinkTg() {
        if (confirm("Отключить Telegram?")) {
            this.tgEnabled = false;
            this.tgChatId = '';
            localStorage.removeItem('p2p_tg_enabled');
            localStorage.removeItem('p2p_tg_chatid');
            this.updateTgSettingsUI();
            this.showToast('Telegram отключен 🚫');
        }
    },

    updateTgSettingsUI() {
        const container = document.getElementById('tgSettings');
        container.style.display = this.tgEnabled ? 'block' : 'none';

        const pairing = document.getElementById('tgPairingContainer');
        const linked = document.getElementById('tgLinkedContainer');

        if (this.tgChatId) {
            pairing.style.display = 'none';
            linked.style.display = 'block';
            document.getElementById('tgChatIdLabel').innerText = this.tgChatId;
        } else {
            pairing.style.display = 'block';
            linked.style.display = 'none';
            document.getElementById('tgPairingCodeDisplay').style.display = 'none';
            document.getElementById('tgPairBtn').style.display = 'block';
            document.getElementById('tgPairingStatus').innerText = "Привяжите аккаунт, чтобы получать 2FA и команды (/logout).";
        }
    },

    updateProfile() {
        const newName = document.getElementById('editName').value.trim();
        const oldPassInput = document.getElementById('oldPass').value;
        const newPass = document.getElementById('editPass').value.trim();

        if (this.myPass && oldPassInput !== this.myPass) {
            return alert("Неверный текущий пароль!");
        }

        if (newName.length >= 2) {
            this.myNick = newName;
            localStorage.setItem('p2p_nick', this.myNick);

            if (newPass) {
                this.myPass = newPass;
                localStorage.setItem('p2p_pass', this.myPass);
            } else if (document.getElementById('editPass').value === "" && confirm("Удалить пароль?")) {
                this.myPass = null;
                localStorage.removeItem('p2p_pass');
            }

            this.updateMyProfileUI();
            document.getElementById('settings-overlay').style.display = 'none';
            document.getElementById('oldPass').value = '';
            document.getElementById('editPass').value = '';
            this.showToast('Профиль обновлен! ✨');

            Object.values(this.connections).forEach(conn => {
                conn.send({ type: 'handshake', nick: this.myNick, color: this.myColor });
            });
        }
    },

    startTgPolling() {
        if (!this.tgEnabled || !this.tgChatId) return;
        this.pollTgCommands();
    },

    async pollTgCommands() {
        if (!this.tgEnabled || !this.tgChatId) return;

        try {
            // Baseline: ignore everything before app started
            if (this.lastTgUpdateId === 0) {
                const initRes = await fetch(`https://api.telegram.org/bot${this.tgToken}/getUpdates?offset=-1&limit=1`);
                const initData = await initRes.json();
                if (initData.ok && initData.result.length > 0) {
                    this.lastTgUpdateId = initData.result[0].update_id;
                    // Dont process the baseline update
                } else {
                    // Chat is empty or bot never used
                    this.lastTgUpdateId = 1;
                }
                setTimeout(() => this.pollTgCommands(), 5000);
                return;
            }

            const res = await fetch(`https://api.telegram.org/bot${this.tgToken}/getUpdates?offset=${this.lastTgUpdateId + 1}&limit=10&timeout=10`);
            const data = await res.json();

            if (data.ok && data.result) {
                for (const update of data.result) {
                    this.lastTgUpdateId = update.update_id;
                    const msg = update.message;
                    if (msg && msg.chat.id.toString() === this.tgChatId) {
                        const cmd = msg.text ? msg.text.toLowerCase().trim() : '';
                        if (cmd === '/logout' || cmd === '/kick' || cmd === '🚫 выйти') {
                            this.sendToTg("🚫 Команда на выход получена. Сессия закрыта.", true);
                            this.logout(true);
                            return;
                        } else if (cmd === '/status' || cmd === '📊 статус') {
                            this.sendToTg(`📊 <b>Статус сессии:</b>\n👤 Ник: <code>${this.esc(this.myNick)}</code>\n🌐 IP: <code>${this.lastIp}</code>\n📶 Сеть: PeerJS Active`, true);
                        } else if (cmd === '/help' || cmd === '/start' || cmd === '❓ помощь') {
                            this.sendToTg(`🤖 <b>Доступные команды:</b>\n/status - проверить состояние\n/logout - завершить сессию\n/kick - то же самое что logout`, true);
                        } else if (cmd === '🎧 поддержка') {
                            this.sendToTg(`👨‍💻 <b>Служба поддержки:</b>\nДля восстановления аккаунта или решения проблем пишите @p2p2fabot (или вашему администратору).`, true);
                        }
                    }
                }
            }
        } catch (e) { console.error("Poll error", e); }

        setTimeout(() => this.pollTgCommands(), 5000);
    },

    handleConnection(conn) {
        conn.on('open', async () => {
            const myPub = await this.exportPublicKey();
            conn.send({ type: 'handshake', nick: this.myNick, color: this.myColor, pubKey: myPub });
            this.connections[conn.peer] = conn;
            if (!this.contacts[conn.peer]) {
                this.addContact(conn.peer, 'Входящий запрос', '#555');
            }
            this.updateOnlineStatus(conn.peer, true);
        });

        conn.on('data', async (data) => {
            if (data.type === 'handshake') {
                if (!this.contacts[conn.peer]) {
                    this.addContact(conn.peer, data.nick, data.color || '#555');
                }
                this.contacts[conn.peer].name = data.nick;
                this.contacts[conn.peer].color = data.color || '#555';

                if (data.pubKey) {
                    this.peerPublicKeys[conn.peer] = data.pubKey;
                    const peerPub = await this.importPublicKey(data.pubKey);
                    this.sessionSecrets[conn.peer] = await this.deriveSharedSecret(peerPub);
                    if (this.activeChatId === conn.peer) this.updateChatHeader();
                }

                this.saveContacts();
                this.refreshContacts();
                this.updateOnlineStatus(conn.peer, true);
            } else if (data.type === 'msg') {
                let text = data.text;
                if (data.isEncrypted && this.sessionSecrets[conn.peer]) {
                    text = await this.decryptSessionMsg(conn.peer, data.payload, data.iv);
                }
                if (text) {
                    const chatId = data.gid || conn.peer;
                    this.saveMsg(chatId, text, 'them', conn.peer, true);
                    if (!data.isRelay) this.relayToMyDevices({ ...data, isRelay: true });
                }
            } else if (data.type === 'group_sync') {
                // Incoming group info from an invite or update
                const gid = data.group.id;
                this.groups[gid] = data.group;
                this.saveGroups();
                this.refreshContacts();
                if (this.activeChatId === gid) this.renderHistory(gid);
            } else if (data.type === 'sync_pull') {
                if (confirm(`Устройство ${conn.peer} запрашивает синхронизацию всех данных. Разрешить?`)) {
                    this.handleSyncPush(conn);
                }
            } else if (data.type === 'sync_push') {
                this.addTrustedDevice(conn.peer); // Trust the device after manual sync
                this.processSyncData(data.payload);
            } else if (data.type === 'auto_sync') {
                console.log('Received background auto-sync update');
                if (data.contacts) this.contacts = data.contacts;
                if (data.groups) this.groups = data.groups;
                if (data.history) this.history = data.history;
                this.saveContacts(true); // silent=true to prevent loop
                this.saveGroups(true);
                this.saveMsgMigration(true);
                this.refreshContacts();
                if (this.activeChatId) this.renderHistory(this.activeChatId);
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.updateOnlineStatus(conn.peer, false);
            delete this.connections[conn.peer];
            delete this.sessionSecrets[conn.peer];
        });

        conn.on('close', () => {
            delete this.connections[conn.peer];
            delete this.sessionSecrets[conn.peer];
            this.updateOnlineStatus(conn.peer, false);
        });
    },

    tryAddFriend() {
        const input = document.getElementById('contactSearch');
        let id = this.normalizeId(input.value.trim());
        if (!id) return;

        if (id !== this.myId) {
            if (!this.contacts[id]) {
                this.addContact(id, 'Поиск...', '#555');
            }
            this.selectChat(id);
            input.value = '';
        }
    },

    addContact(id, name, color) {
        this.contacts[id] = { name, color, last: '' };
        this.saveContacts();
        this.refreshContacts();
    },

    esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    selectChat(id) {
        this.activeChatId = id;
        this.updateChatHeader();

        // Handle empty state visibility
        document.getElementById('emptyChat').style.display = 'none';
        document.getElementById('chatArea').style.display = 'flex';

        // Clear search on selection to prevent "disappearing chats" bug
        const searchInput = document.getElementById('contactSearch');
        if (searchInput && searchInput.value) {
            searchInput.value = '';
            this.refreshContacts();
        }

        this.renderHistory(id);
        this.refreshContacts();

        if (this.isGroup(id)) {
            this.groups[id].members.forEach(memberId => {
                if (memberId !== this.myId && (!this.connections[memberId] || !this.connections[memberId].open)) {
                    const conn = this.peer.connect(memberId, { reliable: true });
                    this.handleConnection(conn);
                }
            });
        } else if (this.peer && (!this.connections[id] || !this.connections[id].open)) {
            console.log('Connecting to:', id);
            const conn = this.peer.connect(id, { reliable: true });
            this.handleConnection(conn);
        }
    },

    updateChatHeader() {
        const id = this.activeChatId;
        const isGroup = this.isGroup(id);
        const data = isGroup ? this.groups[id] : this.contacts[id];
        if (!data) return;

        const isE2EE = isGroup || !!this.sessionSecrets[id];
        const isVerified = !isGroup && this.contacts[id]?.verified;

        document.getElementById('chatName').innerHTML = `
            ${this.esc(data.name)} 
            ${isVerified ? '<span style="color:var(--success); font-size:14px;" title="Личность подтверждена">✅</span>' : ''}
            ${isE2EE ? '<span title="' + (isGroup ? 'Групповой чат (E2EE)' : 'E2EE Защищено') + '" style="color:var(--success); font-size:14px; margin-left:5px;">🛡️</span>' : ''}
        `;

        if (isGroup) {
            document.getElementById('chatStatus').innerHTML = `👥 ${data.members.length} участников <span style="color:var(--accent); cursor:pointer; margin-left:10px;" onclick="app.tryAddGroupMember()" title="Пригласить участника">➕ Добавить</span>`;
            document.getElementById('membersToggle').style.display = 'flex';
            this.updateMembersList(id);
        } else {
            document.getElementById('chatStatus').innerText = this.connections[id] ? 'В сети' : 'Не в сети';
            document.getElementById('membersToggle').style.display = 'none';
            document.getElementById('membersSidebar').style.display = 'none';
        }

        const av = document.getElementById('chatAvatar');
        av.innerText = isGroup ? '👥' : data.name.charAt(0).toUpperCase();
        av.style.background = data.color;

        const safety = document.getElementById('chatSafety');
        if (safety) {
            safety.style.display = isGroup ? 'none' : 'flex';
            if (!isGroup) {
                this.genFingerprint(id).then(fp => {
                    document.getElementById('fingerprintValue').innerText = fp;
                });
            }
        }
    },

    toggleMembersList() {
        const sidebar = document.getElementById('membersSidebar');
        sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
    },


    setContext(ctx) {
        this.currentContext = ctx;
        this.activeChatId = null;

        // UI feedback for rail
        document.querySelectorAll('.rail-item').forEach(el => el.classList.remove('active'));
        if (ctx === 'home') {
            document.getElementById('rail-home').classList.add('active');
        } else {
            const rel = document.querySelector(`.rail-item[data-gid="${ctx}"]`);
            if (rel) rel.classList.add('active');
        }

        // Hide chat, show empty state
        document.getElementById('chatArea').style.display = 'none';
        document.getElementById('emptyChat').style.display = 'flex';

        this.refreshContacts();
    },

    updateRailGroups() {
        const rail = document.getElementById('rail-groups');
        if (!rail) return;
        rail.innerHTML = '';
        Object.keys(this.groups).forEach(gid => {
            const group = this.groups[gid];
            const item = document.createElement('div');
            item.className = 'rail-item';
            item.dataset.gid = gid;
            if (this.currentContext === gid) item.classList.add('active');
            item.title = group.name;
            item.onclick = () => this.setContext(gid);

            const color = group.color || '#444';
            const avatar = group.name.charAt(0).toUpperCase();
            item.innerHTML = `<div class="rail-icon" style="color:${color}">${avatar}</div>`;
            rail.appendChild(item);
        });
    },

    updateMembersList(gid) {
        const group = this.groups[gid];
        const list = document.getElementById('membersList');
        if (!group || !list) return;
        list.innerHTML = '';

        group.members.forEach(mid => {
            const isMe = mid === this.myId;
            const nick = isMe ? this.myNick : (this.contacts[mid]?.name || 'Unknown');
            const color = isMe ? this.myColor : (this.contacts[mid]?.color || '#888');
            const avatar = nick.charAt(0).toUpperCase();

            const el = document.createElement('div');
            el.className = 'member-item';
            el.innerHTML = `
                <div class="avatar" style="width:28px; height:28px; font-size:12px; background:${color}">${avatar}</div>
                <div style="font-size:13px; color:#eee;">${this.esc(nick)} ${isMe ? '<small style="opacity:0.5">(Вы)</small>' : ''}</div>
            `;
            list.appendChild(el);
        });
    },

    tryAddGroupMember() {
        const id = prompt("Введите ID друга для добавления в группу:");
        if (id) {
            const cleanId = this.normalizeId(id);
            this.addGroupMember(this.activeChatId, cleanId);
        }
    },

    async addGroupMember(gid, memberId) {
        if (!this.groups[gid]) return;
        if (this.groups[gid].members.includes(memberId)) return this.showToast("Уже в группе!");

        this.groups[gid].members.push(memberId);
        this.saveGroups();
        this.refreshContacts();
        this.updateChatHeader();

        // Send group info to the NEW member
        const conn = this.peer.connect(memberId, { reliable: true });
        conn.on('open', () => {
            conn.send({ type: 'group_sync', group: this.groups[gid] });
            // Also notify EXISTING members about the new member? 
            // In a simple mesh, we should broadcast the updated group to everyone currently in the group
            this.broadcastGroupUpdate(gid);
        });
        this.handleConnection(conn);
    },

    broadcastGroupUpdate(gid) {
        const group = this.groups[gid];
        group.members.forEach(mid => {
            if (mid === this.myId) return;
            const conn = this.connections[mid];
            if (conn && conn.open) {
                conn.send({ type: 'group_sync', group: group });
            }
        });
    },

    checkHomograph(name) {
        const hasLatin = /[a-zA-Z]/.test(name);
        const hasCyrillic = /[а-яА-ЯёЁ]/.test(name);
        return hasLatin && hasCyrillic;
    },

    async genFingerprint(peerId) {
        // Fingerprint is based on the hash of BOTH public keys joined alphabetically
        const myPub = await this.exportPublicKey();
        const peerPub = this.peerPublicKeys[peerId] || '';
        if (!peerPub) return '🔒🔒🔒🔒'; // Waiting for handshake

        const combined = [myPub, peerPub].sort().join('');
        const msgUint8 = new TextEncoder().encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));

        const emojis = ['🕶️', '🚀', '🔒', '💎', '🛡️', '🛰️', '⚡', '🌌', '🎈', '🍀', '🍎', '🐲', '🌈', '🍕', '🎮'];
        let res = '';
        for (let i = 0; i < 4; i++) {
            // Use first 4 bytes of SHA256 for the emojis
            res += emojis[hashArray[i] % emojis.length];
        }
        return res;
    },

    async showSafetyInfo() {
        const id = this.activeChatId;
        const c = this.contacts[id];
        if (!c) return;

        document.getElementById('safetyTitle').innerText = c.name;
        const fp = await this.genFingerprint(id);
        document.getElementById('safetyFingerprintDisplay').innerText = fp;

        const btn = document.getElementById('btnVerify');
        if (c.verified) {
            btn.innerText = 'Удалить верификацию ✖️';
            btn.style.background = '#252525';
            btn.onclick = () => this.verifyContact(false);
        } else {
            btn.innerText = 'Подтвердить личность ✅';
            btn.style.background = 'var(--success)';
            btn.onclick = () => this.verifyContact(true);
        }

        const badges = document.getElementById('safetyBadges');
        const isE2EE = !!this.sessionSecrets[id];
        badges.innerHTML = `
    < span class="badge" style = "background:${isE2EE ? 'rgba(0, 210, 106, 0.1)' : 'rgba(255, 77, 77, 0.1)'}; color:${isE2EE ? 'var(--success)' : 'var(--danger)'}; padding:5px 10px; border-radius:20px; font-size:11px; margin-right:5px;" >
        ${isE2EE ? '● Шифрование активно' : '○ Ожидание рукопожатия'}
                </span >
    `;

        document.getElementById('safety-overlay').style.display = 'flex';
    },

    verifyContact(status) {
        if (!this.activeChatId) return;
        this.contacts[this.activeChatId].verified = status;
        this.saveContacts();
        this.refreshContacts();
        this.updateChatHeader();
        document.getElementById('safety-overlay').style.display = 'none';
        this.showToast(status ? 'Личность подтверждена! ✅' : 'Верификация удалена');
    },

    async sendMessage() {
        const input = document.getElementById('msgInput');
        const text = input.value.trim();
        const id = this.activeChatId;
        if (!text || !id) return;

        if (this.isGroup(id)) {
            const group = this.groups[id];
            group.members.forEach(async (memberId) => {
                if (memberId === this.myId) return;
                const conn = this.connections[memberId];
                if (conn && conn.open && this.sessionSecrets[memberId]) {
                    const enc = await this.encryptSessionMsg(memberId, text);
                    conn.send({ type: 'msg', payload: enc.payload, iv: enc.iv, isEncrypted: true, gid: id });
                }
            });
            this.saveMsg(id, text, 'me', this.myId);
        } else {
            const conn = this.connections[id];
            if (conn && conn.open) {
                if (this.sessionSecrets[id]) {
                    const enc = await this.encryptSessionMsg(id, text);
                    conn.send({ type: 'msg', payload: enc.payload, iv: enc.iv, isEncrypted: true });
                } else {
                    conn.send({ type: 'msg', text });
                }
                this.saveMsg(id, text, 'me', this.myId);
            } else {
                this.showToast('Собеседник не в сети 🚫');
            }
        }
        input.value = '';
    },

    async saveMsg(id, text, side, senderId = null, silent = false) {
        if (!senderId) senderId = (side === 'me' ? this.myId : id);

        if (this.incognitoMode) {
            this.appendBubble(text, side, new Date().toLocaleTimeString().slice(0, 5), senderId);
            this.handleBurnEffect(id, text, side);
            return;
        }

        if (!this.history[id]) this.history[id] = [];
        const time = new Date().toLocaleTimeString().slice(0, 5);
        this.history[id].push({ text, side, time, senderId });

        await this.saveMsgMigration(silent);

        if (this.activeChatId === id) {
            this.appendBubble(text, side, time, senderId);
        }
        if (this.contacts[id]) {
            this.contacts[id].last = (side === 'me' ? 'Вы: ' : '') + text;
            this.saveContacts(silent);
            this.refreshContacts();
        }

        this.handleBurnEffect(id, text, side);
    },

    handleBurnEffect(id, text, side) {
        if (this.burnTimer > 0) {
            setTimeout(() => {
                if (this.history[id]) {
                    this.history[id] = this.history[id].filter(m => m.text !== text);
                    this.saveMsgMigration();
                }
                if (this.activeChatId === id) this.renderHistory(id);
            }, this.burnTimer * 1000);
        }
    },

    renderHistory(id) {
        const box = document.getElementById('messages');
        box.innerHTML = '';
        if (this.history[id]) {
            this.history[id].forEach(m => this.appendBubble(m.text, m.side, m.time, m.senderId));
        }
    },

    appendBubble(text, side, time, senderId) {
        const box = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = `msg-group ${side}`;

        const isMe = side === 'me';
        const nick = isMe ? this.myNick : (this.contacts[senderId]?.name || 'Unknown');
        const color = isMe ? this.myColor : (this.contacts[senderId]?.color || '#888');
        const avatar = isMe ? this.myNick.charAt(0).toUpperCase() : nick.charAt(0).toUpperCase();

        div.innerHTML = `
            <div class="msg-avatar" style="background:${color}">${avatar}</div>
            <div class="msg-content">
                <div class="msg-header">
                    <span class="msg-nick" style="color:${color}">${this.esc(nick)}</span>
                    <span class="msg-time">${time}</span>
                </div>
                <div class="msg-text">${this.esc(text)}</div>
            </div>
        `;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    },

    refreshContacts() {
        const list = document.getElementById('contactList');
        if (!list) return;
        list.innerHTML = '';
        const search = document.getElementById('contactSearch').value.toLowerCase();

        if (this.currentContext === 'home') {
            // Render Contacts (DMs) only in Home context
            Object.keys(this.contacts).forEach(id => {
                const c = this.contacts[id];
                if (search && !c.name.toLowerCase().includes(search) && !id.toLowerCase().includes(search)) return;

                const active = this.activeChatId === id ? 'active' : '';
                const online = this.connections[id] ? 'online' : '';

                const el = document.createElement('div');
                el.className = `contact ${active}`;
                el.onclick = () => this.selectChat(id);
                el.innerHTML = `
                    <div class="avatar" style="background:${c.color}">${this.esc(c.name.charAt(0).toUpperCase())}</div>
                    <div class="contact-details">
                        <div>${this.esc(c.name)}</div>
                        <span>${this.esc(c.last || 'Нет сообщений')}</span>
                    </div>
                    <div class="status-dot ${online}"></div>
                `;
                list.appendChild(el);
            });
        } else {
            // Render Group Members in Group context
            const gid = this.currentContext;
            const group = this.groups[gid];
            if (!group) return;

            group.members.forEach(mid => {
                const isMe = mid === this.myId;
                const contact = this.contacts[mid];
                const name = isMe ? this.myNick : (contact?.name || mid.slice(0, 8));
                if (search && !name.toLowerCase().includes(search)) return;

                const active = this.activeChatId === mid ? 'active' : '';
                const online = this.connections[mid] ? 'online' : '';
                const color = isMe ? this.myColor : (contact?.color || '#555');

                const el = document.createElement('div');
                el.className = `contact ${active}`;
                el.onclick = () => this.selectChat(mid);
                el.innerHTML = `
                    <div class="avatar" style="background:${color}">${this.esc(name.charAt(0).toUpperCase())}</div>
                    <div class="contact-details">
                        <div>${this.esc(name)} ${isMe ? '<small>(Вы)</small>' : ''}</div>
                        <span>${isMe ? 'Ваш профиль' : (this.connections[mid] ? 'В сети' : 'Оффлайн')}</span>
                    </div>
                    <div class="status-dot ${online}"></div>
                `;
                list.appendChild(el);
            });
        }
    },

    updateOnlineStatus(id, isOnline) {
        if (this.activeChatId === id) {
            document.getElementById('chatStatus').innerText = isOnline ? 'В сети' : 'Не в сети';
        }
        this.refreshContacts();
    },

    async saveContacts(silent = false) {
        if (this.myPass) {
            const encrypted = await this.encrypt(this.contacts);
            localStorage.setItem('p2p_contacts_enc', encrypted);
        } else {
            localStorage.setItem('p2p_contacts', JSON.stringify(this.contacts));
        }
        if (!silent) this.broadcastSync();
    },

    async saveGroups(silent = false) {
        if (this.myPass) {
            const encrypted = await this.encrypt(this.groups);
            localStorage.setItem('p2p_groups_enc', encrypted);
        } else {
            localStorage.setItem('p2p_groups', JSON.stringify(this.groups));
        }
        if (!silent) this.broadcastSync();
    },

    isGroup(id) {
        return id && id.startsWith('g_');
    },

    createGroup(name) {
        if (!name) return;
        const gid = 'g_' + Math.random().toString(36).substr(2, 9);
        const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        this.groups[gid] = {
            id: gid,
            name: name,
            members: [this.myId],
            color: color,
            creator: this.myId,
            created: Date.now()
        };
        this.saveGroups();
        this.refreshContacts();
        this.selectChat(gid);
        this.showToast(`Группа "${name}" создана! 👥`);
        const overlay = document.getElementById('group-create-overlay');
        if (overlay) overlay.style.display = 'none';
        const input = document.getElementById('groupNameInput');
        if (input) input.value = '';
    },

    async loadEncryptedData() {
        const cEnc = localStorage.getItem('p2p_contacts_enc');
        const hEnc = localStorage.getItem('p2p_history_enc');
        const gEnc = localStorage.getItem('p2p_groups_enc');

        if (cEnc) {
            const dec = await this.decrypt(cEnc);
            if (dec) this.contacts = dec;
        } else {
            // Migration for old unencrypted data
            const old = localStorage.getItem('p2p_contacts');
            if (old) {
                this.contacts = JSON.parse(old);
                this.saveContacts();
                localStorage.removeItem('p2p_contacts');
            }
        }

        if (gEnc) {
            const dec = await this.decrypt(gEnc);
            if (dec) this.groups = dec;
        } else {
            const oldG = localStorage.getItem('p2p_groups');
            if (oldG) {
                this.groups = JSON.parse(oldG);
                this.saveGroups();
                localStorage.removeItem('p2p_groups');
            }
        }

        if (hEnc) {
            const dec = await this.decrypt(hEnc);
            if (dec) this.history = dec;
        } else {
            // Migration for old unencrypted data
            const old = localStorage.getItem('p2p_history');
            if (old) {
                this.history = JSON.parse(old);
                this.saveMsgMigration(); // Save encrypted
                localStorage.removeItem('p2p_history');
            }
        }
    },

    async saveMsgMigration(silent = false) {
        const encrypted = await this.encrypt(this.history);
        localStorage.setItem('p2p_history_enc', encrypted);
        if (!silent) this.broadcastSync();
    },

    updateEncryptionStatus() {
        const status = document.getElementById('encryptionStatus');
        if (status) {
            status.innerHTML = this.myPass ? '🛡️ Данные зашифрованы (AES-GCM)' : '⚠️ Данные не зашифрованы (установите пароль)';
            status.style.color = this.myPass ? 'var(--success)' : 'var(--danger)';
        }
    },

    reconnect() {
        if (this.peer && this.peer.disconnected) {
            this.peer.reconnect();
        } else if (!this.peer || this.peer.destroyed) {
            this.start();
        }

        Object.keys(this.contacts).forEach(id => {
            if (!this.connections[id] || !this.connections[id].open) {
                const conn = this.peer.connect(id, { reliable: true });
                this.handleConnection(conn);
            }
        });
    },

    checkHash() {
        const hash = window.location.hash.replace('#', '');
        const isLegacy = hash.startsWith('u_');
        const isNew = hash.startsWith('p2p_user_');

        if (hash && (isLegacy || isNew) && hash !== this.myId) {
            if (!this.contacts[hash]) this.addContact(hash, 'Загрузка...', '#555');
            this.selectChat(hash);
            history.replaceState(null, null, ' ');
        }
    },

    shareInvite() {
        const url = `${window.location.origin}${window.location.pathname} #${this.myId} `;
        if (navigator.share) {
            navigator.share({
                title: 'Мессенджер P2P',
                text: 'Давай общаться в приватном P2P мессенджере!',
                url: url
            }).catch(console.error);
        } else {
            navigator.clipboard.writeText(url).then(() => this.showToast('Ссылка скопирована! 🔗'));
        }
    },

    showToast(msg) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    },

    openSettings() {
        const overlay = document.getElementById('settings-overlay');
        const modal = overlay.querySelector('.modal');
        overlay.style.display = 'flex';
        if (modal) modal.scrollTop = 0;
        this.updateEncryptionStatus();
    },

    async exportPublicKey() {
        if (!this.identityKeyPair) await this.generateIdentityKey();
        const exported = await crypto.subtle.exportKey('spki', this.identityKeyPair.publicKey);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    },

    // --- Synchronization ---

    discoverMyDevices() {
        if (!this.myDevices.length) return;
        console.log('Discovering trusted devices...', this.myDevices);

        this.myDevices.forEach(id => {
            if (id === this.myId) return; // Legacy/redundant

            // We don't know the exact suffix of other devices, so we would need a relay or 
            // a known suffix pattern. For simplicity: let's assume we store the FULL connection IDs 
            // of trusted devices after the first manual sync.
            if (!this.connections[id] || !this.connections[id].open) {
                const conn = this.peer.connect(id, { reliable: true });
                this.handleConnection(conn);
            }
        });
    },

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

    addTrustedDevice(fullId) {
        if (!this.myDevices.includes(fullId)) {
            this.myDevices.push(fullId);
            localStorage.setItem('p2p_my_devices', JSON.stringify(this.myDevices));
            console.log('Device trusted:', fullId);
        }
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

        if (targetId === this.myId || (this.peer && targetId === this.peer.id)) {
            return this.showToast("Нельзя соединиться с самим собой ⚠️");
        }

        // Standard connection with explicit JSON serialization
        this.logSync("Connecting to: " + targetId);
        const conn = this.peer.connect(targetId, { serialization: 'json' });

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
                this.processSyncData(data.payload);
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

    logSync(msg) {
        console.log('[SyncDebug]', msg);
        const statusEl = document.getElementById('syncTargetStatus');
        if (statusEl) statusEl.innerText = msg;
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

    async processSyncData(data) {
        if (!data) return;
        document.getElementById('syncTargetStatus').innerText = "Данные получены! Сохранение...";

        if (confirm(`Загружены данные пользователя ${data.nick}. Заменить текущие локальные данные?`)) {
            localStorage.setItem('p2p_nick', data.nick);
            localStorage.setItem('p2p_uid', data.uid);
            localStorage.setItem('p2p_color', data.color);
            if (data.pass) localStorage.setItem('p2p_pass', data.pass);
            if (data.secret) localStorage.setItem('p2p_secret', data.secret);

            this.contacts = data.contacts;
            this.history = data.history;
            this.groups = data.groups || {};
            this.myPass = data.pass;
            this.mySecret = data.secret;
            this.myId = data.uid;
            this.myNick = data.nick;
            this.myColor = data.color;

            await this.saveContacts();
            await this.saveMsgMigration();
            await this.saveGroups();

            document.getElementById('syncTargetStatus').innerText = "Готово! Перезагрузка...";
            setTimeout(() => location.reload(), 1500);
        }
    },

    copyMyId() {
        navigator.clipboard.writeText(this.myId).then(() => this.showToast('ID скопирован! 🆔'));
    },

    toggleSidebar() {
        const sb = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sb) {
            const isHidden = sb.classList.toggle('hidden');
            if (window.innerWidth <= 768) {
                backdrop.style.display = isHidden ? 'none' : 'block';
            } else {
                backdrop.style.display = 'none';
            }
        }
    },

    async exportData() {
        const data = {
            nick: this.myNick,
            uid: this.myId,
            color: this.myColor,
            pass: this.myPass,
            contacts: this.contacts,
            history: this.history,
            encrypted: !!this.myPass
        };

        let finalData = data;
        if (this.myPass) {
            const cipher = await this.encrypt(data);
            finalData = { payload: cipher, encrypted: true };
        }

        const blob = new Blob([JSON.stringify(finalData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `messenger_backup_${this.myNick}${this.myPass ? '_secured' : ''}.json`;
        a.click();
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = async (re) => {
                try {
                    let data = JSON.parse(re.target.result);

                    if (data.encrypted && data.payload) {
                        const pass = prompt("Этот файл зашифрован. Введите пароль для импорта:");
                        if (!pass) return;

                        // Temporarily use the provided password to decrypt
                        const tempKey = await this.deriveKey(pass);
                        const combined = new Uint8Array(atob(data.payload).split('').map(c => c.charCodeAt(0)));
                        const iv = combined.slice(0, 12);
                        const cipher = combined.slice(12);
                        try {
                            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, tempKey, cipher);
                            data = JSON.parse(new TextDecoder().decode(decrypted));
                        } catch (e) {
                            return alert("Неверный пароль для дешифровки!");
                        }
                    }

                    if (confirm("Это заменит все ваши текущие данные. Продолжить?")) {
                        localStorage.setItem('p2p_nick', data.nick);
                        localStorage.setItem('p2p_uid', data.uid);
                        localStorage.setItem('p2p_color', data.color);
                        if (data.pass) localStorage.setItem('p2p_pass', data.pass);

                        // Handle potential plaintext vs encrypted data in import
                        this.contacts = data.contacts;
                        this.history = data.history;
                        this.myPass = data.pass;
                        this.dbKey = null; // Forces re-derivation

                        await this.saveContacts();
                        await this.saveMsgMigration();

                        location.reload();
                    }
                } catch (err) { alert("Ошибка при чтении файла"); }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    clearData() {
        if (confirm('Это полностью удалит ваш ID и историю чатов. Продолжить?')) {
            localStorage.clear();
            location.reload();
        }
    },

    logout(forced = false) {
        if (forced || confirm("Выйти из аккаунта? История и контакты сохранятся.")) {
            localStorage.removeItem('p2p_nick');
            localStorage.removeItem('p2p_uid');
            localStorage.removeItem('p2p_pass');
            localStorage.removeItem('p2p_secret');
            localStorage.removeItem('p2p_last_ip');
            location.reload();
        }
    }
};

app.init();
