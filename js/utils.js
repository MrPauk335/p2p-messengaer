// Utility Functions
Object.assign(App.prototype, {
    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.innerText = msg;
        toast.className = "show";
        setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
    },

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    escapeHtml(text) {
        if (!text) return text;
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    normalizeId(id) {
        if (!id) return '';
        const prefix = id.startsWith('u_') ? 'u_' : 'p2p_user_';
        const clean = id.replace('p2p_user_', '').replace('u_', '').toLowerCase().replace(/[^a-z0-9\_]/g, '');
        return prefix + clean;
    },

    // Debug logging for sync
    logSync(msg) {
        console.log('[SyncDebug]', msg);
        const statusEl = document.getElementById('syncTargetStatus');
        if (statusEl) statusEl.innerText = msg;
    },

    // Helper to request full screen (optional)
    toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            document.exitFullscreen();
        }
    }
});
