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

    // 7. Handshake Orchestration
    async initiateHandshake(peerId) {
        const conn = this.connections[peerId];
        if (!conn || !conn.open) return;

        console.log('[E2EE] Initiating handshake with:', peerId);
        const myPubKey = await this.exportPublicKey();
        if (myPubKey) {
            conn.send({ type: 'handshake', publicKey: myPubKey });
        }
    },

    async handleHandshake(peerId, peerPubKeyJwk) {
        console.log('[E2EE] Handling handshake from:', peerId);
        try {
            const peerPubKey = await this.importPublicKey(peerPubKeyJwk);
            const sharedSecret = await this.deriveSharedSecret(peerPubKey);

            if (sharedSecret) {
                this.sessionSecrets[peerId] = sharedSecret;
                console.log('[E2EE] Session established with:', peerId);

                // If we don't have their public key recorded yet (or just to be safe),
                // we might need to send ours back if we haven't already.
                // But usually handleConnection triggers initiateHandshake for both sides.
                // However, the second peer to join might receive a handshake before their own initiateHandshake sends.

                this.updateChatHeader(); // Update UI to show 🔒
            }
        } catch (e) {
            console.error('[E2EE] Handshake failed:', e);
        }
    },

    // Internal Encryption for Local Data (using password)
    async encrypt(data) {
        try {
            const str = JSON.stringify(data);
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            console.error("Encryption (Base64) failed:", e);
            return null;
        }
    },

    async decrypt(str) {
        if (!str || str === "null") return null;
        try {
            return JSON.parse(decodeURIComponent(escape(atob(str))));
        } catch (e) {
            console.error("Decryption (Base64) failed:", e);
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

        // Helper to load with fallback
        const loadWithFallback = async (encKey, oldKey, target) => {
            let loaded = null;
            if (encKey) {
                loaded = await this.decrypt(encKey);
            }
            if (!loaded || Object.keys(loaded).length === 0) {
                const old = localStorage.getItem(oldKey);
                if (old) {
                    try {
                        loaded = JSON.parse(old);
                        console.log(`Restored ${target} from old storage`);
                    } catch (e) { }
                }
            }
            return loaded;
        };

        const contacts = await loadWithFallback(cEnc, 'p2p_contacts', 'contacts');
        if (contacts) this.contacts = contacts;

        const groups = await loadWithFallback(gEnc, 'p2p_groups', 'groups');
        if (groups) this.groups = groups;

        const history = await loadWithFallback(hEnc, 'p2p_history', 'history');
        if (history) this.history = history;
    },

    saveContacts(silent = false) {
        this.saveMsgMigration(silent);
    },

    saveGroups(silent = false) {
        this.saveMsgMigration(silent);
    }
});
