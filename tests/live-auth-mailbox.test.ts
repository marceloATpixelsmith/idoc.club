import assert from 'node:assert/strict';
import test from 'node:test';
import { findOtp, otpCodes } from '../scripts/live-auth-mailbox.mjs';

test('live-auth selects a newly delivered OTP even when the mailbox returns newest messages first', () => {
  const previousMailbox = {
    messages: [
      { subject: 'Your IDOC sign-in code', text: 'Use code 654321 to sign in.' },
    ],
  };
  const updatedMailbox = {
    messages: [
      { subject: 'Your IDOC sign-in code', text: 'Use code 123456 to sign in.' },
      { subject: 'Your IDOC sign-in code', text: 'Use code 654321 to sign in.' },
    ],
  };

  const previousCodes = otpCodes(previousMailbox, 'sign-in code');
  assert.deepEqual(previousCodes, ['654321']);
  assert.equal(findOtp(updatedMailbox, 'sign-in code', previousCodes), '123456');
});
