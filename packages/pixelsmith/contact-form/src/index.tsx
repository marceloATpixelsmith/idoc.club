"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ContactFieldDefinition,
  ContactFormMessages,
  ContactSubmissionResult,
} from "./types";
import {
  contactFieldConditionMatches,
  isContactFieldVisible,
  validateContactFields,
} from "./validation";

export * from "./types";
export * from "./validation";

declare global
{
  interface Window
  {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export interface ContactFormProps
{
  fields: readonly ContactFieldDefinition[];
  action?: string;
  messages?: ContactFormMessages;
  className?: string;
  longFormThreshold?: number;
  turnstilePlacement?: "auto" | "top" | "bottom";
  submitAdornment?: ReactNode;
  successContent?: ReactNode | ((message: string) => ReactNode);
  onSuccess?: (result: ContactSubmissionResult) => void;
}

function TurnstileWidget({
  onToken,
  resetSignal,
}: {
  onToken: (token: string) => void;
  resetSignal: number;
}): React.JSX.Element
{
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey)
      {
        return;
      }

    let cancelled = false;
    const scriptId = "pixelsmith-turnstile-script";

    function renderWidget(): void
    {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current)
        {
          return;
        }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
        theme: "auto",
      });
    }

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing)
      {
        if (window.turnstile)
          {
            renderWidget();
          }
        else
          {
            existing.addEventListener("load", renderWidget, { once: true });
          }
      }
    else
      {
        const script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.addEventListener("load", renderWidget, { once: true });
        document.head.appendChild(script);
      }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile)
        {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile)
      {
        window.turnstile.reset(widgetIdRef.current);
        onToken("");
      }
  }, [resetSignal, onToken]);

  if (!siteKey)
    {
      return <div className="pixelsmith-contact__configuration-error">Turnstile site key is not configured.</div>;
    }

  return <div className="pixelsmith-contact__turnstile" ref={containerRef} />;
}

function FieldControl({
  field,
  value,
  error,
  required,
  onChange,
}: {
  field: ContactFieldDefinition;
  value: string | boolean;
  error?: string;
  required: boolean;
  onChange: (value: string | boolean) => void;
}): React.JSX.Element
{
  const common = {
    id: `contact-${field.name}`,
    name: field.name,
    required,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `contact-${field.name}-error` : field.helpText ? `contact-${field.name}-help` : undefined,
  };

  if (field.type === "textarea")
    {
      return <textarea {...common} className="pixelsmith-contact__control" rows={field.rows ?? 5} placeholder={field.placeholder} value={String(value)} minLength={field.minLength} maxLength={field.maxLength} onChange={(event) => onChange(event.target.value)} />;
    }

  if (field.type === "select")
    {
      return (
        <select {...common} className="pixelsmith-contact__control" value={String(value)} onChange={(event) => onChange(event.target.value)}>
          <option value="">{field.placeholder ?? "Select"}</option>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }

  if (field.type === "radio")
    {
      return (
        <div className="pixelsmith-contact__choice-group" role="radiogroup" aria-required={required || undefined}>
          {field.options?.map((option) => (
            <label key={option.value} className="pixelsmith-contact__choice">
              <input type="radio" name={field.name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );
    }

  if (field.type === "checkbox")
    {
      return (
        <label className="pixelsmith-contact__choice">
          <input {...common} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.helpText ?? field.label}</span>
        </label>
      );
    }

  if (field.type === "hidden")
    {
      return <input type="hidden" name={field.name} value={String(value)} />;
    }

  return <input {...common} className="pixelsmith-contact__control" type={field.type} placeholder={field.placeholder} autoComplete={field.autocomplete} value={String(value)} minLength={field.minLength} maxLength={field.maxLength} min={field.min} max={field.max} pattern={field.pattern} onChange={(event) => onChange(event.target.value)} />;
}

type FieldGroup = {
  key: string;
  label?: string;
  fields: ContactFieldDefinition[];
};

function groupFields(fields: readonly ContactFieldDefinition[]): FieldGroup[]
{
  const groups: FieldGroup[] = [];

  for (const field of fields)
    {
      const key = field.section ?? "__default";
      const current = groups.at(-1);
      if (current?.key === key)
        {
          current.fields.push(field);
          if (!current.label && field.sectionLabel)
            {
              current.label = field.sectionLabel;
            }
          continue;
        }

      groups.push({
        key,
        label: field.sectionLabel,
        fields: [field],
      });
    }

  return groups;
}

function FieldList({
  fields,
  values,
  errors,
  setValues,
}: {
  fields: readonly ContactFieldDefinition[];
  values: Record<string, string | boolean>;
  errors: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string | boolean>>>;
}): React.JSX.Element
{
  return (
    <div className="pixelsmith-contact__fields">
      {fields.map((field) => {
        const required = field.required === true || contactFieldConditionMatches(field.requiredWhen, values);
        return (
          <div key={field.name} className="pixelsmith-contact__field" data-type={field.type} data-name={field.name} data-width={field.width ?? "full"}>
            {field.type !== "hidden" && field.type !== "checkbox" && <label className="pixelsmith-contact__label" htmlFor={`contact-${field.name}`}>{field.label}{required && <span aria-hidden="true"> *</span>}</label>}
            <FieldControl field={field} value={values[field.name] ?? ""} error={errors[field.name]} required={required} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
            {field.helpText && field.type !== "checkbox" && <p id={`contact-${field.name}-help`} className="pixelsmith-contact__help">{field.helpText}</p>}
            {errors[field.name] && <p id={`contact-${field.name}-error`} className="pixelsmith-contact__error" role="alert">{errors[field.name]}</p>}
          </div>
        );
      })}
    </div>
  );
}

function fieldDefault(field: ContactFieldDefinition): string | boolean
{
  return field.type === "checkbox" ? Boolean(field.value) : field.value ?? "";
}

export function ContactForm({
  fields,
  action = "/api/contact",
  messages = {},
  className = "",
  longFormThreshold = 6,
  turnstilePlacement = "auto",
  submitAdornment,
  successContent,
  onSuccess,
}: ContactFormProps): React.JSX.Element
{
  const initialValues = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, fieldDefault(field)])), [fields]);
  const [values, setValues] = useState<Record<string, string | boolean>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [turnstileToken, setTurnstileToken] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [serverMessage, setServerMessage] = useState("");
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    setValues((current) => {
      const next: Record<string, string | boolean> = {};
      for (const field of fields)
        {
          next[field.name] = field.type === "hidden"
            ? fieldDefault(field)
            : current[field.name] ?? fieldDefault(field);
        }
      return next;
    });
  }, [fields]);

  const visibleFields = fields.filter((field) => isContactFieldVisible(field, values));
  const fieldGroups = groupFields(visibleFields);
  const turnstileAtTop = turnstilePlacement === "top" || (turnstilePlacement === "auto" && visibleFields.filter((field) => field.type !== "hidden").length > longFormThreshold);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void>
    {
      event.preventDefault();
      setStatus("idle");
      setServerMessage("");

      const nextErrors = validateContactFields(fields, values, messages);
      if (!turnstileToken)
        {
          nextErrors.__turnstile = messages.turnstileMessage ?? "Complete the security challenge.";
        }

      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0)
        {
          return;
        }

      setStatus("submitting");

      try
        {
          const response = await fetch(action, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: values, turnstileToken, honeypot }),
          });
          const result = await response.json() as ContactSubmissionResult;

          if (!response.ok || !result.ok)
            {
              setErrors(result.fieldErrors ?? {});
              setServerMessage(result.message ?? messages.errorMessage ?? "There was a problem sending your message.");
              setStatus("error");
              setResetSignal((value) => value + 1);
              return;
            }

          setStatus("success");
          setServerMessage(result.message ?? messages.successMessage ?? "Your message has been sent.");
          setValues(initialValues);
          setHoneypot("");
          setResetSignal((value) => value + 1);
          onSuccess?.(result);
        }
      catch
        {
          setStatus("error");
          setServerMessage(messages.errorMessage ?? "There was a problem sending your message.");
          setResetSignal((value) => value + 1);
        }
    }

  if (status === "success" && successContent)
    {
      const message = serverMessage || messages.successMessage || "Your message has been sent.";
      return <>{typeof successContent === "function" ? successContent(message) : successContent}</>;
    }

  const challenge = (
    <div className="pixelsmith-contact__challenge-wrap">
      <TurnstileWidget onToken={setTurnstileToken} resetSignal={resetSignal} />
      {errors.__turnstile && <p className="pixelsmith-contact__error" role="alert">{errors.__turnstile}</p>}
    </div>
  );

  return (
    <form className={`pixelsmith-contact ${className}`.trim()} noValidate onSubmit={handleSubmit}>
      <div className="pixelsmith-contact__honeypot" aria-hidden="true">
        <label>Leave this field empty<input type="text" name="website-confirmation" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} /></label>
      </div>
      {turnstileAtTop && challenge}
      <div className="pixelsmith-contact__sections">
        {fieldGroups.map((group, index) => group.key === "__default" && !group.label
          ? <FieldList key={`${group.key}-${index}`} fields={group.fields} values={values} errors={errors} setValues={setValues} />
          : (
            <fieldset key={`${group.key}-${index}`} className="pixelsmith-contact__section">
              {group.label ? <legend className="pixelsmith-contact__section-title">{group.label}</legend> : null}
              <FieldList fields={group.fields} values={values} errors={errors} setValues={setValues} />
            </fieldset>
          ))}
      </div>
      {!turnstileAtTop && challenge}
      <button className="pixelsmith-contact__submit" type="submit" disabled={status === "submitting"}>
        <span>{status === "submitting" ? messages.submittingLabel ?? "Sending…" : messages.submitLabel ?? "Send"}</span>
        {submitAdornment ? <span className="pixelsmith-contact__submit-adornment" aria-hidden="true">{submitAdornment}</span> : null}
      </button>
      {serverMessage && <p className="pixelsmith-contact__status" data-status={status} role="status">{serverMessage}</p>}
    </form>
  );
}
