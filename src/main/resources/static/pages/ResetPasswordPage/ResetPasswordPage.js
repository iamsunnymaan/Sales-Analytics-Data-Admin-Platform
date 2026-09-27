// Reset-password page behavior — wired to POST /api/auth/reset-password (AuthController /
// AuthService.resetPassword). The token comes from this page's own URL (?token=...), the same
// value AuthService.forgotPassword logs/emails as part of the reset link — never typed by hand.
(function () {
    const token = new URLSearchParams(window.location.search).get("token");

    const form = document.getElementById("resetPasswordForm");
    const formError = document.getElementById("resetPasswordError");
    const doneView = document.getElementById("resetPasswordDone");
    const doneMessage = document.getElementById("resetPasswordDoneMessage");

    const newPasswordInput = document.getElementById("newPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const newPasswordField = newPasswordInput.closest(".login-field");
    const confirmPasswordField = confirmPasswordInput.closest(".login-field");

    const toggleBtn = document.getElementById("toggleNewPassword");
    const toggleIcon = document.getElementById("toggleNewPasswordIcon");
    toggleBtn.addEventListener("click", function () {
        const isPassword = newPasswordInput.type === "password";
        newPasswordInput.type = isPassword ? "text" : "password";
        toggleIcon.classList.toggle("bi-eye", !isPassword);
        toggleIcon.classList.toggle("bi-eye-slash", isPassword);
        toggleBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        toggleBtn.title = isPassword ? "Hide password" : "Show password";
    });

    function setFieldError(field, hasError) {
        field.classList.toggle("has-error", hasError);
    }

    function showFormError(message) {
        formError.textContent = message;
        formError.classList.remove("d-none");
    }

    function clearFormError() {
        formError.classList.add("d-none");
        formError.textContent = "";
    }

    function extractErrorMessage(response) {
        return response.json()
            .then(function (body) {
                return body && body.message ? body.message : "Something went wrong. Please try again.";
            })
            .catch(function () {
                return "Something went wrong. Please try again.";
            });
    }

    if (!token) {
        form.classList.add("d-none");
        showFormError("This reset link is missing its token. Please request a new one from the login page.");
        return;
    }

    [newPasswordInput, confirmPasswordInput].forEach(function (input) {
        input.addEventListener("input", function () {
            setFieldError(input.closest(".login-field"), false);
            clearFormError();
        });
    });

    const submitBtn = document.getElementById("resetSubmitBtn");
    const submitLabel = submitBtn.querySelector(".login-submit-label");
    const submitSpinner = document.getElementById("resetSubmitSpinner");

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        clearFormError();

        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        const lengthValid = newPassword.length >= 8;
        const matchValid = newPassword === confirmPassword && confirmPassword.length > 0;

        setFieldError(newPasswordField, !lengthValid);
        setFieldError(confirmPasswordField, lengthValid && !matchValid);

        if (!lengthValid || !matchValid) {
            return;
        }

        submitBtn.disabled = true;
        submitLabel.textContent = "Resetting...";
        submitSpinner.classList.remove("d-none");

        fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token, newPassword: newPassword })
        })
            .then(function (response) {
                if (!response.ok) {
                    return extractErrorMessage(response).then(function (message) {
                        throw new Error(message);
                    });
                }
                return response.json();
            })
            .then(function (result) {
                doneMessage.textContent = result.message || "Your password has been reset. You can now log in.";
                form.classList.add("d-none");
                doneView.classList.remove("d-none");
            })
            .catch(function (error) {
                submitBtn.disabled = false;
                submitLabel.textContent = "Reset Password";
                submitSpinner.classList.add("d-none");
                showFormError(error.message);
            });
    });
})();
