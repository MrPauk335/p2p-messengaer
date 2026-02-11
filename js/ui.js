// UI & Rendering Logic
Object.assign(App.prototype, {
    // 1. Refresh Contacts List
    refreshContacts() {
        const list = document.getElementById('contactsList');
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
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('chat-screen').style.display = 'flex';

        // Mobile sidebar toggle
        if (window.innerWidth <= 768) {
            this.toggleSidebar();
        }

        this.updateChatHeader();
        this.renderHistory(id);
        this.refreshContacts(); // update active class
    },

    // 3. Update Chat Header
    updateChatHeader() {
        const headerName = document.getElementById('chatName');
        const headerStatus = document.getElementById('chatStatus');
        const id = this.activeChatId;

        if (this.groups[id]) {
            headerName.innerText = this.groups[id].name;
            headerStatus.innerText = `${this.groups[id].members.length} участников`;
            return;
        }

        const contact = this.contacts[id];
        if (contact) {
            headerName.innerText = contact.name;
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
    },

    updateEncryptionStatus() {
        const status = document.getElementById('encryptionStatus');
        if (status) {
            status.innerHTML = this.myPass ? '🛡️ Данные зашифрованы (AES-GCM)' : '⚠️ Данные не зашифрованы (установите пароль)';
            status.style.color = this.myPass ? 'var(--success)' : 'var(--danger)';
        }
    },

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        const isActive = sidebar.classList.contains('active');

        if (isActive) {
            sidebar.classList.remove('active');
            backdrop.style.display = 'none';
        } else {
            sidebar.classList.add('active');
            backdrop.style.display = 'block';
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
            document.getElementById('welcome-screen').style.display = 'flex';
            document.getElementById('chat-screen').style.display = 'none';
            this.refreshContacts();
        }
    },

    // UI Event Handlers
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

    tryAddFriend() {
        const input = document.getElementById('contactSearch');
        const val = input.value.trim();
        if (!val) return;

        // Remove spaces
        const id = val.replace(/\s/g, '');

        if (id === this.myId) return this.showToast("Это ваш ID");

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
