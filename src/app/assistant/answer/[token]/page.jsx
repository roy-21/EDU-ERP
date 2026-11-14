import AnswerForm from "../AnswerForm";

// The address holds a secret, so it must not leak through search engines or referrers.
export const metadata = {
  title: "Answer a question",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AnswerQuestionPage({ params }) {
  const { token } = await params;
  return <AnswerForm token={token} />;
}
