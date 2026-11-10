
export const settingsMenu = [
  {
    title: "General Settings",
    description: "Manage institution-wide application preferences.",
    href: "/admin/settings/general",
    icon: "⚙️",
  },
  {
    title: "Institution Profile",
    description: "Configure institution information and contact details.",
    href: "/admin/settings/institution-profile",
    icon: "🏫",
  },
  {
    title: "Academic Calendar",
    description: "Configure academic years, semesters and holidays.",
    href: "/admin/settings/academic-calendar",
    icon: "📅",
  },
  {
    title: "Timezone",
    description: "Set the system timezone and date preferences.",
    href: "/admin/settings/timezone",
    icon: "🌐",
  },
  {
    title: "Language",
    description: "Manage default language and localization.",
    href: "/admin/settings/language",
    icon: "🌍",
  },
  {
    title: "Theme",
    description: "Configure admin panel appearance preferences.",
    href: "/admin/settings/theme",
    icon: "🎨",
  },
  {
    title: "Branding",
    description: "Manage institution name, colors and identity.",
    href: "/admin/settings/branding",
    icon: "✨",
  },
  {
    title: "Logo",
    description: "Manage institution logos and favicon.",
    href: "/admin/settings/logo",
    icon: "🖼️",
  },
  {
    title: "SMTP Settings",
    description: "Configure outgoing email delivery.",
    href: "/admin/settings/smtp",
    icon: "📧",
  },
  {
    title: "SMS Gateway",
    description: "Configure SMS provider and delivery settings.",
    href: "/admin/settings/sms-gateway",
    icon: "📱",
  },
  {
    title: "Payment Gateway",
    description: "Manage payment provider configurations.",
    href: "/admin/settings/payment-gateway",
    icon: "💳",
  },
  {
    title: "Backup",
    description: "Manage database and file backup settings.",
    href: "/admin/settings/backup",
    icon: "💾",
  },
];

export const settingsPages = {
  general: {
    section: "general",
    title: "General Settings",
    description: "Configure general system preferences.",
    fields: [
      {
        name: "systemName",
        label: "System Name",
        type: "text",
        value: "Education Management System",
      },
      {
        name: "supportEmail",
        label: "Support Email",
        type: "email",
        value: "support@example.com",
      },
      {
        name: "supportPhone",
        label: "Support Phone",
        type: "text",
        value: "+8801XXXXXXXXX",
      },
      {
        name: "maintenanceMode",
        label: "Maintenance Mode",
        type: "checkbox",
        value: false,
      },
      {
        name: "registrationEnabled",
        label: "Allow New Registrations",
        type: "checkbox",
        value: true,
      },
    ],
  },

  institution: {
    section: "institution",
    title: "Institution Profile",
    description: "Manage institution identity and contact information.",
    fields: [
      {
        name: "institutionName",
        label: "Institution Name",
        type: "text",
        value: "Example Education Institute",
      },
      {
        name: "shortName",
        label: "Short Name",
        type: "text",
        value: "EEI",
      },
      {
        name: "institutionEmail",
        label: "Official Email",
        type: "email",
        value: "info@example.com",
      },
      {
        name: "phone",
        label: "Phone Number",
        type: "text",
        value: "+8801XXXXXXXXX",
      },
      {
        name: "address",
        label: "Address",
        type: "textarea",
        value: "Dhaka, Bangladesh",
      },
      {
        name: "website",
        label: "Website",
        type: "text",
        value: "https://example.com",
      },
    ],
  },

  calendar: {
    section: "calendar",
    title: "Academic Calendar",
    description: "Configure the academic year and semester dates.",
    fields: [
      {
        name: "academicYear",
        label: "Current Academic Year",
        type: "text",
        value: "2026-2027",
      },
      {
        name: "startDate",
        label: "Academic Year Start",
        type: "date",
        value: "2026-07-01",
      },
      {
        name: "endDate",
        label: "Academic Year End",
        type: "date",
        value: "2027-06-30",
      },
      {
        name: "semesterCount",
        label: "Number of Semesters",
        type: "number",
        value: "2",
      },
    ],
  },

  timezone: {
    section: "timezone",
    title: "Timezone Settings",
    description: "Configure system timezone and date format.",
    fields: [
      {
        name: "timezone",
        label: "System Timezone",
        type: "select",
        value: "Asia/Dhaka",
        options: [
          { label: "Bangladesh (Asia/Dhaka)", value: "Asia/Dhaka" },
          { label: "India (Asia/Kolkata)", value: "Asia/Kolkata" },
          { label: "UTC", value: "UTC" },
          { label: "London (Europe/London)", value: "Europe/London" },
          { label: "New York (America/New_York)", value: "America/New_York" },
        ],
      },
      {
        name: "dateFormat",
        label: "Date Format",
        type: "select",
        value: "DD/MM/YYYY",
        options: [
          { label: "DD/MM/YYYY", value: "DD/MM/YYYY" },
          { label: "MM/DD/YYYY", value: "MM/DD/YYYY" },
          { label: "YYYY-MM-DD", value: "YYYY-MM-DD" },
        ],
      },
      {
        name: "timeFormat",
        label: "Time Format",
        type: "select",
        value: "12",
        options: [
          { label: "12 Hour", value: "12" },
          { label: "24 Hour", value: "24" },
        ],
      },
    ],
  },

  language: {
    section: "language",
    title: "Language Settings",
    description: "Configure application language preferences.",
    fields: [
      {
        name: "defaultLanguage",
        label: "Default Language",
        type: "select",
        value: "en",
        options: [
          { label: "English", value: "en" },
          { label: "বাংলা", value: "bn" },
          { label: "Arabic", value: "ar" },
        ],
      },
      {
        name: "allowLanguageSwitch",
        label: "Allow Users to Change Language",
        type: "checkbox",
        value: true,
      },
    ],
  },

  theme: {
    section: "theme",
    title: "Theme Settings",
    description: "Configure the default application appearance.",
    fields: [
      {
        name: "defaultTheme",
        label: "Default Theme",
        type: "select",
        value: "light",
        options: [
          { label: "Light", value: "light" },
          { label: "Dark", value: "dark" },
          { label: "System", value: "system" },
        ],
      },
      {
        name: "allowThemeSwitch",
        label: "Allow Users to Change Theme",
        type: "checkbox",
        value: true,
      },
      {
        name: "primaryColor",
        label: "Primary Color",
        type: "color",
        value: "#2563eb",
      },
    ],
  },

  branding: {
    section: "branding",
    title: "Branding Settings",
    description: "Manage institution branding and identity.",
    fields: [
      {
        name: "brandName",
        label: "Brand Name",
        type: "text",
        value: "Education Management System",
      },
      {
        name: "tagline",
        label: "Tagline",
        type: "text",
        value: "Empowering Education Through Technology",
      },
      {
        name: "primaryColor",
        label: "Primary Brand Color",
        type: "color",
        value: "#2563eb",
      },
      {
        name: "secondaryColor",
        label: "Secondary Brand Color",
        type: "color",
        value: "#0f172a",
      },
    ],
  },

  logo: {
    section: "logo",
    title: "Logo Settings",
    description: "Upload and manage institution visual assets.",
    fields: [
      {
        name: "logo",
        label: "Institution Logo",
        type: "file",
        value: "",
      },
      {
        name: "darkLogo",
        label: "Dark Mode Logo",
        type: "file",
        value: "",
      },
      {
        name: "favicon",
        label: "Favicon",
        type: "file",
        value: "",
      },
    ],
  },

  smtp: {
    section: "smtp",
    title: "SMTP Settings",
    description: "Configure outgoing email server settings.",
    fields: [
      {
        name: "host",
        label: "SMTP Host",
        type: "text",
        value: "smtp.example.com",
      },
      {
        name: "port",
        label: "SMTP Port",
        type: "number",
        value: "587",
      },
      {
        name: "username",
        label: "SMTP Username",
        type: "text",
        value: "",
      },
      {
        name: "password",
        label: "SMTP Password",
        type: "password",
        value: "",
      },
      {
        name: "fromEmail",
        label: "Sender Email",
        type: "email",
        value: "noreply@example.com",
      },
      {
        name: "secure",
        label: "Use Secure Connection",
        type: "checkbox",
        value: false,
      },
    ],
  },

  sms: {
    section: "sms",
    title: "SMS Gateway",
    description: "Configure SMS provider credentials and sender settings.",
    fields: [
      {
        name: "provider",
        label: "SMS Provider",
        type: "select",
        value: "custom",
        options: [
          { label: "Custom Gateway", value: "custom" },
          { label: "Twilio", value: "twilio" },
          { label: "SSL Wireless", value: "sslwireless" },
        ],
      },
      {
        name: "apiUrl",
        label: "API URL",
        type: "text",
        value: "",
      },
      {
        name: "apiKey",
        label: "API Key",
        type: "password",
        value: "",
      },
      {
        name: "senderId",
        label: "Sender ID",
        type: "text",
        value: "",
      },
      {
        name: "enabled",
        label: "Enable SMS Gateway",
        type: "checkbox",
        value: false,
      },
    ],
  },

  payment: {
    section: "payment",
    title: "Payment Gateway",
    description: "Configure payment provider and transaction settings.",
    fields: [
      {
        name: "provider",
        label: "Payment Provider",
        type: "select",
        value: "sslcommerz",
        options: [
          { label: "SSLCommerz", value: "sslcommerz" },
          { label: "Stripe", value: "stripe" },
          { label: "PayPal", value: "paypal" },
          { label: "Manual Bank Transfer", value: "bank" },
        ],
      },
      {
        name: "storeId",
        label: "Store ID",
        type: "text",
        value: "",
      },
      {
        name: "storePassword",
        label: "Store Password / Secret",
        type: "password",
        value: "",
      },
      {
        name: "sandbox",
        label: "Sandbox Mode",
        type: "checkbox",
        value: true,
      },
      {
        name: "enabled",
        label: "Enable Payment Gateway",
        type: "checkbox",
        value: false,
      },
    ],
  },

  backup: {
    section: "backup",
    title: "Backup Settings",
    description: "Configure backup schedule and retention preferences.",
    fields: [
      {
        name: "autoBackup",
        label: "Enable Automatic Backup",
        type: "checkbox",
        value: true,
      },
      {
        name: "frequency",
        label: "Backup Frequency",
        type: "select",
        value: "daily",
        options: [
          { label: "Daily", value: "daily" },
          { label: "Weekly", value: "weekly" },
          { label: "Monthly", value: "monthly" },
        ],
      },
      {
        name: "retentionDays",
        label: "Retention Period (Days)",
        type: "number",
        value: "30",
      },
      {
        name: "includeFiles",
        label: "Include Uploaded Files",
        type: "checkbox",
        value: true,
      },
    ],
  },
};
