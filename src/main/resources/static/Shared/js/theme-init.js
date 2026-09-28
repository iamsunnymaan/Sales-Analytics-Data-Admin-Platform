(function () {
    try {
        if (localStorage.getItem("hob-theme") === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
        }
    } catch (error) {}
})();
