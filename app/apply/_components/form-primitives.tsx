"use client";

import { cn } from "@/lib/utils";

const inputClass =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none placeholder:text-slate-400 focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

export function FormSection({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-vam-ink">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
      </header>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function Label({
  htmlFor,
  required,
  children,
  helpText,
  helpId
}: {
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
  helpText?: string;
  helpId?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-vam-ink">
        {children} {required ? <span className="text-red-600">*</span> : null}
      </label>
      {helpText ? <p id={helpId} className="mt-0.5 text-xs text-slate-500">{helpText}</p> : null}
    </div>
  );
}

export function TextField({
  name,
  label,
  type = "text",
  required,
  placeholder,
  helpText,
  defaultValue
}: {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "url";
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: string;
}) {
  const helpId = helpText ? `${name}-help` : undefined;
  return (
    <div>
      <Label htmlFor={name} required={required} helpText={helpText} helpId={helpId}>
        {label}
      </Label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        aria-describedby={helpId}
        className={inputClass}
      />
    </div>
  );
}

export function NumberField({
  name,
  label,
  required,
  min,
  helpText,
  onChange
}: {
  name: string;
  label: string;
  required?: boolean;
  min?: number;
  helpText?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  const helpId = helpText ? `${name}-help` : undefined;
  return (
    <div>
      <Label htmlFor={name} required={required} helpText={helpText} helpId={helpId}>
        {label}
      </Label>
      <input
        id={name}
        name={name}
        type="number"
        inputMode="decimal"
        min={min}
        step="any"
        required={required}
        aria-describedby={helpId}
        onChange={onChange}
        className={inputClass}
      />
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  required,
  placeholder,
  rows = 4,
  minLength,
  helpText
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  minLength?: number;
  helpText?: string;
}) {
  return (
    <div>
      <Label htmlFor={name} required={required} helpText={helpText}>
        {label}
      </Label>
      <textarea
        id={name}
        name={name}
        required={required}
        rows={rows}
        minLength={minLength}
        placeholder={placeholder}
        className={cn(inputClass, "min-h-[6rem] resize-y")}
      />
    </div>
  );
}

export function SelectField({
  name,
  label,
  required,
  options,
  helpText,
  placeholderOption = "-- Chọn --"
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
  placeholderOption?: string;
}) {
  return (
    <div>
      <Label htmlFor={name} required={required} helpText={helpText}>
        {label}
      </Label>
      <select id={name} name={name} required={required} defaultValue="" className={inputClass}>
        <option value="" disabled={required}>
          {placeholderOption}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckboxGroupField({
  name,
  label,
  required,
  options,
  helpText
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
}) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-vam-ink">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </legend>
      {helpText ? <p className="mt-0.5 text-xs text-slate-500">{helpText}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-vam-line bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              className="mt-0.5 h-4 w-4 rounded border-vam-line text-vam-green focus:ring-vam-mint"
            />
            <span className="text-vam-ink">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RadioGroupField({
  name,
  label,
  required,
  options,
  helpText
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
}) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-vam-ink">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </legend>
      {helpText ? <p className="mt-0.5 text-xs text-slate-500">{helpText}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-vam-line bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              required={required}
              className="mt-0.5 h-4 w-4 border-vam-line text-vam-green focus:ring-vam-mint"
            />
            <span className="text-vam-ink">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ConsentCheckbox({
  name,
  label,
  required,
  defaultChecked
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-vam-line bg-slate-50 px-3 py-3 text-sm">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        required={required}
        className="mt-0.5 h-4 w-4 rounded border-vam-line text-vam-green focus:ring-vam-mint"
      />
      <span className="text-vam-ink">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </span>
    </label>
  );
}

export function FormBanner({
  state
}: {
  state: { ok: boolean; message: string | null };
}) {
  if (!state.message) return null;
  if (state.ok) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        {state.message}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {state.message}
    </div>
  );
}
