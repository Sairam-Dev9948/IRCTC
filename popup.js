const $ = (id) => document.getElementById(id);
const MAX_PASSENGERS = 6;
let passengers = [];
let editingIndex = -1;

function showStatus(message) {
    $("status").textContent = message;
}

function isIRCTCTab(tab) {
    try {
        const url = new URL(tab.url);
        return url.protocol === "https:" &&
            (url.hostname === "irctc.co.in" || url.hostname.endsWith(".irctc.co.in"));
    } catch {
        return false;
    }
}

async function sendAutofillMessage(tab, message) {
    try {
        return await chrome.tabs.sendMessage(tab.id, message);
    } catch (firstError) {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
        });
        return chrome.tabs.sendMessage(tab.id, message);
    }
}

function renderPassengers() {
    const list = $("passengerList");
    list.replaceChildren();
    $("count").textContent = `${passengers.length}/${MAX_PASSENGERS}`;
    $("empty").hidden = passengers.length > 0;
    $("fill").disabled = passengers.length === 0;
    $("addPassenger").disabled = passengers.length >= MAX_PASSENGERS;

    passengers.forEach((passenger, index) => {
        const card = document.createElement("article");
        card.className = "passenger-card";

        const top = document.createElement("div");
        top.className = "passenger-top";
        const title = document.createElement("span");
        title.className = "passenger-title";
        title.textContent = `Passenger ${index + 1}`;
        const actions = document.createElement("div");
        actions.className = "passenger-actions";
        actions.append(createActionButton("Edit", () => openPassengerForm(index)));
        actions.append(createActionButton("Remove", () => removePassenger(index)));
        top.append(title, actions);

        const name = document.createElement("h2");
        name.className = "passenger-name";
        name.textContent = passenger.name || "Not set";
        const details = document.createElement("div");
        details.className = "passenger-details";
        details.textContent = `Age ${passenger.age || "-"} · ${passenger.gender || "Gender not set"} · ${passenger.berthType || "No berth preference"}`;
        card.append(top, name, details);
        list.append(card);
    });
}

function createActionButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
}

function openPassengerForm(index = -1) {
    editingIndex = index;
    const passenger = index >= 0 ? passengers[index] : {};
    $("formTitle").textContent = index >= 0 ? `Edit passenger ${index + 1}` : "New passenger";
    $("name").value = passenger.name || "";
    $("age").value = passenger.age || "";
    $("gender").value = passenger.gender || "";
    $("berthType").value = passenger.berthType || "";
    $("editForm").hidden = false;
    $("name").focus();
}

function closePassengerForm() {
    editingIndex = -1;
    $("editForm").hidden = true;
}

async function savePassengers() {
    await chrome.storage.local.set({ passengers });
    renderPassengers();
}

async function removePassenger(index) {
    passengers.splice(index, 1);
    await savePassengers();
    showStatus("Passenger removed.");
}

$("addPassenger").addEventListener("click", () => openPassengerForm());
$("cancelEdit").addEventListener("click", closePassengerForm);

document.querySelectorAll('input[name="paymentMode"]').forEach((input) => {
    input.addEventListener("change", async () => {
        await chrome.storage.local.set({ paymentMode: input.value });
        showStatus(`${input.value === "upi" ? "UPI" : "Card"} payment selected.`);
    });
});

$("editForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const profile = {
        name: $("name").value.trim(),
        age: $("age").value.trim(),
        gender: $("gender").value,
        berthType: $("berthType").value
    };

    if (!profile.name || !profile.age || Number(profile.age) < 1 || Number(profile.age) > 120) {
        showStatus("Enter a valid passenger name and age.");
        return;
    }

    if (editingIndex >= 0) passengers[editingIndex] = profile;
    else if (passengers.length < MAX_PASSENGERS) passengers.push(profile);
    else {
        showStatus(`A maximum of ${MAX_PASSENGERS} passengers is allowed.`);
        return;
    }

    await savePassengers();
    closePassengerForm();
    showStatus("Passenger details saved on this device.");
});

$("fill").addEventListener("click", async () => {
    if (passengers.length === 0) {
        showStatus("Add at least one passenger first.");
        return;
    }

    const paymentMode = document.querySelector('input[name="paymentMode"]:checked')?.value || "card";
    await chrome.storage.local.set({ paymentMode, paymentModePending: true });

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.id) {
        await chrome.storage.local.set({ paymentModePending: false });
        showStatus("No active tab.");
        return;
    }

    if (!isIRCTCTab(tab)) {
        await chrome.storage.local.set({ paymentModePending: false });
        showStatus("Open an HTTPS IRCTC page before autofilling.");
        return;
    }

    try {
        const response = await sendAutofillMessage(tab, {
            action: "fillForm",
            passengers,
            paymentMode
        });

        showStatus(response?.message || "Autofill complete.");
    } catch (error) {
        console.error(error);
        await chrome.storage.local.set({ paymentModePending: false });
        showStatus(error?.message || "Open an IRCTC booking page and try again.");
    }
});

async function loadPassengers() {
    const saved = await chrome.storage.local.get(["passengers", "profile", "paymentMode"]);
    passengers = Array.isArray(saved.passengers)
        ? saved.passengers.slice(0, MAX_PASSENGERS)
        : saved.profile
            ? [saved.profile]
            : [];
            const paymentMode = saved.paymentMode === "upi" ? "upi" : "card";
            document.querySelector(`input[name="paymentMode"][value="${paymentMode}"]`).checked = true;
    renderPassengers();
    showStatus(passengers.length ? "Passenger group ready." : "Add passengers to create your group.");
}

loadPassengers();
