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
    }
});
