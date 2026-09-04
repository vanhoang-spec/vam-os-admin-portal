"use client";

import { useEffect, useRef, useState, createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { ApplySubmitButton } from "./submit-button";
import { RETURNING_MENTOR_GUIDANCE, type ApplyActionState } from "@/lib/apply-types";
import { draftChecked, draftList, draftText, type AutosaveData } from "@/lib/autosave";

/** The draft being restored into this render, or null when there is none. */
export const AutosaveContext = createContext<AutosaveData | null>(null);

/**
 * The autosave ALLOWLIST, published by the primitives themselves.
 *
 * Snapshotting the whole `FormData` would persist every hidden input the form
 * happens to render — including the `__apply_token` pilot relay — to the
 * applicant's browser. Excluding known-bad names would fix that one field and
 * leave the next one exposed.
 *
 * Instead each primitive that renders a USER-EDITABLE control registers its
 * name here while it is mounted, and the form reads only registered names out
 * of the `FormData`. A hidden or internal input is not rendered by a
 * primitive, so it never registers, so it cannot be stored — no denylist
 * required, and a field added later is excluded by default rather than by
 * remembering.
 *
 * `multiple` marks a control that can contribute several values under one name
 * (a checkbox group). It is what lets the snapshot store a single ticked box
 * as a one-element ARRAY rather than a bare string.
 */
export type AutosaveFieldRegistry = {
  register: (name: string, options?: { multiple?: boolean }) => () => void;
};

export const AutosaveRegistryContext = createContext<AutosaveFieldRegistry | null>(null);

/** Registers `name` as autosave-safe for as long as the control is mounted. */
export function useAutosaveSafeField(name: string, options?: { multiple?: boolean }) {
  const registry = useContext(AutosaveRegistryContext);
  const multiple = options?.multiple ?? false;
  useEffect(() => {
    if (!registry) return;
    return registry.register(name, { multiple });
  }, [registry, name, multiple]);
}

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
  onChangeCapture,
  children
}: {
  action: (formData: FormData) => void;
  state: ApplyActionState;
  submitLabel: string;
  onChangeCapture?: React.FormEventHandler<HTMLFormElement>;
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
      onChangeCapture={onChangeCapture}
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
      <SubmitAreaAlert state={state} />
      <div className="flex justify-end pt-2">
        <ApplySubmitButton idleLabel={submitLabel} />
      </div>
    </form>
  );
}

/**
 * Server-side refusals are re-stated here, immediately above the submit button.
 *
 * The banner at the top of the form is out of view for anyone who has just
 * pressed submit at the bottom of a long intake form — Owner UAT reported
 * applicants concluding nothing had happened. This block sits where they are
 * already looking, announces itself to assistive technology, takes focus, and
 * scrolls itself into view. Its meaning is carried by the heading text, not by
 * colour alone.
 */
function SubmitAreaAlert({ state }: { state: ApplyActionState }) {
  const alertRef = useRef<HTMLDivElement>(null);
  const returningMentor = state.errorKind === "returning_mentor";

  useEffect(() => {
    // A field-level error already scrolls to and focuses the offending control.
    // Taking focus here as well would fight it.
    if (state.ok || !state.message || state.fieldErrors?.length) return;
    const node = alertRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.focus({ preventScroll: true });
  }, [state]);

  if (state.ok || !state.message) return null;

  return (
    <div
      ref={alertRef}
      role="alert"
      tabIndex={-1}
      data-testid="submit-area-alert"
      data-error-kind={state.errorKind ?? "generic"}
      className="rounded-md border-2 border-red-400 bg-red-50 p-4 text-sm text-red-900"
    >
      <p className="text-base font-semibold">
        {returningMentor ? RETURNING_MENTOR_GUIDANCE.heading : "Không gửi được đơn"}
      </p>
      <p className="mt-2 leading-6">
        {returningMentor ? RETURNING_MENTOR_GUIDANCE.body : state.message}
      </p>
      {returningMentor ? (
        <p className="mt-3 rounded-md border border-red-300 bg-white p-3 font-medium leading-6">
          {RETURNING_MENTOR_GUIDANCE.cta}
        </p>
      ) : null}
    </div>
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

/**
 * The free-text companion that appears when an applicant picks "Khác / Other".
 *
 * Its own component for two reasons. It has to call a hook to register itself
 * with autosave, and it is rendered CONDITIONALLY — a hook cannot live behind
 * an `if` in the parent. It also had no `defaultValue`, so an applicant who
 * chose "Khác" and typed the detail got the option back on restore but lost
 * the text, which is the half that cannot be re-derived.
 *
 * It unmounts when the applicant selects something else, so its value leaves
 * the `FormData` and the next snapshot drops it. That is what keeps a stale
 * companion from riding along with a changed parent answer.
 */
function OtherCompanionInput({ name, label }: { name: string; label: string }) {
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  return (
    <div className="mt-3" data-field-name={name} data-field-label={label}>
      <Label htmlFor={name} required>{label}</Label>
      <input
        id={name}
        name={name}
        defaultValue={draftText(draft?.[name])}
        required
        aria-required="true"
        className={inputClass}
      />
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
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  const resolvedValue = defaultValue ?? draftText(draft?.[name]);
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
        defaultValue={resolvedValue}
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
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  const resolvedValue = defaultValue ?? draftText(draft?.[name]);
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
        defaultValue={resolvedValue}
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
  onChange,
  defaultValue
}: {
  name: string;
  label: string;
  required?: boolean;
  min?: number;
  helpText?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  defaultValue?: string;
}) {
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  const resolvedValue = defaultValue ?? draftText(draft?.[name]);
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
        defaultValue={resolvedValue}
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
  helpText,
  defaultValue
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  minLength?: number;
  helpText?: string;
  defaultValue?: string;
}) {
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  const resolvedValue = defaultValue ?? draftText(draft?.[name]);
  return (
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <Label htmlFor={name} required={required} helpText={helpText}>
        {label}
      </Label>
      <textarea
        id={name}
        name={name}
        defaultValue={resolvedValue}
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
  otherInput,
  defaultValue
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
  placeholderOption?: string;
  otherInput?: { name: string; label: string; triggerValue?: string };
  defaultValue?: string;
}) {
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  const resolvedValue = defaultValue ?? draftText(draft?.[name]);
  const [selectedValue, setSelectedValue] = useState(resolvedValue);
  const showOther = otherInput && selectedValue === (otherInput.triggerValue ?? "other");

  return (
    <div data-field-name={name} data-field-label={label} className="group data-[invalid=true]:rounded-md data-[invalid=true]:border data-[invalid=true]:border-red-300 data-[invalid=true]:bg-red-50 data-[invalid=true]:p-2">
      <Label htmlFor={name} required={required} helpText={helpText}>
        {label}
      </Label>
      <select id={name} name={name} required={required} aria-required={required || undefined} defaultValue={resolvedValue} className={inputClass} onChange={(e) => setSelectedValue(e.target.value)}>
        <option value="" disabled={required}>
          {placeholderOption}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {showOther ? <OtherCompanionInput name={otherInput.name} label={otherInput.label} /> : null}
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
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name, { multiple: true });
  // `draftList` is load-bearing, not defensive tidiness: a group with exactly
  // one box ticked round-trips through `FormData` as a bare STRING, and
  // `new Set("communication")` is a set of thirteen single characters. That is
  // how a single-selection draft came back with the wrong boxes ticked, a
  // nonsense "n/3 selected" counter, and an "Other" companion that never
  // appeared.
  const resolvedSelected = defaultSelected ?? draftList(draft?.[name]);
  const [selected, setSelected] = useState<Set<string>>(new Set(resolvedSelected));
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
              defaultChecked={resolvedSelected.includes(o.value)}
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
      {otherInput && otherSelected ? <OtherCompanionInput name={otherInput.name} label={otherInput.label} /> : null}
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
  otherInput,
  defaultValue
}: {
  name: string;
  label: string;
  required?: boolean;
  options: Array<{ value: string; label: string }>;
  helpText?: string;
  otherInput?: { name: string; label: string; triggerValue?: string };
  defaultValue?: string;
}) {
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  const resolvedValue = defaultValue ?? draftText(draft?.[name]);
  const [selectedValue, setSelectedValue] = useState(resolvedValue);
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
              defaultChecked={resolvedValue === o.value}
              required={required}
              onChange={(e) => setSelectedValue(e.target.value)}
              className="mt-0.5 h-4 w-4 border-vam-line text-vam-green focus:ring-vam-mint"
            />
            <span className="text-vam-ink">{o.label}</span>
          </label>
        ))}
      </div>
      {showOther ? <OtherCompanionInput name={otherInput.name} label={otherInput.label} /> : null}
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
  const draft = useContext(AutosaveContext);
  useAutosaveSafeField(name);
  // Unticked boxes are absent from the draft entirely, so "no entry" restores
  // as unchecked without a special case.
  const resolvedChecked = defaultChecked ?? draftChecked(draft?.[name]);
  return (
    <label data-field-name={name} data-field-label={label} className="group flex cursor-pointer items-start gap-2 rounded-md border border-vam-line bg-slate-50 px-3 py-3 text-sm data-[invalid=true]:border-red-400 data-[invalid=true]:bg-red-50">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={resolvedChecked}
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
