const AUTO_CONTINUE_KEY = "irctcAutofillContinueState";

function readAutoContinueState() {
    try {
        const state = JSON.parse(sessionStorage.getItem(AUTO_CONTINUE_KEY) || "null");
        return state && state.expiresAt > Date.now() ? state : { remaining: 0, expiresAt: 0 };
    } catch {
        return { remaining: 0, expiresAt: 0 };
    }
}

function writeAutoContinueState(state) {
    try {
        if (state.remaining > 0 || (state.phase?.startsWith("payment-") && state.phase !== "payment-submitting")) {
            sessionStorage.setItem(AUTO_CONTINUE_KEY, JSON.stringify(state));
        }
        else sessionStorage.removeItem(AUTO_CONTINUE_KEY);
    } catch {
        return;
    }
}

let autoContinueState = readAutoContinueState();

function armAutoContinueClicks(count) {
    autoContinueState = { remaining: count, expiresAt: Date.now() + 300000 };
    writeAutoContinueState(autoContinueState);
}

function getVisibleFields() {
    return [...document.querySelectorAll("input, textarea, select")]
        .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !element.disabled;
        });
}

function hasExtensionContext() {
    try {
        return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
    } catch {
        return false;
    }
}

async function setExtensionStorage(values) {
    try {
        if (hasExtensionContext()) await chrome.storage.local.set(values);
    } catch (error) {
        if (!/extension context invalidated/i.test(error?.message || "")) console.warn(error);
    }
}

async function removeExtensionStorage(keys) {
    try {
        if (hasExtensionContext()) await chrome.storage.local.remove(keys);
    } catch (error) {
        if (!/extension context invalidated/i.test(error?.message || "")) console.warn(error);
    }
}

function fieldDescription(element) {
    const labels = [...(element.labels || [])].map((label) => label.textContent || "");
    const parentLabel = element.closest("label")?.textContent || "";
    return [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.id,
        element.getAttribute("formcontrolname"),
        ...labels,
        parentLabel
    ].filter(Boolean).join(" ").toLowerCase();
}

function findFields(fields, keywords) {
    return fields.filter((element) => {
        const description = fieldDescription(element);
        return keywords.some((keyword) => description.includes(keyword));
    });
}

function dispatchValue(element, value) {
    if (!element || value === undefined || value === null || value === "") {
        return false;
    }

    element.focus();
    if (element instanceof HTMLSelectElement) {
        const requested = String(value).trim().toLowerCase();
        const option = [...element.options].find((item) =>
            item.value.trim().toLowerCase() === requested ||
            item.textContent.trim().toLowerCase() === requested
        );
        if (!option) return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        "value"
    );
    const nextValue = element instanceof HTMLSelectElement
        ? [...element.options].find((item) =>
            item.value.trim().toLowerCase() === String(value).trim().toLowerCase() ||
            item.textContent.trim().toLowerCase() === String(value).trim().toLowerCase()
        )?.value
        : value;
    if (nextValue === undefined) return false;
    if (descriptor?.set) descriptor.set.call(element, nextValue);
    else element.value = nextValue;

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
}

function getPassengerNameFields() {
    return findFields(getVisibleFields(), ["passenger name", "traveller name", "full name", "name"]);
}

function findAddPassengerButton() {
    return [...document.querySelectorAll("button, [role='button'], a")].find((element) => {
        const rect = element.getBoundingClientRect();
        const label = [element.textContent, element.getAttribute("aria-label"), element.title]
            .filter(Boolean).join(" ").trim().toLowerCase();
        return rect.width > 0 && rect.height > 0 && !element.disabled &&
            /add\s+(passenger|traveller)/.test(label);
    }) || null;
}

function findActionButton(labelPattern) {
    return [...document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button'], a")]
        .find((element) => {
            const rect = element.getBoundingClientRect();
            const labels = [element.textContent, element.value, element.getAttribute("aria-label"), element.title]
                .filter(Boolean)
                .map((label) => label.replace(/\s+/g, " ").trim().toLowerCase());
            return rect.width > 0 && rect.height > 0 && !element.disabled &&
                element.getAttribute("aria-disabled") !== "true" &&
                labels.some((label) => labelPattern.test(label));
        }) || null;
}

function findContinueButton() {
    const irctcButton = document.querySelector("button.btnDefault.train_Search[type='submit']");
    if (irctcButton && isVisible(irctcButton) && !irctcButton.disabled &&
        irctcButton.getAttribute("aria-disabled") !== "true") {
        return irctcButton;
    }
    return findActionButton(/\bcontinue\b/);
}

function findConfirmationButton() {
    return findActionButton(/^confirm\b/);
}

function findBankTypeOption(labelPattern) {
    return [...document.querySelectorAll(".bank-type")].find((option) =>
        isVisible(option) && option.getAttribute("aria-disabled") !== "true" &&
        labelPattern.test((option.textContent || "").replace(/\s+/g, " ").trim())
    ) || null;
}

function findPaytmUpiOption() {
    const bankOption = findBankTypeOption(/paytm.*upi|upi.*paytm/i) ||
        findBankTypeOption(/\bpaytm\b/i);
    if (bankOption) return bankOption;

    const candidates = [...document.querySelectorAll(
        ".bank-type, [role='radio'], [role='button'], button, label, [tabindex], [aria-label], [title], span, div, img[alt]"
    )]
        .filter(isVisible)
        .map((element) => ({
            element,
            text: [
                element.innerText,
                element.textContent,
                element.getAttribute("aria-label"),
                element.getAttribute("title"),
                element.getAttribute("alt"),
                ...[...(element.querySelectorAll?.("img[alt]") || [])].map((image) => image.alt)
            ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
        }))
        .filter(({ text }) => text.length > 0 && text.length <= 80 && /\bpaytm\b/i.test(text))
        .sort((left, right) => left.text.length - right.text.length);
    const candidate = candidates.find(({ text }) => /paytm.*upi|upi.*paytm/i.test(text)) ||
        candidates[0];
    if (!candidate) return null;

    return candidate.element.closest(".bank-type, [role='radio'], [role='button'], button, label, [tabindex]") ||
        candidate.element.parentElement || candidate.element;
}

function clickPaymentStep(element, nextPhase, description) {
    if (!element || !element.isConnected || element.disabled ||
        element.getAttribute("aria-disabled") === "true") return false;

    autoContinueState.phase = nextPhase;
    autoContinueState.nextActionAfter = Date.now() + 500;
    writeAutoContinueState(autoContinueState);
    console.log(`[IRCTC AutoFill] ${description}`, element, location.href);
    setTimeout(() => {
        if (element.isConnected && !element.disabled && element.getAttribute("aria-disabled") !== "true") {
            element.click();
        }
    }, 100);
    return true;
}

function runAutomaticPaymentFlow() {
    if (!autoContinueState.phase?.startsWith("payment-")) return;
    if (autoContinueState.expiresAt <= Date.now()) {
        autoContinueState = { remaining: 0, expiresAt: 0 };
        writeAutoContinueState(autoContinueState);
        return;
    }
    if (autoContinueState.nextActionAfter > Date.now()) return;

    if (autoContinueState.phase === "payment-upi") {
        clickPaymentStep(
            findBankTypeOption(/bhim\s*\/\s*upi\s*\/\s*ussd/i),
            "payment-paytm-upi",
            "Selecting BHIM/UPI/USSD"
        );
    } else if (autoContinueState.phase === "payment-paytm-upi") {
        const paytmOption = findPaytmUpiOption();
        if (paytmOption) {
            clickPaymentStep(paytmOption, "payment-pay-book", "Selecting Paytm UPI");
        } else if (!autoContinueState.paytmOptionWaitLogged) {
            autoContinueState.paytmOptionWaitLogged = true;
            writeAutoContinueState(autoContinueState);
            const visibleOptions = [...document.querySelectorAll(
                ".bank-type, [role='radio'], [role='button'], button, label, [tabindex], [aria-label], [title]"
            )]
                .filter(isVisible)
                .map((element) => [element.innerText, element.getAttribute("aria-label"), element.title]
                    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
                .filter(Boolean);
            console.warn("[IRCTC AutoFill] Paytm UPI not found yet; visible payment options:", visibleOptions);
        }
    } else if (autoContinueState.phase === "payment-pay-book") {
        const proceedButton = findActionButton(/(?:\bproceed\s*(?:&|and|to)\s*pay(?:ment)?\b|\bpay\s*&\s*book\b)/i);
        if (proceedButton) {
            autoContinueState.phase = "payment-submitting";
            writeAutoContinueState(autoContinueState);
            console.log("[IRCTC AutoFill] Clicking payment proceed button", proceedButton, location.href);
            setTimeout(() => {
                if (proceedButton.isConnected && !proceedButton.disabled &&
                    proceedButton.getAttribute("aria-disabled") !== "true") {
                    proceedButton.click();
                }
            }, 100);
        }
    }
}

function getActionPageSignature() {
    return [...document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button'], a")]
        .filter(isVisible)
        .map((element) => [element.textContent, element.value, element.getAttribute("aria-label"), element.title]
            .filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase())
        .filter(Boolean)
        .join("|");
}

function isBookingReviewPage() {
    const path = location.pathname.toLowerCase();
    const bodyText = (document.body?.innerText || "").toLowerCase();
    return /reviewbooking|booking\/review|review/.test(path) ||
        /review|passenger details|journey details|preview/.test(bodyText);
}

function highlightContinueButton(button, reason = "Continue button detected") {
    if (!button) return false;
    button.style.outline = "3px solid red";
    button.style.outlineOffset = "2px";
    button.setAttribute("data-irctc-autofill-detected", "true");
    console.log(`[IRCTC AutoFill] ${reason}`, button, location.href);
    autoClickContinueButton(button, "Auto-clicking marked Continue button");
    return true;
}

function autoClickContinueButton(button, reason) {
    if (!button || !button.isConnected || button.disabled ||
        button.getAttribute("aria-disabled") === "true" ||
        button.getAttribute("data-irctc-autofill-clicked") === "true" ||
        autoContinueState.expiresAt <= Date.now() || autoContinueState.remaining <= 0) {
        return false;
    }

    autoContinueState.remaining -= 1;
    if (autoContinueState.remaining === 0) autoContinueState.phase = "payment-upi";
    writeAutoContinueState(autoContinueState);
    button.setAttribute("data-irctc-autofill-clicked", "true");
    console.log(`[IRCTC AutoFill] ${reason}`, button, location.href);
    setTimeout(() => {
        if (button.isConnected && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
            button.click();
        }
    }, 100);
    return true;
}

function waitForContinueButtonDebug(maxAttempts = 300) {
    return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            const button = findContinueButton();
            if (button || attempts >= maxAttempts) {
                if (button) highlightContinueButton(button, "Continue button detected");
                resolve(button);
                return;
            }
            attempts += 1;
            setTimeout(check, 200);
        };
        check();
    });
}

async function watchForReviewPageDebug(state) {
    console.log("[IRCTC AutoFill] Watching for review/preview page", state);

    for (let attempt = 0; attempt < 600; attempt += 1) {
        if (Date.now() - state.startedAt > 120000) break;

        if (location.href !== state.sourceUrl || isBookingReviewPage()) {
            const continueButton = await waitForContinueButtonDebug(300);
            if (continueButton) {
                console.log("[IRCTC AutoFill] Review/preview page detected.");
                autoClickContinueButton(continueButton, "Auto-clicking detected Continue button");
                await removeExtensionStorage("autoContinueState");
                return;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log("[IRCTC AutoFill] Review/preview page or Continue button was not detected within the timeout.");
    await removeExtensionStorage("autoContinueState");
}

function startReviewPageObserverDebug() {
    let lastUrl = location.href;
    let timer = null;

    const checkPage = async () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
            runAutomaticPaymentFlow();
            const button = findContinueButton();
            if (button && (isBookingReviewPage() || location.href !== lastUrl)) {
                highlightContinueButton(button, "Review/preview Continue detected");
                autoClickContinueButton(button, "Auto-clicking review/preview Continue button");
            }
            lastUrl = location.href;
        }, 150);
    };

    const observer = new MutationObserver(checkPage);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-disabled", "class", "style", "hidden"]
    });

    window.addEventListener("popstate", checkPage);
    setInterval(() => {
        if (location.href !== lastUrl || autoContinueState.phase?.startsWith("payment-")) checkPage();
    }, 500);
}

function waitForNameFieldCount(previousCount) {
    return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            const count = getPassengerNameFields().length;
            if (count > previousCount || attempts >= 40) {
                resolve(count);
                return;
            }
            attempts += 1;
            setTimeout(check, 100);
        };
        check();
    });
}

function fillPassengerRow(passenger, index) {
    const fields = getVisibleFields();
    const mappings = [
        { key: "name", keywords: ["passenger name", "traveller name", "full name", "name"] },
        { key: "age", keywords: ["age"] },
        { key: "gender", keywords: ["gender", "sex"] },
        { key: "berthType", keywords: ["berth preference", "berth", "preference"] }
    ];
    let filledDetails = 0;
    mappings.forEach(({ key, keywords }) => {
        const field = findFields(fields, keywords)[index];
        if (field && dispatchValue(field, passenger[key])) filledDetails += 1;
    });
    return filledDetails;
}

function paymentRadioDescription(radio) {
    const labels = [...(radio.labels || [])].map((label) => label.textContent || "");
    const labelledBy = (radio.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "");
    const directDescription = [
        radio.value,
        radio.name,
        radio.id,
        radio.getAttribute("aria-label"),
        radio.title,
        ...labels,
        ...labelledBy,
        radio.closest("label")?.textContent
    ].filter(Boolean).join(" ");
    const directText = directDescription.toLowerCase();
    const directHasUpi = /\bupi\b|unified payments? interface/.test(directText);
    const directHasCard = /\bcard\b|credit|debit/.test(directText);
    if (directHasUpi !== directHasCard) return directText;

    let container = radio.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
        const containerText = (container.textContent || "").trim().toLowerCase();
        if (containerText.length > 400) continue;
        const hasUpi = /\bupi\b|unified payments? interface/.test(containerText);
        const hasCard = /\bcard\b|credit|debit/.test(containerText);
        if (hasUpi !== hasCard) return `${directText} ${containerText}`;
    }
    return directText;
}

function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function findPaymentRadio(paymentMode) {
    const wantUpi = paymentMode === "upi";
    return [...document.querySelectorAll('[role="radio"], input[type="radio"]')].find((radio) => {
        if (radio.disabled || radio.getAttribute("aria-disabled") === "true") return false;
        const description = paymentRadioDescription(radio);
        const mentionsUpi = /\bupi\b|unified payments? interface/.test(description);
        const mentionsCard = /\bcard\b|credit|debit/.test(description);
        if (wantUpi ? !mentionsUpi || mentionsCard : !mentionsCard || mentionsUpi) return false;

        const visibleLabel = [...(radio.labels || [])].some(isVisible) ||
            Boolean(radio.closest("label") && isVisible(radio.closest("label")));
        return isVisible(radio) || visibleLabel || Boolean(radio.parentElement && isVisible(radio.parentElement));
    }) || null;
}

let paymentObserver = null;
let paymentObserverTimeout = null;

function trySelectPaymentMode(paymentMode) {
    const radio = findPaymentRadio(paymentMode);
    if (!radio) return false;

    const nativeRadio = radio.matches('input[type="radio"]')
        ? radio
        : radio.closest("p-radiobutton")?.querySelector('input[type="radio"]');
    const isSelected = () => radio.checked === true ||
        radio.getAttribute("aria-checked") === "true" || nativeRadio?.checked === true;
    if (isSelected()) return true;

    if (radio.matches('[role="radio"]')) {
        radio.click();
    } else {
        const visibleLabel = [...(radio.labels || [])].find(isVisible) ||
            (radio.closest("label") && isVisible(radio.closest("label")) ? radio.closest("label") : null);
        (visibleLabel || radio).click();
    }
    if (isSelected()) return true;

    if (nativeRadio && !nativeRadio.checked) {
        nativeRadio.click();
        if (!nativeRadio.checked) {
            nativeRadio.checked = true;
            nativeRadio.dispatchEvent(new Event("input", { bubbles: true }));
            nativeRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }
    return isSelected();
}

function watchForPaymentMode(paymentMode) {
    if (paymentObserver) paymentObserver.disconnect();
    if (paymentObserverTimeout) clearTimeout(paymentObserverTimeout);

    if (trySelectPaymentMode(paymentMode)) {
        setExtensionStorage({ paymentModePending: false });
        return "Payment mode selected.";
    }

    paymentObserver = new MutationObserver(() => {
        if (trySelectPaymentMode(paymentMode)) {
            paymentObserver.disconnect();
            clearTimeout(paymentObserverTimeout);
            setExtensionStorage({ paymentModePending: false });
        }
    });
    paymentObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["checked", "aria-checked", "class", "style", "hidden"]
    });
    paymentObserverTimeout = setTimeout(() => paymentObserver.disconnect(), 300000);
    return `${paymentMode === "upi" ? "UPI" : "Card"} will be selected when payment options appear.`;
}

async function fillPassengerRows(passengers) {
    let filledDetails = 0;
    let filledPassengers = 0;

    for (let index = 0; index < passengers.length; index += 1) {
        let nameFieldCount = getPassengerNameFields().length;
        if (nameFieldCount <= index) {
            const addButton = findAddPassengerButton();
            if (!addButton) break;
            addButton.click();
            nameFieldCount = await waitForNameFieldCount(nameFieldCount);
            if (nameFieldCount <= index) break;
        }

        const rowDetails = fillPassengerRow(passengers[index], index);
        if (rowDetails > 0) filledPassengers += 1;
        filledDetails += rowDetails;
    }

    return { filledDetails, filledPassengers };
}

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        if (message.action === "fillForm") {
            const passengers = Array.isArray(message.passengers)
                ? message.passengers.slice(0, 6)
                : message.profile ? [message.profile] : [];

            (async () => {
                try {
                    const result = await fillPassengerRows(passengers);
                    const paymentMessage = watchForPaymentMode(message.paymentMode === "upi" ? "upi" : "card");
                    const continueButton = result.filledDetails > 0
                        ? await waitForContinueButtonDebug()
                        : null;
                    const autoContinueState = continueButton ? {
                        phase: "review-detect",
                        sourceUrl: location.href,
                        startedAt: Date.now()
                    } : null;
                    if (autoContinueState) {
                        await setExtensionStorage({ autoContinueState });
                    }
                    const continueMessage = continueButton
                        ? " Continue detected; it will be clicked automatically."
                        : result.filledDetails > 0
                            ? " Continue button not found or disabled; review the form."
                            : "";
                    sendResponse({
                        success: result.filledDetails > 0,
                        message: result.filledDetails
                            ? `Filled ${result.filledDetails} details for ${result.filledPassengers} of ${passengers.length} passengers. ${paymentMessage}${continueMessage}`
                            : "No matching passenger fields found. Check that the passenger form is open."
                    });
                    if (continueButton) {
                        armAutoContinueClicks(2);
                        highlightContinueButton(continueButton, "Passenger page Continue detected");
                        watchForReviewPageDebug(autoContinueState);
                    }
                } catch (error) {
                    sendResponse({
                        success: false,
                        message: `Autofill failed: ${error?.message || "unknown page error"}`
                    });
                }
            })();
            return true;
        }

        return false;
    }
);

startReviewPageObserverDebug();
runAutomaticPaymentFlow();

if (hasExtensionContext()) {
    chrome.storage.local.get(["paymentMode", "paymentModePending"]).then(({ paymentMode, paymentModePending }) => {
        if (paymentModePending && (paymentMode === "card" || paymentMode === "upi")) {
            watchForPaymentMode(paymentMode);
        }
    }).catch((error) => {
        if (!/extension context invalidated/i.test(error?.message || "")) console.warn(error);
    });

    chrome.storage.local.get("autoContinueState").then(({ autoContinueState }) => {
        if (!autoContinueState) return;
        if (Date.now() - autoContinueState.startedAt > 120000) {
            removeExtensionStorage("autoContinueState");
            return;
        }
        if (autoContinueState.phase === "review-detect" || autoContinueState.phase === "next-continue" || autoContinueState.phase === "next-confirm") {
            watchForReviewPageDebug(autoContinueState);
        } else {
            watchForReviewPageDebug(autoContinueState);
        }
    }).catch((error) => {
        if (!/extension context invalidated/i.test(error?.message || "")) console.warn(error);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        const paymentMode = changes.paymentMode?.newValue;
        if (areaName === "local" && changes.paymentModePending?.newValue === true &&
            (paymentMode === "card" || paymentMode === "upi")) {
            watchForPaymentMode(paymentMode);
        }
    });
}