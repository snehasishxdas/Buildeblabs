const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const dashboardError = document.querySelector("#dashboard-error");
const applicationList = document.querySelector("#application-list");
const applicationDetail = document.querySelector("#application-detail");
const statusFilter = document.querySelector("#status-filter");
const serviceFilter = document.querySelector("#service-filter");
const searchInput = document.querySelector("#application-search");
const loadMoreButton = document.querySelector("#load-more");
const messageList = document.querySelector("#message-list");
const statuses = ["New", "Reviewing", "Call Scheduled", "Proposal Sent", "Won", "Rejected", "On Hold"];
let applications = [];
let selectedApplicationId = "";
let currentPage = 1;
let totalApplications = 0;
let searchTimer;

function showError(target, message) {
  target.textContent = message;
  target.hidden = false;
}

function clearError(target) {
  target.hidden = true;
  target.textContent = "";
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(data.error || "The request could not be completed.");
  }
  return data;
}

function showLogin() {
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginForm.elements.password.value = "";
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  loadApplications(true).catch((error) => showError(dashboardError, error.message));
  loadMessages().catch((error) => showToast(error.message));
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeText(value) {
  return String(value ?? "");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { toast.hidden = true; }, 4500);
}

function buildApplicationItem(application) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "application-item";
  button.classList.toggle("is-selected", application._id === selectedApplicationId);
  button.setAttribute("aria-label", `${application.company}, ${application.status}, ${formatDate(application.createdAt)}`);

  const top = document.createElement("span");
  top.className = "application-item-top";
  const company = document.createElement("strong");
  company.textContent = escapeText(application.company);
  const status = document.createElement("span");
  status.className = `status-pill ${application.status.toLowerCase().replaceAll(" ", "-")}`;
  status.textContent = application.status;
  top.append(company, status);

  const person = document.createElement("span");
  person.className = "application-person";
  person.textContent = `${escapeText(application.contactName)} · ${escapeText(application.email)}`;
  const bottom = document.createElement("span");
  bottom.className = "application-item-bottom";
  const services = document.createElement("span");
  services.textContent = (application.services || []).join(" · ");
  const date = document.createElement("span");
  date.textContent = formatDate(application.createdAt);
  bottom.append(services, date);
  button.append(top, person, bottom);
  button.addEventListener("click", () => selectApplication(application._id));
  return button;
}

function renderApplications() {
  applicationList.replaceChildren();
  applications.forEach((application) => applicationList.append(buildApplicationItem(application)));
  document.querySelector("#list-count").textContent = totalApplications === 0
    ? "No applications match these filters."
    : `Showing ${applications.length} of ${totalApplications} application${totalApplications === 1 ? "" : "s"}`;
  loadMoreButton.hidden = applications.length >= totalApplications;
  document.querySelector("#sidebar-app-count").textContent = String(totalApplications);
  document.querySelector("#stat-total").textContent = String(totalApplications);
}

async function loadApplications(reset = false, append = false) {
  clearError(dashboardError);
  if (reset) {
    currentPage = 1;
    selectedApplicationId = "";
    applicationDetail.innerHTML = '<div class="empty-detail"><span class="empty-detail-mark">↖</span><h2>Choose an application.</h2><p>Project details, notes and your reply tools will appear here.</p></div>';
  }
  const params = new URLSearchParams({
    page: String(append ? currentPage + 1 : currentPage)
  });
  if (statusFilter.value) params.set("status", statusFilter.value);
  if (serviceFilter.value) params.set("service", serviceFilter.value);
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
  const data = await request(`/api/admin/applications?${params}`);
  if (append) currentPage += 1;
  else currentPage = 1;
  applications = append ? [...applications, ...data.applications] : data.applications;
  totalApplications = data.total;
  document.querySelector("#stat-new").textContent = String(data.summary.new);
  document.querySelector("#stat-week").textContent = String(data.summary.thisWeek);
  renderApplications();
}

function addDetailField(parent, label, value, className = "") {
  const row = document.createElement("div");
  row.className = `detail-field ${className}`.trim();
  const title = document.createElement("span");
  title.className = "detail-label";
  title.textContent = label;
  const content = document.createElement("div");
  content.className = "detail-value";
  content.textContent = value || "Not provided";
  row.append(title, content);
  parent.append(row);
  return content;
}

function renderReplyHistory(parent, replies = []) {
  const history = document.createElement("div");
  history.className = "reply-history";
  const heading = document.createElement("h3");
  heading.textContent = "Reply history";
  history.append(heading);
  if (!replies.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No replies have been sent yet.";
    history.append(empty);
  } else {
    replies.slice().reverse().forEach((reply) => {
      const item = document.createElement("article");
      item.className = "reply-item";
      const meta = document.createElement("span");
      meta.textContent = `${reply.status === "sent" ? "SENT" : reply.status.toUpperCase()} · ${formatDate(reply.sentAt || reply.createdAt)}`;
      const message = document.createElement("p");
      message.textContent = reply.message;
      item.append(meta, message);
      history.append(item);
    });
  }
  parent.append(history);
}

async function selectApplication(id) {
  selectedApplicationId = id;
  renderApplications();
  applicationDetail.innerHTML = '<div class="detail-loading">Loading application…</div>';
  try {
    const { application } = await request(`/api/admin/applications/${encodeURIComponent(id)}`);
    if (selectedApplicationId !== id) return;
    renderApplicationDetail(application);
  } catch (error) {
    showToast(error.message);
  }
}

function renderApplicationDetail(application) {
  applicationDetail.replaceChildren();
  const detailHeader = document.createElement("div");
  detailHeader.className = "detail-header";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `RECEIVED ${formatDate(application.createdAt).toUpperCase()}`;
  const company = document.createElement("h2");
  company.textContent = application.company;
  const contact = document.createElement("p");
  contact.className = "detail-contact";
  contact.textContent = `${application.contactName} · ${application.email}`;
  detailHeader.append(eyebrow, company, contact);
  applicationDetail.append(detailHeader);

  const statusLabel = document.createElement("label");
  statusLabel.className = "detail-label status-select-label";
  statusLabel.textContent = "PROJECT STATUS";
  const statusSelect = document.createElement("select");
  statusSelect.className = "detail-status-select";
  statusSelect.setAttribute("aria-label", "Project status");
  statuses.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = status === application.status;
    statusSelect.append(option);
  });
  statusSelect.addEventListener("change", async () => {
    try {
      await request(`/api/admin/applications/${application._id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: statusSelect.value })
      });
      application.status = statusSelect.value;
      await loadApplications();
      await selectApplication(application._id);
      showToast("Application status updated.");
    } catch (error) {
      showToast(error.message);
    }
  });
  applicationDetail.append(statusLabel, statusSelect);

  const fields = document.createElement("div");
  fields.className = "detail-fields";
  addDetailField(fields, "EMAIL", application.email);
  addDetailField(fields, "PHONE", application.phone);
  addDetailField(fields, "WEBSITE", application.website);
  addDetailField(fields, "INDUSTRY / COMPANY SIZE", [application.industry, application.size].filter(Boolean).join(" · "));
  addDetailField(fields, "SERVICES", (application.services || []).join(" · "));
  addDetailField(fields, "BUDGET / TIMELINE", [application.budget, application.timeline].filter(Boolean).join(" · "));
  addDetailField(fields, "PROJECT DESCRIPTION", application.description, "detail-long");
  addDetailField(fields, "WHY NOW", application.reason, "detail-long");
  if (application.attachment) {
    const attachmentRow = document.createElement("div");
    attachmentRow.className = "detail-field";
    const label = document.createElement("span");
    label.className = "detail-label";
    label.textContent = "ATTACHMENT";
    const link = document.createElement("a");
    link.className = "attachment-link";
    link.href = `/api/admin/applications/${application._id}/attachment`;
    link.textContent = `${application.attachment.filename} · ${(application.attachment.size / 1024 / 1024).toFixed(1)} MB ↓`;
    attachmentRow.append(label, link);
    fields.append(attachmentRow);
  }
  applicationDetail.append(fields);

  const notesLabel = document.createElement("label");
  notesLabel.className = "detail-label notes-label";
  notesLabel.textContent = "PRIVATE NOTES";
  const notes = document.createElement("textarea");
  notes.className = "admin-textarea";
  notes.rows = 3;
  notes.value = application.notes || "";
  notes.placeholder = "Only visible to you…";
  notesLabel.append(notes);
  applicationDetail.append(notesLabel);
  const saveNotes = document.createElement("button");
  saveNotes.type = "button";
  saveNotes.className = "admin-button admin-button-quiet save-notes-button";
  saveNotes.textContent = "Save notes";
  saveNotes.addEventListener("click", async () => {
    try {
      await request(`/api/admin/applications/${application._id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: notes.value })
      });
      showToast("Private notes saved.");
    } catch (error) {
      showToast(error.message);
    }
  });
  applicationDetail.append(saveNotes);

  renderReplyHistory(applicationDetail, application.replies);

  const replyForm = document.createElement("form");
  replyForm.className = "reply-form";
  const replyLabel = document.createElement("label");
  replyLabel.className = "detail-label";
  replyLabel.textContent = `REPLY TO ${application.email.toUpperCase()}`;
  const replyText = document.createElement("textarea");
  replyText.name = "message";
  replyText.className = "admin-textarea";
  replyText.rows = 5;
  replyText.required = true;
  replyText.maxLength = 10000;
  replyText.placeholder = `Write a reply to ${application.contactName}…`;
  replyLabel.append(replyText);
  const replyStatus = document.createElement("p");
  replyStatus.className = "reply-status";
  replyStatus.setAttribute("role", "status");
  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.className = "admin-button admin-button-primary";
  sendButton.innerHTML = 'Send email <span aria-hidden="true">↗</span>';
  replyForm.append(replyLabel, replyStatus, sendButton);
  replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!replyText.value.trim()) {
      replyText.reportValidity();
      return;
    }
    sendButton.disabled = true;
    sendButton.textContent = "Sending…";
    replyStatus.textContent = "";
    try {
      await request(`/api/admin/applications/${application._id}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: replyText.value })
      });
      showToast("Email sent to the applicant.");
      await selectApplication(application._id);
    } catch (error) {
      replyStatus.textContent = error.message;
      sendButton.disabled = false;
      sendButton.innerHTML = 'Try again <span aria-hidden="true">↗</span>';
    }
  });
  applicationDetail.append(replyForm);
}

async function loadMessages() {
  const { messages } = await request("/api/admin/messages");
  document.querySelector("#sidebar-message-count").textContent = String(messages.length);
  messageList.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-detail";
    empty.innerHTML = "<span class=\"empty-detail-mark\">✉</span><h2>No contact messages yet.</h2><p>Messages submitted through the quick contact form will appear here.</p>";
    messageList.append(empty);
    return;
  }
  messages.forEach((message) => {
    const card = document.createElement("article");
    card.className = "message-card";
    const heading = document.createElement("div");
    heading.className = "message-card-heading";
    const name = document.createElement("h2");
    name.textContent = message.name;
    const date = document.createElement("span");
    date.textContent = formatDate(message.createdAt);
    heading.append(name, date);
    const email = document.createElement("a");
    email.href = `mailto:${encodeURIComponent(message.email)}`;
    email.textContent = message.email;
    const body = document.createElement("p");
    body.textContent = message.message;
    card.append(heading, email, body);
    messageList.append(card);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError(loginError);
  const button = loginForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: loginForm.elements.username.value,
        password: loginForm.elements.password.value
      })
    });
    showDashboard();
  } catch (error) {
    showError(loginError, error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span aria-hidden="true">↗</span>';
    loginForm.elements.password.value = "";
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST", body: "{}" });
  } finally {
    showLogin();
  }
});

document.querySelectorAll(".sidebar-link").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-link").forEach((item) => item.classList.toggle("is-active", item === button));
    const applicationsView = button.dataset.view === "applications";
    document.querySelector("#applications-view").hidden = !applicationsView;
    document.querySelector("#messages-view").hidden = applicationsView;
    if (!applicationsView) loadMessages().catch((error) => showToast(error.message));
  });
});

[statusFilter, serviceFilter].forEach((filter) => {
  filter.addEventListener("change", () => {
    loadApplications(true).catch((error) => showError(dashboardError, error.message));
  });
});

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    loadApplications(true).catch((error) => showError(dashboardError, error.message));
  }, 250);
});

loadMoreButton.addEventListener("click", () => {
  loadApplications(false, true).catch((error) => showError(dashboardError, error.message));
});

request("/api/admin/session")
  .then(({ authenticated }) => {
    if (authenticated) showDashboard();
    else showLogin();
  })
  .catch(() => showLogin());
