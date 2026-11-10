// src/lib/api.js
// Centralized API Client for NextGen ERP Frontend -> Core ERP Backend (Port 4000)

const CORE_API_BASE_URL =
  process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:4000/api/v1";

/**
 * Standard HTTP Request helper
 */
async function request(endpoint, options = {}) {
  const url = `${CORE_API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  // Default headers (Tenant Context + Correlation ID)
  const headers = {
    "Content-Type": "application/json",
    "X-Tenant-Id": "inst-001",
    "X-Correlation-Id": `fe_${Date.now()}`,
    ...(options.headers || {})
  };

  // Attach token from localStorage if available in browser
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("erp_access_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // The account was disabled, its password changed, or the session expired: sign in again.
      const isSignIn = endpoint.startsWith("/auth/login") || endpoint.startsWith("/auth/change-password");
      if (typeof window !== "undefined" && !isSignIn && headers.Authorization &&
          (response.status === 401 || errorData.code === "PASSWORD_CHANGE_REQUIRED")) {
        localStorage.removeItem("erp_access_token");
        localStorage.removeItem("erp_user");
        document.cookie = "erp_access_token=; path=/; max-age=0";
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
      }
      throw new Error(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const json = await response.json();
    return json.data !== undefined ? json.data : json;
  } catch (err) {
    console.warn(`[Core ERP API Warning] Request to ${url} failed:`, err.message);
    throw err;
  }
}

export const api = {
  get: (endpoint, headers) => request(endpoint, { method: "GET", headers }),
  post: (endpoint, body, headers) =>
    request(endpoint, { method: "POST", body: JSON.stringify(body), headers }),
  put: (endpoint, body, headers) =>
    request(endpoint, { method: "PUT", body: JSON.stringify(body), headers }),
  delete: (endpoint, headers) => request(endpoint, { method: "DELETE", headers })
};

export default api;

