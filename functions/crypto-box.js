// Encrypts the API keys people save, so the database only ever holds ciphertext.
// AES-256-GCM with a random nonce each time; the secret ENC_KEY (32 random bytes, base64) lives only on the server.
const crypto = require('node:crypto');

function createCryptoBox(secretB64) {
  const key = Buffer.from(String(secretB64 || ''), 'base64');
  if (key.length !== 32) throw new Error('ENC_KEY must be 32 random bytes, base64-encoded.');
  return {
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
    },
    decrypt(b64) {
      const buf = Buffer.from(String(b64), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

module.exports = { createCryptoBox };
