const app = {
    peer: null,
    myId: localStorage.getItem('p2p_uid'),
    myNick: localStorage.getItem('p2p_nick'),
    myPass: localStorage.getItem('p2p_pass'),
    mySecret: localStorage.getItem('p2p_secret'),
    lastIp: localStorage.getItem('p2p_last_ip'),
    myColor: localStorage.getItem('p2p_color') || '#0084ff',
    contacts: JSON.parse(localStorage.getItem('p2p_contacts') || '{}'),
    history: JSON.parse(localStorage.getItem('p2p_history') || '{}'),
    connections: {},
    activeChatId: null,
    setupMode: 'reg',
    ipCheck: localStorage.getItem('p2p_ip_check') !== 'false',
    tgEnabled: localStorage.getItem('p2p_tg_enabled') === 'true',
    tgToken: '8508148034:AAFJRU766RAY1Rt6-XfYB6_PbEpZ7WwgND4',
    tgChatId: localStorage.getItem('p2p_tg_chatid') || '',
    tempSecret: null,
    pairingCode: null,
    isPairing: false,
    tg2faCode: null,
    lastTgUpdateId: 0,
    tgLoginActive: false,
    tempChatId: '',

    init() {
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
        } else {
            this.updateMyProfileUI(); // Show nick immediately
            this.checkIP();
            this.startTgPolling();
        }

        window.addEventListener('hashchange', () => this.checkHash());
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
            const res = await fetch('https://api.ipify.org?format=json');
            const d = await res.json();
            localStorage.setItem('p2p_last_ip', d.ip);
            this.lastIp = d.ip;
        } catch (e) { }
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

        const testPeerId = `p2p_user_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        if (this.setupMode === 'reg') {
            const isTaken = await this.checkIdTaken(testPeerId);
            if (isTaken) {
                document.getElementById('setupBtn').innerText = "Начать работу";
                document.getElementById('setupBtn').disabled = false;
                return document.getElementById('setupError').innerText = "Этот никнейм уже занят!";
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

        this.peer = new Peer(this.myId, {
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });

        this.peer.on('open', (id) => {
            console.log('Peer ID:', id);
            this.checkHash();
            this.reconnect();
        });

        this.peer.on('connection', (conn) => this.handleConnection(conn));
        this.peer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                this.showToast('Ошибка: Этот никнейм уже используется на другом устройстве ⚠️');
            }
        });

        this.refreshContacts();
    },

    updateMyProfileUI() {
        document.getElementById('myNickDisplay').innerText = this.myNick;
        const avatar = document.getElementById('myAvatarDisplay');
        avatar.innerText = this.myNick.charAt(0).toUpperCase();
        avatar.style.background = this.myColor;
        document.getElementById('editName').value = this.myNick;
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
        conn.on('open', () => {
            conn.send({ type: 'handshake', nick: this.myNick, color: this.myColor });
            this.connections[conn.peer] = conn;
            if (!this.contacts[conn.peer]) {
                this.addContact(conn.peer, 'Входящий запрос', '#555');
            }
            this.updateOnlineStatus(conn.peer, true);
        });

        conn.on('data', (data) => {
            if (data.type === 'handshake') {
                this.contacts[conn.peer].name = data.nick;
                this.contacts[conn.peer].color = data.color || '#555';
                this.saveContacts();
                this.refreshContacts();
                if (this.activeChatId === conn.peer) this.updateChatHeader();
            } else if (data.type === 'msg') {
                this.saveMsg(conn.peer, data.text, 'them');
            }
        });

        conn.on('close', () => {
            delete this.connections[conn.peer];
            this.updateOnlineStatus(conn.peer, false);
        });
    },

    tryAddFriend() {
        const input = document.getElementById('contactSearch');
        let id = input.value.trim();
        if (!id) return;

        if (!id.startsWith('p2p_user_') && !id.startsWith('u_')) {
            id = `p2p_user_${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        }

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

        document.getElementById('msgInput').disabled = false;
        document.getElementById('sendBtn').disabled = false;
        document.getElementById('msgInput').focus();

        if (window.innerWidth <= 768) this.toggleSidebar();

        this.renderHistory(id);
        this.refreshContacts();

        if (!this.connections[id]) {
            const conn = this.peer.connect(id);
            this.handleConnection(conn);
        }
    },

    updateChatHeader() {
        const c = this.contacts[this.activeChatId];
        if (!c) return;

        const warning = this.checkHomograph(c.name) ? ' <span class="warning-badge" title="Внимание! Имя содержит похожие символы разных алфавитов (подделка)">⚠️</span>' : '';
        document.getElementById('chatName').innerHTML = this.esc(c.name) + warning;

        document.getElementById('chatStatus').innerText = this.connections[this.activeChatId] ? 'В сети' : 'Не в сети';
        const av = document.getElementById('chatAvatar');
        av.innerText = c.name.charAt(0).toUpperCase();
        av.style.background = c.color;

        const safety = document.getElementById('chatSafety');
        safety.style.display = 'flex';
        document.getElementById('fingerprintValue').innerText = this.genFingerprint(this.myId, this.activeChatId);
    },

    checkHomograph(name) {
        const hasLatin = /[a-zA-Z]/.test(name);
        const hasCyrillic = /[а-яА-ЯёЁ]/.test(name);
        return hasLatin && hasCyrillic;
    },

    genFingerprint(id1, id2) {
        const combined = [id1, id2].sort().join('');
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            hash = ((hash << 5) - hash) + combined.charCodeAt(i);
            hash |= 0;
        }
        const emojis = ['🕶️', '🚀', '🔒', '💎', '🛡️', '🛰️', '⚡', '🌌', '🎈', '🍀'];
        let res = '';
        const hStr = Math.abs(hash).toString();
        for (let i = 0; i < 4; i++) {
            res += emojis[parseInt(hStr[i] || i) % emojis.length];
        }
        return res;
    },

    showSafetyInfo() {
        alert(`Код безопасности: ${document.getElementById('fingerprintValue').innerText}\nЕсли у вашего собеседника такой же код — ваш чат на 100% приватен.`);
    },

    sendMessage() {
        const input = document.getElementById('msgInput');
        const text = input.value.trim();
        const id = this.activeChatId;
        if (!text || !id) return;

        if (this.connections[id] && this.connections[id].open) {
            this.connections[id].send({ type: 'msg', text });
            this.saveMsg(id, text, 'me');
            input.value = '';
        } else {
            this.showToast('Собеседник не в сети 🚫');
        }
    },

    saveMsg(id, text, side) {
        if (!this.history[id]) this.history[id] = [];
        const time = new Date().toLocaleTimeString().slice(0, 5);
        this.history[id].push({ text, side, time });
        localStorage.setItem('p2p_history', JSON.stringify(this.history));

        if (this.activeChatId === id) {
            this.appendBubble(text, side, time);
        }
        this.contacts[id].last = (side === 'me' ? 'Вы: ' : '') + text;
        this.saveContacts();
        this.refreshContacts();
    },

    renderHistory(id) {
        const box = document.getElementById('messages');
        box.innerHTML = '';
        if (this.history[id]) {
            this.history[id].forEach(m => this.appendBubble(m.text, m.side, m.time));
        }
    },

    appendBubble(text, side, time) {
        const box = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = `msg ${side}`;
        div.innerHTML = `${this.esc(text)} <time>${time}</time>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    },

    refreshContacts() {
        const list = document.getElementById('contactList');
        if (!list) return;
        list.innerHTML = '';
        const search = document.getElementById('contactSearch').value.toLowerCase();

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
    },

    updateOnlineStatus(id, isOnline) {
        if (this.activeChatId === id) {
            document.getElementById('chatStatus').innerText = isOnline ? 'В сети' : 'Не в сети';
        }
        this.refreshContacts();
    },

    saveContacts() {
        localStorage.setItem('p2p_contacts', JSON.stringify(this.contacts));
    },

    reconnect() {
        Object.keys(this.contacts).forEach(id => {
            if (!this.connections[id]) {
                const conn = this.peer.connect(id);
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
        const url = `${window.location.origin}${window.location.pathname}#${this.myId}`;
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

    copyMyId() {
        navigator.clipboard.writeText(this.myId).then(() => this.showToast('ID скопирован! 🆔'));
    },

    toggleSidebar() {
        const sb = document.getElementById('sidebar');
        if (sb) sb.classList.toggle('hidden');
    },

    exportData() {
        const data = {
            nick: this.myNick,
            uid: this.myId,
            color: this.myColor,
            pass: this.myPass,
            contacts: this.contacts,
            history: this.history
        };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `messenger_backup_${this.myNick}.json`;
        a.click();
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const data = JSON.parse(re.target.result);
                    if (confirm("Это заменит все ваши текущие данные. Продолжить?")) {
                        localStorage.setItem('p2p_nick', data.nick);
                        localStorage.setItem('p2p_uid', data.uid);
                        localStorage.setItem('p2p_color', data.color);
                        if (data.pass) localStorage.setItem('p2p_pass', data.pass);
                        localStorage.setItem('p2p_contacts', JSON.stringify(data.contacts));
                        localStorage.setItem('p2p_history', JSON.stringify(data.history));
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
