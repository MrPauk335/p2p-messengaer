// UI & Rendering Logic
Object.assign(App.prototype, {
    // 1. Refresh Contacts List
    refreshContacts() {
        const list = document.getElementById('contactList');
        if (!list) return;
        list.innerHTML = '';

        // Add Groups first
        Object.values(this.groups).forEach(group => {
            const div = document.createElement('div');
            div.className = `contact-item ${this.activeChatId === group.id ? 'active' : ''}`;
            div.onclick = () => this.selectChat(group.id);
            div.innerHTML = `
                <div class="avatar" style="background:#555">👥</div>
                <div class="contact-info">
                    <div class="name">${this.escapeHtml(group.name)} <span style="font-size:10px; opacity:0.6;">(Группа)</span></div>
                    <div class="last-msg">${this.escapeHtml(group.last || 'Нет сообщений')}</div>
                </div>
            `;
            list.appendChild(div);
        });

        // Add Contacts
        Object.keys(this.contacts).forEach(id => {
            const contact = this.contacts[id];
            const isOnline = this.connections[id] && this.connections[id].open;

            const div = document.createElement('div');
            div.className = `contact-item ${this.activeChatId === id ? 'active' : ''}`;
            div.onclick = () => this.selectChat(id);
            div.innerHTML = `
                <div class="avatar" style="background:${contact.color}">${contact.name[0].toUpperCase()}</div>
                <div class="contact-info">
                    <div class="name">
                        ${this.escapeHtml(contact.name)} 
                        ${isOnline ? '<span style="color:var(--accent); font-size:10px;">●</span>' : ''}
                    </div>
                    <div class="last-msg">${this.escapeHtml(contact.last || 'Нажмите, чтобы открыть чат')}</div>
                </div>
            `;
            list.appendChild(div);
        });
    },

    // 2. Select Chat
    selectChat(id) {
        this.activeChatId = id;

        // Desktop: toggle empty state / chat
        const empty = document.getElementById('emptyChat');
        const chat = document.getElementById('chatArea');
        if (empty) empty.style.display = 'none';
        if (chat) chat.style.display = 'flex';

        // Mobile: Hide sidebar, show chat
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').style.display = 'none';
            if (chat) chat.style.display = 'flex'; // Ensure flex
            // Also enable back button in header (it's already there)
        }

        this.updateChatHeader();
        this.renderHistory(id);
        this.refreshContacts();

        // Enable and Focus input
        const input = document.getElementById('msgInput');
        const sendBtn = document.getElementById('sendBtn');
        if (input) {
            input.disabled = false;
            input.focus();
        }
        if (sendBtn) {
            sendBtn.disabled = false;
        }
    },

    // Mobile Back Button / Sidebar Toggle
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const chatArea = document.getElementById('chatArea');
        const backdrop = document.getElementById('sidebar-backdrop');

        if (window.innerWidth <= 768) {
            // Mobile: If chat is open, "Back" hides chat and shows sidebar
            if (chatArea && chatArea.style.display !== 'none') {
                chatArea.style.display = 'none';
                sidebar.style.display = 'flex';
                this.activeChatId = null;
                return;
            }
        }

        // General: Toggle active class
        if (sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
            if (backdrop) backdrop.style.display = 'none';
        } else {
            sidebar.classList.add('active');
            if (backdrop) backdrop.style.display = 'block';
        }
    },

    // 3. Update Chat Header
    updateChatHeader() {
        const headerName = document.getElementById('chatName');
        const headerStatus = document.getElementById('chatStatus');
        const headerAvatar = document.getElementById('chatAvatar');
        const id = this.activeChatId;

        if (this.groups[id]) {
            headerName.innerText = this.groups[id].name;
            headerStatus.innerText = `${this.groups[id].members.length} участников`;
            return;
        }

        const contact = this.contacts[id];
        if (contact) {
            headerName.innerText = contact.name || id;
            if (headerAvatar) {
                headerAvatar.innerText = (contact.name || id)[0].toUpperCase();
                headerAvatar.style.background = contact.color || 'var(--accent)';
            }
            const isOnline = this.connections[id] && this.connections[id].open;

            if (isOnline) {
                if (this.sessionSecrets[id]) {
                    headerStatus.innerHTML = '<span style="color:var(--success)">🔒 E2EE · Онлайн</span>';
                } else {
                    headerStatus.innerText = 'Онлайн (Обмен ключами...)';
                }
            } else {
                headerStatus.innerText = 'Оффлайн';
            }
        } else {
            headerName.innerText = id; // Fallback
            headerStatus.innerText = "Неизвестный";
        }
    },

    // 4. Render History
    renderHistory(chatId) {
        const container = document.getElementById('messages');
        container.innerHTML = '';

        const messages = this.history[chatId] || [];

        messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = `message ${msg.side}`;

            // For groups, show sender name
            let senderName = '';
            if (this.groups[chatId] && msg.side === 'them' && msg.senderId) {
                const sender = this.contacts[msg.senderId];
                senderName = `<div style="font-size:10px; opacity:0.7; margin-bottom:2px;">${sender ? sender.name : 'Участник'}</div>`;
            }

            div.innerHTML = `
                ${senderName}
                <div class="text">${this.escapeHtml(msg.text)}</div>
                <div class="time">${this.formatDate(msg.timestamp)}</div>
            `;
            container.appendChild(div);
        });

        container.scrollTop = container.scrollHeight;
    },

    // 5. Open Settings (UI)
    openSettings() {
        const overlay = document.getElementById('settings-overlay');
        const modal = overlay.querySelector('.modal');
        overlay.style.display = 'flex';
        if (modal) modal.scrollTop = 0;
        this.updateEncryptionStatus();

        // Sync UI with State
        const nameInput = document.getElementById('editName');
        if (nameInput) nameInput.value = this.myNick || '';

        const incognitoCheck = document.getElementById('settingIncognito');
        if (incognitoCheck) incognitoCheck.checked = this.incognitoMode;

        const burnSelect = document.getElementById('settingBurn');
        if (burnSelect) burnSelect.value = this.burnTimer;

        const notifCheck = document.getElementById('settingTgEnabled');
        if (notifCheck) notifCheck.checked = this.notificationsEnabled;

        const ipCheck = document.getElementById('settingIpCheck');
        if (ipCheck) ipCheck.checked = this.ipCheckEnabled;
    },

    updateEncryptionStatus() {
        const status = document.getElementById('encryptionStatus');
        if (status) {
            status.innerHTML = this.myPass ? '🛡️ Данные зашифрованы (AES-GCM)' : '⚠️ Данные не зашифрованы (установите пароль)';
            status.style.color = this.myPass ? 'var(--success)' : 'var(--danger)';
        }
    },



    // --- Contact & Group Management ---

    addContact(id, name, color) {
        if (!id) return;
        if (id === this.myId) return this.showToast("Это ваш ID 🤷‍♂️");
        if (this.contacts[id]) return this.selectChat(id);

        this.contacts[id] = {
            id: id,
            name: name || id,
            color: color || this.getRandomColor(),
            added: Date.now(),
            last: ''
        };
        this.saveContacts();
        this.refreshContacts();
        this.showToast("Контакт добавлен! 👤");

        // Try to connect
        if (!this.connections[id]) {
            const conn = this.peer.connect(id, { serialization: 'json' });
            this.handleConnection(conn);
        }
    },

    // Create Group Logic
    createGroup() {
        const name = document.getElementById('groupNameInput').value.trim();
        if (!name) return this.showToast("Введите название группы");

        const gid = 'group_' + Math.random().toString(36).substr(2, 9);
        const color = this.getRandomColor();

        this.groups[gid] = {
            id: gid,
            name: name,
            members: [this.myId], // Start with self
            isActive: true,
            currKey: null, // For E2EE (todo)
            color: color,
            creator: this.myId,
            created: Date.now(),
            last: 'Группа создана'
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

    leaveGroup(gid) {
        if (confirm("Выйти из группы?")) {
            delete this.groups[gid];
            this.saveGroups();
            this.activeChatId = null;
            document.getElementById('emptyChat').style.display = 'flex';
            document.getElementById('chatArea').style.display = 'none';
            this.refreshContacts();
        }
    },

    // UI Event Handlers
    shareInvite() {
        const fullId = (this.peer && this.peer.id) ? this.peer.id : this.myId;
        const url = `${window.location.origin}${window.location.pathname}#${fullId}`;
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

    tryAddFriend() {
        const input = document.getElementById('contactSearch');
        const val = input.value.trim();
        if (!val) return;

        // Remove spaces
        const id = val.replace(/\s/g, '');

        if (id === this.myId) return this.showToast("Это ваш ID");

        // Proactive Hint: If ID is short, warn user
        if (!id.includes('_dev_')) {
            this.showToast("⚠️ Похоже, ID неполный. Друг должен скопировать ВЕСЬ ID из сайдбара!");
        }

        if (this.contacts[id]) {
            this.selectChat(id);
            input.value = '';
        } else {
            this.addContact(id);
            input.value = '';
        }
    },

    toggleMembersList() {
        const sidebar = document.getElementById('membersSidebar');
        if (!sidebar) return;

        if (sidebar.style.display === 'none') {
            sidebar.style.display = 'block';
            this.renderMembersList();
        } else {
            sidebar.style.display = 'none';
        }
    },

    renderMembersList() {
        const list = document.getElementById('membersList');
        const gid = this.activeChatId;
        if (!list || !this.groups[gid]) return;

        list.innerHTML = '';
        this.groups[gid].members.forEach(mid => {
            const div = document.createElement('div');
            div.className = 'member-item';
            div.style.padding = '5px';
            div.style.borderBottom = '1px solid var(--border)';

            const contact = this.contacts[mid];
            const name = contact ? contact.name : mid;
            const isMe = mid === this.myId;

            div.innerHTML = `
                <div style="font-size:12px;">${isMe ? 'Вы' : this.escapeHtml(name)}</div>
                <div style="font-size:10px; color:var(--text-dim);">${mid}</div>
            `;
            list.appendChild(div);
        });
    },

    showSafetyInfo() {
        document.getElementById('safety-overlay').style.display = 'flex';
        // Calculate fingerprint if possible
        // Placeholder
        document.getElementById('safetyFingerprintDisplay').innerText = "ECDH-P256-AES-GCM";
    }
});
