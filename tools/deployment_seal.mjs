// Confidential transfer only: ciphertext may enter SSM history, plaintext may not.
import { createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, randomBytes, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function seal(plaintext, publicKey) {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const wrapped = publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key);
  return { format: 'medipulse-env-v1', key: wrapped.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') };
}

export function unseal(envelope, privateKey) {
  if (envelope.format !== 'medipulse-env-v1') throw Error('Unknown sealed environment format');
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.key, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(envelope.body, 'base64')), cipher.final()]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(JSON.stringify(seal(Buffer.concat(chunks), readFileSync(process.argv[2]))));
}
