// Turns a browser's User-Agent text into "Chrome 126 · Windows · Desktop". No outside lookups.
export type Device = { browser: string; os: string; type: string; summary: string };

const version = (ua: string, pattern: RegExp) => ua.match(pattern)?.[1]?.split(".")[0] || "";

export const describeDevice = (ua: string): Device | null => {
  if (!ua) return null;
  let browser = "Unknown browser";
  if (/PostmanRuntime/i.test(ua)) browser = "Postman";
  else if (/^curl\//i.test(ua)) browser = "curl";
  else if (/^node|undici|axios/i.test(ua)) browser = "Script (Node.js)";
  else if (/Edg\//.test(ua)) browser = `Edge ${version(ua, /Edg\/([\d.]+)/)}`;
  else if (/OPR\//.test(ua)) browser = `Opera ${version(ua, /OPR\/([\d.]+)/)}`;
  else if (/SamsungBrowser\//.test(ua)) browser = `Samsung Internet ${version(ua, /SamsungBrowser\/([\d.]+)/)}`;
  else if (/Firefox\//.test(ua)) browser = `Firefox ${version(ua, /Firefox\/([\d.]+)/)}`;
  else if (/Chrome\//.test(ua)) browser = `Chrome ${version(ua, /Chrome\/([\d.]+)/)}`;
  else if (/Version\/[\d.]+.*Safari\//.test(ua)) browser = `Safari ${version(ua, /Version\/([\d.]+)/)}`;

  let os = "Unknown system";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.[23]/.test(ua)) os = "Windows 8";
  else if (/Windows NT 6\.1/.test(ua)) os = "Windows 7";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(ua)) os = `iOS ${version(ua, /OS (\d+)_/)}`.trim();
  else if (/Android/.test(ua)) os = `Android ${version(ua, /Android ([\d.]+)/)}`.trim();
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? "Tablet"
    : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : /Windows|Mac OS X|Linux|CrOS/.test(ua) ? "Desktop" : "Other";
  return { browser, os, type, summary: `${browser} · ${os} · ${type}` };
};

// Private and local addresses are named instead of shown as if they were on the internet.
export const describeIp = (ip: string): string => {
  if (!ip) return "";
  if (ip === "::1" || ip.startsWith("127.")) return "This server (local)";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(ip)) return "Private network";
  return "Internet";
};
