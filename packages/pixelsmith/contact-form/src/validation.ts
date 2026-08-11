import type {
  ContactFieldCondition,
  ContactFieldDefinition,
  ContactFormMessages,
  FieldValidationResult,
} from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\-\.\s\d]{7,25}$/;

const DEFAULT_MESSAGES: Required<Pick<
  ContactFormMessages,
  | "requiredMessage"
  | "invalidEmailMessage"
  | "invalidPhoneMessage"
  | "invalidUrlMessage"
  | "invalidNumberMessage"
  | "invalidPatternMessage"
>> = {
  requiredMessage: "This field is required.",
  invalidEmailMessage: "Enter a valid email address.",
  invalidPhoneMessage: "Enter a valid phone number.",
  invalidUrlMessage: "Enter a valid URL.",
  invalidNumberMessage: "Enter a valid number.",
  invalidPatternMessage: "Enter a valid value.",
};

function isEmpty(value: string | boolean | undefined): boolean
{
  return value === undefined || value === "" || value === false;
}

export function contactFieldConditionMatches(
  condition: ContactFieldCondition | undefined,
  values: Record<string, string | boolean>,
): boolean
{
  if (!condition)
    {
      return false;
    }

  const current = values[condition.field];
  if (condition.equals === "" && current === undefined)
    {
      return true;
    }

  return current === condition.equals;
}

export function isContactFieldVisible(
  field: ContactFieldDefinition,
  values: Record<string, string | boolean>,
): boolean
{
  return !field.visibleWhen || contactFieldConditionMatches(field.visibleWhen, values);
}

export function validateContactField(
  field: ContactFieldDefinition,
  value: string | boolean | undefined,
  messages: ContactFormMessages = {},
  values: Record<string, string | boolean> = {},
): FieldValidationResult
{
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const fieldCopy = field.validationMessages ?? {};
  const required = field.required === true || contactFieldConditionMatches(field.requiredWhen, values);

  if (required && isEmpty(value))
    {
      return { valid: false, message: fieldCopy.required ?? copy.requiredMessage };
    }

  if (isEmpty(value))
    {
      return { valid: true };
    }

  if (field.type === "checkbox")
    {
      return { valid: true };
    }

  const stringValue = String(value).trim();

  if (field.minLength !== undefined && stringValue.length < field.minLength)
    {
      return { valid: false, message: fieldCopy.minLength ?? `Enter at least ${field.minLength} characters.` };
    }

  if (field.maxLength !== undefined && stringValue.length > field.maxLength)
    {
      return { valid: false, message: fieldCopy.maxLength ?? `Enter no more than ${field.maxLength} characters.` };
    }

  if (field.type === "email" && !EMAIL_PATTERN.test(stringValue))
    {
      return { valid: false, message: fieldCopy.invalid ?? copy.invalidEmailMessage };
    }

  if (field.type === "tel" && !PHONE_PATTERN.test(stringValue))
    {
      return { valid: false, message: fieldCopy.invalid ?? copy.invalidPhoneMessage };
    }

  if (field.type === "url")
    {
      try
        {
          const url = new URL(stringValue);
          if (url.protocol !== "http:" && url.protocol !== "https:")
            {
              return { valid: false, message: fieldCopy.invalid ?? copy.invalidUrlMessage };
            }
        }
      catch
        {
          return { valid: false, message: fieldCopy.invalid ?? copy.invalidUrlMessage };
        }
    }

  if (field.type === "number")
    {
      const numericValue = Number(stringValue);
      if (!Number.isFinite(numericValue))
        {
          return { valid: false, message: fieldCopy.invalid ?? copy.invalidNumberMessage };
        }
      if (field.min !== undefined && numericValue < field.min)
        {
          return { valid: false, message: fieldCopy.min ?? `Enter a value of at least ${field.min}.` };
        }
      if (field.max !== undefined && numericValue > field.max)
        {
          return { valid: false, message: fieldCopy.max ?? `Enter a value no greater than ${field.max}.` };
        }
    }

  if (field.pattern)
    {
      let expression: RegExp;
      try
        {
          expression = new RegExp(field.pattern);
        }
      catch
        {
          throw new Error(`Invalid validation pattern configured for field ${field.name}.`);
        }

      if (!expression.test(stringValue))
        {
          return { valid: false, message: fieldCopy.invalid ?? copy.invalidPatternMessage };
        }
    }

  if ((field.type === "select" || field.type === "radio") && field.options?.length)
    {
      const allowedValues = new Set(field.options.map((option) => option.value));
      if (!allowedValues.has(stringValue))
        {
          return { valid: false, message: fieldCopy.invalid ?? copy.invalidPatternMessage };
        }
    }

  return { valid: true };
}

export function validateContactFields(
  fields: readonly ContactFieldDefinition[],
  values: Record<string, string | boolean>,
  messages: ContactFormMessages = {},
): Record<string, string>
{
  const errors: Record<string, string> = {};

  for (const field of fields)
    {
      if (field.type === "hidden" || !isContactFieldVisible(field, values))
        {
          continue;
        }

      const result = validateContactField(field, values[field.name], messages, values);
      if (!result.valid && result.message)
        {
          errors[field.name] = result.message;
        }
    }

  return errors;
}
