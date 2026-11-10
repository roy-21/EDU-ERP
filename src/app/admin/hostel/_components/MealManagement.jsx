"use client";

import { useCallback, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import {
  DataTable,
  ErrorBanner,
  Field,
  FormModal,
  PageShell,
  Pager,
  SelectField,
  StatGrid,
  StatusBadge,
  TextField,
  dangerButton,
  filterClass,
  formatDateTime,
  friendlyError,
  inputClass,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelData,
  usePagination,
} from "./hostelUi";
import { Detail, ProtectedImage, ViewModal, fileToBase64 } from "./hostelViews";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Special Meal", "Snacks"];

// datetime-local wants the local time without a zone.
const localInput = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const emptyMeal = () => ({
  title: "",
  mealType: "Lunch",
  mealDate: "",
  category: "",
  description: "",
  menuItems: [""],
  pricePerMeal: "",
  specialPrice: "",
  additionalCharge: "0",
  bookingOpensAt: "",
  bookingClosesAt: "",
  collectFrom: "",
  collectUntil: "",
});

function MealForm({ meal, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    meal
      ? {
          ...meal,
          menuItems: [...meal.menuItems],
          pricePerMeal: String(meal.pricePerMeal),
          specialPrice: meal.specialPrice === null ? "" : String(meal.specialPrice),
          additionalCharge: String(meal.additionalCharge),
          bookingOpensAt: localInput(meal.bookingOpensAt),
          bookingClosesAt: localInput(meal.bookingClosesAt),
          collectFrom: localInput(meal.collectFrom),
          collectUntil: localInput(meal.collectUntil),
        }
      : emptyMeal()
  );
  const [imageFile, setImageFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const loadImage = useCallback(() => hostelService.getMealImage(meal?.id), [meal?.id]);
  const setValue = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const setItem = (index, value) =>
    setForm((previous) => ({ ...previous, menuItems: previous.menuItems.map((item, i) => (i === index ? value : item)) }));
  const moveItem = (index, step) =>
    setForm((previous) => {
      const items = [...previous.menuItems];
      const target = index + step;
      if (target < 0 || target >= items.length) return previous;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...previous, menuItems: items };
    });

  const total =
    (Number(form.specialPrice || form.pricePerMeal) || 0) + (Number(form.additionalCharge) || 0);

  const handleSubmit = async () => {
    if (imageFile && imageFile.size > MAX_IMAGE_BYTES) throw new Error("The meal image must be 2 MB or smaller.");
    const image = imageFile
      ? { fileName: imageFile.name, contentBase64: await fileToBase64(imageFile) }
      : removeImage
        ? null
        : undefined;
    const body = {
      ...form,
      image,
      menuItems: form.menuItems.map((item) => item.trim()).filter(Boolean),
      pricePerMeal: Number(form.pricePerMeal),
      specialPrice: form.specialPrice === "" ? null : Number(form.specialPrice),
      additionalCharge: Number(form.additionalCharge || 0),
    };
    if (meal) await hostelService.updateMeal(meal.id, body);
    else await hostelService.createMeal(body);
    onSaved();
  };

  return (
    <FormModal title={meal ? `Edit Draft: ${meal.title}` : "Add New Meal"} submitLabel="Save as Draft" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="meal-title" label="Meal Title *" value={form.title} maxLength={150} onChange={setValue("title")} />
      <SelectField id="meal-type" label="Meal Type *" value={form.mealType} onChange={setValue("mealType")} options={MEAL_TYPES} />
      <TextField id="meal-date" label="Meal Date *" type="date" value={form.mealDate} onChange={setValue("mealDate")} />
      <TextField id="meal-category" label="Meal Category" value={form.category} maxLength={50} onChange={setValue("category")} placeholder="e.g. Regular, Festival" />
      <Field id="meal-description" label="Description" wide>
        <textarea id="meal-description" rows={2} maxLength={1000} value={form.description} onChange={(event) => setValue("description")(event.target.value)} className={inputClass} />
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-slate-700">Menu Items *</legend>
        <div className="space-y-2">
          {form.menuItems.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                aria-label={`Menu item ${index + 1}`}
                value={item}
                maxLength={100}
                onChange={(event) => setItem(index, event.target.value)}
                className={inputClass}
              />
              <button type="button" onClick={() => moveItem(index, -1)} aria-label={`Move item ${index + 1} up`} className={linkButton}>↑</button>
              <button type="button" onClick={() => moveItem(index, 1)} aria-label={`Move item ${index + 1} down`} className={linkButton}>↓</button>
              <button
                type="button"
                disabled={form.menuItems.length === 1}
                onClick={() => setForm((previous) => ({ ...previous, menuItems: previous.menuItems.filter((_, i) => i !== index) }))}
                aria-label={`Remove item ${index + 1}`}
                className={`${dangerButton} disabled:opacity-40`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setForm((previous) => ({ ...previous, menuItems: [...previous.menuItems, ""] }))} className={`${linkButton} mt-2 text-sm`}>
          + Add Item
        </button>
      </fieldset>

      <Field id="meal-image" label="Meal Image (JPG or PNG, up to 2 MB)" wide>
        <div className="flex flex-wrap items-center gap-4">
          {meal?.hasImage && !removeImage && !imageFile && <ProtectedImage load={loadImage} alt={`Photo of ${meal.title}`} className="h-16 w-24" />}
          <input
            id="meal-image"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              setImageFile(event.target.files?.[0] || null);
              setRemoveImage(false);
            }}
            className="text-sm"
          />
          {meal?.hasImage && !imageFile && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={removeImage} onChange={(event) => setRemoveImage(event.target.checked)} />
              Remove current image
            </label>
          )}
        </div>
      </Field>

      <TextField id="meal-price" label="Price Per Meal (৳) *" type="number" min="0" step="0.01" value={form.pricePerMeal} onChange={setValue("pricePerMeal")} />
      <TextField id="meal-special" label="Special Meal Price (৳), replaces the price" type="number" min="0" step="0.01" value={form.specialPrice} onChange={setValue("specialPrice")} />
      <TextField id="meal-extra" label="Additional Charges (৳)" type="number" min="0" step="0.01" value={form.additionalCharge} onChange={setValue("additionalCharge")} />
      <Detail label="Total Price Per Meal" value={money(total)} />

      <TextField id="meal-open" label="Booking Opens *" type="datetime-local" value={form.bookingOpensAt} onChange={setValue("bookingOpensAt")} />
      <TextField id="meal-close" label="Booking Closes *" type="datetime-local" value={form.bookingClosesAt} onChange={setValue("bookingClosesAt")} />
      <TextField id="meal-collect-from" label="Collection Starts *" type="datetime-local" value={form.collectFrom} onChange={setValue("collectFrom")} />
      <TextField id="meal-collect-until" label="Collection Ends *" type="datetime-local" value={form.collectUntil} onChange={setValue("collectUntil")} />
      <p className="text-xs text-slate-500 sm:col-span-2">Times are in the hostel&apos;s time zone. After publishing, nothing here can be changed.</p>
    </FormModal>
  );
}

function PublishPreview({ meal, onClose, onDone }) {
  const handleSubmit = async () => {
    await hostelService.publishMeal(meal.id);
    onDone();
  };
  return (
    <FormModal title={`Publish ${meal.title}?`} submitLabel="Publish Meal" onSubmit={handleSubmit} onClose={onClose}>
      <Detail label="Meal" value={`${meal.title} (${meal.mealType})`} />
      <Detail label="Meal Date" value={meal.mealDate} />
      <Detail label="Menu" value={meal.menuItems.join(", ")} />
      <Detail label="Price" value={money(meal.unitPrice)} />
      <Detail label="Booking" value={`${formatDateTime(meal.bookingOpensAt)} to ${formatDateTime(meal.bookingClosesAt)}`} />
      <Detail label="Collection" value={`${formatDateTime(meal.collectFrom)} to ${formatDateTime(meal.collectUntil)}`} />
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
        Once published, this meal is locked. To correct it you must cancel it and create a new one.
      </p>
    </FormModal>
  );
}

function CancelMeal({ meal, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const isDraft = meal.status === "Draft";
  const handleSubmit = async () => {
    const result = await hostelService.cancelMeal(meal.id, reason);
    onDone(result);
  };
  return (
    <FormModal title={isDraft ? `Delete draft ${meal.title}?` : `Cancel ${meal.title}?`} submitLabel={isDraft ? "Delete Draft" : "Cancel Meal"} onSubmit={handleSubmit} onClose={onClose}>
      {!isDraft && (
        <>
          <p className="text-sm text-slate-600 sm:col-span-2">
            All {meal.totalOrders} order(s) are cancelled. Unpaid charges are cleared; paid ones are kept and listed for refund.
          </p>
          <TextField id="meal-cancel-reason" label="Reason *" value={reason} maxLength={500} onChange={setReason} wide />
        </>
      )}
    </FormModal>
  );
}

function AddOrder({ meal, onClose, onSaved }) {
  const { data: allocations } = useHostelData(hostelService.getAllocations);
  const [search, setSearch] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const members = (allocations || []).filter((item) => item.status === "Allocated");
  const query = search.trim().toLowerCase();
  const matches = members.filter((item) => `${item.studentName} ${item.studentId} ${item.roomLabel}`.toLowerCase().includes(query)).slice(0, 50);

  const handleSubmit = async () => {
    if (!allocationId) throw new Error("Choose a student.");
    await hostelService.bookMeal(meal.id, { allocationId, quantity: Number(quantity) });
    onSaved();
  };

  return (
    <FormModal title={`Order: ${meal.title}`} submitLabel="Place Order" onSubmit={handleSubmit} onClose={onClose}>
      <TextField id="order-search" label="Search Student" value={search} onChange={setSearch} placeholder="Name, ID or room" wide />
      <Field id="order-student" label="Student *" wide>
        <select id="order-student" value={allocationId} onChange={(event) => setAllocationId(event.target.value)} className={inputClass} size={Math.min(6, Math.max(2, matches.length + 1))}>
          <option value="">Select a student...</option>
          {matches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.studentName} ({item.studentId}) · {item.roomLabel}, seat {item.seatNumber}
            </option>
          ))}
        </select>
      </Field>
      <TextField id="order-quantity" label="Quantity *" type="number" min="1" max="20" value={quantity} onChange={setQuantity} />
      <Detail label="Total" value={money((Number(quantity) || 0) * meal.unitPrice)} />
    </FormModal>
  );
}

function MealDetails({ mealId, onClose, onChanged }) {
  const { has } = useHostelPermissions();
  const load = useCallback(() => hostelService.getMeal(mealId), [mealId]);
  const { data, error, reload } = useHostelData(load);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState("");

  const act = async (work) => {
    setActionError("");
    try {
      await work();
      reload();
      onChanged();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const meal = data?.meal;
  const loadImage = useCallback(() => hostelService.getMealImage(mealId), [mealId]);
  const canOrder = has("manage_meals") && meal?.status === "Booking Open";
  const query = search.trim().toLowerCase();
  const orders = (data?.orders || []).filter((item) =>
    `${item.studentName} ${item.studentId} ${item.roomNumber} ${item.status}`.toLowerCase().includes(query)
  );

  return (
    <ViewModal title={meal ? meal.title : "Meal"} onClose={onClose} wide>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {meal && (
        <>
          {meal.hasImage && <ProtectedImage load={loadImage} alt={`Photo of ${meal.title}`} className="h-40 w-full max-w-sm" />}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Detail label="Meal Type" value={meal.mealType} />
            <Detail label="Meal Date" value={meal.mealDate} />
            <div>
              <p className="text-xs text-slate-500">Status</p>
              <div className="mt-1"><StatusBadge status={meal.status} /></div>
            </div>
            <Detail label="Price Per Meal" value={money(meal.unitPrice)} />
            <Detail label="Menu" value={meal.menuItems.join(", ")} />
            <Detail label="Booking" value={`${formatDateTime(meal.bookingOpensAt)} to ${formatDateTime(meal.bookingClosesAt)}`} />
            <Detail label="Collection" value={`${formatDateTime(meal.collectFrom)} to ${formatDateTime(meal.collectUntil)}`} />
            <Detail label="Category" value={meal.category} />
            <Detail label="Total Orders" value={String(meal.totalOrders)} />
            <Detail label="Total Meals" value={String(meal.totalMeals)} />
            <Detail label="Expected Revenue" value={money(meal.expectedRevenue)} />
            {meal.cancelReason && <Detail label="Cancel Reason" value={meal.cancelReason} />}
          </div>
          {meal.description && <p className="text-sm text-slate-600">{meal.description}</p>}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input aria-label="Search orders" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders..." className={`w-full md:max-w-xs ${filterClass}`} />
            {canOrder && <button onClick={() => setAdding(true)} className={primaryButton}>Add Order</button>}
          </div>
          <DataTable
            columns={["Student", "Building / Room / Seat", "Qty", "Unit Price", "Total", "Paid", "Booked", "Status", "Action"]}
            hasRows={orders.length > 0}
            emptyMessage="No orders yet."
            minWidth="min-w-[960px]"
          >
            {orders.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800">{item.studentName}</p>
                  <p className="text-xs text-slate-500">{item.studentId}</p>
                </td>
                <td className="px-3 py-2 text-slate-600">{item.hostelName} · {item.building} · {item.roomNumber} · Seat {item.seatNumber}</td>
                <td className="px-3 py-2 text-slate-600">{item.quantity}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{money(item.unitPrice)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-800">{money(item.totalPrice)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{money(item.paidAmount)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatDateTime(item.bookedAt)}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={item.status} />
                  {item.collectedAt && <p className="mt-1 text-xs text-slate-500">Collected</p>}
                </td>
                <td className="px-3 py-2">
                  {has("manage_meals") && item.status === "Confirmed" && (
                    <div className="flex gap-3 whitespace-nowrap">
                      {canOrder && (
                        <>
                          <button
                            onClick={() => {
                              const value = window.prompt("New quantity", String(item.quantity));
                              if (value) act(() => hostelService.changeMealBooking(item.id, Number(value)));
                            }}
                            aria-label={`Change order of ${item.studentName}`}
                            className={linkButton}
                          >
                            Change
                          </button>
                          <button onClick={() => act(() => hostelService.cancelMealBooking(item.id))} aria-label={`Cancel order of ${item.studentName}`} className={dangerButton}>
                            Cancel
                          </button>
                        </>
                      )}
                      {!item.collectedAt && (
                        <button onClick={() => act(() => hostelService.markMealCollected(item.id))} aria-label={`Mark collected for ${item.studentName}`} className={linkButton}>
                          Collected
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
      {adding && meal && (
        <AddOrder
          meal={meal}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
            onChanged();
          }}
        />
      )}
    </ViewModal>
  );
}

const REFUND_METHODS = ["Cash", "bKash", "Nagad", "Bank Transfer", "Card", "Cheque"];
const loadRefunds = () => hostelService.getRefunds();

function RefundForm({ refund, onClose, onSaved }) {
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const handleSubmit = async () => {
    await hostelService.payRefund(refund.id, { method, reference });
    onSaved();
  };
  return (
    <FormModal title={`Refund ${money(refund.amount)} to ${refund.studentName}`} submitLabel="Record Refund" onSubmit={handleSubmit} onClose={onClose}>
      <SelectField id="refund-method" label="Paid Back By" value={method} onChange={setMethod} options={REFUND_METHODS} />
      <TextField id="refund-reference" label={method === "Cash" ? "Reference (optional)" : "Transaction Reference *"} value={reference} maxLength={100} onChange={setReference} />
      <p className="text-xs text-slate-500 sm:col-span-2">
        Recording the refund reverses the payment on {refund.invoiceNumber} and clears that invoice, so collections and the student&apos;s balance stay correct.
      </p>
    </FormModal>
  );
}

// Money owed back to students for paid orders on cancelled meals.
function MealRefunds() {
  const { has } = useHostelPermissions();
  const { data, error, isLoading, reload } = useHostelData(loadRefunds);
  const [paying, setPaying] = useState(null);
  const [notice, setNotice] = useState("");
  const due = (data || []).filter((item) => item.status === "DUE");
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <ErrorBanner message={error} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <p className="text-sm text-slate-600">{due.length} refund(s) to pay, {money(due.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100)} in total.</p>
      <DataTable columns={["Student", "Invoice", "Reason", "Amount", "Status", "Paid", "Action"]} isLoading={isLoading} hasRows={(data || []).length > 0} emptyMessage="No refunds. Cancelling a meal with paid orders adds them here." minWidth="min-w-[820px]">
        {(data || []).map((item) => (
          <tr key={item.id} className="border-b border-slate-100">
            <td className="px-4 py-3"><p className="font-medium text-slate-800">{item.studentName}</p><p className="text-xs text-slate-500">{item.studentId}</p></td>
            <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.invoiceNumber}</td>
            <td className="px-4 py-3 text-slate-600">{item.reason}</td>
            <td className="px-4 py-3 tabular-nums text-slate-800">{money(item.amount)}</td>
            <td className="px-4 py-3"><StatusBadge status={item.status === "DUE" ? "Due" : "Paid"} /></td>
            <td className="px-4 py-3 text-xs text-slate-600">{item.paidOn ? `${item.paidOn} · ${item.method}${item.reference ? ` (${item.reference})` : ""}` : "—"}</td>
            <td className="px-4 py-3">
              {item.status === "DUE" && has("manage_payments") && (
                <button onClick={() => setPaying(item)} aria-label={`Refund ${item.studentName}`} className={linkButton}>Record Refund</button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      {paying && (
        <RefundForm
          refund={paying}
          onClose={() => setPaying(null)}
          onSaved={() => { setNotice(`Refund to ${paying.studentName} recorded.`); setPaying(null); reload(); }}
        />
      )}
    </div>
  );
}

function MealDues() {
  const { has } = useHostelPermissions();
  const { data, error, reload } = useHostelData(hostelService.getMealDues);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState("");

  const rows = (data || []).filter((item) => `${item.studentName} ${item.studentId} ${item.location}`.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = (data || []).filter((item) => selected.includes(item.allocationId));
  const total = chosen.reduce((sum, item) => sum + Math.round(item.outstanding * 100), 0) / 100;
  const toggle = (id) => setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

  const send = async () => {
    const response = await hostelService.remindMealDues(selected);
    const sent = response.filter((item) => item.queued > 0).length;
    setResult(`${sent} reminder(s) sent. ${response.length - sent} skipped because they were already reminded today.`);
    setSelected([]);
    setConfirming(false);
    reload();
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Meal Dues</h2>
          <p className="text-sm text-slate-500">Students who owe for meals. Reminders above the set amount also go automatically.</p>
        </div>
        {has("send_reminders") && (
          <button disabled={selected.length === 0} onClick={() => setConfirming(true)} className={`${primaryButton} disabled:opacity-50`}>
            Remind Selected ({selected.length})
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}
      <input aria-label="Search meal dues" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student..." className={`mb-3 w-full md:max-w-xs ${filterClass}`} />
      <DataTable columns={["", "Student", "Room / Seat", "Invoices", "Outstanding", "Oldest Due", "Email"]} hasRows={rows.length > 0} emptyMessage="No meal dues." minWidth="min-w-[760px]">
        {rows.map((item) => (
          <tr key={item.allocationId} className="border-b border-slate-100">
            <td className="px-3 py-2">
              <input type="checkbox" aria-label={`Select ${item.studentName}`} checked={selected.includes(item.allocationId)} onChange={() => toggle(item.allocationId)} />
            </td>
            <td className="px-3 py-2"><p className="font-medium text-slate-800">{item.studentName}</p><p className="text-xs text-slate-500">{item.studentId}</p></td>
            <td className="px-3 py-2 text-slate-600">{item.location}</td>
            <td className="px-3 py-2 text-slate-600">{item.invoices}</td>
            <td className="px-3 py-2 font-medium tabular-nums text-red-700">{money(item.outstanding)}</td>
            <td className="px-3 py-2 text-slate-600">{item.oldestDue}</td>
            <td className="px-3 py-2 text-slate-600">{item.hasEmail ? "Yes" : "No email"}</td>
          </tr>
        ))}
      </DataTable>
      {confirming && (
        <FormModal title="Send meal payment reminders?" submitLabel="Send Reminders" onSubmit={send} onClose={() => setConfirming(false)}>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm text-slate-600">{chosen.length} student(s), {money(total)} to collect:</p>
            <ul className="max-h-60 overflow-y-auto text-sm text-slate-700">
              {chosen.map((item) => (
                <li key={item.allocationId} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{item.studentName} ({item.studentId}){item.hasEmail ? "" : " · no email, in-app only"}</span>
                  <span className="tabular-nums">{money(item.outstanding)}</span>
                </li>
              ))}
            </ul>
          </div>
        </FormModal>
      )}
    </section>
  );
}

export default function MealManagement() {
  const { has } = useHostelPermissions();
  const { data, error: loadError, isLoading, reload } = useHostelData(hostelService.getMeals);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("meals");

  const meals = data || [];
  const query = search.trim().toLowerCase();
  const filtered = meals.filter(
    (meal) => `${meal.title} ${meal.mealType} ${meal.mealDate}`.toLowerCase().includes(query) && (statusFilter === "All" || meal.status === statusFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered);
  const canManage = has("manage_meals");
  const done = (message) => {
    setForm(null);
    setNotice(message);
    reload();
  };

  const stats = [
    { label: "Meals", value: meals.length },
    { label: "Booking Open", value: meals.filter((meal) => meal.status === "Booking Open").length, color: "text-green-600" },
    { label: "Orders", value: meals.reduce((sum, meal) => sum + meal.totalOrders, 0), color: "text-blue-600" },
    { label: "Expected Revenue", value: money(meals.reduce((sum, meal) => sum + Math.round(meal.expectedRevenue * 100), 0) / 100), color: "text-indigo-600" },
  ];

  return (
    <PageShell
      title="Meal Management"
      subtitle="Draft a meal, publish it, then take orders until the booking deadline. Each order becomes a meal charge."
      actions={canManage && <button onClick={() => setForm({ type: "new" })} className={primaryButton}>Add New Meal</button>}
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      <div role="group" aria-label="View" className="flex gap-2">
        {[["meals", "Meals"], ["dues", "Meal Dues"], ["refunds", "Refunds"]].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={tab === value ? primaryButton : secondaryButton}>
            {label}
          </button>
        ))}
      </div>

      {tab === "dues" && <MealDues />}
      {tab === "refunds" && <MealRefunds />}
      {tab === "meals" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <ErrorBanner message={loadError} />
          <div className="mb-4 flex flex-col gap-3 md:flex-row">
            <input aria-label="Search meals" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search meals..." className={`w-full md:max-w-md ${filterClass}`} />
            <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterClass}>
              <option value="All">All Status</option>
              {["Draft", "Published", "Booking Open", "Booking Closed", "Completed", "Cancelled"].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <DataTable
            columns={["Meal", "Type", "Date", "Menu", "Price", "Orders", "Meals", "Booking Deadline", "Collection", "Status", "Action"]}
            isLoading={isLoading && !data}
            onRetry={reload}
            hasRows={pageItems.length > 0}
            emptyMessage={meals.length === 0 ? "No meals yet." : "No meals match your search."}
            minWidth="min-w-[1240px]"
          >
            {pageItems.map((meal) => (
              <tr key={meal.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{meal.title}</td>
                <td className="px-4 py-3 text-slate-600">{meal.mealType}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{meal.mealDate}</td>
                <td className="max-w-[14rem] truncate px-4 py-3 text-slate-600" title={meal.menuItems.join(", ")}>{meal.menuItems.join(", ")}</td>
                <td className="px-4 py-3 tabular-nums text-slate-600">{money(meal.unitPrice)}</td>
                <td className="px-4 py-3 text-slate-600">{meal.totalOrders}</td>
                <td className="px-4 py-3 text-slate-600">{meal.totalMeals}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(meal.bookingClosesAt)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(meal.collectFrom)}</td>
                <td className="px-4 py-3"><StatusBadge status={meal.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 whitespace-nowrap">
                    <button onClick={() => setForm({ type: "view", meal })} aria-label={`View ${meal.title}`} className={linkButton}>View</button>
                    {canManage && meal.status === "Draft" && (
                      <>
                        <button onClick={() => setForm({ type: "edit", meal })} aria-label={`Edit ${meal.title}`} className={linkButton}>Edit</button>
                        <button onClick={() => setForm({ type: "publish", meal })} aria-label={`Publish ${meal.title}`} className={linkButton}>Publish</button>
                      </>
                    )}
                    {canManage && meal.status !== "Cancelled" && meal.status !== "Completed" && (
                      <button onClick={() => setForm({ type: "cancel", meal })} aria-label={`${meal.status === "Draft" ? "Delete" : "Cancel"} ${meal.title}`} className={dangerButton}>
                        {meal.status === "Draft" ? "Delete" : "Cancel"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
          <Pager {...pagerProps} />
        </div>
      )}

      {(form?.type === "new" || form?.type === "edit") && (
        <MealForm meal={form.meal} onClose={() => setForm(null)} onSaved={() => done("Meal saved as a draft.")} />
      )}
      {form?.type === "publish" && <PublishPreview meal={form.meal} onClose={() => setForm(null)} onDone={() => done(`${form.meal.title} is published.`)} />}
      {form?.type === "cancel" && (
        <CancelMeal
          meal={form.meal}
          onClose={() => setForm(null)}
          onDone={(result) =>
            done(
              result.deleted
                ? "Draft deleted."
                : result.needsRefund.length
                  ? `Meal cancelled. Refund needed: ${result.needsRefund.map((item) => `${item.studentName} ${money(item.paid)}`).join(", ")}.`
                  : "Meal cancelled. Unpaid charges were cleared."
            )
          }
        />
      )}
      {form?.type === "view" && <MealDetails mealId={form.meal.id} onClose={() => setForm(null)} onChanged={reload} />}
    </PageShell>
  );
}
