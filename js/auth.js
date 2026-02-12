// Authentication & Profile Logic (Restored)
Object.assign(App.prototype, {
    setSetupMode(mode) {
        document.getElementById('modeReg').classList.toggle('active', mode === 'reg');
        document.getElementById('modeLogin').classList.toggle('active', mode === 'login');

        if (mode === 'reg') {
            document.getElementById('setupTitle').innerText = "Создать профиль";
            document.getElementById('setupDesc').innerText = "Выберите имя, цвет и пароль";
            document.getElementById('setupColors').style.display = 'flex';
            document.getElementById('setupName').placeholder = "Никнейм";
            document.getElementById('setupPass').placeholder = "Пароль";
            document.getElementById('login-2fa-choice').style.display = 'none';
            document.getElementById('setupSecretInput').style.display = 'none';
        } else {
            document.getElementById('setupTitle').innerText = "Вход";
            document.getElementById('setupDesc').innerText = "Введите данные для входа";
            document.getElementById('setupColors').style.display = 'none';
            document.getElementById('setupName').placeholder = "Ваш Никнейм";
            document.getElementById('setupPass').placeholder = "Ваш Пароль";

            // Show 2FA choice if configured (logic simplified for restore)
            document.getElementById('login-2fa-choice').style.display = 'block';
        }
    },

    async register() {
        const name = document.getElementById('setupName').value.trim();
        const pass = document.getElementById('setupPass').value;

        if (!name || !pass) return this.showToast("Заполните все поля ⚠️");

        // Basic unique ID generation
        const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const uid = 'p2p_user_' + cleanName + '_' + Math.random().toString(36).substr(2, 4);

        // Color selection
        const activeColor = document.querySelector('.color-dot.active');
        const color = activeColor ? activeColor.getAttribute('data-color') : '#0084ff';

        // Save locally
        localStorage.setItem('p2p_nick', name);
        localStorage.setItem('p2p_uid', uid);
        localStorage.setItem('p2p_color', color);
        localStorage.setItem('p2p_pass', pass);

        // Generate Identity Key for E2EE
        await this.generateIdentityKey();

        this.showToast("Профиль создан! 🚀");
        setTimeout(() => location.reload(), 500);
    },

    async login() {
        const name = document.getElementById('setupName').value.trim();
        const pass = document.getElementById('setupPass').value;

        const storedPass = localStorage.getItem('p2p_pass');
        const storedNick = localStorage.getItem('p2p_nick');

        if (storedPass && storedNick === name) {
            if (storedPass === pass) {
                location.reload();
            } else {
                this.showToast("Неверный пароль ❌");
            }
        } else {
            this.showToast("Профиль не найден на этом устройстве. Используйте Импорт/Синхронизацию.");
        }
    },

    finishSetup() {
        const isReg = document.getElementById('modeReg').classList.contains('active');
        if (isReg) {
            this.register();
        } else {
            this.login();
        }
    },

    checkHash() {
        const hash = window.location.hash.replace('#', '');
        if (!hash) return;

        const isLegacy = hash.startsWith('u_');
        const isNew = hash.startsWith('p2p_user_');

        if ((isLegacy || isNew) && hash !== this.myId) {
            if (!this.contacts[hash]) {
                if (this.addContact) {
                    this.addContact(hash, 'Загрузка...', '#555');
                }
            }
            if (this.selectChat) {
                this.selectChat(hash);
            }
            history.replaceState(null, null, ' ');
        }
    },

    updateMyProfileUI() {
        if (!this.myNick) {
            const nickEl = document.getElementById('myNickDisplay');
            if (nickEl) nickEl.innerText = "Загрузка...";
            return;
        }

        const nickEl = document.getElementById('myNickDisplay');
        if (nickEl) nickEl.innerText = this.myNick;

        const myIdEl = document.getElementById('myIdDisplay');
        if (myIdEl) {
            const isOnline = (this.peer && !this.peer.disconnected);
            const dot = isOnline
                ? '<span class="id-status-dot"></span>'
                : '<span class="id-status-dot" style="background:#555; box-shadow:none;"></span>';

            // Show ACTUAL Peer ID (full) for sharing
            const actualId = (this.peer && this.peer.id) ? this.peer.id : this.myId;
            myIdEl.innerHTML = `ID: ${actualId} ${dot}`;
        }

        // FIXED: Use correct ID myAvatarDisplay
        const avatarEl = document.getElementById('myAvatarDisplay');
        if (avatarEl) {
            avatarEl.innerText = this.myNick[0].toUpperCase();
            avatarEl.style.background = this.myColor;
        }

        // Update lock settings avatar too if exists
        const lockAvatar = document.getElementById('lockAvatar');
        if (lockAvatar) {
            lockAvatar.innerText = this.myNick[0].toUpperCase();
            lockAvatar.style.background = this.myColor;
            document.getElementById('lockNick').innerText = "С возвращением, " + this.myNick;
        }

        // --- Update Telegram UI ---
        const tgToken = localStorage.getItem('p2p_tg_token');
        const tgChatId = localStorage.getItem('p2p_tg_chatid');
        const botInput = document.getElementById('tgBotToken');
        const chatInput = document.getElementById('tgChatId');

        if (botInput && tgToken) botInput.value = tgToken;
        if (chatInput && tgChatId) chatInput.value = tgChatId;

        const tgLabel = document.getElementById('tgStatusLabel');
        if (tgLabel) {
            if (tgToken && tgChatId) {
                tgLabel.innerText = "Бот настроен ✅";
                tgLabel.style.color = "var(--success)";
            } else {
                tgLabel.innerText = "Бот не настроен";
                tgLabel.style.color = "var(--text-dim)";
            }
        }

        const tgEnabledSwitch = document.getElementById('settingTgEnabled');
        if (tgEnabledSwitch) {
            tgEnabledSwitch.checked = this.notificationsEnabled;
            const settingsDiv = document.getElementById('tgSettings');
            if (settingsDiv) settingsDiv.style.display = this.notificationsEnabled ? 'block' : 'none';
        }
    },

    // Auth Helpers
    unlock() {
        const pass = document.getElementById('lockPass').value;
        if (pass === this.myPass) {
            document.getElementById('lock-overlay').style.display = 'none';
            localStorage.removeItem('p2p_is_locked');
            if (!this.peer) {
                this.start();
                this.checkIP();
            }
        } else {
            document.getElementById('lockError').innerText = "Неверный пароль";
        }
    },

    clearData() {
        if (confirm("Вы уверены? Весь чат и контакты будут удалены безвозвратно!")) {
            localStorage.clear();
            location.reload();
        }
    },

    copyMyId() {
        const fullId = (this.peer && this.peer.id) ? this.peer.id : this.myId;
        if (fullId) {
            navigator.clipboard.writeText(fullId);
            this.showToast("ID скопирован! 📋");
        }
    },

    updateProfile() {
        const nick = document.getElementById('editName').value;
        const pass = document.getElementById('editPass').value;
        if (nick) {
            this.myNick = nick; // Use 'this' as it is bound to app instance
            localStorage.setItem('p2p_nick', nick);
        }
        if (pass) {
            this.myPass = pass;
            localStorage.setItem('p2p_pass', pass);
        }
        this.updateMyProfileUI();
        this.showToast("Профиль обновлен");
        document.getElementById('settings-overlay').style.display = 'none';
    },

    logout(force = false) {
        if (force || confirm("Выйти из профиля? (Приложение будет заблокировано)")) {
            localStorage.setItem('p2p_is_locked', 'true');
            location.reload();
        }
    },

    async checkIP() {
        if (!this.ipCheckEnabled) return;

        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            const currentIp = data.ip;
            const lastIp = localStorage.getItem('p2p_last_ip');

            if (lastIp && lastIp !== currentIp) {
                // IP Changed!
                this.showToast(`⚠️ IP изменился: ${lastIp} -> ${currentIp}`);
                // Lock the app for security
                localStorage.setItem('p2p_is_locked', 'true');
                localStorage.setItem('p2p_last_ip', currentIp); // Update known IP
                setTimeout(() => location.reload(), 2000);
            } else {
                localStorage.setItem('p2p_last_ip', currentIp);
            }
        } catch (e) {
            console.warn("IP Check failed:", e);
        }
    },

    // Generate Identity Key Helper
    async generateIdentityKey() {
        const keyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
        );
        this.identityKeyPair = keyPair;

        const exportedPriv = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
        const exportedPub = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

        localStorage.setItem('p2p_priv_key', JSON.stringify(exportedPriv));
        localStorage.setItem('p2p_pub_key', JSON.stringify(exportedPub));
    },

    // Security & Settings
    toggleIncognito(checked) {
        this.incognitoMode = checked;
        localStorage.setItem('p2p_incognito', checked);
        this.showToast(checked ? "🕵️ Режим Инкогнито ВКЛ" : "🕵️ Режим Инкогнито ВЫКЛ");
    },

    setBurnTimer(seconds) {
        this.burnTimer = parseInt(seconds);
        localStorage.setItem('p2p_burn_timer', seconds);
        if (seconds > 0) {
            this.showToast(`🔥 Сообщения исчезнут через ${seconds} сек`);
        } else {
            this.showToast("🔥 Таймер удаления отключен");
        }
    },

    toggleTg(checked) {
        if (checked) {
            if (Notification.permission === 'granted') {
                this.notificationsEnabled = true;
                this.showToast("🔔 Уведомления включены");
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        this.notificationsEnabled = true;
                        this.showToast("🔔 Уведомления включены");
                    } else {
                        this.notificationsEnabled = false;
                        document.getElementById('settingTgEnabled').checked = false;
                        this.showToast("❌ Доступ к уведомлениям запрещен");
                    }
                    localStorage.setItem('p2p_notifications', this.notificationsEnabled);
                });
                return; // Check logic async
            } else {
                this.notificationsEnabled = false;
                document.getElementById('settingTgEnabled').checked = false;
                this.showToast("❌ Уведомления заблокированы в браузере");
            }
        } else {
            this.notificationsEnabled = false;
            this.showToast("🔕 Уведомления выключены");
        }
        localStorage.setItem('p2p_notifications', this.notificationsEnabled);
    },

    toggleIpCheck(checked) {
        localStorage.setItem('p2p_ip_check', checked);
        this.showToast(checked ? "🛡️ Проверка IP включена" : "⚠️ Проверка IP отключена");
    },

    // --- Telegram Bot Integration (Direct API) ---
    saveTgSettings() {
        const token = document.getElementById('tgBotToken').value.trim();
        const chatId = document.getElementById('tgChatId').value.trim();
        if (token) localStorage.setItem('p2p_tg_token', token);
        if (chatId) localStorage.setItem('p2p_tg_chatid', chatId);
        this.showToast("Настройки Telegram сохранены");
        if (this.tgEnabled) this.initTgBot();
    },

    async testTgConnection() {
        const token = document.getElementById('tgBotToken').value.trim() || localStorage.getItem('p2p_tg_token');
        const chatId = document.getElementById('tgChatId').value.trim() || localStorage.getItem('p2p_tg_chatid');

        if (!token || !chatId) return this.showToast("Сначала укажите Token и Chat ID ⚠️");

        const label = document.getElementById('tgStatusLabel');
        label.innerText = "Проверка...";
        label.style.color = "var(--text-dim)";

        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `✅ Связь с P2P Messenger установлена!\n👤 Ник: ${this.myNick}\n🌐 IP: Checking...`
                })
            });
            const data = await res.json();
            if (data.ok) {
                this.showToast("Бот подключен! Проверьте Telegram 📨");
                label.innerText = "Подключено ✅";
                label.style.color = "var(--success)";
            } else {
                throw new Error(data.description);
            }
        } catch (e) {
            console.error(e);
            this.showToast("Ошибка подключения ❌");
            label.innerText = "Ошибка: " + e.message;
            label.style.color = "var(--danger)";
        }
    },

    async sendTgMessage(text) {
        const token = localStorage.getItem('p2p_tg_token') || "8508148034:AAFJRU766RAY1Rt6-XfYB6_PbEpZ7WwgND4";
        const chatId = localStorage.getItem('p2p_tg_chatid');
        if (!this.tgEnabled || !token || !chatId) return;

        try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
            });
        } catch (e) {
            console.warn("Failed to send TG message:", e);
        }
    },

    async pollTgUpdates() {
        if (!this.tgEnabled) return;
        const token = localStorage.getItem('p2p_tg_token') || "8508148034:AAFJRU766RAY1Rt6-XfYB6_PbEpZ7WwgND4";
        const chatId = localStorage.getItem('p2p_tg_chatid');
        if (!token || !chatId) return;

        const lastOffset = localStorage.getItem('p2p_tg_offset') || 0;

        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastOffset}&timeout=30`);
            const data = await res.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    const msg = update.message;
                    if (msg && msg.chat.id.toString() === chatId.toString() && msg.text) {
                        this.handleTgCommand(msg.text);
                    }
                    localStorage.setItem('p2p_tg_offset', update.update_id + 1);
                }
            }
        } catch (e) {
            console.warn("TG Polling error:", e);
        }

        // Loop polling
        setTimeout(() => this.pollTgUpdates(), 3000);
    },

    handleTgCommand(cmd) {
        const command = cmd.toLowerCase().trim();
        if (command === '/status') {
            const status = `📊 <b>Статус сессии:</b>\n👤 Ник: ${this.myNick}\n🌐 Сеть: ${this.peer && !this.peer.disconnected ? 'Active' : 'Offline'}\n🆔 ID: <code>${this.myId}</code>`;
            this.sendTgMessage(status);
        } else if (command === '/logout' || command === '/kick') {
            this.sendTgMessage(`🚫 Сессия для <b>${this.myNick}</b> завершена удаленно.`);
            this.logout(true);
        } else if (command === '/login' || command === '/2fa') {
            const code = Math.floor(100000 + Math.random() * 900000);
            this.sendTgMessage(`🔐 Код подтверждения: <b>${code}</b>\n🛡️ Ваш Секрет: <code>${this.mySecret}</code>`);
        } else if (command === '/help' || command === '❓ помощь') {
            this.sendTgMessage(`🤖 <b>Доступные команды:</b>\n/status - проверить состояние\n/logout - завершить сессию\n/login - получить код и секрет\n/kick - то же самое что logout`);
        }
    },

    initTgBot() {
        const token = localStorage.getItem('p2p_tg_token') || "8508148034:AAFJRU766RAY1Rt6-XfYB6_PbEpZ7WwgND4";
        const chatId = localStorage.getItem('p2p_tg_chatid');
        const enabled = localStorage.getItem('p2p_notifications') === 'true';

        this.tgEnabled = enabled;
        if (enabled && token && chatId) {
            this.pollTgUpdates();
            this.sendTgMessage(`🚀 <b>Бот запущен</b>\nПриложение открыто на устройстве.`);
        }
    },

    // Legacy/Sync methods updated for Direct API
    startTgPairing() {
        alert("Используйте ручную настройку: вставьте Token от @BotFather и ваш Chat ID в настройках.");
    },
    unlinkTg() {
        localStorage.removeItem('p2p_tg_token');
        localStorage.removeItem('p2p_tg_chatid');
        localStorage.setItem('p2p_notifications', 'false');
        location.reload();
    },

    promptInstall() {
        // Simple prompt logic usually involves capturing the install event
        this.showToast("Функция установки недоступна");
    },
    exportData() {
        // Full export for domain migration
        const data = {
            nick: this.myNick,
            uid: this.myId,
            color: this.myColor,
            pass: this.myPass,
            secret: this.mySecret,
            contacts: this.contacts,
            groups: this.groups,
            history: this.history,
            myDevices: this.myDevices,
            deviceSuffix: this.deviceSuffix,
            connSettings: this.connSettings,
            privKey: localStorage.getItem('p2p_priv_key'),
            pubKey: localStorage.getItem('p2p_pub_key'),
            incognito: localStorage.getItem('p2p_incognito'),
            burnTimer: localStorage.getItem('p2p_burn_timer'),
            notifications: localStorage.getItem('p2p_notifications'),
            ipCheck: localStorage.getItem('p2p_ip_check'),
            deviceSuffix: localStorage.getItem('p2p_device_suffix')
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `messenger_backup_${this.myNick}_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        this.showToast("Бэкап создан! 💾");
    },

    handleImportFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.uid || !data.nick) {
                    throw new Error("Неверный формат файла");
                }
                if (confirm(`Импортировать профиль "${data.nick}"? Текущие данные на этом устройстве будут заменены.`)) {
                    this.applyImportedProfile(data);
                }
            } catch (err) {
                console.error(err);
                this.showToast("Ошибка при чтении файла ❌");
            }
        };
        reader.readAsText(file);
    }
});
