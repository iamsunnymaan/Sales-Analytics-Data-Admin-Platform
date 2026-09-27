// Super Admin page — SUPERADMIN-role-only. "System / DB Tools" and "Advanced Audit" (the page's
// only two sections) were both removed per explicit request (frontend+backend — see
// SuperAdminPage.html and AuthBootstrapSeeder's PERMISSION_TREE); "Roles & Permissions Matrix" and
// "Feature Bulk Management" were removed earlier the same way. Don't re-add any of them unasked.
// This file's job now is just wiring the shared shell (Sidebar/QuickAccessPanel/permission reveal),
// same convention every other multi-section page in this app already follows, ready for whatever
// section comes next.
import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";

initSidebar();
initQuickAccessPanel();
// Reveals this page's Section-gated elements once the session's real permission set resolves;
// every one of them ships `hidden` in the static HTML itself, so there's no flash of content this
// session doesn't hold permission for.
applyPagePermissions();
