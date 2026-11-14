const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector("#site-menu");

if (menuToggle && siteMenu) {
  const closeMenu = () => {
    menuToggle.setAttribute("aria-expanded", "false");
    siteMenu.hidden = true;
  };

  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    siteMenu.hidden = isOpen;
  });

  siteMenu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) {
      closeMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !menuToggle.parentElement.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      menuToggle.focus();
    }
  });
}

const splitTexts = document.querySelectorAll(".split-text:not(.shiny-text)");

for (const element of splitTexts) {
  const text = element.textContent?.trim().replace(/\s+/g, " ");
  if (!text) continue;

  element.setAttribute("aria-label", text);
  const letters = Array.from(text).map((character, index) => {
    const span = document.createElement("span");
    span.className = character === " " ? "letter letter-space" : "letter";
    span.textContent = character === " " ? "\u00a0" : character;
    span.style.setProperty("--letter-index", String(index));
    return span;
  });

  element.replaceChildren(...letters);
}

const taxChart = document.querySelector("[data-tax-chart]");

if (taxChart) {
  const monthlyTaxCosts = [
    { month: "Jan", fullMonth: "January", amount: 4.2 },
    { month: "Feb", fullMonth: "February", amount: 4.7 },
    { month: "Mar", fullMonth: "March", amount: 4.5 },
    { month: "Apr", fullMonth: "April", amount: 5.4 },
    { month: "May", fullMonth: "May", amount: 5.1 },
    { month: "Jun", fullMonth: "June", amount: 6.1 },
    { month: "Jul", fullMonth: "July", amount: 5.8 },
    { month: "Aug", fullMonth: "August", amount: 6.9 },
    { month: "Sep", fullMonth: "September", amount: 6.6 },
    { month: "Oct", fullMonth: "October", amount: 7.7 },
    { month: "Nov", fullMonth: "November", amount: 8.4 },
    { month: "Dec", fullMonth: "December", amount: 9.1 },
  ];
  const defaultIndex = 9;
  const minimum = Math.min(...monthlyTaxCosts.map((item) => item.amount));
  const maximum = Math.max(...monthlyTaxCosts.map((item) => item.amount));
  const svg = taxChart.querySelector(".analytics-chart");
  const line = svg?.querySelector(".chart-line");
  const area = svg?.querySelector(".chart-area");
  const crosshair = svg?.querySelector(".chart-crosshair");
  const marker = svg?.querySelector(".chart-marker");
  const value = taxChart.closest(".magic-card")?.querySelector("[data-tax-value]");
  const period = taxChart.closest(".magic-card")?.querySelector("[data-tax-period]");
  const points = monthlyTaxCosts.map((item, index) => ({
    x: 2 + (index / (monthlyTaxCosts.length - 1)) * 174,
    y: 62 - ((item.amount - minimum) / (maximum - minimum)) * 58,
  }));
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  if (line && area) {
    line.setAttribute("d", linePath);
    area.setAttribute("d", `${linePath} L176 72 L2 72 Z`);
  }

  const updateTaxChart = (index, isActive) => {
    const item = monthlyTaxCosts[index];
    const point = points[index];

    if (!item || !point || !crosshair || !marker || !value || !period) return;

    value.textContent = `$${item.amount.toFixed(1)}k`;
    period.textContent = `${item.month} '25`;
    taxChart.setAttribute("aria-valuenow", String(index));
    taxChart.setAttribute("aria-valuetext", `$${item.amount.toFixed(1)}k, ${item.fullMonth} 2025`);
    crosshair.setAttribute("x1", point.x.toFixed(1));
    crosshair.setAttribute("x2", point.x.toFixed(1));
    marker.setAttribute("cx", point.x.toFixed(1));
    marker.setAttribute("cy", point.y.toFixed(1));
    taxChart.classList.toggle("is-active-point", isActive);
  };

  const updateFromPointer = (event) => {
    const bounds = taxChart.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const index = Math.round(position * (monthlyTaxCosts.length - 1));
    updateTaxChart(index, true);
  };

  taxChart.addEventListener("pointermove", updateFromPointer);
  taxChart.addEventListener("pointerdown", updateFromPointer);
  taxChart.addEventListener("pointerleave", () => {
    if (document.activeElement !== taxChart) {
      updateTaxChart(defaultIndex, false);
    }
  });
  taxChart.addEventListener("focus", () => updateTaxChart(defaultIndex, true));
  taxChart.addEventListener("blur", () => updateTaxChart(defaultIndex, false));
  taxChart.addEventListener("keydown", (event) => {
    const currentIndex = Number(taxChart.getAttribute("aria-valuenow")) || 0;
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(monthlyTaxCosts.length - 1, currentIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = monthlyTaxCosts.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    updateTaxChart(nextIndex, true);
  });
}

if ("IntersectionObserver" in window) {
  const revealElements = document.querySelectorAll(".reveal");
  const startMotion = () => {
    document.documentElement.classList.add("motion-ready");
    const observer = new IntersectionObserver(
      (entries, currentObserver) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            currentObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );

    revealElements.forEach((element) => {
      observer.observe(element);
      const bounds = element.getBoundingClientRect();
      if (bounds.top < window.innerHeight && bounds.bottom > 0) {
        element.classList.add("is-visible");
      }
    });
  };

  if (document.visibilityState === "visible") {
    startMotion();
  } else {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        startMotion();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
}

document.querySelectorAll("[data-plan]").forEach((button) => {
  button.addEventListener("click", () => {
    const feedback = document.querySelector(".plan-feedback");
    const plan = button.getAttribute("data-plan");
    if (feedback && plan) {
      feedback.textContent = `${plan} plan selected. Sign-up will be available soon.`;
    }
  });
});

document.querySelectorAll(".feature-card, .magic-card").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const bounds = card.getBoundingClientRect();
    card.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    card.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--pointer-x", "50%");
    card.style.setProperty("--pointer-y", "50%");
  });

  if (card.classList.contains("magic-card")) {
    card.addEventListener("click", () => {
      card.classList.remove("is-clicked");
      void card.offsetWidth;
      card.classList.add("is-clicked");
    });

    card.addEventListener("animationend", (event) => {
      if (event.animationName === "bento-click") {
        card.classList.remove("is-clicked");
      }
    });
  }
});

document.querySelectorAll(".plan-card").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const bounds = card.getBoundingClientRect();
    card.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    card.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--pointer-x", "50%");
    card.style.setProperty("--pointer-y", "50%");
  });
});
