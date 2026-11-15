import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { seal, unseal } from './deployment_seal.mjs';
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
test('deployment environment survives authenticated encryption without plaintext in transport', () => {
  const { publicKey, privateKey } = pair(), plain = Buffer.from('TOKEN_KEY=synthetic-only-private-value\n');
  const envelope = seal(plain, publicKey);
  assert.deepEqual(unseal(envelope, privateKey), plain);
  assert.ok(!JSON.stringify(envelope).includes('synthetic-only-private-value'));
});
test('tampering and a different destination key reject the environment', () => {
  const { publicKey, privateKey } = pair(), other = pair(), envelope = seal(Buffer.from('fixture'), publicKey);
  const tag = Buffer.from(envelope.tag, 'base64'); tag[0] ^= 1;
  assert.throws(() => unseal({ ...envelope, tag: tag.toString('base64') }, privateKey));
  assert.throws(() => unseal(envelope, other.privateKey));
  assert.throws(() => unseal({ ...envelope, format: 'wrong' }, privateKey));
});
