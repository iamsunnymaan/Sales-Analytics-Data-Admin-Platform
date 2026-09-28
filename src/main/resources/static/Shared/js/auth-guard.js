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

        return;
    }


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

                }
            });
        })
        .catch(redirectToLogin);
})();
