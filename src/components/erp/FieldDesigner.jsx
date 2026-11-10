"use client";

import { dangerButton, inputClass, linkButton } from "./ui";

export const FIELD_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "radio", label: "Single choice" },
  { value: "multiselect", label: "Multiple choice" },
  { value: "checkbox", label: "Yes / No tick" },
];
const WITH_OPTIONS = ["select", "radio", "multiselect"];
const OPERATORS = [
  { value: "equals", label: "is" },
  { value: "notEquals", label: "is not" },
  { value: "in", label: "is one of" },
  { value: "notEmpty", label: "is answered" },
  { value: "empty", label: "is not answered" },
];

const toId = (label, taken) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "f_$1").slice(0, 40) || "field";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}_${n}`;
  return id;
};

export const blankField = () => ({ id: "", type: "text", label: "", required: false, options: [], showIf: null, placeholder: "", helpText: "", min: null, max: null });

// Gives every field a stable id before saving. Existing ids never change, so old answers still match.
// A condition on a new field points at its label until then, so it is pointed at the new id.
export const finishFields = (fields) => {
  const taken = fields.map((field) => field.id).filter(Boolean);
  const byLabel = {};
  const withIds = fields.map((field) => {
    if (field.id) return field;
    const id = toId(field.label, taken);
    taken.push(id);
    byLabel[field.label] = id;
    return { ...field, id };
  });
  return withIds.map((field) =>
    field.showIf && byLabel[field.showIf.field] ? { ...field, showIf: { ...field.showIf, field: byLabel[field.showIf.field] } } : field
  );
};

export default function FieldDesigner({ fields, onChange, lockedIds = [] }) {
  const update = (index, change) => onChange(fields.map((field, i) => (i === index ? { ...field, ...change } : field)));
  const move = (index, step) => {
    const target = index + step;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {fields.map((field, index) => {
        const earlier = fields.slice(0, index).filter((item) => item.label);
        const target = earlier.find((item) => (item.id || item.label) === field.showIf?.field);
        const label = field.label || `Field ${index + 1}`;
        return (
          <fieldset key={index} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-500">
              {index + 1}. {label}{field.id ? <span className="ml-2 font-mono text-slate-400">{field.id}</span> : null}
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input aria-label={`Label of field ${index + 1}`} value={field.label} maxLength={200} placeholder="Question or label" onChange={(e) => update(index, { label: e.target.value })} className={inputClass} />
              <select aria-label={`Type of field ${index + 1}`} value={field.type} disabled={lockedIds.includes(field.id)} onChange={(e) => update(index, { type: e.target.value })} className={inputClass}>
                {FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={field.required} onChange={(e) => update(index, { required: e.target.checked })} />
                Required
              </label>
              {WITH_OPTIONS.includes(field.type) && (
                <input
                  aria-label={`Options of field ${index + 1}`}
                  value={(field.options || []).join(", ")}
                  placeholder="Options, separated by commas"
                  onChange={(e) => update(index, { options: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                  className={`${inputClass} sm:col-span-3`}
                />
              )}
              {field.type === "number" && (
                <>
                  <input aria-label={`Minimum of field ${index + 1}`} type="number" value={field.min ?? ""} placeholder="Minimum" onChange={(e) => update(index, { min: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass} />
                  <input aria-label={`Maximum of field ${index + 1}`} type="number" value={field.max ?? ""} placeholder="Maximum" onChange={(e) => update(index, { max: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass} />
                </>
              )}
              <input aria-label={`Help text of field ${index + 1}`} value={field.helpText || ""} maxLength={500} placeholder="Help text (optional)" onChange={(e) => update(index, { helpText: e.target.value })} className={`${inputClass} sm:col-span-3`} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>Show</span>
              <select
                aria-label={`Condition of field ${index + 1}`}
                value={field.showIf?.field || ""}
                onChange={(e) => update(index, { showIf: e.target.value ? { field: e.target.value, operator: "equals", value: "" } : null })}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">always</option>
                {earlier.map((item) => <option key={item.id || item.label} value={item.id || item.label}>only when &quot;{item.label}&quot;</option>)}
              </select>
              {field.showIf && (
                <>
                  <select aria-label={`Condition operator of field ${index + 1}`} value={field.showIf.operator} onChange={(e) => update(index, { showIf: { ...field.showIf, operator: e.target.value, value: e.target.value === "in" ? [] : "" } })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                    {OPERATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  {["equals", "notEquals"].includes(field.showIf.operator) && (
                    target && WITH_OPTIONS.includes(target.type) ? (
                      <select aria-label={`Condition value of field ${index + 1}`} value={field.showIf.value} onChange={(e) => update(index, { showIf: { ...field.showIf, value: e.target.value } })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                        <option value="">Choose...</option>
                        {target.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : target?.type === "checkbox" ? (
                      <select aria-label={`Condition value of field ${index + 1}`} value={String(field.showIf.value)} onChange={(e) => update(index, { showIf: { ...field.showIf, value: e.target.value === "true" } })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                        <option value="true">ticked</option>
                        <option value="false">not ticked</option>
                      </select>
                    ) : (
                      <input aria-label={`Condition value of field ${index + 1}`} value={field.showIf.value ?? ""} onChange={(e) => update(index, { showIf: { ...field.showIf, value: target?.type === "number" ? Number(e.target.value) : e.target.value } })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                    )
                  )}
                  {field.showIf.operator === "in" && (
                    <input aria-label={`Condition values of field ${index + 1}`} value={(field.showIf.value || []).join(", ")} placeholder="Values, separated by commas" onChange={(e) => update(index, { showIf: { ...field.showIf, value: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                  )}
                </>
              )}
              <span className="ml-auto flex gap-3">
                <button type="button" onClick={() => move(index, -1)} aria-label={`Move ${label} up`} className={linkButton}>↑</button>
                <button type="button" onClick={() => move(index, 1)} aria-label={`Move ${label} down`} className={linkButton}>↓</button>
                <button type="button" disabled={fields.length === 1} onClick={() => onChange(fields.filter((_, i) => i !== index))} aria-label={`Remove ${label}`} className={`${dangerButton} disabled:opacity-40`}>Remove</button>
              </span>
            </div>
          </fieldset>
        );
      })}
      <button type="button" onClick={() => onChange([...fields, blankField()])} className={`${linkButton} text-sm`}>+ Add Field</button>
    </div>
  );
}
