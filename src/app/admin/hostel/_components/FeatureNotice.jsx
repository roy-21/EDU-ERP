import Link from "next/link";

export default function FeatureNotice({ title, message }) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-lg font-bold text-slate-800">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <Link
          href="/admin/hostel"
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          ← Back to Hostel Control Board
        </Link>
      </div>
    </div>
  );
}
