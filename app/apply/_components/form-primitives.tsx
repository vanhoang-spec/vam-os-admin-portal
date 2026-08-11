"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ApplySubmitButton } from "./submit-button";
import type { ApplyActionState } from "@/lib/apply-types";

const inputClass =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none placeholder:text-slate-400 focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

const requiredBadge = (
  <span className="ml-1 inline-flex rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
    Bắt buộc
  </span>
);

const InlineRequiredError = ({ message }: { message?: string }) => (
  <span className="mt-1 hidden text-sm font-medium text-red-700 group-data-[invalid=true]:block" role="alert">
    {message || "Vui lòng hoàn thành mục bắt buộc này."}
  </span>
);

type MissingField = { name: string; label: string };

function fieldDetails(control: HTMLElement): MissingField {
  const container = control.closest<HTMLElement>("[data-field-name]");
  return {
    name: container?.dataset.fieldName || control.getAttribute("name") || control.id,
    label: container?.dataset.fieldLabel || control.getAttribute("name") || "Mục bắt buộc"
  };
}

export function ApplicationForm({
  action,
  state,
  submitLabel,
  children
}: {
  action: (formData: FormData) => void;
  state: ApplyActionState;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [missing, setMissing] = useState<MissingField[]>([]);

  // Runs from the form's `invalid` capture listener, which the browser fires once
  // per invalid control during interactive validation.
  //
  // MUST NOT call checkValidity(): per the HTML spec that method *dispatches* an
  // `invalid` event at the control, which captures straight back into this handler
  // and recurses without bound. Read the `validity` property instead — a plain
  // property access that fires nothing.
  const revealInvalid = () => {
    const form = formRef.current;
    if (!form) return;
    const controls = Array.from(form.querySelectorAll<HTMLElement>("input, select, textarea"));
    const invalid = controls.filter((control) => {
      const candidate = control as HTMLInputElement;
      return candidate.validity ? !candidate.validity.valid : false;
    });
    const unique = Array.from(new Map(invalid.map((control) => {
      const details = fieldDetails(control);
      return [details.name, details];
    })).values());
    // The browser fires one `invalid` event per invalid control, so this handler
    // runs N times per submit. Keep the previous array when nothing changed so the
    // repeats collapse into a single React render.
    setMissing((prev) =>
      prev.length === unique.length && prev.every((item, i) => item.name === unique[i].name)
        ? prev
        : unique
    );
    form.querySelectorAll("[data-field-name]").forEach((node) => node.removeAttribute("data-invalid"));
    controls.forEach((control) => control.removeAttribute("aria-invalid"));
    invalid.forEach((control) => {
      control.setAttribute("aria-invalid", "true");
      control.closest("[data-field-name]")?.setAttribute("data-invalid", "true");
    });
    // Deterministic first-invalid handling in DOM order. Idempotent across the N
    // repeats because `invalid[0]` is the same node every time.
    const first = invalid[0];
    if (first && document.activeElement !== first) {
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      first.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (state.ok || !state.fieldErrors?.length) return;
    setMissing(state.fieldErrors);
    const firstName = state.fieldErrors[0].name;
    const field = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-field-name]") ?? [])
      .find((candidate) => candidate.dataset.fieldName === firstName);
    field?.setAttribute("data-invalid", "true");
    const control = field?.querySelector<HTMLElement>("input, select, textarea");
    control?.setAttribute("aria-invalid", "true");
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    control?.focus({ preventScroll: true });
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-6"
      onInvalidCapture={revealInvalid}
      onSubmit={(event) => {
        setMissing([]);
      }}
      onChange={(event) => {
        const control = event.target as HTMLInputElement;
        control.removeAttribute("aria-invalid");
        control.closest("[data-field-name]")?.removeAttribute("data-invalid");
      }}
    >
      <FormBanner state={state} />
      {children}
      {missing.length ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert" aria-live="polite">
          <p className="font-semibold">Bạn còn {missing.length} mục bắt buộc chưa hoàn thành.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {missing.map((item) => <li key={item.name}>{item.label}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="flex justify-end pt-2">
        <ApplySubmitButton idleLabel={submitLabel} />
      </div>
    </form>
  );
}

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
        {children} {required ? requiredBadge : null}
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
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <Label htmlFor={name} required={required} helpText={helpText} helpId={helpId}>
        {label}
      </Label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        aria-required={required || undefined}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        aria-describedby={helpId}
        className={inputClass}
      />
      <InlineRequiredError />
    </div>
  );
}

export function PhoneField({
  name,
  label,
  required,
  placeholder,
  helpText,
  defaultValue
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: string;
}) {
  const helpId = helpText ? `${name}-help` : undefined;
  return (
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <Label htmlFor={name} required={required} helpText={helpText} helpId={helpId}>
        {label}
      </Label>
      {/*
        No maxLength: it silently truncates an over-length paste (e.g. the 11-digit
        "09012345678" became the valid-but-wrong "0901234567"). Let the full value
        stand so `pattern` rejects it and the applicant is told to correct it.
      */}
      <input
        id={name}
        name={name}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]{10}"
        title="Số điện thoại phải gồm đúng 10 chữ số (0-9), không khoảng trắng."
        required={required}
        aria-required={required || undefined}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        aria-describedby={helpId}
        className={inputClass}
      />
      <InlineRequiredError message="Số điện thoại phải gồm đúng 10 chữ số." />
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
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
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
        aria-required={required || undefined}
        aria-describedby={helpId}
        onChange={onChange}
        className={inputClass}
      />
      <InlineRequiredError />
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
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <Label htmlFor={name} required={required} helpText={helpText}>
        {label}
      </Label>
      <textarea
        id={name}
        name={name}
        required={required}
        aria-required={required || undefined}
        rows={rows}
        minLength={minLength}
        placeholder={placeholder}
        className={cn(inputClass, "min-h-[6rem] resize-y")}
      />
      <InlineRequiredError />
    </div>
  );
}

export function SelectField({
  name,
  label,
  required,
  options,
  helpText,
  placeholderOption = "-- Chọn --",
  otherInput
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
  placeholderOption?: string;
  otherInput?: { name: string; label: string; triggerValue?: string };
}) {
  const [selectedValue, setSelectedValue] = useState("");
  const showOther = otherInput && selectedValue === (otherInput.triggerValue ?? "other");

  return (
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <Label htmlFor={name} required={required} helpText={helpText}>
        {label}
      </Label>
      <select id={name} name={name} required={required} aria-required={required || undefined} defaultValue="" className={inputClass} onChange={(e) => setSelectedValue(e.target.value)}>
        <option value="" disabled={required}>
          {placeholderOption}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {showOther ? (
        <div className="mt-3" data-field-name={otherInput.name} data-field-label={otherInput.label}>
          <Label htmlFor={otherInput.name} required>{otherInput.label}</Label>
          <input id={otherInput.name} name={otherInput.name} required aria-required="true" className={inputClass} />
        </div>
      ) : null}
      <InlineRequiredError />
    </div>
  );
}

export function CheckboxGroupField({
  name,
  label,
  required,
  options,
  helpText,
  maxSelections,
  otherInput,
  defaultSelected
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
  maxSelections?: number;
  otherInput?: { name: string; label: string };
  defaultSelected?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected || []));
  const [limitError, setLimitError] = useState(false);
  const otherSelected = selected.has("other");
  return (
    <fieldset
      data-field-name={name}
      data-field-label={label}
      aria-required={required || undefined}
      className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2"
    >
      <legend className="block text-sm font-medium text-vam-ink">
        {label} {required ? requiredBadge : null}
      </legend>
      {helpText ? <p className="mt-0.5 text-xs text-slate-500">{helpText}</p> : null}
      {maxSelections ? <p className="mt-1 text-xs font-medium text-slate-600">{selected.size}/{maxSelections} đã chọn</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Array.from(new Map(options.map((option) => [option.value, option])).values()).map((o, index) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-vam-line bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={defaultSelected?.includes(o.value)}
              required={required && selected.size === 0 && index === 0}
              aria-required={required || undefined}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.currentTarget.checked) {
                  if (maxSelections && next.size >= maxSelections) {
                    event.currentTarget.checked = false;
                    setLimitError(true);
                    return;
                  }
                  next.add(o.value);
                } else {
                  next.delete(o.value);
                }
                setSelected(next);
                setLimitError(false);
              }}
              className="mt-0.5 h-4 w-4 rounded border-vam-line text-vam-green focus:ring-vam-mint"
            />
            <span className="text-vam-ink">{o.label}</span>
          </label>
        ))}
      </div>
      {limitError ? <p className="mt-2 text-sm font-medium text-red-700" role="alert">Bạn chỉ có thể chọn tối đa {maxSelections} lựa chọn.</p> : null}
      {otherInput && otherSelected ? (
        <div className="mt-3" data-field-name={otherInput.name} data-field-label={otherInput.label}>
          <Label htmlFor={otherInput.name} required>{otherInput.label}</Label>
          <input id={otherInput.name} name={otherInput.name} required aria-required="true" className={inputClass} />
        </div>
      ) : null}
      <InlineRequiredError />
    </fieldset>
  );
}

export function RadioGroupField({
  name,
  label,
  required,
  options,
  helpText,
  otherInput
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
  otherInput?: { name: string; label: string; triggerValue?: string };
}) {
  const [selectedValue, setSelectedValue] = useState("");
  const showOther = otherInput && selectedValue === (otherInput.triggerValue ?? "other");

  return (
    <fieldset data-field-name={name} data-field-label={label} aria-required={required || undefined} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <legend className="block text-sm font-medium text-vam-ink">
        {label} {required ? requiredBadge : null}
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
              onChange={(e) => setSelectedValue(e.target.value)}
              className="mt-0.5 h-4 w-4 border-vam-line text-vam-green focus:ring-vam-mint"
            />
            <span className="text-vam-ink">{o.label}</span>
          </label>
        ))}
      </div>
      {showOther ? (
        <div className="mt-3" data-field-name={otherInput.name} data-field-label={otherInput.label}>
          <Label htmlFor={otherInput.name} required>{otherInput.label}</Label>
          <input id={otherInput.name} name={otherInput.name} required aria-required="true" className={inputClass} />
        </div>
      ) : null}
      <InlineRequiredError />
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
    <label data-field-name={name} data-field-label={label} className="group flex cursor-pointer items-start gap-2 rounded-md border border-vam-line bg-slate-50 px-3 py-3 text-sm data-[invalid=true]:border-red-400 data-[invalid=true]:bg-red-50">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        required={required}
        aria-required={required || undefined}
        className="mt-0.5 h-4 w-4 rounded border-vam-line text-vam-green focus:ring-vam-mint"
      />
      <span className="text-vam-ink">
        {label} {required ? requiredBadge : null}
        <InlineRequiredError />
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
