export type ContactFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "hidden";

export interface ContactFieldOption
{
  label: string;
  value: string;
}

export interface ContactFieldCondition
{
  field: string;
  equals: string | boolean;
}

export interface ContactFieldValidationMessages
{
  required?: string;
  minLength?: string;
  maxLength?: string;
  invalid?: string;
  min?: string;
  max?: string;
}

export interface ContactFieldDefinition
{
  name: string;
  label: string;
  type: ContactFieldType;
  required?: boolean;
  requiredWhen?: ContactFieldCondition;
  visibleWhen?: ContactFieldCondition;
  placeholder?: string;
  autocomplete?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: readonly ContactFieldOption[];
  rows?: number;
  value?: string | boolean;
  helpText?: string;
  section?: string;
  sectionLabel?: string;
  width?: "full" | "half";
  validationMessages?: ContactFieldValidationMessages;
}

export interface ContactFormMessages
{
  submitLabel?: string;
  submittingLabel?: string;
  successMessage?: string;
  errorMessage?: string;
  requiredMessage?: string;
  invalidEmailMessage?: string;
  invalidPhoneMessage?: string;
  invalidUrlMessage?: string;
  invalidNumberMessage?: string;
  invalidPatternMessage?: string;
  turnstileMessage?: string;
}

export interface ContactFormPayload
{
  fields: Record<string, string | boolean>;
  turnstileToken: string;
  honeypot?: string;
}

export interface FieldValidationResult
{
  valid: boolean;
  message?: string;
}

export interface ContactSubmissionResult
{
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}
