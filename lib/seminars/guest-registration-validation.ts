import { z } from 'zod';
import { isValidInternationalPhone } from '@/lib/phone';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function personName(label: string) {
  return z.string()
    .trim()
    .min(1, `Enter your ${label.toLowerCase()}.`)
    .max(100)
    .refine((value) => !CONTROL_CHARACTERS.test(value), `Enter a valid ${label.toLowerCase()}.`)
    .transform((value) => value.normalize('NFC'));
}

export const guestFirstNameSchema = personName('First name');
export const guestLastNameSchema = personName('Last name');
export const guestEmailSchema = z.string().trim().email('Enter a valid email address.').max(255)
  .transform((value) => value.normalize('NFC').toLowerCase());
export const guestPhoneSchema = z.string().trim()
  .refine(isValidInternationalPhone, 'Enter a valid international phone number.');

export const guestContactSchema = z.object({
  email: guestEmailSchema,
  firstName: guestFirstNameSchema,
  lastName: guestLastNameSchema,
  phone: guestPhoneSchema,
});
