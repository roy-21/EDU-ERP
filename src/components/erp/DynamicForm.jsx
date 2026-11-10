"use client";

import { inputClass } from "./ui";

const isEmpty = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

// The same rule the server uses, so a hidden field is hidden here too.
export const isVisible = (field, values) => {
  const condition = field.showIf;
  if (!condition?.field) return true;
  const actual = values[condition.field];
  switch (condition.operator) {
    case "equals": return Array.isArray(actual) ? actual.includes(condition.value) : actual === condition.value;
    case "notEquals": return Array.isArray(actual) ? !actual.includes(condition.value) : actual !== condition.value;
    case "in": return (condition.value || []).some((item) => (Array.isArray(actual) ? actual.includes(item) : actual === item));
    case "notEmpty": return !isEmpty(actual);
    case "empty": return isEmpty(actual);
    default: return true;
  }
};

// Drops answers to hidden questions before sending.
export const visibleValues = (fields, values) => {
  const result = {};
  for (const field of fields) {
    if (!isVisible(field, result)) continue;
    if (values[field.id] !== undefined) result[field.id] = values[field.id];
  }
  return result;
};

export const displayValue = (field, value) => {
  if (value === undefined || value === null || value === "") return "—";
  if (field?.type === "checkbox") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

function Input({ field, value, onChange, idPrefix }) {
  const id = `${idPrefix}-${field.id}`;
  const common = { id, "aria-describedby": field.helpText ? `${id}-help` : undefined };
  switch (field.type) {
    case "textarea":
      return <textarea {...common} rows={3} value={value ?? ""} maxLength={field.maxLength || 5000} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case "number":
      return <input {...common} type="number" value={value ?? ""} min={field.min ?? undefined} max={field.max ?? undefined} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className={inputClass} />;
    case "date":
      return <input {...common} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case "select":
      return (
        <select {...common} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Choose...</option>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    case "radio":
      return (
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-4 pt-1">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name={id} checked={value === option} onChange={() => onChange(option)} />
              {option}
            </label>
          ))}
        </div>
      );
    case "multiselect":
      return (
        <div className="flex flex-wrap gap-4 pt-1">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={(value || []).includes(option)}
                onChange={(e) => onChange(e.target.checked ? [...(value || []), option] : (value || []).filter((item) => item !== option))}
              />
              {option}
            </label>
          ))}
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 pt-1 text-sm text-slate-700">
          <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.placeholder || "Yes"}
        </label>
      );
    default:
      return (
        <input
          {...common}
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          value={value ?? ""}
          maxLength={field.maxLength || 500}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      );
  }
}

// Renders a published form's fields. Sits inside a two-column grid such as FormModal.
export default function DynamicFields({ fields, values, onChange, idPrefix = "dyn" }) {
  const shown = [];
  const seen = {};
  for (const field of fields) {
    if (!isVisible(field, seen)) continue;
    seen[field.id] = values[field.id];
    shown.push(field);
  }
  return shown.map((field) => {
    const id = `${idPrefix}-${field.id}`;
    const wide = ["textarea", "radio", "multiselect"].includes(field.type);
    return (
      <div key={field.id} className={wide ? "sm:col-span-2" : ""}>
        <label id={`${id}-label`} htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
          {field.label}{field.required ? " *" : ""}
        </label>
        <Input field={field} value={values[field.id]} onChange={(value) => onChange({ ...values, [field.id]: value })} idPrefix={idPrefix} />
        {field.helpText && <p id={`${id}-help`} className="mt-1 text-xs text-slate-500">{field.helpText}</p>}
      </div>
    );
  });
}
