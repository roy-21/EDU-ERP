
"use client";

import { useEffect, useState } from "react";
import { systemService } from "@/lib/erpServices";

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

// Each page is saved on the server for this institution only.
export default function SettingsForm({ config }) {
  const [formData, setFormData] = useState(() =>
    Object.fromEntries(
      config.fields.map((field) => [field.name, field.value])
    )
  );

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [server, setServer] = useState(null);

  useEffect(() => {
    let isCurrent = true;
    systemService
      .getSettingsSection(config.section)
      .then((result) => {
        if (!isCurrent) return;
        setServer(result);
        setFormData((previous) => ({ ...previous, ...result.data }));
      })
      .catch((err) => isCurrent && setServer({ error: err.message, notes: [] }));
    return () => { isCurrent = false; };
  }, [config.section]);

  const handleChange = (name, value) => {
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload = {};
      for (const field of config.fields) {
        const value = formData[field.name];
        if (field.type === "file") {
          // Only a newly chosen file is sent; a saved image stays as it is.
          if (value instanceof File) payload[field.name] = { fileName: value.name, contentBase64: await toBase64(value) };
        } else if (field.type === "number") {
          payload[field.name] = value === "" || value === null || value === undefined ? null : Number(value);
        } else {
          payload[field.name] = value;
        }
      }
      const result = await systemService.saveSettingsSection(config.section, payload);
      setServer(result);
      setFormData((previous) => ({ ...previous, ...result.data }));
      setMessage("Saved for your institution.");
    } catch (err) {
      setMessage(`Not saved: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field) => {
    const commonClass =
      "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";

    if (field.type === "checkbox") {
      return (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(formData[field.name])}
            onChange={(e) =>
              handleChange(field.name, e.target.checked)
            }
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-sm text-slate-700">
            {formData[field.name] ? "Enabled" : "Disabled"}
          </span>
        </label>
      );
    }

    if (field.type === "select") {
      return (
        <select
          value={formData[field.name]}
          onChange={(e) =>
            handleChange(field.name, e.target.value)
          }
          className={commonClass}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "textarea") {
      return (
        <textarea
          rows={4}
          value={formData[field.name]}
          onChange={(e) =>
            handleChange(field.name, e.target.value)
          }
          className={commonClass}
        />
      );
    }

    if (field.type === "file") {
      return (
        <div>
          <input
            type="file"
            accept="image/*,.ico"
            onChange={(e) =>
              handleChange(field.name, e.target.files?.[0] || null)
            }
            className="w-full rounded-lg border border-slate-200 p-2 text-sm"
          />
          {(formData[field.name]?.name || formData[field.name]?.fileName) && (
            <p className="mt-2 text-xs text-slate-500">
              {formData[field.name] instanceof File ? `Selected: ${formData[field.name].name}` : `Saved: ${formData[field.name].fileName}`}
            </p>
          )}
        </div>
      );
    }

    if (field.type === "color") {
      return (
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={formData[field.name]}
            onChange={(e) =>
              handleChange(field.name, e.target.value)
            }
            className="h-10 w-16 cursor-pointer rounded border border-slate-200"
          />
          <span className="text-sm text-slate-600">
            {formData[field.name]}
          </span>
        </div>
      );
    }

    return (
      <input
        type={field.type || "text"}
        value={formData[field.name] ?? ""}
        onChange={(e) =>
          handleChange(field.name, e.target.value)
        }
        className={commonClass}
      />
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          {config.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {config.description}
        </p>
      </div>

      {server?.notes?.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          {server.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
      {server?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not load saved settings: {server.error}</p>}

      {!server?.managedElsewhere && (
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {config.fields.map((field) => (
            <div
              key={field.name}
              className={
                field.type === "textarea" ||
                field.type === "file" ||
                field.type === "checkbox"
                  ? "md:col-span-2"
                  : ""
              }
            >
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {field.label}
              </label>
              {renderField(field)}
            </div>
          ))}
        </div>

        {message && (
          <p className="mt-5 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
            {message}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={() => {
              setFormData(
                Object.fromEntries(
                  config.fields.map((field) => [
                    field.name,
                    field.value,
                  ])
                )
              );
              setMessage("");
            }}
            className="rounded-lg border border-slate-200 px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset
          </button>

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
      )}

      {server?.updatedAt && (
        <p className="text-xs text-slate-500">Last saved {new Date(server.updatedAt).toLocaleString()} by {server.updatedBy}.</p>
      )}
    </div>
  );
}
