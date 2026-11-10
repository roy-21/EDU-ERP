import NotConnected from "../_components/NotConnected";

export default function PushNotificationPage() {
  return <NotConnected title="Push Notifications" channel="Push notification" needs="a mobile app or a web push service (such as Firebase Cloud Messaging) with its server key" />;
}
