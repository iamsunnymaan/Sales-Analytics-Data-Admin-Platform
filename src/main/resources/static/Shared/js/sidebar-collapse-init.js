(function () {
    try {
        if (localStorage.getItem("sidebar-collapsed") === "true") {
            document.documentElement.classList.add("sidebar-collapsed");
        }
    } catch (error) {}
})();
