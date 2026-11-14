"use client";

import { useCallback, useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { useMe } from "@/lib/useMe";
import { DataTable, ErrorBanner, FormModal, NoAccess, SystemShell, dangerButton, friendlyError, inputClass, linkButton, primaryButton, useData } from "@/components/erp/ui";
import { CRUMBS, Notice, Pill, SectionTabs } from "../_components/assistantUi";

const CHANNELS = [
  ["SMS", "SMS"],
  ["EMAIL", "Email"],
  ["CALL", "Call forwarding"],
  ["PANEL", "Their ERP panel"],
];

function ContactForm({ contact, staff, onClose, onDone }) {
  const [form, setForm] = useState(() => ({
    name: contact?.name || "",
    title: contact?.title || "",
    phone: contact?.phone || "",
    email: contact?.email || "",
    userId: contact?.userId || "",
    topics: (contact?.topics || []).join(", "),
    channels: contact?.channels || ["EMAIL"],
    isDefault: contact?.isDefault || false,
    isActive: contact ? contact.isActive : true,
  }));
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const toggle = (channel) => setForm({ ...form, channels: form.channels.includes(channel) ? form.channels.filter((item) => item !== channel) : [...form.channels, channel] });
  const pickUser = (event) => {
    const user = staff.find((item) => item.id === event.target.value);
    setForm({ ...form, userId: event.target.value, name: form.name || user?.name || "", email: form.email || user?.email || "", phone: form.phone || user?.phone || "" });
  };

  return (
    <FormModal title={contact ? `Edit ${contact.name}` : "Add a responsible person"} submitDisabled={!form.name.trim() || form.channels.length === 0} onClose={onClose}
      onSubmit={async () => {
        const body = { ...form, topics: form.topics, userId: form.userId || null };
        if (contact) await assistantApi.updateContact(contact.id, body);
        else await assistantApi.createContact(body);
        onDone(contact ? "Saved." : "Added. Questions on their topics now go to them.");
      }}>
      <div>
        <label htmlFor="c-user" className="mb-1 block text-sm font-medium text-slate-700">ERP user (optional)</label>
        <select id="c-user" value={form.userId} onChange={pickUser} className={inputClass}>
          <option value="">Not a user</option>
          {staff.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.role})</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="c-name" className="mb-1 block text-sm font-medium text-slate-700">Name *</label>
        <input id="c-name" value={form.name} onChange={set("name")} maxLength={150} className={inputClass} />
      </div>
      <div>
        <label htmlFor="c-title" className="mb-1 block text-sm font-medium text-slate-700">Role / title</label>
        <input id="c-title" value={form.title} onChange={set("title")} maxLength={150} placeholder="e.g. Hostel Warden" className={inputClass} />
      </div>
      <div>
        <label htmlFor="c-phone" className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
        <input id="c-phone" value={form.phone} onChange={set("phone")} maxLength={30} placeholder="01XXXXXXXXX" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <input id="c-email" type="email" value={form.email} onChange={set("email")} maxLength={255} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-topics" className="mb-1 block text-sm font-medium text-slate-700">Topics they answer</label>
        <input id="c-topics" value={form.topics} onChange={set("topics")} placeholder="e.g. hostel, meal, seat, হোস্টেল" className={inputClass} />
        <p className="mt-1 text-xs text-slate-500">Comma separated words or phrases. A question containing them goes to this person.</p>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Reach them by *</legend>
        <div className="flex flex-wrap gap-4">
          {CHANNELS.map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.channels.includes(value)} onChange={() => toggle(value)} /> {label}</label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Fallback person for every other topic</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
    </FormModal>
  );
}

function SettingsForm({ settings, onDone }) {
  const [form, setForm] = useState(settings);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
          await assistantApi.saveSettings(form);
          onDone("Settings saved.");
        } catch (err) {
          setError(friendlyError(err));
        } finally {
          setSaving(false);
        }
      }}>
      <div>
        <label htmlFor="s-tz" className="mb-1 block text-sm font-medium text-slate-700">Time zone</label>
        <input id="s-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputClass} />
        <p className="mt-1 text-xs text-slate-500">Used for &ldquo;today&rdquo; in meal and other live answers.</p>
      </div>
      <div>
        <label htmlFor="s-conf" className="mb-1 block text-sm font-medium text-slate-700">How sure before answering</label>
        <select id="s-conf" value={String(form.minConfidence)} onChange={(e) => setForm({ ...form, minConfidence: Number(e.target.value) })} className={inputClass}>
          <option value="0.5">Lenient (0.5)</option><option value="0.6">Balanced (0.6)</option><option value="0.75">Strict (0.75)</option><option value="0.9">Very strict (0.9)</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">Below this, a question is forwarded instead of answered.</p>
      </div>
      <div>
        <label htmlFor="s-mail" className="mb-1 block text-sm font-medium text-slate-700">Admin email</label>
        <input id="s-mail" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} className={inputClass} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-3">{error}</p>}
      <button type="submit" disabled={saving} className={`${primaryButton} disabled:opacity-60`}>{saving ? "Saving…" : "Save settings"}</button>
    </form>
  );
}

export default function SetupPage() {
  const { can, isReady } = useMe();
  const load = useCallback(() => Promise.all([assistantApi.contacts(), assistantApi.staff(""), assistantApi.settings()]), []);
  const { data, error, isLoading, reload } = useData(load);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [contacts, staff, settings] = data || [[], [], null];

  if (!isReady) return null;
  if (!can("voice-ai.manage_escalations")) return <NoAccess />;
  const done = (text) => {
    setForm(null);
    setNotice(text);
    reload();
  };

  return (
    <SystemShell title="Responsible Persons" crumbs={CRUMBS} subtitle="Who answers the questions the assistant cannot, and how they are reached."
      actions={<button onClick={() => setForm({ contact: null })} className={primaryButton}>Add Person</button>}>
      <SectionTabs can={can} />
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <Notice text={notice} />
      {!isLoading && contacts.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Nobody is set up yet, so every unanswered question waits for an admin under Forwarded Questions. Add at least a fallback person.</p>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-1">
        <DataTable columns={["Person", "Topics", "Reached by", "Status", ""]} isLoading={isLoading} hasRows={contacts.length > 0} emptyMessage="No responsible persons yet.">
          {contacts.map((contact) => (
            <tr key={contact.id} className="border-b border-slate-100 align-top">
              <td className="px-4 py-3"><span className="font-medium text-slate-800">{contact.name}</span><span className="block text-xs text-slate-500">{[contact.title, contact.phone, contact.email].filter(Boolean).join(" · ")}</span></td>
              <td className="max-w-xs px-4 py-3 text-slate-700">{contact.isDefault && <Pill tone="blue">Fallback</Pill>} {contact.topics.join(", ") || (contact.isDefault ? "" : "—")}</td>
              <td className="px-4 py-3 text-slate-700">{contact.channels.map((channel) => CHANNELS.find(([value]) => value === channel)?.[1] || channel).join(", ")}</td>
              <td className="px-4 py-3">{contact.isActive ? <Pill tone="green">Active</Pill> : <Pill>Off</Pill>}</td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  <button onClick={() => setForm({ contact })} className={linkButton}>Edit</button>
                  <button onClick={async () => {
                    if (!window.confirm(`Remove ${contact.name}?`)) return;
                    try {
                      await assistantApi.removeContact(contact.id);
                      done("Removed.");
                    } catch (err) {
                      setActionError(friendlyError(err));
                    }
                  }} className={dangerButton}>Remove</button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
      <h2 className="font-bold text-slate-800">Settings</h2>
      {settings && <SettingsForm key={settings.updatedAt || "new"} settings={settings} onDone={done} />}
      {form && <ContactForm contact={form.contact} staff={staff} onClose={() => setForm(null)} onDone={done} />}
    </SystemShell>
  );
}
