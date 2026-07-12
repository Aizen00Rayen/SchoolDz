// Centralised test-id constants for SchoolDZ.
export const AUTH = {
  loginEmail: "auth-login-email-input",
  loginPassword: "auth-login-password-input",
  loginSubmit: "auth-login-submit-button",
  loginTenantSlug: "auth-login-tenant-input",
  registerName: "auth-register-name-input",
  registerEmail: "auth-register-email-input",
  registerPassword: "auth-register-password-input",
  registerWorkspaceName: "auth-register-workspace-input",
  registerWorkspaceSlug: "auth-register-slug-input",
  registerCenterType: "auth-register-center-type-select",
  registerSubmit: "auth-register-submit-button",
  forgotEmail: "auth-forgot-email-input",
  forgotSubmit: "auth-forgot-submit-button",
  logout: "auth-logout-button",
};

export const MARKETING = {
  navLogin: "marketing-nav-login-link",
  navSignup: "marketing-nav-signup-button",
  heroCtaPrimary: "marketing-hero-cta-primary",
  heroCtaSecondary: "marketing-hero-cta-secondary",
  langSwitcher: "marketing-lang-switcher",
  themeToggle: "marketing-theme-toggle",
};

export const APPUI = {
  sidebar: "app-sidebar",
  sidebarLink: (key) => `app-sidebar-link-${key}`,
  tenantSwitcher: "app-tenant-switcher",
  topbarSearch: "app-topbar-search",
  topbarSearchInput: "app-topbar-search-input",
  topbarSearchResult: (id) => `app-topbar-search-result-${id}`,
  themeToggle: "app-theme-toggle",
  langSwitcher: "app-lang-switcher",
  userMenu: "app-user-menu",
  dashboardKpi: (key) => `dashboard-kpi-${key}`,
  createNew: (module) => `${module}-create-button`,
  formSubmit: (module) => `${module}-form-submit`,
  formCancel: (module) => `${module}-form-cancel`,
  row: (module, id) => `${module}-row-${id}`,
  rowAction: (module, id, action) => `${module}-row-${action}-${id}`,
  attendanceMark: (studentId, status) => `attendance-mark-${status}-${studentId}`,
  attendanceSave: "attendance-save-button",
};

// Backwards-compatible
export const LOGIN = AUTH;
export const HOME = { emergentLink: "marketing-emergent-link" };
