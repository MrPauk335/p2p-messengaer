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

    // Stubs for Telegram/Other unimplemented features to prevent crash
    // Stubs for Telegram/Other unimplemented features
    startTgPairing() {
        alert("ОШИБКА: Для работы Telegram-бота и 2FA требуется выделенный бэкенд-сервер.\n\nВ текущей P2P версии (без сервера) эта функция недоступна для защиты вашей приватности.");
    },
    verifyTg2fa() { },
    show2faStep() { },
    verifySecret() { },
    unlinkTg() { },
    requestTg2fa() { },

    promptInstall() {
        // Simple prompt logic usually involves capturing the install event
        this.showToast("Функция установки недоступна");
    },
    exportData() {
        // Simple export
        const data = {
            nick: this.myNick,
            contacts: this.contacts,
            groups: this.groups,
            history: this.history
        };
        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "messenger_backup.json";
        a.click();
    }
});
