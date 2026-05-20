const crypto = require('crypto');

// Per-plan monthly commission, in dollars.
const COMMISSION = {
  SCOUT:   1.5,
  ANALYST: 5.2,
  EDGE:    10.0,
};

const PAYOUT_THRESHOLD = 20;

// 8-char uppercase alphanumeric, avoiding ambiguous chars (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

module.exports = { COMMISSION, PAYOUT_THRESHOLD, randomCode };
