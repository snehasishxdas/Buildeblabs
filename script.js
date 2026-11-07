const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const nav = document.querySelector(".primary-nav");
const menuToggle = document.querySelector(".menu-toggle");
const applicationForm = document.querySelector("#application-form");
const formSteps = [...document.querySelectorAll(".form-step")];
const nextButton = document.querySelector("#next-step");
const backButton = document.querySelector("#back-step");
const submitButton = document.querySelector("#submit-application");
const formError = document.querySelector("#form-error");
const servicesError = document.querySelector("#services-error");
const draftStatus = document.querySelector("#draft-status");
const storageKey = "buildedlabs-application-draft";
let currentStep = 1;

document.querySelector("#current-year").textContent = new Date().getFullYear();

const scrollProgress = document.querySelector(".scroll-progress span");
let scrollFrame = 0;
function updateScrollProgress() {
  if (scrollFrame) return;
  scrollFrame = window.requestAnimationFrame(() => {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollableHeight > 0 ? window.scrollY / scrollableHeight : 0;
    scrollProgress.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    scrollFrame = 0;
  });
}
window.addEventListener("scroll", updateScrollProgress, { passive: true });
window.addEventListener("resize", updateScrollProgress);
updateScrollProgress();

if (!reducedMotion && window.matchMedia("(pointer: fine)").matches) {
  document.body.classList.add("has-pointer-aura");
  const tiltItems = document.querySelectorAll("[data-tilt], a[href], button");
  const heroArt = document.querySelector(".hero-art");
  const heroObject = document.querySelector(".hero-object");
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;

  function updateHeroParallax() {
    const bounds = heroArt.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
      heroArt.style.removeProperty("--hero-tilt-x");
      heroArt.style.removeProperty("--hero-tilt-y");
      heroObject.style.removeProperty("--mouse-x");
      heroObject.style.removeProperty("--mouse-y");
      heroObject.style.removeProperty("--mouse-tilt-x");
      heroObject.style.removeProperty("--mouse-tilt-y");
      return;
    }

    const x = Math.max(-1, Math.min(1, (pointerX / window.innerWidth - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, (pointerY / window.innerHeight - 0.5) * 2));
    heroArt.style.setProperty("--hero-tilt-x", `${(x * 16).toFixed(2)}deg`);
    heroArt.style.setProperty("--hero-tilt-y", `${(y * -14).toFixed(2)}deg`);
    heroObject.style.setProperty("--mouse-x", `${(x * 22).toFixed(2)}px`);
    heroObject.style.setProperty("--mouse-y", `${(y * 22).toFixed(2)}px`);
    heroObject.style.setProperty("--mouse-tilt-x", `${(y * -30).toFixed(2)}deg`);
    heroObject.style.setProperty("--mouse-tilt-y", `${(x * 38).toFixed(2)}deg`);
  }

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
    document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
    updateHeroParallax();
  }, { passive: true });
  window.addEventListener("scroll", updateHeroParallax, { passive: true });
  window.addEventListener("resize", updateHeroParallax);
  window.addEventListener("blur", () => {
    heroArt.style.removeProperty("--hero-tilt-x");
    heroArt.style.removeProperty("--hero-tilt-y");
    heroObject.style.removeProperty("--mouse-x");
    heroObject.style.removeProperty("--mouse-y");
    heroObject.style.removeProperty("--mouse-tilt-x");
    heroObject.style.removeProperty("--mouse-tilt-y");
  });

  tiltItems.forEach((item) => {
    item.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const bounds = item.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const strength = Number(item.dataset.tiltStrength) || (item.hasAttribute("data-tilt") ? 13 : 8);
      item.style.setProperty("--tilt-x", `${((x - 0.5) * strength).toFixed(2)}deg`);
      item.style.setProperty("--tilt-y", `${((0.5 - y) * strength).toFixed(2)}deg`);
      item.style.setProperty("--depth-x", `${((x - 0.5) * 14).toFixed(2)}px`);
      item.style.setProperty("--depth-y", `${((y - 0.5) * 14).toFixed(2)}px`);
      item.style.setProperty("--pointer-local-x", `${(x * 100).toFixed(1)}%`);
      item.style.setProperty("--pointer-local-y", `${(y * 100).toFixed(1)}%`);
      item.classList.add("is-pointer-active");
    });
    item.addEventListener("pointerleave", () => {
      item.classList.remove("is-pointer-active");
      ["--tilt-x", "--tilt-y", "--depth-x", "--depth-y", "--pointer-local-x", "--pointer-local-y"]
        .forEach((property) => item.style.removeProperty(property));
    });
  });
}

menuToggle.addEventListener("click", () => {
  const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  nav.classList.toggle("is-open", !isExpanded);
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !reducedMotion) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".work-card").forEach((card) => {
      card.classList.toggle("is-hidden", filter !== "all" && card.dataset.category !== filter);
    });
  });
});

document.querySelectorAll("[data-service]").forEach((link) => {
  link.addEventListener("click", () => {
    const selectedService = link.dataset.service;
    const serviceLabels = {
      website: "Website",
      database: "Database",
      api: "API",
      auth: "Authentication",
      "3d": "3D experience",
      admin: "Admin panel"
    };
    const checkbox = [...applicationForm.querySelectorAll('input[name="services"]')]
      .find((input) => input.value === serviceLabels[selectedService]);
    if (checkbox) {
      checkbox.checked = true;
      saveDraft();
    }
  });
});

function showStep(step) {
  currentStep = step;
  formSteps.forEach((fieldset) => {
    const active = Number(fieldset.dataset.step) === step;
    fieldset.hidden = !active;
    fieldset.classList.toggle("is-current", active);
  });
  document.querySelector("#step-current").textContent = String(step).padStart(2, "0");
  document.querySelector("#progress-fill").style.width = `${(step / formSteps.length) * 100}%`;
  backButton.hidden = step === 1;
  nextButton.hidden = step === formSteps.length;
  submitButton.hidden = step !== formSteps.length;
  formError.hidden = true;
  const heading = formSteps[step - 1].querySelector("legend");
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

function validateStep(step) {
  const fieldset = formSteps[step - 1];
  const fields = [...fieldset.querySelectorAll("input, select, textarea")]
    .filter((input) => input.name !== "websiteConfirm" && input.type !== "file");
  const firstInvalid = fields.find((field) => !field.checkValidity());
  if (firstInvalid) {
    firstInvalid.reportValidity();
    firstInvalid.focus();
    return false;
  }
  if (step === 2) {
    const checkedServices = applicationForm.querySelectorAll('input[name="services"]:checked').length > 0;
    servicesError.hidden = checkedServices;
    if (!checkedServices) {
      applicationForm.querySelector('input[name="services"]').focus();
      return false;
    }
  }
  if (step === 3) {
    const upload = applicationForm.elements.attachment.files[0];
    if (upload && upload.size > 10 * 1024 * 1024) {
      formError.textContent = "That file is over 10 MB. Please choose a smaller file.";
      formError.hidden = false;
      applicationForm.elements.attachment.focus();
      return false;
    }
  }
  return true;
}

function stepIsComplete(step) {
  const fieldset = formSteps[step - 1];
  const fields = [...fieldset.querySelectorAll("input, select, textarea")]
    .filter((input) => input.name !== "websiteConfirm" && input.type !== "file");
  if (!fields.every((field) => field.checkValidity())) return false;
  if (step === 2 && !applicationForm.querySelector('input[name="services"]:checked')) return false;
  if (step === 3) {
    const upload = applicationForm.elements.attachment.files[0];
    if (upload && upload.size > 10 * 1024 * 1024) return false;
  }
  return true;
}

nextButton.addEventListener("click", () => {
  if (validateStep(currentStep)) {
    showStep(currentStep + 1);
    saveDraft();
  }
});

backButton.addEventListener("click", () => showStep(currentStep - 1));

applicationForm.addEventListener("input", (event) => {
  if (event.target.name === "description") {
    const length = event.target.value.trim().length;
    document.querySelector("#description-count").textContent = `${length} / 50 minimum characters`;
  }
  if (event.target.name === "services") servicesError.hidden = true;
  saveDraft();
});

applicationForm.addEventListener("change", (event) => {
  if (event.target.name === "attachment") {
    const file = event.target.files[0];
    if (file && file.size > 10 * 1024 * 1024) {
      formError.textContent = "That file is over 10 MB. Please choose a smaller file.";
      formError.hidden = false;
    } else {
      formError.hidden = true;
    }
  }
  saveDraft();
});

function saveDraft() {
  const values = {};
  [...applicationForm.elements].forEach((field) => {
    if (!field.name || field.type === "file" || field.name === "websiteConfirm") return;
    if (field.type === "checkbox") {
      values[field.name] ??= [];
      if (field.checked) values[field.name].push(field.value || "on");
    } else {
      values[field.name] = field.value;
    }
  });
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(values));
    draftStatus.textContent = "DRAFT SAVED IN THIS TAB";
  } catch (error) {
    draftStatus.textContent = "DRAFT NOT SAVED — STORAGE UNAVAILABLE";
    console.error("Could not save the application draft.", error);
  }
}

function restoreDraft() {
  let savedDraft;
  try {
    savedDraft = JSON.parse(sessionStorage.getItem(storageKey) || "null");
  } catch (error) {
    draftStatus.textContent = "DRAFT COULD NOT BE RESTORED";
    console.error("Could not read the saved application draft.", error);
    return;
  }
  if (!savedDraft) return;
  [...applicationForm.elements].forEach((field) => {
    if (!field.name || !(field.name in savedDraft) || field.type === "file") return;
    if (field.type === "checkbox") {
      field.checked = savedDraft[field.name].includes(field.value || "on");
    } else {
      field.value = savedDraft[field.name];
    }
  });
  const description = applicationForm.elements.description;
  document.querySelector("#description-count").textContent = `${description.value.trim().length} / 50 minimum characters`;
  draftStatus.textContent = "DRAFT RESTORED FROM THIS TAB";
}

restoreDraft();

applicationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.hidden = true;
  if (applicationForm.elements.websiteConfirm.value) return;
  for (let step = 1; step <= formSteps.length; step += 1) {
    if (!stepIsComplete(step)) {
      showStep(step);
      validateStep(step);
      return;
    }
  }

  const values = new FormData(applicationForm);
  submitButton.disabled = true;
  submitButton.textContent = "Sending application…";
  try {
    const response = await fetch("/api/applications", { method: "POST", body: values });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your application could not be submitted. Please try again.");
    document.querySelector("#form-success").hidden = false;
    document.querySelector("#form-success h3").textContent = "Application received.";
    document.querySelector("#form-success p").textContent = "Thanks for telling us about your project. Snehasish will review your application and aim to reply within 48 hours.";
    applicationForm.querySelectorAll(".form-step, .form-actions, .form-footnote").forEach((element) => {
      element.hidden = true;
    });
    draftStatus.textContent = "APPLICATION RECEIVED";
    try {
      sessionStorage.removeItem(storageKey);
    } catch (error) {
      console.error("Could not clear the submitted application draft.", error);
    }
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit application <span aria-hidden="true">↗</span>';
  }
});

document.querySelector("#contact-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const contactForm = event.currentTarget;
  if (!contactForm.reportValidity()) return;
  const values = new FormData(contactForm);
  const status = document.querySelector("#contact-form-status");
  const submit = contactForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Sending…";
  fetch("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: values.get("name"),
      email: values.get("email"),
      message: values.get("message")
    })
  }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your message could not be sent. Please try again.");
    status.textContent = "Message received. We’ll be in touch as soon as we can.";
    status.hidden = false;
    contactForm.reset();
  }).catch((error) => {
    status.textContent = error.message;
    status.hidden = false;
  }).finally(() => {
    submit.disabled = false;
    submit.innerHTML = 'Send message <span aria-hidden="true">↗</span>';
  });
});
