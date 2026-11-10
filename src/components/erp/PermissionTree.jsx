"use client";

import { useState } from "react";
import { inputClass } from "./ui";

// Module → feature → action. In "role" mode each permission is on or off.
// In "override" mode each is Inherit, Allow or Deny for one user, over what the role gives.
export default function PermissionTree({ tree, mode = "role", selected = [], inherited: inheritedKeys = [], onToggle, overrides = {}, onOverride, fromRole = [], readOnly = false }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState({});
  const query = search.trim().toLowerCase();
  const chosen = new Set(selected);
  const inherited = new Set(fromRole);
  const fromParent = new Set(inheritedKeys);

  const modules = tree
    .map((module) => ({
      ...module,
      groups: module.groups
        .map((group) => ({ ...group, permissions: group.permissions.filter((item) => !query || `${module.name} ${group.feature} ${item.label} ${item.key}`.toLowerCase().includes(query)) }))
        .filter((group) => group.permissions.length > 0),
    }))
    .filter((module) => module.groups.length > 0);

  const keysOf = (module) => module.groups.flatMap((group) => group.permissions.map((item) => item.key));

  return (
    <div className="space-y-3">
      <input aria-label="Search permissions" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search modules or permissions" className={inputClass} />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {modules.map((module) => {
          const keys = keysOf(module);
          const count = mode === "role" ? keys.filter((key) => chosen.has(key) || fromParent.has(key)).length : keys.filter((key) => overrides[key]).length;
          const isOpen = open[module.id] || Boolean(query);
          return (
            <li key={module.id}>
              <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpen((previous) => ({ ...previous, [module.id]: !previous[module.id] }))}
                  aria-expanded={isOpen}
                  className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-slate-800"
                >
                  <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  <span aria-hidden="true">{module.icon}</span>
                  {module.name}
                  {!module.entitled && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Not subscribed</span>}
                </button>
                <span className="text-xs text-slate-500">{count} {mode === "role" ? `of ${keys.length}` : "override(s)"}</span>
                {mode === "role" && !readOnly && (
                  <span className="flex gap-2 text-xs">
                    <button type="button" onClick={() => onToggle(keys, true)} className="text-blue-600 hover:underline" aria-label={`Select all in ${module.name}`}>All</button>
                    <button type="button" onClick={() => onToggle(keys, false)} className="text-slate-500 hover:underline" aria-label={`Clear ${module.name}`}>None</button>
                  </span>
                )}
              </div>
              {isOpen && (
                <div className="space-y-3 bg-slate-50 px-6 py-3">
                  {module.groups.map((group) => (
                    <div key={group.feature}>
                      <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{group.feature}</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {group.permissions.map((item) =>
                          mode === "role" ? (
                            <label key={item.key} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                disabled={readOnly || fromParent.has(item.key)}
                                checked={chosen.has(item.key) || fromParent.has(item.key)}
                                onChange={(e) => onToggle([item.key], e.target.checked)}
                              />
                              {item.label}
                              {fromParent.has(item.key) && <span className="text-xs text-indigo-600">from parent role</span>}
                            </label>
                          ) : (
                            <div key={item.key} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                              <span>
                                {item.label}
                                <span className={`ml-2 text-xs ${inherited.has(item.key) ? "text-green-700" : "text-slate-400"}`}>{inherited.has(item.key) ? "role: yes" : "role: no"}</span>
                              </span>
                              <select
                                aria-label={`Override for ${module.name}: ${item.label}`}
                                value={overrides[item.key] || ""}
                                disabled={readOnly}
                                onChange={(e) => onOverride(item.key, e.target.value)}
                                className={`rounded border px-2 py-0.5 text-xs ${overrides[item.key] === "DENY" ? "border-red-300 text-red-700" : overrides[item.key] === "ALLOW" ? "border-green-300 text-green-700" : "border-slate-300"}`}
                              >
                                <option value="">Inherit</option>
                                <option value="ALLOW" disabled={!module.entitled}>Allow</option>
                                <option value="DENY">Deny</option>
                              </select>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
