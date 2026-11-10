"use client";

import { useState } from "react";
import { Field, FormModal, inputClass } from "./ui";

// A modal form described by a list of fields.
// Field: { name, label, type: text|number|date|datetime-local|textarea|select|checkbox, options: [[value, label]], optional, step, wide, disabled }
// onSubmit receives the values with numbers converted and empty optional fields as null.
export default function QuickForm({ title, fields, initial = {}, submitLabel = "Save", onSubmit, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.name, initial[field.name] ?? (field.type === "checkbox" ? false : "")]))
  );
  const set = (name, value) => setValues((previous) => ({ ...previous, [name]: value }));

  const submit = () => {
    const body = {};
    for (const field of fields) {
      if (field.disabled) continue;
      const value = values[field.name];
      if (field.type === "number") body[field.name] = value === "" ? (field.optional ? null : undefined) : Number(value);
      else if (field.type === "datetime-local") body[field.name] = value ? new Date(value).toISOString() : null;
      else body[field.name] = field.optional && value === "" ? null : value;
    }
    return onSubmit(body);
  };

  return (
    <FormModal title={title} submitLabel={submitLabel} onSubmit={submit} onClose={onClose}>
      {fields.map((field) => {
        const id = `qf-${field.name}`;
        if (field.type === "checkbox") {
          return (
            <label key={field.name} className={`flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700 ${field.wide ? "sm:col-span-2" : ""}`}>
              <input id={id} type="checkbox" checked={Boolean(values[field.name])} disabled={field.disabled} onChange={(e) => set(field.name, e.target.checked)} />
              {field.label}
            </label>
          );
        }
        return (
          <Field key={field.name} id={id} label={field.label} wide={field.wide || field.type === "textarea"}>
            {field.type === "select" ? (
              <select id={id} value={values[field.name] ?? ""} disabled={field.disabled} onChange={(e) => set(field.name, e.target.value)} className={inputClass}>
                {!field.noBlank && <option value="">{field.optional ? "None" : "Choose..."}</option>}
                {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : field.type === "textarea" ? (
              <textarea id={id} rows={field.rows || 6} value={values[field.name] ?? ""} disabled={field.disabled} onChange={(e) => set(field.name, e.target.value)} className={inputClass} />
            ) : (
              <input id={id} type={field.type || "text"} step={field.step} min={field.min} value={values[field.name] ?? ""} disabled={field.disabled}
                onChange={(e) => set(field.name, e.target.value)} className={inputClass} />
            )}
            {field.hint && <p className="mt-1 text-xs text-slate-500">{field.hint}</p>}
          </Field>
        );
      })}
    </FormModal>
  );
}

// For datetime-local inputs: an ISO time shown in the browser's local time.
export const toLocalInput = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export const label = (value) => (value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ") : "");
