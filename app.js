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

const splitTexts = document.querySelectorAll(".split-text");

for (const element of splitTexts) {
  const text = element.textContent?.trim().replace(/\s+/g, " ");
  if (!text) continue;

  element.setAttribute("aria-label", text);
  element.replaceChildren(
    ...Array.from(text).map((character, index) => {
      const span = document.createElement("span");
      span.className = character === " " ? "letter letter-space" : "letter";
      span.textContent = character === " " ? "\u00a0" : character;
      span.style.setProperty("--letter-index", String(index));
      return span;
    }),
  );
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
      feedback.textContent = `${plan} selected. Sign-up will be available soon.`;
    }
  });
});

document.querySelectorAll(".magic-card").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const bounds = card.getBoundingClientRect();
    card.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    card.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--pointer-x", "50%");
    card.style.setProperty("--pointer-y", "50%");
  });

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
});
