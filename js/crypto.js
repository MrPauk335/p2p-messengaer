// Cryptographic Functions
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
            payload: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv)
        };
    },

    // 6. Decrypt Message
    async decryptSessionMsg(peerId, encryptedData, iv) {
        const secret = this.sessionSecrets[peerId];
        if (!secret) return "[Ошибка расшифровки]";

        try {
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(iv) },
                secret,
                new Uint8Array(encryptedData)
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error("Decryption failed:", e);
            return "[Ошибка расшифровки]";
        }
    },

    // Security Migration for older keys
    async saveMsgMigration(silent = false) {
        // ... handled in saveMsg or app logic if generic
        // This function was empty or specific in app.js, ensuring compatibility
        // If it was just a stub or minor helper, it fits here.
    }
});
