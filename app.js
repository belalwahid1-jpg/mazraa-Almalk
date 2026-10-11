const DAY_COUNT = 42;
const TRADER_COUNT = 70;
const MAX_INVOICE_SIZE = 8 * 1024 * 1024;
const arabicNumber = new Intl.NumberFormat("ar-EG");
const moneyNumber = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const invoiceTypes = { feed: "علف", electricity: "كهرباء", treatment: "علاج" };
const invoiceMimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const apiHost = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "127.0.0.1"
  : window.location.hostname;
const apiBaseUrl = `http://${apiHost}:8123`;

let state = null;

const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const appShell = document.querySelector("#app-shell");
const farmForm = document.querySelector("#farm-form");
const farmMessage = document.querySelector("#farm-message");
const dailyMessage = document.querySelector("#daily-message");
const dailyBody = document.querySelector("#daily-table-body");
const tradersForm = document.querySelector("#traders-form");
const traderProfiles = document.querySelector("#trader-profiles");
const tradersMessage = document.querySelector("#traders-message");
const gasForm = document.querySelector("#gas-form");
const gasMessage = document.querySelector("#gas-message");
const expenseForm = document.querySelector("#expense-form");
const expenseMessage = document.querySelector("#expense-message");
const workerRecordForm = document.querySelector("#worker-record-form");
const workerRecordMessage = document.querySelector("#worker-record-message");

function setFormMessage(element, text, state = "idle") {
  element.textContent = text;
  element.dataset.state = state;
}

function apiUrl(path) {
  return new URL(path, apiBaseUrl).toString();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormMessage(loginMessage, "");
  if (!loginForm.reportValidity()) return;

  const button = loginForm.querySelector('[type="submit"]');
  const credentials = new FormData(loginForm);
  button.disabled = true;
  button.textContent = "جارٍ التحقق...";
  try {
    await requestJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: credentials.get("username"),
        password: credentials.get("password"),
      }),
    });
    loginForm.reset();
    loginScreen.hidden = true;
    appShell.hidden = false;
    await initialize(true);
  } catch (error) {
    setFormMessage(loginMessage, error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "تسجيل الدخول";
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  const button = document.querySelector("#logout-button");
  button.disabled = true;
  try {
    await requestJson("/api/logout", { method: "POST" });
    state = null;
    appShell.hidden = true;
    loginScreen.hidden = false;
    loginForm.reset();
    loginForm.elements.username.value = "01044147246";
    setFormMessage(loginMessage, "");
  } catch (error) {
    farmMessage.textContent = `تعذر تسجيل الخروج: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

function blankTrader() {
  return {
    name: "",
    phone: "",
    date: "",
    entries: Array.from({ length: 30 }, () => ({ empty: "", outstanding: "", total: "", price: "" })),
  };
}

function normalizeTrader(trader) {
  const normalized = {
    ...blankTrader(),
    ...(trader && typeof trader === "object" ? trader : {}),
  };
  normalized.name = typeof normalized.name === "string" ? normalized.name : "";
  normalized.phone = typeof normalized.phone === "string" ? normalized.phone : "";

  const savedEntries = Array.isArray(trader?.entries) ? trader.entries : [];
  const firstSavedDate = savedEntries.find((entry) => entry && typeof entry.date === "string" && entry.date)?.date;
  normalized.date = typeof trader?.date === "string"
    ? trader.date
    : typeof firstSavedDate === "string" ? firstSavedDate : "";
  normalized.entries = Array.from({ length: 30 }, (_, index) => ({
    empty: "",
    outstanding: "",
    total: "",
    price: "",
    ...(savedEntries[index] && typeof savedEntries[index] === "object" ? {
      empty: savedEntries[index].empty ?? savedEntries[index].amount ?? "",
      outstanding: savedEntries[index].outstanding ?? "",
      total: savedEntries[index].total ?? "",
      price: savedEntries[index].price ?? "",
    } : {}),
  }));
  if (savedEntries.length === 0) {
    normalized.entries[0].outstanding = String(trader?.outstanding ?? "");
    normalized.entries[0].total = String(trader?.total ?? "");
  }
  delete normalized.outstanding;
  delete normalized.total;
  return normalized;
}

function normalizeState(value) {
  const savedTraders = Array.isArray(value.traders) ? value.traders : [];
  const legacyFarmRecords = Array.isArray(value.farmRecords) ? value.farmRecords : [];
  const cycle = value.cycle && typeof value.cycle === "object"
    ? value.cycle
    : legacyFarmRecords.length
      ? legacyFarmRecords[legacyFarmRecords.length - 1]
      : null;
  return {
    cycle: cycle ? {
      date: typeof cycle.date === "string" ? cycle.date : "",
      chicks: cycle.chicks ?? "",
      workers: cycle.workers ?? "",
    } : null,
    dailyRecords: Array.isArray(value.dailyRecords) ? value.dailyRecords : [],
    invoiceRecords: Array.isArray(value.invoiceRecords) ? value.invoiceRecords : [],
    gasRecords: Array.isArray(value.gasRecords) ? value.gasRecords : [],
    extraExpenses: Array.isArray(value.extraExpenses) ? value.extraExpenses : [],
    workerRecords: Array.isArray(value.workerRecords) ? value.workerRecords : [],
    traders: Array.from({ length: TRADER_COUNT }, (_, index) => normalizeTrader(savedTraders[index])),
  };
}

function renderWorkerRecords() {
  const tbody = document.querySelector("#worker-records");
  const records = [...state.workerRecords].sort((left, right) => right.date.localeCompare(left.date));
  tbody.replaceChildren();

  records.forEach((record, index) => {
    const row = document.createElement("tr");
    [
      record.worker,
      formatDate(record.date),
      record.attendance,
      record.advance ? formatMoney(record.advance) : "—",
      record.leaveDays ? formatNumber(record.leaveDays) : "—",
      record.notes || "—",
    ].forEach((value, columnIndex) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (columnIndex === 2) {
        cell.className = record.attendance === "غياب" ? "attendance-absent" : "attendance-present";
      }
      row.append(cell);
    });

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.className = "delete-record";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `حذف سجل ${record.worker} بتاريخ ${formatDate(record.date)}`);
    removeButton.addEventListener("click", async () => {
      if (!window.confirm("متأكد إنك عايز تحذف سجل العامل؟")) return;
      const previousRecords = state.workerRecords;
      state.workerRecords = previousRecords.filter((item) => item.id !== record.id);
      try {
        await saveState();
        renderWorkerRecords();
        workerRecordMessage.textContent = "تم حذف سجل العامل.";
      } catch (error) {
        state.workerRecords = previousRecords;
        renderWorkerRecords();
        workerRecordMessage.textContent = `تعذر حذف السجل: ${error.message}`;
      }
    });
    actionCell.append(removeButton);
    row.append(actionCell);
    tbody.append(row);
  });

  document.querySelector("#worker-record-count").textContent = `${formatNumber(records.length)} سجل`;
  document.querySelector("#worker-records-empty").hidden = records.length > 0;
  document.querySelector("#worker-advance-total").textContent = formatMoney(
    records.reduce((sum, record) => sum + (Number(record.advance) || 0), 0),
  );
  document.querySelector("#worker-leave-total").textContent = formatNumber(
    records.reduce((sum, record) => sum + (Number(record.leaveDays) || 0), 0),
  );
}

function makeExpenseTableRow(expense, index) {
  const row = document.createElement("tr");
  [
    formatDate(expense.date),
    expense.item,
    expense.notes || "—",
    expense.amount === "" || expense.amount == null ? "—" : formatMoney(expense.amount),
  ].forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = value || "—";
    row.append(cell);
  });
  const actionCell = document.createElement("td");
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-record";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.setAttribute("aria-label", `حذف المصروف ${formatNumber(index + 1)}`);
  deleteButton.addEventListener("click", async () => {
    if (!window.confirm("متأكد إنك عايز تحذف المصروف؟")) return;
    const previousExpenses = state.extraExpenses;
    state.extraExpenses = previousExpenses.filter((item) => item.id !== expense.id);
    try {
      await saveState();
      renderExpenses();
      expenseMessage.textContent = "تم حذف المصروف.";
    } catch (error) {
      state.extraExpenses = previousExpenses;
      renderExpenses();
      expenseMessage.textContent = `تعذر حذف المصروف: ${error.message}`;
    }
  });
  actionCell.append(deleteButton);
  row.append(actionCell);
  return row;
}

function renderExpenses() {
  const body = document.querySelector("#expense-records");
  const records = [...state.extraExpenses].sort((left, right) =>
    String(right.date || "").localeCompare(String(left.date || "")),
  );
  body.replaceChildren();
  records.forEach((expense, index) => body.append(makeExpenseTableRow(expense, index)));
  document.querySelector("#expense-empty").hidden = records.length > 0;
  document.querySelector("#expense-count").textContent = `${formatNumber(records.length)} مصروف`;
  const total = records.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  document.querySelector("#expenses-total-card").textContent = formatMoney(total);
}

async function requestJson(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    ...options,
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText.replace(/^\uFEFF/, ""));
  } catch {
    const contentType = response.headers.get("content-type") || "نوع محتوى غير محدد";
    const excerpt = responseText.trim().replace(/\s+/g, " ").slice(0, 120);
    const detail = excerpt ? ` الرد: ${excerpt}` : " الرد فارغ.";
    throw new Error(`رد الخادم غير مفهوم (${response.status}، ${contentType}).${detail}`);
  }
  if (!response.ok) throw new Error(result.error || `تعذر إكمال الطلب (${response.status}).`);
  return result;
}

async function saveState() {
  await requestJson("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
}

function formatNumber(value) {
  return arabicNumber.format(Number(value) || 0);
}

function formatMoney(value) {
  return `${moneyNumber.format(Number(value) || 0)} جنيه`;
}

function formatDate(dateValue) {
  if (!dateValue) return "—";
  const date = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dateValue : dateFormatter.format(date);
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cycleDate(day) {
  if (!state.cycle?.date) return "";
  const date = new Date(`${state.cycle.date}T00:00:00`);
  date.setDate(date.getDate() + day - 1);
  return localIsoDate(date);
}

function cycleDayForDate(dateValue) {
  if (!state.cycle?.date || !dateValue) return null;
  const date = new Date(`${dateValue}T00:00:00`);
  const start = new Date(`${state.cycle.date}T00:00:00`);
  const day = Math.floor((date - start) / 86400000) + 1;
  return day >= 1 && day <= DAY_COUNT ? day : null;
}

function getDailyRecord(day) {
  let record = state.dailyRecords.find((entry) => Number(entry.day) === day);
  if (!record) {
    record = { day, date: cycleDate(day), feedBags: "", mortality: "", temperature: "" };
    state.dailyRecords.push(record);
  }
  record.date = cycleDate(day);
  return record;
}

function validateImage(file) {
  if (!file) throw new Error("اختَر صورة الفاتورة أولًا.");
  if (!Object.values(invoiceMimeTypes).includes(file.type)) {
    throw new Error("صيغة الصورة غير مدعومة. اختَر JPG أو PNG أو WebP.");
  }
  if (file.size > MAX_INVOICE_SIZE) throw new Error("حجم الصورة أكبر من ٨ ميجابايت.");
  const extension = `.${file.name.split(".").pop().toLowerCase()}`;
  if (invoiceMimeTypes[extension] !== file.type) throw new Error("امتداد الملف لا يطابق نوع الصورة.");
  return extension;
}

async function uploadImage(file) {
  const extension = validateImage(file);
  return requestJson("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": file.type, "X-Upload-Extension": extension },
    body: file,
  });
}

function renderCycleForm() {
  if (!state.cycle) return;
  farmForm.querySelector('[name="date"]').value = state.cycle.date;
  farmForm.querySelector('[name="chicks"]').value = state.cycle.chicks;
  farmForm.querySelector('[name="workers"]').value = state.cycle.workers;
}

function renderDailyTable() {
  dailyBody.replaceChildren();
  for (let day = 1; day <= DAY_COUNT; day += 1) {
    const record = getDailyRecord(day);
    const row = document.createElement("tr");
    const dayCell = document.createElement("td");
    dayCell.className = "cycle-day-number";
    dayCell.textContent = formatNumber(day);
    row.append(dayCell);

    const dateCell = document.createElement("td");
    dateCell.className = "cycle-date-cell";
    dateCell.textContent = formatDate(record.date) === "—" ? "حدد بداية الدورة" : formatDate(record.date);
    row.append(dateCell);

    [
      { key: "feedBags", label: "عدد شكاير العلف", step: "1" },
      { key: "mortality", label: "عدد النافق", step: "1" },
      { key: "temperature", label: "درجة الحرارة", step: "0.1" },
    ].forEach((field) => {
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.className = "cycle-input";
      input.type = "number";
      input.min = "0";
      input.step = field.step;
      input.value = record[field.key] ?? "";
      input.placeholder = "—";
      input.setAttribute("aria-label", `${field.label}، اليوم ${day}`);
      input.addEventListener("input", () => {
        record[field.key] = input.value;
        dailyMessage.textContent = "فيه تعديلات غير محفوظة في الجدول.";
      });
      cell.append(input);
      row.append(cell);
    });
    dailyBody.append(row);
  }
}

function updateFarmSummary() {
  const currentDay = state.cycle?.date
    ? Math.floor((new Date(`${localIsoDate()}T00:00:00`) - new Date(`${state.cycle.date}T00:00:00`)) / 86400000) + 1
    : 0;
  document.querySelector("#cycle-subtitle").textContent = state.cycle?.date
    ? `بداية الدورة ${formatDate(state.cycle.date)} — ${currentDay > 0 ? `عمر الكتكوت اليوم ${formatNumber(currentDay)} من ٤٢ يومًا.` : "موعد دخول الكتاكيت لم يأتِ بعد."}`
    : "أدخل تاريخ دخول الكتاكيت لحساب تواريخ الأيام الـ٤٢ تلقائيًا.";
  document.querySelector("#current-age").textContent = currentDay > 0
    ? currentDay > DAY_COUNT ? "انتهت دورة الـ٤٢ يومًا" : `عمر الكتكوت: اليوم ${formatNumber(currentDay)}`
    : "العمر: لم تبدأ الدورة";
}

function updateTraderTotals() {
  const totalsForTrader = (trader) => trader.entries.reduce((totals, entry) => {
    totals.outstanding += Number(entry.outstanding) || 0;
    totals.total += Number(entry.total) || 0;
    return totals;
  }, { outstanding: 0, total: 0 });
  const totals = state.traders.reduce((grand, trader) => {
    const traderTotals = totalsForTrader(trader);
    grand.outstanding += traderTotals.outstanding;
    grand.total += traderTotals.total;
    return grand;
  }, { outstanding: 0, total: 0 });
  document.querySelector("#traders-total-card").textContent = formatMoney(totals.outstanding);
  document.querySelector("#traders-total-cell").textContent = formatMoney(totals.outstanding);
  document.querySelector("#traders-total-footer").textContent = formatMoney(totals.total);
}

function renderTraderDetails(details, trader, traderIndex) {
  const container = details.querySelector(".trader-details-content");
  container.replaceChildren();

  const identity = document.createElement("div");
  identity.className = "trader-identity";
  [
    { key: "name", label: "اسم التاجر", placeholder: "اكتب اسم التاجر" },
    { key: "phone", label: "رقم التليفون", placeholder: "اكتب رقم التليفون", type: "tel" },
    { key: "date", label: "تاريخ الاستلام", type: "date" },
  ].forEach((field) => {
    const label = document.createElement("label");
    label.className = "field";
    const caption = document.createElement("span");
    caption.textContent = field.label;
    const input = document.createElement("input");
    input.type = field.type || "text";
    input.name = `trader-${field.key}-${traderIndex}`;
    input.value = trader[field.key];
    input.placeholder = field.placeholder;
    input.setAttribute("aria-label", `${field.label} للتاجر ${formatNumber(traderIndex + 1)}`);
    if (field.type === "tel") input.inputMode = "tel";
    input.addEventListener("input", () => {
      trader[field.key] = input.value;
      details.querySelector(".trader-summary-name").textContent =
        input.value.trim() || `بيانات التاجر رقم ${formatNumber(traderIndex + 1)}`;
      details.querySelector(".trader-summary-phone").textContent = trader.date
        ? `${trader.phone || "رقم التليفون غير مسجل"} · ${formatDate(trader.date)}`
        : trader.phone || "أضف الاسم ورقم التليفون";
      filterTraderProfiles();
    });
    label.append(caption, input);
    identity.append(label);
  });
  container.append(identity);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap trader-entries-wrap";
  const table = document.createElement("table");
  table.className = "data-table trader-entries-table";

  const thead = document.createElement("thead");
  const heading = document.createElement("tr");
  ["رقم الصف", "فارغ", "قائم", "إجمالي", "سعر"].forEach((title) => {
    const th = document.createElement("th");
    th.textContent = title;
    heading.append(th);
  });
  thead.append(heading);
  table.append(thead);

  const tbody = document.createElement("tbody");
  trader.entries.forEach((entry, entryIndex) => {
    const row = document.createElement("tr");
    const rowNumber = document.createElement("td");
    rowNumber.className = "row-number";
    rowNumber.textContent = formatNumber(entryIndex + 1);
    row.append(rowNumber);

    [
      { key: "empty", type: "number", label: "فارغ", cellClass: "trader-entry-amount" },
      { key: "outstanding", type: "number", label: "المبلغ القائم", cellClass: "trader-entry-outstanding" },
      { key: "total", type: "number", label: "الإجمالي", cellClass: "trader-entry-total" },
      { key: "price", type: "number", label: "السعر", cellClass: "trader-entry-price" },
    ].forEach((field) => {
      const cell = document.createElement("td");
      cell.className = field.cellClass;
      const input = document.createElement("input");
      input.className = "trader-input";
      input.type = field.type;
      input.name = `trader-${traderIndex}-entry-${entryIndex}-${field.key}`;
      input.value = entry[field.key] ?? "";
      input.setAttribute("aria-label", `${field.label}، صف ${formatNumber(entryIndex + 1)} للتاجر ${formatNumber(traderIndex + 1)}`);
      if (field.type === "number") {
        input.min = "0";
        input.step = "0.01";
        input.inputMode = "decimal";
      }
      input.addEventListener("input", () => {
        entry[field.key] = input.value;
        const completedEntries = trader.entries.filter((item) =>
          item.empty || item.outstanding || item.total || item.price,
        ).length;
        details.querySelector(".trader-entry-count").textContent =
          `${formatNumber(completedEntries)} / ${formatNumber(30)} حركة`;
        updateSingleTraderTotals(details, trader);
        updateTraderTotals();
      });
      cell.append(input);
      row.append(cell);
    });
    tbody.append(row);
  });
  table.append(tbody);

  const tfoot = document.createElement("tfoot");
  const totalsRow = document.createElement("tr");
  const totalLabel = document.createElement("th");
  totalLabel.colSpan = 1;
  totalLabel.textContent = "مجموع التاجر";
  totalsRow.append(totalLabel);
  ["empty", "outstanding", "total", "price"].forEach((key) => {
    const cell = document.createElement("td");
    cell.dataset.traderTotal = key;
    totalsRow.append(cell);
  });
  tfoot.append(totalsRow);
  table.append(tfoot);
  tableWrap.append(table);
  container.append(tableWrap);
  updateSingleTraderTotals(details, trader);
}

function updateSingleTraderTotals(details, trader) {
  const totals = trader.entries.reduce((result, entry) => {
    result.empty += Number(entry.empty) || 0;
    result.outstanding += Number(entry.outstanding) || 0;
    result.total += Number(entry.total) || 0;
    result.price += Number(entry.price) || 0;
    return result;
  }, { empty: 0, outstanding: 0, total: 0, price: 0 });
  Object.entries(totals).forEach(([key, value]) => {
    const cell = details.querySelector(`[data-trader-total="${key}"]`);
    if (cell) cell.textContent = formatMoney(value);
  });
}

function filterTraderProfiles() {
  const query = document.querySelector("#trader-search").value.trim().toLocaleLowerCase();
  traderProfiles.querySelectorAll(".trader-profile").forEach((details, index) => {
    const trader = state.traders[index];
    details.hidden = Boolean(query) &&
      !`${trader.name} ${trader.phone} ${trader.date} ${index + 1}`.toLocaleLowerCase().includes(query);
  });
}

function renderTraders() {
  traderProfiles.replaceChildren();
  state.traders.forEach((trader, index) => {
    const details = document.createElement("details");
    details.className = "trader-profile";
    details.dataset.traderIndex = String(index);

    const summary = document.createElement("summary");
    summary.className = "trader-profile-summary";
    const number = document.createElement("span");
    number.className = "trader-profile-number";
    number.textContent = formatNumber(index + 1);
    const name = document.createElement("strong");
    name.className = "trader-summary-name";
    name.textContent = trader.name || `بيانات التاجر رقم ${formatNumber(index + 1)}`;
    const phone = document.createElement("span");
    phone.className = "trader-summary-phone";
    phone.textContent = trader.date
      ? `${trader.phone || "رقم التليفون غير مسجل"} · ${formatDate(trader.date)}`
      : trader.phone || "أضف الاسم ورقم التليفون";
    const entryCount = document.createElement("span");
    entryCount.className = "trader-entry-count";
    const savedEntries = trader.entries.filter((entry) =>
      entry.empty || entry.outstanding || entry.total || entry.price,
    ).length;
    entryCount.textContent = `${formatNumber(savedEntries)} / ${formatNumber(30)} صف`;
    const chevron = document.createElement("span");
    chevron.className = "trader-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    summary.append(number, name, phone, entryCount, chevron);
    details.append(summary);

    const content = document.createElement("div");
    content.className = "trader-details-content";
    details.append(content);
    details.addEventListener("toggle", () => {
      if (details.open && !content.hasChildNodes()) renderTraderDetails(details, trader, index);
    });
    traderProfiles.append(details);
  });
  document.querySelector("#trader-search").value = "";
  updateTraderTotals();
}

function renderInvoiceRecords(category) {
  const records = state.invoiceRecords
    .filter((record) => record.category === category)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const body = document.querySelector(`#invoice-records-${category}`);
  const empty = document.querySelector(`#invoice-empty-${category}`);
  body.replaceChildren();
  empty.hidden = records.length > 0;
  document.querySelector(`#invoice-count-${category}`).textContent = `${formatNumber(records.length)} فاتورة`;

  records.forEach((record) => {
    const row = document.createElement("tr");
    const day = record.day || cycleDayForDate(record.date);
    const dayCell = document.createElement("td");
    dayCell.textContent = day ? formatNumber(day) : "خارج الدورة";
    row.append(dayCell);
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(record.date);
    row.append(dateCell);
    const itemCell = document.createElement("td");
    itemCell.textContent = record.item || "—";
    row.append(itemCell);
    const amountCell = document.createElement("td");
    amountCell.textContent = record.amount === "" || record.amount == null ? "—" : formatMoney(record.amount);
    row.append(amountCell);
    const receiptCell = document.createElement("td");
    const receiptLink = document.createElement("a");
    receiptLink.className = "receipt-link";
    receiptLink.href = apiUrl(record.receipt);
    receiptLink.target = "_blank";
    receiptLink.rel = "noopener noreferrer";
    receiptLink.textContent = "فتح الصورة";
    receiptCell.append(receiptLink);
    row.append(receiptCell);

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.className = "delete-record";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "حذف الفاتورة");
    removeButton.addEventListener("click", async () => {
      if (!window.confirm("متأكد إنك عايز تحذف الفاتورة؟")) return;
      const previousInvoices = state.invoiceRecords;
      state.invoiceRecords = previousInvoices.filter((item) => item.id !== record.id);
      try {
        await saveState();
        renderInvoiceRecords(category);
        setFormMessage(document.querySelector(`#invoice-message-${category}`), "تم حذف سجل الفاتورة.", "success");
      } catch (error) {
        state.invoiceRecords = previousInvoices;
        renderInvoiceRecords(category);
        setFormMessage(
          document.querySelector(`#invoice-message-${category}`),
          `تعذر حذف الفاتورة: ${error.message}`,
          "error",
        );
      }
    });
    actionCell.append(removeButton);
    row.append(actionCell);
    body.append(row);
  });
}

function renderGasRecords() {
  const body = document.querySelector("#gas-records");
  const empty = document.querySelector("#gas-empty");
  body.replaceChildren();
  empty.hidden = state.gasRecords.length > 0;

  let incomingTotal = 0;
  let outgoingTotal = 0;
  state.gasRecords.forEach((record, index) => {
    incomingTotal += Number(record.incoming) || 0;
    outgoingTotal += Number(record.outgoing) || 0;
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(record.date);
    row.append(dateCell);
    const dayCell = document.createElement("td");
    dayCell.textContent = record.day ? formatNumber(record.day) : "خارج الدورة";
    row.append(dayCell);
    [formatNumber(record.incoming), formatNumber(record.outgoing), record.notes || "—"].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.className = "delete-record";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "حذف حركة الغاز");
    removeButton.addEventListener("click", async () => {
      const previousRecords = [...state.gasRecords];
      state.gasRecords.splice(index, 1);
      try {
        await saveState();
        renderGasRecords();
        gasMessage.textContent = "تم حذف حركة الغاز.";
      } catch (error) {
        state.gasRecords = previousRecords;
        renderGasRecords();
        gasMessage.textContent = `تعذر حذف الحركة: ${error.message}`;
      }
    });
    actionCell.append(removeButton);
    row.append(actionCell);
    body.append(row);
  });
  document.querySelector("#gas-in-total").textContent = formatNumber(incomingTotal);
  document.querySelector("#gas-out-total").textContent = formatNumber(outgoingTotal);
}

farmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  farmMessage.textContent = "";
  if (!farmForm.reportValidity()) return;
  const formData = new FormData(farmForm);
  const previousCycle = state.cycle;
  const previousDates = state.dailyRecords.map((record) => record.date);
  state.cycle = {
    date: String(formData.get("date")),
    chicks: String(formData.get("chicks")),
    workers: String(formData.get("workers") || 0),
  };
  state.dailyRecords.forEach((record) => { record.date = cycleDate(Number(record.day)); });
  state.gasRecords.forEach((record) => { record.day = cycleDayForDate(record.date); });
  state.invoiceRecords.forEach((record) => { record.day = cycleDayForDate(record.date); });
  const button = farmForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await saveState();
    updateFarmSummary();
    renderDailyTable();
    renderGasRecords();
    ["feed", "electricity", "treatment"].forEach(renderInvoiceRecords);
    farmMessage.textContent = "تم حفظ بيانات الدورة وتحديث تواريخ الأيام الـ٤٢.";
  } catch (error) {
    state.cycle = previousCycle;
    state.dailyRecords.forEach((record, index) => { record.date = previousDates[index]; });
    farmMessage.textContent = `تعذر حفظ بيانات الدورة: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#save-daily-table").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  dailyMessage.textContent = "";
  try {
    await saveState();
    dailyMessage.textContent = "تم حفظ بيانات جدول الأيام الـ٤٢.";
  } catch (error) {
    dailyMessage.textContent = `تعذر حفظ الجدول: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

tradersForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  tradersMessage.textContent = "";
  const button = tradersForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await saveState();
    tradersMessage.textContent = "تم حفظ بيانات التجار على الخادم.";
  } catch (error) {
    tradersMessage.textContent = `تعذر حفظ بيانات التجار: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll(".invoice-form").forEach((form) => {
  const category = form.dataset.category;
  const message = document.querySelector(`#invoice-message-${category}`);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormMessage(message, "");
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const file = formData.get("receipt");
    const button = form.querySelector('[type="submit"]');
    const previousInvoices = state.invoiceRecords;
    button.disabled = true;
    try {
      const uploaded = await uploadImage(file);
      state.invoiceRecords = [{
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        date: String(formData.get("date")),
        day: cycleDayForDate(String(formData.get("date"))),
        category,
        item: String(formData.get("item") || "").trim(),
        amount: String(formData.get("amount") || ""),
        receipt: uploaded.url,
      }, ...previousInvoices];
      await saveState();
      renderInvoiceRecords(category);
      form.reset();
      form.querySelector('[name="date"]').value = localIsoDate();
      setFormMessage(message, "تم رفع صورة الفاتورة وحفظ بياناتها.", "success");
    } catch (error) {
      state.invoiceRecords = previousInvoices;
      setFormMessage(message, `تعذر حفظ الفاتورة: ${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });
});

gasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  gasMessage.textContent = "";
  if (!gasForm.reportValidity()) return;
  const formData = new FormData(gasForm);
  const date = String(formData.get("date"));
  const previousRecords = state.gasRecords;
  state.gasRecords = [{
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    date,
    day: cycleDayForDate(date),
    incoming: String(formData.get("incoming") || 0),
    outgoing: String(formData.get("outgoing") || 0),
    notes: String(formData.get("notes") || "").trim(),
  }, ...previousRecords];
  const button = gasForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await saveState();
    renderGasRecords();
    gasForm.reset();
    gasForm.querySelector('[name="date"]').value = localIsoDate();
    gasMessage.textContent = "تم حفظ حركة الأنابيب بتاريخها.";
  } catch (error) {
    state.gasRecords = previousRecords;
    gasMessage.textContent = `تعذر حفظ حركة الغاز: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  expenseMessage.textContent = "";
  if (!expenseForm.reportValidity()) return;
  const formData = new FormData(expenseForm);
  const previousExpenses = state.extraExpenses;
  state.extraExpenses = [{
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    date: String(formData.get("date")),
    item: String(formData.get("item") || "").trim(),
    amount: String(formData.get("amount") || ""),
    notes: String(formData.get("notes") || "").trim(),
  }, ...previousExpenses];
  const button = expenseForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await saveState();
    renderExpenses();
    expenseForm.reset();
    expenseForm.querySelector('[name="date"]').value = localIsoDate();
    expenseMessage.textContent = "تم حفظ المصروف الإضافي.";
  } catch (error) {
    state.extraExpenses = previousExpenses;
    expenseMessage.textContent = `تعذر حفظ المصروف: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

workerRecordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  workerRecordMessage.textContent = "";
  if (!workerRecordForm.reportValidity()) return;
  const formData = new FormData(workerRecordForm);
  const previousRecords = state.workerRecords;
  state.workerRecords = [{
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    worker: String(formData.get("worker")),
    date: String(formData.get("date")),
    attendance: String(formData.get("attendance")),
    advance: String(formData.get("advance") || ""),
    leaveDays: String(formData.get("leaveDays") || ""),
    notes: String(formData.get("notes") || "").trim(),
  }, ...previousRecords];

  const button = workerRecordForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await saveState();
    renderWorkerRecords();
    workerRecordForm.reset();
    workerRecordForm.querySelector('[name="date"]').value = localIsoDate();
    workerRecordMessage.textContent = "تم حفظ سجل العامل.";
  } catch (error) {
    state.workerRecords = previousRecords;
    workerRecordMessage.textContent = `تعذر حفظ سجل العامل: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

const pageNames = {
  "farm-page": "متابعة المزرعة",
  "workers-page": "العمال",
  "invoices-page": "فواتير العلف",
  "electricity-page": "الكهرباء",
  "treatment-page": "العلاج",
  "gas-page": "أنابيب الغاز",
  "expenses-page": "مصاريف إضافية",
  "traders-page": "حسابات التجار",
};

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => {
    const nextPageId = button.dataset.page;
    document.querySelectorAll(".nav-link").forEach((link) => {
      const selected = link === button;
      link.classList.toggle("active", selected);
      link.setAttribute("aria-current", selected ? "page" : "false");
    });
    document.querySelectorAll(".page").forEach((page) => {
      const selected = page.id === nextPageId;
      page.hidden = !selected;
      page.classList.toggle("active", selected);
    });
    document.querySelector("#breadcrumb-current").textContent = pageNames[nextPageId];
  });
});

document.querySelector("#trader-search").addEventListener("input", filterTraderProfiles);
document.querySelector("#farm-print").addEventListener("click", () => window.print());
document.querySelectorAll("[data-print-page]").forEach((button) => {
  button.addEventListener("click", () => window.print());
});
document.querySelector("#feed-invoices-print").addEventListener("click", () => window.print());
document.querySelector("#traders-print").addEventListener("click", () => window.print());

async function initialize(loginSucceeded = false) {
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
  document.querySelector("#record-date").value = localIsoDate();
  workerRecordForm.querySelector('[name="date"]').value = localIsoDate();
  document.querySelector("#gas-form").querySelector('[name="date"]').value = localIsoDate();
  expenseForm.querySelector('[name="date"]').value = localIsoDate();
  document.querySelectorAll(".invoice-form [name=\"date\"]").forEach((input) => { input.value = localIsoDate(); });

  try {
    state = normalizeState(await requestJson("/api/state"));
    renderCycleForm();
    renderDailyTable();
    renderTraders();
    renderWorkerRecords();
    renderGasRecords();
    ["feed", "electricity", "treatment"].forEach(renderInvoiceRecords);
    renderExpenses();
    updateFarmSummary();
    const serverStatus = document.querySelector("#server-status");
    serverStatus.textContent = loginSucceeded ? "تم تسجيل الدخول بنجاح · الخادم متصل" : "الخادم متصل";
    serverStatus.classList.remove("server-error");
    serverStatus.classList.add("server-connected");
  } catch (error) {
    state = normalizeState({});
    renderDailyTable();
    renderTraders();
    renderWorkerRecords();
    renderGasRecords();
    ["feed", "electricity", "treatment"].forEach(renderInvoiceRecords);
    renderExpenses();
    updateFarmSummary();
    const serverStatus = document.querySelector("#server-status");
    serverStatus.textContent = `تعذر تحميل البيانات: ${error.message}`;
    serverStatus.classList.remove("server-connected");
    serverStatus.classList.add("server-error");
    document.querySelectorAll("form input, form button, form select, .cycle-input, #save-daily-table").forEach((control) => {
      control.disabled = true;
    });
    farmMessage.textContent = error.message;
  }
}

async function initializeAuthentication() {
  try {
    const session = await requestJson("/api/session");
    if (session.authenticated) {
      loginScreen.hidden = true;
      appShell.hidden = false;
      await initialize();
    }
  } catch (error) {
    setFormMessage(loginMessage, `تعذر الاتصال بخادم تسجيل الدخول: ${error.message}`, "error");
  }
}

initializeAuthentication();
