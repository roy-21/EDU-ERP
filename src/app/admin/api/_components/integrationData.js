export const createIntegration = (
  id,
  name,
  category,
  endpoint,
  status,
  lastSync,
  description,
  extra = {}
) => ({
  id,
  name,
  category,
  endpoint,
  status,
  lastSync,
  description,
  ...extra,
});

export const integrationPages = {
  restApi: {
    title: "REST API",
    description: "Manage REST API endpoints, authentication, requests and API versions.",
    records: [
      createIntegration("API-001", "Student API", "REST API", "/api/v1/students", "Active", "2026-11-02 10:30 AM", "Student information API.", { method: "GET, POST, PATCH, DELETE", auth: "JWT Bearer", version: "v1", requests: 12450 }),
      createIntegration("API-002", "Teacher API", "REST API", "/api/v1/teachers", "Active", "2026-11-02 09:15 AM", "Teacher information API.", { method: "GET, POST, PATCH", auth: "JWT Bearer", version: "v1", requests: 8320 }),
      createIntegration("API-003", "Admission API", "REST API", "/api/v1/admissions", "Under Review", "2026-11-01 04:20 PM", "Admission application API.", { method: "GET, POST", auth: "API Key", version: "v1", requests: 2150 }),
    ],
  },

  graphql: {
    title: "GraphQL",
    description: "Manage GraphQL endpoints, schemas and query access.",
    records: [
      createIntegration("GQL-001", "Main GraphQL API", "GraphQL", "/graphql", "Active", "2026-11-02 10:10 AM", "Main GraphQL endpoint.", { method: "Query, Mutation", auth: "JWT Bearer", schema: "Student, Teacher, Department", requests: 5420 }),
      createIntegration("GQL-002", "Analytics GraphQL", "GraphQL", "/graphql/analytics", "Under Review", "2026-11-01 03:30 PM", "Analytics query endpoint.", { method: "Query", auth: "API Key", schema: "Reports, Attendance, Finance", requests: 1840 }),
    ],
  },

  webhook: {
    title: "Webhook",
    description: "Configure event subscriptions, callback URLs and delivery status.",
    records: [
      createIntegration("WH-001", "Payment Success Hook", "Webhook", "https://example.com/webhooks/payment", "Active", "2026-11-02 10:00 AM", "Receives successful payment events.", { event: "payment.success", method: "POST", retries: 3, deliveries: 1240 }),
      createIntegration("WH-002", "Admission Update Hook", "Webhook", "https://example.com/webhooks/admission", "Active", "2026-11-02 09:40 AM", "Receives admission status changes.", { event: "admission.updated", method: "POST", retries: 5, deliveries: 850 }),
      createIntegration("WH-003", "Attendance Hook", "Webhook", "https://example.com/webhooks/attendance", "Inactive", "2026-10-30 02:10 PM", "Receives attendance events.", { event: "attendance.created", method: "POST", retries: 3, deliveries: 420 }),
    ],
  },

  erpIntegration: {
    title: "ERP Integration",
    description: "Connect external ERP systems and synchronize institutional data.",
    records: [
      createIntegration("ERP-001", "SAP ERP", "ERP Integration", "SAP Connector", "Active", "2026-11-02 08:30 AM", "ERP data synchronization.", { provider: "SAP", syncType: "Two-way", modules: "Finance, HR, Inventory" }),
      createIntegration("ERP-002", "Oracle ERP", "ERP Integration", "Oracle Connector", "Under Review", "2026-11-01 05:00 PM", "Oracle ERP integration setup.", { provider: "Oracle", syncType: "One-way", modules: "Finance, Procurement" }),
    ],
  },

  paymentGateway: {
    title: "Payment Gateway",
    description: "Manage payment provider connections and transaction integration.",
    records: [
      createIntegration("PAY-001", "SSLCommerz", "Payment Gateway", "SSLCommerz API", "Active", "2026-11-02 10:20 AM", "Online payment processing.", { provider: "SSLCommerz", currency: "BDT", environment: "Sandbox", transactions: 4520 }),
      createIntegration("PAY-003", "Nagad", "Payment Gateway", "Nagad API", "Pending", "2026-10-29 11:30 AM", "Nagad payment integration.", { provider: "Nagad", currency: "BDT", environment: "Sandbox", transactions: 0 }),
    ],
  },

  smsGateway: {
    title: "SMS Gateway",
    description: "Connect SMS providers and monitor message delivery.",
    records: [
      createIntegration("SMS-001", "Twilio SMS", "SMS Gateway", "Twilio Messaging API", "Active", "2026-11-02 10:15 AM", "SMS notification provider.", { provider: "Twilio", messages: 15420, deliveryRate: "98.5%" }),
      createIntegration("SMS-002", "Local SMS Provider", "SMS Gateway", "Provider REST API", "Active", "2026-11-02 08:45 AM", "Local SMS gateway connection.", { provider: "Local Gateway", messages: 8200, deliveryRate: "96.2%" }),
    ],
  },

  googleWorkspace: {
    title: "Google Workspace",
    description: "Connect Google services for institutional accounts and collaboration.",
    records: [
      createIntegration("GW-001", "Google Drive", "Google Workspace", "Google Drive API", "Active", "2026-11-02 09:00 AM", "File storage and document access.", { service: "Drive API", scopes: "drive, drive.file", accounts: 250 }),
      createIntegration("GW-002", "Google Calendar", "Google Workspace", "Google Calendar API", "Active", "2026-11-02 08:50 AM", "Academic calendar synchronization.", { service: "Calendar API", scopes: "calendar.events", accounts: 180 }),
      createIntegration("GW-003", "Google Gmail", "Google Workspace", "Gmail API", "Pending", "2026-10-30 12:00 PM", "Institutional email integration.", { service: "Gmail API", scopes: "gmail.send", accounts: 0 }),
    ],
  },

  microsoft365: {
    title: "Microsoft 365",
    description: "Manage Microsoft 365 services and Microsoft Graph connections.",
    records: [
      createIntegration("MS-001", "Microsoft Outlook", "Microsoft 365", "Microsoft Graph API", "Active", "2026-11-02 09:20 AM", "Email and calendar integration.", { service: "Outlook", permissions: "Mail.Send, Calendars.ReadWrite", accounts: 120 }),
      createIntegration("MS-002", "OneDrive", "Microsoft 365", "Microsoft Graph API", "Active", "2026-11-01 04:10 PM", "Cloud file storage integration.", { service: "OneDrive", permissions: "Files.ReadWrite", accounts: 95 }),
      createIntegration("MS-003", "Microsoft Teams", "Microsoft 365", "Microsoft Graph API", "Under Review", "2026-10-31 02:30 PM", "Teams collaboration integration.", { service: "Teams", permissions: "ChannelMessage.Send", accounts: 0 }),
    ],
  },

  voiceGateway: {
    title: "Voice Gateway Integration",
    description: "Manage authorized voice call providers and call routing configurations.",
    records: [
      createIntegration("VG-001", "Twilio Voice", "Voice Gateway", "Twilio Voice API", "Active", "2026-11-02 09:30 AM", "Voice call routing and notification integration.", { provider: "Twilio", routing: "Admission Support", calls: 320, region: "Configured region" }),
      createIntegration("VG-002", "Vonage Voice", "Voice Gateway", "Vonage Voice API", "Pending", "2026-10-30 03:00 PM", "Voice gateway connection setup.", { provider: "Vonage", routing: "Admin Support", calls: 0, region: "Configured region" }),
    ],
  },
};

export const integrationMenu = [
  { key: "restApi", title: "REST API", href: "/admin/api/rest-api", icon: "🔌" },
  { key: "graphql", title: "GraphQL", href: "/admin/api/graphql", icon: "◈" },
  { key: "webhook", title: "Webhook", href: "/admin/api/webhook", icon: "🪝" },
  { key: "erpIntegration", title: "ERP Integration", href: "/admin/api/erp-integration", icon: "🏢" },
  { key: "paymentGateway", title: "Payment Gateway", href: "/admin/api/payment-gateway", icon: "💳" },
  { key: "smsGateway", title: "SMS Gateway", href: "/admin/api/sms-gateway", icon: "💬" },
  { key: "googleWorkspace", title: "Google Workspace", href: "/admin/api/google-workspace", icon: "🌐" },
  { key: "microsoft365", title: "Microsoft 365", href: "/admin/api/microsoft-365", icon: "🪟" },
  { key: "voiceGateway", title: "Voice Gateway", href: "/admin/api/voice-gateway", icon: "📞" },
];