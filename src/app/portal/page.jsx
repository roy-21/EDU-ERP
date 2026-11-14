"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authService } from "@/lib/auth";
import { portalApi } from "@/lib/identityServices";
import { ProtectedImage } from "@/app/admin/hostel/_components/hostelViews";
import AssistantChat from "@/components/assistant/AssistantChat";
import VoiceCall from "@/components/assistant/VoiceCall";
import { DataTable, ErrorBanner, StatusBadge, formatDateTime, friendlyError, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";

// A guardian with no linked student gets 404s for bills and meals; that is shown as a message.
const orNull = (promise) => promise.catch((err) => (/linked|No students/.test(err.message) ? null : Promise.reject(err)));

function MealCard({ meal, order, canBook, student, onDone, onError }) {
  const [quantity, setQuantity] = useState(order?.quantity || 1);
  const [isBusy, setIsBusy] = useState(false);
  const loadImage = useCallback(() => portalApi.mealImage(meal.id, student), [meal.id, student]);
  const isOpen = meal.status === "Booking Open";

  const run = async (work, message) => {
    setIsBusy(true);
    try {
      await work();
      onDone(message);
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      {meal.hasImage && <ProtectedImage load={loadImage} alt={`Photo of ${meal.title}`} className="h-36 w-full rounded-none" />}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-800">{meal.title}</h3>
            <p className="text-xs text-slate-500">{meal.mealType} · {meal.mealDate}</p>
          </div>
          <StatusBadge status={meal.status} />
        </div>
        <p className="text-sm text-slate-600">{meal.menuItems.join(", ")}</p>
        <p className="text-sm font-semibold text-slate-800">{money(meal.unitPrice)} per meal</p>
        <p className="text-xs text-slate-500">
          {isOpen ? `Order by ${formatDateTime(meal.bookingClosesAt)}` : meal.status === "Published" ? `Opens ${formatDateTime(meal.bookingOpensAt)}` : "Ordering is closed"} · Collect {formatDateTime(meal.collectFrom)} to {formatDateTime(meal.collectUntil)}
        </p>
        {order && <p className="rounded bg-green-50 px-2 py-1 text-sm text-green-800">You ordered {order.quantity}. {order.outstandingAmount > 0 ? `${money(order.outstandingAmount)} to pay.` : "Paid."}</p>}
        {isOpen && canBook && (
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <label className="text-sm text-slate-600" htmlFor={`qty-${meal.id}`}>Quantity</label>
            <input id={`qty-${meal.id}`} type="number" min="1" max="20" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
            {order ? (
              <>
                <button disabled={isBusy || quantity === order.quantity} onClick={() => run(() => portalApi.changeBooking(order.id, quantity), `Changed your ${meal.title} order to ${quantity}.`)} className={`${secondaryButton} disabled:opacity-50`}>Change</button>
                <button disabled={isBusy} onClick={() => window.confirm(`Cancel your ${meal.title} order?`) && run(() => portalApi.cancelBooking(order.id), `Cancelled your ${meal.title} order.`)} className="text-sm font-medium text-red-600 hover:text-red-800">Cancel</button>
              </>
            ) : (
              <button disabled={isBusy} onClick={() => run(() => portalApi.book(meal.id, quantity), `Ordered ${quantity} × ${meal.title}. It is added to your bills.`)} className={`${primaryButton} disabled:opacity-50`}>Order</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function StudentPortal() {
  const [allowed, setAllowed] = useState(null);
  const [student, setStudent] = useState("");
  const loadAll = useCallback(
    () => Promise.all([portalApi.me(student || undefined), orNull(portalApi.invoices(student || undefined)), orNull(portalApi.meals(student || undefined)), orNull(portalApi.academics(student || undefined)),
      orNull(portalApi.fees(student || undefined)), orNull(portalApi.notices()), orNull(portalApi.library(student || undefined))]),
    [student]
  );
  const { data, error, reload } = useData(loadAll);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("portal_seen_popups") || "[]");
    } catch {
      return [];
    }
  });
  const dismiss = (id) => {
    if (!id) return;
    const next = [...dismissed, id].slice(-100);
    setDismissed(next);
    try {
      localStorage.setItem("portal_seen_popups", JSON.stringify(next));
    } catch {
      // A blocked storage only means the pop-up shows again next time.
    }
  };
  const [openNotice, setOpenNotice] = useState(null);

  useEffect(() => {
    const token = typeof window !== "undefined" && localStorage.getItem("erp_access_token");
    if (!token) {
      window.location.href = "/login?from=/portal";
      return;
    }
    Promise.resolve().then(() => setAllowed(true));
  }, []);

  const pay = async (invoice) => {
    setActionError("");
    try {
      const { url } = await portalApi.payLink(invoice.id, student || undefined);
      window.location.assign(url);
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  if (!allowed) return null;
  const [me, bills, meals, academics, fees, notices, loans] = data || [];
  const popup = (notices || []).find((item) => item.display === "POPUP" && !dismissed.includes(item.id));
  const board = (notices || []).filter((item) => item.display === "BOARD");
  const orders = (meals?.orders || []).filter((item) => item.status === "Confirmed");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">{me?.isGuardian ? "Guardian Portal" : "Student Portal"}</p>
            <h1 className="text-lg font-bold text-slate-800">{!me ? "Loading..." : me.isGuardian ? me.fullName : `${me.fullName} (${me.studentId})`}</h1>
            {me?.isGuardian && me.wards.length > 0 && (
              <label className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-600">
                Student
                <select aria-label="Choose student" value={student || me.studentId || ""} onChange={(e) => setStudent(e.target.value)} className="min-w-0 max-w-full flex-1 rounded border border-slate-300 px-2 py-1 text-sm sm:flex-none">
                  {me.wards.map((ward) => <option key={ward.studentId} value={ward.studentId}>{ward.name} ({ward.studentId}){ward.relationship ? ` · ${ward.relationship}` : ""}</option>)}
                </select>
              </label>
            )}
          </div>
          <button onClick={() => authService.logout()} className={secondaryButton}>Sign Out</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4">
        <ErrorBanner message={error || actionError} onDismiss={actionError ? () => setActionError("") : undefined} />
        {error && <p className="text-sm text-slate-600">If you are staff, use the <Link href="/admin" className="text-blue-700 underline">admin panel</Link>.</p>}
        {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

        {me?.isGuardian && me.wards.length === 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No students are linked to your account yet. Ask the institution office to link your child.</p>
        )}
        {me && (!me.isGuardian || me.wards.length > 0) && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
              <p className="text-xs text-slate-500">Hostel</p>
              {me.hostel ? (
                <>
                  <p className="font-semibold text-slate-800">{me.hostel.room}{me.hostel.seatNumber ? `, seat ${me.hostel.seatNumber}` : ""}</p>
                  <p className="text-sm text-slate-600">{me.hostel.status} · Rent {money(me.hostel.monthlyRent)} a month</p>
                </>
              ) : (
                <p className="text-sm text-slate-600">No hostel seat on record.</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Hostel to pay</p>
              <p className="text-2xl font-bold text-orange-600">{money(bills?.totalOutstanding || 0)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Hostel overdue</p>
              <p className="text-2xl font-bold text-red-600">{money(bills?.totalOverdue || 0)}</p>
            </div>
          </section>
        )}

        {me?.modules?.includes("voice-ai") && (
          <section className="space-y-2">
            <h2 className="font-bold text-slate-800">Ask the assistant</h2>
            <VoiceCall />
            <AssistantChat compact />
          </section>
        )}

        {board.length > 0 && (
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-bold text-slate-800">Notices</h2>
            {board.slice(0, 5).map((item) => (
              <button key={item.id} onClick={() => setOpenNotice(item)} className="block w-full rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50">
                <p className={`font-medium ${item.category === "URGENT" ? "text-red-700" : "text-slate-800"}`}>{item.isPinned ? "📌 " : ""}{item.title}</p>
                <p className="line-clamp-1 text-sm text-slate-500">{item.body}</p>
              </button>
            ))}
          </section>
        )}

        {fees && (fees.invoices.length > 0 || fees.payments.length > 0) && (
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-bold text-slate-800">Tuition &amp; Fees</h2>
              <p className="text-sm text-slate-600">Due <strong className="text-orange-600">{money(fees.totalOutstanding)}</strong>{fees.totalOverdue > 0 && <> · overdue <strong className="text-red-600">{money(fees.totalOverdue)}</strong></>}</p>
            </div>
            <p className="text-xs text-slate-500">Pay at the accounts office. Online payment for tuition is not available yet.</p>
            <DataTable columns={["Invoice", "Title", "Due date", "Amount", "Paid", "Due now", "Status"]} hasRows={fees.invoices.length > 0} emptyMessage="No fee invoices." minWidth="min-w-[640px]">
              {fees.invoices.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{item.invoiceNumber}</td>
                  <td className="px-4 py-2">{item.title}</td>
                  <td className="px-4 py-2">{item.dueDate}</td>
                  <td className="px-4 py-2">{money(item.amountDue)}</td>
                  <td className="px-4 py-2">{money(item.paidAmount)}</td>
                  <td className="px-4 py-2 font-semibold">{money(item.outstanding)}</td>
                  <td className={`px-4 py-2 font-medium ${item.state === "OVERDUE" ? "text-red-600" : item.state === "PAID" ? "text-green-700" : "text-slate-700"}`}>{item.state.charAt(0) + item.state.slice(1).toLowerCase()}</td>
                </tr>
              ))}
            </DataTable>
            {fees.payments.length > 0 && (
              <p className="text-xs text-slate-500">Receipts: {fees.payments.slice(0, 6).map((pay) => `${pay.receiptNumber} (${money(pay.amount)}, ${pay.paidOn})`).join(" · ")}</p>
            )}
          </section>
        )}

        {loans && loans.length > 0 && (
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-bold text-slate-800">Library</h2>
            <DataTable columns={["Book", "Issued", "Due", "Returned", "Fine"]} hasRows={loans.length > 0} emptyMessage="" minWidth="min-w-[520px]">
              {loans.map((loan) => (
                <tr key={loan.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">{loan.bookTitle}</td>
                  <td className="px-4 py-2">{loan.issuedOn}</td>
                  <td className={`px-4 py-2 ${loan.state === "OVERDUE" ? "font-semibold text-red-600" : ""}`}>{loan.dueOn}{loan.state === "OVERDUE" ? ` (${loan.lateDays} days late)` : ""}</td>
                  <td className="px-4 py-2">{loan.returnedOn || "—"}</td>
                  <td className="px-4 py-2">{loan.fineAmount > 0 ? `${money(loan.fineAmount)} · ${loan.fineStatus.toLowerCase()}` : "—"}</td>
                </tr>
              ))}
            </DataTable>
          </section>
        )}

        {(openNotice || popup) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => (openNotice ? setOpenNotice(null) : dismiss(popup?.id))}>
            <div role="dialog" aria-modal="true" aria-label={(openNotice || popup).title} onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-bold text-slate-800">{(openNotice || popup).title}</h2>
              <p className="mt-1 text-xs text-slate-500">{formatDateTime((openNotice || popup).publishAt || (openNotice || popup).publishedAt)}</p>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{(openNotice || popup).body}</p>
              <div className="mt-4 flex justify-end"><button onClick={() => (openNotice ? setOpenNotice(null) : dismiss(popup?.id))} className={primaryButton}>{openNotice ? "Close" : "Got it"}</button></div>
            </div>
          </div>
        )}

        {academics?.enrolled && (
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-bold text-slate-800">Academics</h2>
                <p className="text-sm text-slate-600">{academics.program}{academics.section ? ` · ${academics.section}` : ""}</p>
              </div>
              <div className="flex gap-4 text-sm">
                <p>Attendance <strong className={academics.attendance.overallPercent !== null && academics.attendance.overallPercent < 75 ? "text-red-600" : "text-slate-900"}>{academics.attendance.overallPercent ?? "—"}%</strong></p>
                <p>CGPA <strong className="text-slate-900">{academics.transcript.cgpa === null ? "—" : academics.transcript.cgpa.toFixed(2)}</strong></p>
              </div>
            </div>
            {academics.attendance.classes.length > 0 && (
              <DataTable columns={["Course", "Attended", "Absent", "%"]} hasRows minWidth="min-w-[360px]">
                {academics.attendance.classes.map((row) => (
                  <tr key={row.classId} className="border-b border-slate-100">
                    <td className="px-4 py-2 text-slate-700">{row.courseCode} · {row.courseTitle}</td>
                    <td className="px-4 py-2 text-slate-600">{row.attended}</td>
                    <td className="px-4 py-2 text-slate-600">{row.absent}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{row.percent ?? "—"}</td>
                  </tr>
                ))}
              </DataTable>
            )}
            {academics.transcript.terms.length === 0 && <p className="text-sm text-slate-500">No published results yet.</p>}
            {academics.transcript.terms.map((term) => (
              <div key={`${term.session}-${term.term}`}>
                <p className="mb-1 text-sm font-medium text-slate-700">{term.session} · {term.term} · GPA {term.gpa?.toFixed(2)}</p>
                <DataTable columns={["Course", "Credits", "Grade", "Point"]} hasRows minWidth="min-w-[360px]">
                  {term.courses.map((course) => (
                    <tr key={course.courseCode} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-700">{course.courseCode} · {course.courseTitle}</td>
                      <td className="px-4 py-2 text-slate-600">{course.credits}</td>
                      <td className={`px-4 py-2 font-semibold ${course.passed ? "text-slate-800" : "text-red-600"}`}>{course.letter}</td>
                      <td className="px-4 py-2 text-slate-600">{course.gradePoint.toFixed(2)}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            ))}
          </section>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-bold text-slate-800">My Bills</h2>
          <DataTable columns={["Invoice", "For", "Due", "Amount", "Paid", "Balance", "Status", ""]} isLoading={!data && !error} hasRows={(bills?.invoices || []).length > 0} emptyMessage="No bills." minWidth="min-w-[760px]">
            {(bills?.invoices || []).map((invoice) => (
              <tr key={invoice.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{invoice.invoiceNumber}</td>
                <td className="px-4 py-3 text-slate-700">{invoice.title || invoice.category}</td>
                <td className="px-4 py-3 text-slate-600">{invoice.dueDate}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{money(invoice.amountDue ?? invoice.rentAmount)}</td>
                <td className="px-4 py-3 tabular-nums text-green-700">{money(invoice.paidAmount)}</td>
                <td className="px-4 py-3 tabular-nums text-orange-700">{money(invoice.outstandingAmount)}</td>
                <td className="px-4 py-3"><StatusBadge status={invoice.status} /></td>
                <td className="px-4 py-3">{invoice.outstandingAmount > 0 && <button onClick={() => pay(invoice)} className={primaryButton}>Pay</button>}</td>
              </tr>
            ))}
          </DataTable>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="font-bold text-slate-800">Meals</h2>
            {meals?.summary && <p className="text-sm text-slate-600">{meals.summary.totalMealsOrdered} ordered · {money(meals.summary.totalOutstanding)} unpaid</p>}
          </div>
          {meals && !meals.canBook && <p className="text-sm text-slate-500">{me?.isGuardian ? "Meals are ordered by the student. You can see their orders here." : "Meal ordering is for students with a hostel seat."}</p>}
          {meals && meals.meals.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No meals are open right now.</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(meals?.meals || []).map((meal) => (
              <MealCard
                key={meal.id}
                meal={meal}
                order={orders.find((item) => item.mealId === meal.id)}
                canBook={meals.canBook}
                student={student || undefined}
                onDone={(message) => { setActionError(""); setNotice(message); reload(); }}
                onError={setActionError}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
