"use client";

import { useCallback, useState } from "react";
import { Detail, filterClass, formatDateTime, friendlyError, linkButton, useData } from "./ui";

const ACTION_STYLES = {
  "Signed In": "bg-green-50 text-green-700",
  "Sign-in Failed": "bg-red-50 text-red-700",
  Deleted: "bg-red-50 text-red-700",
  Created: "bg-blue-50 text-blue-700",
  Permissions: "bg-indigo-50 text-indigo-700",
};

const DEVICE_ICONS = { Mobile: "📱", Tablet: "📱", Desktop: "💻" };

// "💻 Chrome 126 · Windows 10/11 · Desktop · IP 103.4.5.6 (Internet)"
export function Origin({ origin, className = "" }) {
  if (!origin) return <span className={`text-xs text-slate-400 ${className}`}>Device and IP not recorded</span>;
  return (
    <span className={`text-xs text-slate-500 ${className}`} title={origin.userAgent || ""}>
      {origin.device ? `${DEVICE_ICONS[origin.device.type] || "🖥️"} ${origin.device.summary}` : "Unknown device"}
      {origin.ip && <> · IP <span className="font-mono">{origin.ip}</span>{origin.network ? ` (${origin.network})` : ""}</>}
    </span>
  );
}

function ActivityRow({ item, showActor }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="w-36 shrink-0 text-xs text-slate-500">{formatDateTime(item.at)}</span>
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[item.action] || "bg-slate-100 text-slate-700"}`}>{item.action}</span>
      <span className="text-xs text-slate-500">{item.area}</span>
      <span className="min-w-[14rem] flex-1 text-slate-700">
        {item.summary}
        {showActor && (
          <span className="block text-xs text-slate-500">
            {item.actor.outside ? `${item.actor.email || "Platform"} (outside the institution)` : `${item.actor.name} · ${item.actor.username} · ${item.actor.roleName}`}
          </span>
        )}
        <Origin origin={item.origin} className="block" />
      </span>
    </li>
  );
}

// One search's pages. Re-mounted (by key) when the search changes, so pages never mix.
function ActivityPages({ load, query, showActor }) {
  const first = useCallback(() => load({ search: query, limit: 50 }), [load, query]);
  const { data, error, isLoading } = useData(first);
  const [extra, setExtra] = useState([]);
  const [next, setNext] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  const items = [...(data?.items || []), ...extra];
  const cursor = next === undefined ? data?.nextBefore : next;

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    setMoreError("");
    try {
      const page = await load({ search: query, limit: 50, before: cursor });
      setExtra((previous) => [...previous, ...page.items]);
      setNext(page.nextBefore);
    } catch (err) {
      setMoreError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (isLoading && !data) return <p className="text-sm text-slate-500">Loading activity...</p>;
  if (items.length === 0) return <p className="text-sm text-slate-500">{query ? "Nothing matches." : "No activity recorded yet."}</p>;
  return (
    <div>
      <ul aria-label="Activity">{items.map((item) => <ActivityRow key={item.id} item={item} showActor={showActor} />)}</ul>
      {moreError && <p role="alert" className="text-sm text-red-600">{moreError}</p>}
      {cursor && <button onClick={more} disabled={busy} className={`${linkButton} mt-2 text-sm disabled:opacity-50`}>{busy ? "Loading..." : "Load older activity"}</button>}
    </div>
  );
}

// A searchable, newest-first timeline. `load(params)` returns { items, nextBefore }; keep it stable with useCallback.
export function ActivityList({ load, showActor = true }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }} className="flex gap-2">
        <input aria-label="Search activity" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search what was done, e.g. Deleted, Payment, room" className={`${filterClass} flex-1`} />
        <button type="submit" className={linkButton}>Search</button>
      </form>
      <ActivityPages key={query} load={load} query={query} showActor={showActor} />
    </div>
  );
}

// One person: how active they are, what they set up (users and roles), and everything they did.
// `load(params)` returns the user activity payload from the server.
export function UserActivity({ load }) {
  const summary = useCallback(() => load({ limit: 1 }), [load]);
  const { data, error } = useData(summary);
  const list = useCallback((params) => load(params).then((result) => result.activity), [load]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading activity...</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Actions (30 days)" value={String(data.stats.last30Days)} />
        <Detail label="All actions" value={String(data.stats.total)} />
        <Detail label="Sign-ins" value={String(data.stats.signIns)} />
        <Detail label="Last active" value={data.stats.lastActivityAt ? formatDateTime(data.stats.lastActivityAt) : "Never"} />
      </div>
      {data.areas.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Most worked on">
          {data.areas.map((item) => <span key={item.area} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{item.area}: {item.count}</span>)}
        </div>
      )}
      {(data.createdUsers.length > 0 || data.createdRoles.length > 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-700">Users they created ({data.createdUsers.length})</p>
            {data.createdUsers.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1 text-sm" aria-label="Users they created">
                {data.createdUsers.map((user) => (
                  <li key={user.id}>{user.fullName} <span className="font-mono text-xs text-slate-500">{user.username}</span> <span className="text-xs text-slate-500">· {user.roleName} · {user.status === "ACTIVE" ? "active" : "inactive"} · last sign-in {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "never"}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-700">Roles they created ({data.createdRoles.length})</p>
            {data.createdRoles.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1 text-sm" aria-label="Roles they created">
                {data.createdRoles.map((role) => <li key={role.id}>{role.name} <span className="text-xs text-slate-500">· {role.permissions} permission(s) · {role.users} user(s)</span></li>)}
              </ul>
            )}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">Devices and IP addresses used ({data.devices.length})</p>
        {data.devices.length === 0 ? <p className="text-xs text-slate-500">Nothing recorded yet. Device and IP are kept from now on.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm" aria-label="Devices and IP addresses">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 pr-3">Device</th><th className="py-1 pr-3">IP address</th><th className="py-1 pr-3">Sign-ins</th><th className="py-1 pr-3">Actions</th><th className="py-1 pr-3">First seen</th><th className="py-1">Last seen</th></tr></thead>
              <tbody>
                {data.devices.map((item, index) => (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="py-1 pr-3" title={item.userAgent || ""}>{item.device ? `${DEVICE_ICONS[item.device.type] || "🖥️"} ${item.device.summary}` : "Unknown"}</td>
                    <td className="py-1 pr-3"><span className="font-mono text-xs">{item.ip || "—"}</span>{item.network && <span className="block text-xs text-slate-500">{item.network}</span>}</td>
                    <td className="py-1 pr-3">{item.signIns}</td>
                    <td className="py-1 pr-3">{item.actions}</td>
                    <td className="py-1 pr-3 text-xs text-slate-600">{formatDateTime(item.firstAt)}</td>
                    <td className="py-1 text-xs text-slate-600">{formatDateTime(item.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">A web browser never sends its MAC address, and location is not looked up, so neither is shown.</p>
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">What they did</p>
        <ActivityList load={list} showActor={false} />
      </div>
    </div>
  );
}
