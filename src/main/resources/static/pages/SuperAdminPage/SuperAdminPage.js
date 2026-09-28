import { initSidebar } from "/components/Sidebar/Sidebar.js";
import { initQuickAccessPanel } from "/components/QuickAccessPanel/QuickAccessPanel.js";
import { applyPagePermissions } from "/Shared/js/permission-guard.js";

initSidebar();
initQuickAccessPanel();

applyPagePermissions();
