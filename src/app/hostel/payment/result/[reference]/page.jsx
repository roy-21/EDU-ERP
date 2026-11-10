import PaymentResult from "../../_components/PaymentResult";

export const metadata = {
  title: "Hostel Rent Payment Result",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function HostelPaymentResultPage({ params }) {
  const { reference } = await params;

  return <PaymentResult reference={reference} />;
}

