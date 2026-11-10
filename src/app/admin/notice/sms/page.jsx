import NotConnected from "../_components/NotConnected";

export default function SmsPage() {
  return <NotConnected title="SMS" channel="SMS" needs="an account with a Bangladeshi SMS gateway (for example a masking or non-masking sender ID) and its API key on the server" />;
}
