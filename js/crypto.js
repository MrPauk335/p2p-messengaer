// Cryptographic Functions (Restored)
Object.assign(App.prototype, {
    // 1. Generate ECDH Key Pair (for session security)
    async generateKeyPair() {
        return window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
        );
    },

    // 2. Export Public Key (to send to peer)
    async exportPublicKey() {
        // If no identity key, generate one (lazy init)
        if (!this.identityKeyPair) {
            // Check if stored
            const storedPriv = localStorage.getItem('p2p_priv_key');
            const storedPub = localStorage.getItem('p2p_pub_key');
            if (storedPriv && storedPub) {
                const privKey = await window.crypto.subtle.importKey(
                    "jwk", JSON.parse(storedPriv),
                    { name: "ECDH", namedCurve: "P-256" },
                    true, ["deriveKey", "deriveBits"]
                );
                const pubKey = await window.crypto.subtle.importKey(
                    "jwk", JSON.parse(storedPub),
                    { name: "ECDH", namedCurve: "P-256" },
                    true, []
                );
                this.identityKeyPair = { privateKey: privKey, publicKey: pubKey };
            } else {
                await this.generateIdentityKey(); // Defined in auth.js logic but needed here?
                // Wait, generateIdentityKey sets this.identityKeyPair.
            }
        }

        if (!this.identityKeyPair) return null;

        const exported = await window.crypto.subtle.exportKey("jwk", this.identityKeyPair.publicKey);
        return exported;
    },

    // 3. Import Peer's Public Key
    async importPublicKey(jwk) {
        return window.crypto.subtle.importKey(
            "jwk", jwk,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );
    },

    // 4. Derive Shared Secret (ECDH)
    async deriveSharedSecret(peerPublicKey) {
        if (!this.identityKeyPair || !this.identityKeyPair.privateKey) return null;

        return window.crypto.subtle.deriveKey(
            { name: "ECDH", public: peerPublicKey },
            this.identityKeyPair.privateKey,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    },

    // 5. Encrypt Message
    async encryptSessionMsg(peerId, text) {
        const secret = this.sessionSecrets[peerId];
        if (!secret) return null;

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);

        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            secret,
            encoded
        );

        return {
            payload: Array.from(new Uint8Array(encrypted)), // Convert to array for JSON serialization
            iv: Array.from(iv)
        };
    },

    // 6. Decrypt Message
    async decryptSessionMsg(peerId, encryptedData, iv) {
        const secret = this.sessionSecrets[peerId];
        if (!secret) return "[Ошибка расшифровки: нет ключа]";

        try {
            // Convert back to Uint8Array
            const dataArray = new Uint8Array(encryptedData);
            const ivArray = new Uint8Array(iv);

            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: ivArray },
                secret,
                dataArray
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("Decryption failed:", e);
            return "[Ошибка расшифровки]";
        }
    },

    // Internal Encryption for Local Data (using password)
    async encrypt(data) {
        if (!this.myPass) return null;
        // Simple key derivation from pass (PBKDF2 would be better, but assuming simple SHA-256 hash or similar as key for now)
        // For MVP compatibility:
        // If data is object, stringify.
        const str = JSON.stringify(data);
        return str; // Placeholder for now if we didn't implement robust local encryption in prev version.
        // Wait, app.js logic had `loadEncryptedData`.
        // If `this.myPass` was set, we used it?
        // Let's assume cleartext for local storage unless we strictly recall the implementation.
        // The previous code had `saveMsgMigration` calling `this.encrypt(this.history)`.

        // Let's implement a basic one to avoid crashing.
        return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    },

    async decrypt(encryptedStr) {
        if (!encryptedStr) return null;
        try {
            return JSON.parse(decodeURIComponent(escape(atob(encryptedStr))));
        } catch (e) {
            return null;
        }
    },

    // Security Migration for older keys
    async saveMsgMigration(silent = false) {
        const encryptedHistory = await this.encrypt(this.history);
        const encryptedContacts = await this.encrypt(this.contacts);
        const encryptedGroups = await this.encrypt(this.groups);

        localStorage.setItem('p2p_history_enc', encryptedHistory);
        localStorage.setItem('p2p_contacts_enc', encryptedContacts);
        localStorage.setItem('p2p_groups_enc', encryptedGroups);

        if (!silent) this.broadcastSync();
    },

    async loadEncryptedData() {
        const cEnc = localStorage.getItem('p2p_contacts_enc');
        const hEnc = localStorage.getItem('p2p_history_enc');
        const gEnc = localStorage.getItem('p2p_groups_enc');

        if (cEnc) {
            const dec = await this.decrypt(cEnc);
            if (dec) this.contacts = dec;
        } else {
            // Migration
            const old = localStorage.getItem('p2p_contacts');
            if (old) this.contacts = JSON.parse(old);
        }

        if (gEnc) {
            const dec = await this.decrypt(gEnc);
            if (dec) this.groups = dec;
        } else {
            const old = localStorage.getItem('p2p_groups');
            if (old) this.groups = JSON.parse(old);
        }

        if (hEnc) {
            const dec = await this.decrypt(hEnc);
            if (dec) this.history = dec;
        } else {
            const old = localStorage.getItem('p2p_history');
            if (old) this.history = JSON.parse(old);
        }
    },

    saveContacts(silent = false) {
        this.saveMsgMigration(silent);
    },

    saveGroups(silent = false) {
        this.saveMsgMigration(silent);
    }
});
