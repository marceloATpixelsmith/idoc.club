import 'server-only';

import {
  decryptDeliveryPayloadWithEnvironment,
  encryptDeliveryPayloadWithEnvironment,
} from './encrypted-payload-core';

export function encryptDeliveryPayload(value: unknown) {
  return encryptDeliveryPayloadWithEnvironment(value, process.env);
}

export function decryptDeliveryPayload(value: string, keyVersion: string) {
  return decryptDeliveryPayloadWithEnvironment(value, keyVersion, process.env);
}
