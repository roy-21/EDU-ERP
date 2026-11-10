import api from "./api";

const storeSession = (res) => {
  if (!res?.token || typeof window === "undefined") return;
  localStorage.setItem("erp_access_token", res.token);
  localStorage.setItem("erp_user", JSON.stringify(res.user));
  document.cookie = `erp_access_token=${res.token}; path=/; max-age=28800; SameSite=Lax`;
  if (res.mustChangePassword) localStorage.setItem("erp_must_change_password", "true");
  else localStorage.removeItem("erp_must_change_password");
};

export const authService = {
  login: async ({ username, email, password }) => {
    const res = await api.post("/auth/login", { username, email, password });
    if (res && res.token) {
      if (typeof window !== "undefined") {
        localStorage.setItem("erp_access_token", res.token);
        localStorage.setItem("erp_user", JSON.stringify(res.user));
        // Set cookie for Next.js Middleware Route Protection (8 hours)
        document.cookie = `erp_access_token=${res.token}; path=/; max-age=28800; SameSite=Lax`;

        if (res.mustChangePassword) {
          localStorage.setItem("erp_must_change_password", "true");
        } else {
          localStorage.removeItem("erp_must_change_password");
        }
      }
    }
    return res;
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("erp_access_token");
      localStorage.removeItem("erp_user");
      localStorage.removeItem("erp_must_change_password");
      // Clear cookie immediately
      document.cookie = "erp_access_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      window.location.href = "/login";
    }
  },

  getCurrentUser: () => {
    if (typeof window !== "undefined") {
      const userStr = localStorage.getItem("erp_user");
      if (userStr) {
        try {
          return JSON.parse(userStr);
        } catch {
          return null;
        }
      }
    }
    return null;
  },

  isAuthenticated: () => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("erp_access_token");
      const hasCookie = document.cookie.includes("erp_access_token=");
      return Boolean(token || hasCookie);
    }
    return false;
  },

  // A password change ends older sessions, so the new token replaces the old one.
  changePassword: async ({ username, currentPassword, newPassword }) => {
    const res = await api.post("/auth/change-password", { username, currentPassword, newPassword });
    storeSession(res);
    return res;
  }
};
