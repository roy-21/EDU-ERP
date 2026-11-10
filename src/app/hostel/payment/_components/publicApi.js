// These pages have no login and must not send a staff token, so they skip lib/api.
const API_BASE = process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000/api/v1";

export const PUBLIC_API = `${API_BASE}/public/hostel`;

export const publicRequest = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`${PUBLIC_API}${path}`, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("We could not reach the server. Check your connection and try again.");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || "Something went wrong. Please try again.");
    error.status = response.status;
    throw error;
  }
  return json.data;
};

export const money = (value) =>
  `BDT ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export const formatMonth = (value) =>
  new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const TOKEN_KEY = "hostel_payment_token";

export const rememberToken = (token) => {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Only the "back" link needs this, so the page works without it.
  }
};

export const recallToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};
