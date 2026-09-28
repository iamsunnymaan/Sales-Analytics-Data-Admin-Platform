(function () {
    const AUTH_STORAGE_KEY = "hob-auth-user";


    function resolveNextUrl() {
        const raw = new URLSearchParams(window.location.search).get("next");
        if (raw && raw.startsWith("/") && !raw.startsWith("//")) {
            return raw;
        }
        return "/";
    }


    if (sessionStorage.getItem(AUTH_STORAGE_KEY)) {
        fetch("/api/auth/me")
            .then(function (response) {
                if (response.ok) {
                    window.location.replace(resolveNextUrl());
                } else {
                    sessionStorage.removeItem(AUTH_STORAGE_KEY);
                }
            })
            .catch(function () {
                sessionStorage.removeItem(AUTH_STORAGE_KEY);
            });
    }

    const passwordInput = document.getElementById("loginPassword");
    const togglePasswordBtn = document.getElementById("loginTogglePassword");
    const togglePasswordIcon = document.getElementById("loginTogglePasswordIcon");

    togglePasswordBtn.addEventListener("click", function () {
        const isPassword = passwordInput.type === "password";
        passwordInput.type = isPassword ? "text" : "password";
        togglePasswordIcon.classList.toggle("bi-eye", !isPassword);
        togglePasswordIcon.classList.toggle("bi-eye-slash", isPassword);
        togglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        togglePasswordBtn.title = isPassword ? "Hide password" : "Show password";
    });

    const form = document.getElementById("loginForm");
    const formError = document.getElementById("loginFormError");
    const userIdInput = document.getElementById("loginUserId");
    const otpInput = document.getElementById("loginOtp");
    const userIdField = userIdInput.closest(".login-field");
    const passwordField = passwordInput.closest(".login-field");
    const otpField = otpInput.closest(".login-field");

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

    [userIdInput, passwordInput, otpInput].forEach(function (input) {
        input.addEventListener("input", function () {
            setFieldError(input.closest(".login-field"), false);
            clearFormError();
        });
    });


    const modeToggle = document.getElementById("loginModeToggle");
    const modePasswordBtn = document.getElementById("loginModePasswordBtn");
    const modeOtpBtn = document.getElementById("loginModeOtpBtn");
    const passwordGroup = document.getElementById("loginPasswordGroup");
    const otpGroup = document.getElementById("loginOtpGroup");
    let loginMode = "password";

    function setLoginMode(mode) {
        loginMode = mode;
        modeToggle.setAttribute("data-active", mode);

        modePasswordBtn.classList.toggle("active", mode === "password");
        modePasswordBtn.setAttribute("aria-selected", mode === "password" ? "true" : "false");
        modeOtpBtn.classList.toggle("active", mode === "otp");
        modeOtpBtn.setAttribute("aria-selected", mode === "otp" ? "true" : "false");

        passwordGroup.classList.toggle("d-none", mode !== "password");
        otpGroup.classList.toggle("d-none", mode !== "otp");

        setFieldError(passwordField, false);
        setFieldError(otpField, false);
        clearFormError();
    }

    modePasswordBtn.addEventListener("click", function () {
        setLoginMode("password");
    });

    modeOtpBtn.addEventListener("click", function () {
        setLoginMode("otp");
    });

    const OTP_COOLDOWN_SECONDS = 30;
    const sendOtpBtn = document.getElementById("loginSendOtpBtn");
    const otpHint = document.getElementById("loginOtpHint");
    let otpCooldownTimer = null;

    function startOtpCooldown() {
        let remaining = OTP_COOLDOWN_SECONDS;
        sendOtpBtn.disabled = true;
        sendOtpBtn.textContent = "Resend in " + remaining + "s";

        otpCooldownTimer = window.setInterval(function () {
            remaining -= 1;
            if (remaining <= 0) {
                window.clearInterval(otpCooldownTimer);
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = "Resend OTP";
                return;
            }
            sendOtpBtn.textContent = "Resend in " + remaining + "s";
        }, 1000);
    }

    sendOtpBtn.addEventListener("click", function () {
        const userIdValid = userIdInput.value.trim().length > 0;
        setFieldError(userIdField, !userIdValid);
        if (!userIdValid) {
            userIdInput.focus();
            return;
        }

        clearFormError();
        sendOtpBtn.disabled = true;
        sendOtpBtn.textContent = "Sending...";

        fetch("/api/auth/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: userIdInput.value.trim() })
        })
            .then(function (response) {
                if (!response.ok) {
                    return extractErrorMessage(response).then(function (message) {
                        throw new Error(message);
                    });
                }
                otpHint.classList.remove("d-none");
                otpInput.focus();
                startOtpCooldown();
            })
            .catch(function (error) {
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = "Send OTP";
                showFormError(error.message);
            });
    });


    const forgotLink = document.getElementById("loginForgotPasswordLink");
    const backToLoginLink = document.getElementById("backToLoginLink");
    const forgotForm = document.getElementById("forgotPasswordForm");
    const forgotError = document.getElementById("forgotPasswordError");
    const forgotSuccess = document.getElementById("forgotPasswordSuccess");
    const forgotEmailInput = document.getElementById("forgotEmail");
    const forgotEmailField = forgotEmailInput.closest(".login-field");
    const forgotSubmitBtn = document.getElementById("forgotPasswordSubmitBtn");
    const forgotSubmitLabel = forgotSubmitBtn.querySelector(".login-submit-label");
    const forgotSubmitSpinner = document.getElementById("forgotPasswordSpinner");

    function showForgotSuccess(message) {
        forgotSuccess.textContent = message;
        forgotSuccess.classList.remove("d-none");
    }

    function clearForgotMessages() {
        forgotError.classList.add("d-none");
        forgotError.textContent = "";
        forgotSuccess.classList.add("d-none");
        forgotSuccess.textContent = "";
    }

    function showForgotForm() {
        clearFormError();
        modeToggle.classList.add("d-none");
        form.classList.add("d-none");
        forgotForm.classList.remove("d-none");
        clearForgotMessages();
        setFieldError(forgotEmailField, false);
        forgotEmailInput.value = "";
        forgotEmailInput.focus();
    }

    function showLoginForm() {
        clearForgotMessages();
        forgotForm.classList.add("d-none");
        modeToggle.classList.remove("d-none");
        form.classList.remove("d-none");
    }

    forgotLink.addEventListener("click", showForgotForm);
    backToLoginLink.addEventListener("click", showLoginForm);

    forgotEmailInput.addEventListener("input", function () {
        setFieldError(forgotEmailField, false);
        clearForgotMessages();
    });

    forgotForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearForgotMessages();

        const email = forgotEmailInput.value.trim();
        const emailValid = email.length > 0;
        setFieldError(forgotEmailField, !emailValid);
        if (!emailValid) {
            forgotEmailInput.focus();
            return;
        }

        forgotSubmitBtn.disabled = true;
        forgotSubmitLabel.textContent = "Sending...";
        forgotSubmitSpinner.classList.remove("d-none");

        fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email })
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
                showForgotSuccess(result.message || "If that email is registered, a reset link has been sent.");
            })
            .catch(function (error) {
                forgotError.textContent = error.message;
                forgotError.classList.remove("d-none");
            })
            .finally(function () {
                forgotSubmitBtn.disabled = false;
                forgotSubmitLabel.textContent = "Send Reset Link";
                forgotSubmitSpinner.classList.add("d-none");
            });
    });

    const submitBtn = document.getElementById("loginSubmitBtn");
    const submitLabel = submitBtn.querySelector(".login-submit-label");
    const submitSpinner = document.getElementById("loginSubmitSpinner");

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        clearFormError();

        const userIdValid = userIdInput.value.trim().length > 0;
        const passwordValid = loginMode !== "password" || passwordInput.value.length > 0;
        const otpValid = loginMode !== "otp" || otpInput.value.trim().length > 0;

        setFieldError(userIdField, !userIdValid);
        setFieldError(passwordField, loginMode === "password" && !passwordValid);
        setFieldError(otpField, loginMode === "otp" && !otpValid);

        if (!userIdValid || !passwordValid || !otpValid) {
            return;
        }

        submitBtn.disabled = true;
        submitLabel.textContent = "Logging in...";
        submitSpinner.classList.remove("d-none");

        fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: userIdInput.value.trim(),
                password: loginMode === "password" ? passwordInput.value : null,
                otp: loginMode === "otp" ? otpInput.value.trim() : null,
                mode: loginMode
            })
        })
            .then(function (response) {
                if (!response.ok) {
                    return extractErrorMessage(response).then(function (message) {
                        throw new Error(message);
                    });
                }
                return response.json();
            })
            .then(function (user) {
                sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
                window.location.href = resolveNextUrl();
            })
            .catch(function (error) {
                submitBtn.disabled = false;
                submitLabel.textContent = "Login";
                submitSpinner.classList.add("d-none");
                showFormError(error.message);
            });
    });
})();
