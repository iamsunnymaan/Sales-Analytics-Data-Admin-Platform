// Page guard — makes LoginPage.html the mandatory first stop before any other page. Loaded as a
// plain (non-module) blocking <script src> at the very top of every page's <head> EXCEPT
// LoginPage.html itself (same reasoning as theme-init.js: must run before first paint, so a
// logged-out visitor never sees so much as a flash of real page content before being bounced).
//
// "hob-auth-user" is written by LoginPage.js on a successful POST /api/auth/login and cleared by
// Sidebar.js's logout handler — its mere presence is treated as "signed in" here. This is a
// frontend UX gate only, not the real security boundary: nothing stops someone from faking that
// sessionStorage key on its own. The actual enforcement is server-side and covers both API calls
// and page documents: AuthenticationFilter + PermissionInterceptor gate every /api/** request
// against the real HttpSession, and PageAccessInterceptor (see WebConfig) gates every page-document
// request ("/", "/index.html", "/pages/**") the same way — a faked sessionStorage key gets past
// this script but still 401s/403s/redirects the moment it touches either of those, so this remains
// a UX convenience (skip straight to Login instead of bouncing off a 401/redirect after the fact),
// not something real access control depends on.
(function () {
    function redirectToLogin() {
        const here = window.location.pathname + window.location.search;
        window.location.replace(
            "/pages/LoginPage/LoginPage.html?next=" + encodeURIComponent(here));
    }

    try {
        if (sessionStorage.getItem("hob-auth-user")) {
            return;
        }
    } catch (error) {
        // Storage disabled/unavailable — fail open rather than stranding the user on a redirect
        // loop neither of them can escape.
        return;
    }

    // sessionStorage is scoped per tab, not shared across tabs the way the real HttpSession cookie
    // is — a brand-new tab (typed URL, not a duplicated tab) starts with none of it even for a
    // session that's still genuinely valid server-side, and this script would otherwise bounce that
    // still-logged-in user back to Login for no reason (confirmed live: PageAccessInterceptor
    // returns this page's real content with 200, then this redirect fires anyway and throws it
    // away). Confirming against the server first fixes that without weakening anything — every real
    // page this script loads on is already gated server-side by PageAccessInterceptor, so a
    // genuinely unauthenticated visitor never reaches this line at all (the server 302s them to
    // Login before this HTML is ever served); this fetch only ever resolves the ambiguous "valid
    // session, empty tab cache" case, and only redirects once the server itself confirms there's no
    // session.
    fetch("/api/auth/me")
        .then(function (response) {
            if (!response.ok) {
                redirectToLogin();
                return;
            }
            return response.json().then(function (me) {
                try {
                    sessionStorage.setItem("hob-auth-user", JSON.stringify({
                        userId: me.userId,
                        username: me.username,
                        fullName: me.fullName,
                        roles: me.roles
                    }));
                } catch (error) {
                    // Storage disabled — nothing to cache, but the page itself is still authorized
                    // (server already served it), so no redirect needed either.
                }
            });
        })
        .catch(redirectToLogin);
})();
