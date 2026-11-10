import PaymentPortal from "../_components/PaymentPortal";

// The address holds a secret, so it must not leak through search engines or referrers.
export const metadata = {
  title: "Hostel Rent Payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function HostelPaymentPage({ params }) {
  const { token } = await params;

  return <PaymentPortal token={token} />;
}
