import BkashGatewayPanel from "../_components/BkashGatewayPanel";
import IntegrationList from "../_components/IntegrationList";
import { integrationPages } from "../_components/integrationData";

export default function PaymentGatewayPage() {
  return (
    <>
      <BkashGatewayPanel />
      <IntegrationList config={integrationPages.paymentGateway} />
    </>
  );
}