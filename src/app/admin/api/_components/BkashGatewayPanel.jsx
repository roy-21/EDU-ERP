"use client";

import { useState } from "react";
import Link from "next/link";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  DataTable,
  ErrorBanner,
  Pager,
  SelectField,
  StatusBadge,
  TextField,
  formatDateTime,
  friendlyError,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelData,
  usePagination,
} from "../../hostel/_components/hostelUi";

const loadConfig = () => hostelService.getGatewayConfig();
const loadMethods = () => hostelService.getPaymentMethods();
const loadTransactions = () => hostelService.getGatewayTransactions();

const EMPTY_SECRETS = { username: "", password: "", appKey: "", appSecret: "" };

function ConfigForm({ config, onSaved }) {
  const [form, setForm] = useState({
    environment: config.environment,
    enabled: config.enabled,
    ...EMPTY_SECRETS,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const setValue = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const savedHint = (isSet) => (isSet ? "Saved. Leave empty to keep it." : "Not set");

  const act = async (work, message) => {
    setError("");
    setNotice("");
    setIsBusy(true);
    try {
      const result = await work();
      setForm((previous) => ({ ...previous, ...EMPTY_SECRETS }));
      setNotice(typeof message === "function" ? message(result) : message);
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = (event) => {
    event.preventDefault();
    act(() => hostelService.saveGatewayConfig(form), "Saved. The secret values are encrypted and cannot be shown again.");
  };

  const handleTest = () =>
    act(() => hostelService.testGateway(), (result) => result.lastTestMessage);

  return (
    <form onSubmit={handleSave} noValidate autoComplete="off" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SelectField
        id="bkash-environment"
        label="Environment"
        value={form.environment}
        onChange={setValue("environment")}
        options={[
          { value: "sandbox", label: "Sandbox (test money)" },
          { value: "production", label: config.productionAllowed ? "Production (real money)" : "Production (blocked on this server)" },
        ]}
      />
      <TextField
        id="bkash-base-url"
        label="API Base URL"
        value={form.environment === "production" ? config.productionBaseUrl : config.sandboxBaseUrl}
        onChange={() => {}}
        readOnly
      />
      <TextField id="bkash-username" label="Merchant Username" type="password" autoComplete="new-password" placeholder={savedHint(config.hasUsername)} value={form.username} onChange={setValue("username")} />
      <TextField id="bkash-password" label="Merchant Password" type="password" autoComplete="new-password" placeholder={savedHint(config.hasPassword)} value={form.password} onChange={setValue("password")} />
      <TextField id="bkash-app-key" label="App Key" type="password" autoComplete="new-password" placeholder={savedHint(config.hasAppKey)} value={form.appKey} onChange={setValue("appKey")} />
      <TextField id="bkash-app-secret" label="App Secret" type="password" autoComplete="new-password" placeholder={savedHint(config.hasAppSecret)} value={form.appSecret} onChange={setValue("appSecret")} />
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setValue("enabled")(event.target.checked)} />
        Let students pay with bKash
      </label>

      <div className="flex flex-col gap-3 sm:col-span-2">
        {!config.encryptionKeySet && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Credentials cannot be saved yet. Set HOSTEL_SECRET_KEY in the backend environment and restart it.
          </p>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={isBusy} className={`${primaryButton} disabled:opacity-60`}>
            {isBusy ? "Working..." : "Save Settings"}
          </button>
          <button type="button" disabled={isBusy || !config.hasAppKey} onClick={handleTest} className={`${secondaryButton} disabled:opacity-60`}>
            Test Connection
          </button>
        </div>
      </div>
    </form>
  );
}

function MethodsPanel() {
  const { data, error, reload } = useHostelData(loadMethods);
  const [actionError, setActionError] = useState("");

  const toggle = async (item) => {
    setActionError("");
    try {
      await hostelService.setPaymentMethod(item.method, !item.enabled);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-800">Payment Methods</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">
        Staff can record payments by these methods. Only bKash takes payment online. Nagad and Rocket are for
        recording money received, because they have no integration here.
      </p>
      <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
      <div className="divide-y divide-slate-100">
        {data?.map((item) => (
          <label key={item.method} className="flex items-center justify-between gap-3 py-2 text-sm text-slate-700">
            {item.method === "Bank" ? "Bank Transfer" : item.method}
            <input
              type="checkbox"
              aria-label={`Enable ${item.method}`}
              checked={item.enabled}
              onChange={() => toggle(item)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function TransactionsPanel() {
  const { has } = useHostelPermissions();
  const { data, error, isLoading, reload } = useHostelData(loadTransactions);
  const [actionError, setActionError] = useState("");
  const { pageItems, pagerProps } = usePagination(data || []);

  const verify = async (id) => {
    setActionError("");
    try {
      await hostelService.verifyGatewayTransaction(id);
      reload();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-800">Online Payments</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">
        Every bKash attempt. Payments marked Review reached bKash but were not applied, so a person must check them.
      </p>
      <ErrorBanner message={actionError} onDismiss={() => setActionError("")} />
      <DataTable
        columns={["Started", "Student", "Invoice", "Amount", "Mode", "Transaction ID", "Status", "Action"]}
        isLoading={isLoading && !data}
        loadError={error}
        onRetry={reload}
        hasRows={pageItems.length > 0}
        emptyMessage="No online payments yet."
        minWidth="min-w-[920px]"
      >
        {pageItems.map((row) => (
          <tr key={row.id} className="border-b border-slate-100 align-top">
            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
            <td className="px-4 py-3">
              <Link href={`/admin/hostel/ledger/${row.allocationId}`} className={linkButton}>{row.studentName}</Link>
              <p className="text-xs text-slate-500">{row.studentId}</p>
            </td>
            <td className="px-4 py-3 text-slate-600">{row.invoiceNumber}</td>
            <td className="px-4 py-3 tabular-nums text-slate-600">{money(row.amount)}</td>
            <td className="px-4 py-3 capitalize text-slate-600">{row.environment}</td>
            <td className="px-4 py-3 text-slate-600">{row.trxId || "—"}</td>
            <td className="px-4 py-3">
              <StatusBadge status={row.status} />
              {(row.reviewReason || (row.status === "Failed" && row.statusMessage)) && (
                <p className="mt-1 max-w-xs text-xs text-slate-500">{row.reviewReason || row.statusMessage}</p>
              )}
            </td>
            <td className="px-4 py-3">
              {row.status === "Initiated" && has("manage_payments") && (
                <button onClick={() => verify(row.id)} aria-label={`Check ${row.invoiceNumber} with bKash`} className={linkButton}>
                  Check With bKash
                </button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager {...pagerProps} />
    </section>
  );
}

function ConfigPanel() {
  const { data: config, error, isLoading, reload } = useHostelData(loadConfig);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-800">bKash Merchant Integration</h2>
          <p className="mt-1 text-sm text-slate-500">
            Used by hostel rent payment links. Secret values are encrypted and never shown again.
          </p>
        </div>
        {config && <StatusBadge status={config.health} />}
      </div>
      {isLoading && !config && <p className="text-sm text-slate-500">Loading...</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {config && (
        <>
          <ConfigForm key={`${config.environment}-${config.enabled}`} config={config} onSaved={reload} />
          {config.lastTestAt && (
            <p className="mt-3 text-xs text-slate-500">
              Last test {formatDateTime(config.lastTestAt)}: {config.lastTestMessage}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function BkashGatewayPanel() {
  const { isReady, has } = useHostelPermissions();
  if (!isReady) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 pb-0 md:p-6 md:pb-0">
      {has("configure_rent") && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ConfigPanel />
          </div>
          <MethodsPanel />
        </div>
      )}
      {has("manage_payments", "view_due_rent") && <TransactionsPanel />}
    </div>
  );
}
