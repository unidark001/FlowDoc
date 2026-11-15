(() => {
"use strict";

const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector("#site-menu");

if (menuToggle && siteMenu) {
  const menuWrap = menuToggle.parentElement;
  const isOpen = () => menuToggle.getAttribute("aria-expanded") === "true";
  const setMenu = (open) => {
    menuToggle.setAttribute("aria-expanded", String(open));
    siteMenu.hidden = !open;
  };

  menuToggle.addEventListener("click", () => {
    setMenu(!isOpen());
    if (isOpen()) siteMenu.querySelector("a")?.focus();
  });

  siteMenu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) setMenu(false);
  });

  document.addEventListener("click", (event) => {
    if (isOpen() && event.target instanceof Node && !menuWrap.contains(event.target)) setMenu(false);
  });

  // Close when keyboard focus leaves the menu.
  menuWrap.addEventListener("focusout", (event) => {
    if (isOpen() && event.relatedTarget instanceof Node && !menuWrap.contains(event.relatedTarget)) setMenu(false);
  });

  // Only react to Escape while the menu is open, so it never steals focus from other fields.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setMenu(false);
      menuToggle.focus();
    }
  });
}

// Split into words (each word unbreakable) and letters (each animated), so lines only wrap
// between words. Screen readers get the original sentence; the animated copy is hidden.
const splitTexts = document.querySelectorAll(".split-text, .shiny-text");

for (const element of splitTexts) {
  const text = element.textContent?.trim().replace(/\s+/g, " ");
  if (!text) continue;

  element.setAttribute("aria-label", text);
  const isShinyText = element.classList.contains("shiny-text");
  if (isShinyText) {
    const characterCount = Array.from(text).length;
    element.style.setProperty("--shine-start-delay", `${1250 + (characterCount - 1) * 50}ms`);
  }

  const readable = document.createElement("span");
  readable.className = "sr-only";
  readable.textContent = text;

  const visual = document.createElement("span");
  visual.setAttribute("aria-hidden", "true");
  let letterIndex = 0;
  const words = text.split(/(\s+)/).filter(Boolean).map((part) => {
    if (/^\s+$/.test(part)) {
      letterIndex += 1;
      return document.createTextNode(" ");
    }

    const word = document.createElement("span");
    word.className = "split-word";
    for (const character of Array.from(part)) {
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = character;
      letter.style.setProperty("--letter-index", String(letterIndex));
      letterIndex += 1;
      word.append(letter);
    }
    return word;
  });

  visual.append(...words);
  element.replaceChildren(readable, visual);
  if (isShinyText) {
    const overlay = document.createElement("span");
    overlay.className = "shiny-text-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.textContent = text;
    element.append(overlay);
  }
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

const signInForm = document.querySelector(".sign-in-form");
const authFeedback = document.querySelector(".auth-feedback");

if (signInForm) {
  const showFieldError = (input, message) => {
    const error = document.getElementById(input.getAttribute("aria-describedby") || "");
    input.setAttribute("aria-invalid", String(Boolean(message)));
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  };
  const validateField = (input) => {
    let message = "";
    if (input.validity.valueMissing) message = input.type === "email" ? "Enter your email address." : "Enter your password.";
    else if (input.validity.typeMismatch) message = "Enter a valid email, like name@example.com.";
    else if (input.validity.tooShort) message = `Passwords are at least ${input.minLength} characters.`;
    showFieldError(input, message);
    return !message;
  };

  signInForm.querySelectorAll("input").forEach((input) => {
    input.addEventListener("blur", () => { if (input.value) validateField(input); });
    input.addEventListener("input", () => { if (input.getAttribute("aria-invalid") === "true") validateField(input); });
  });

  signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const inputs = [...signInForm.querySelectorAll("input")];
    const invalid = inputs.filter((input) => !validateField(input));
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    if (authFeedback) authFeedback.textContent = "Signing you in…";
    try {
      const config = await fetch("/api/config").then((response) => response.json());
      if (!config.auth) {
        if (authFeedback) authFeedback.textContent = "Demo mode is active. You can use every tool without signing in.";
        return;
      }
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inputs[0].value.trim(), password: inputs[1].value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.access_token) throw new Error(result.error_description || "The email or password was not accepted.");
      localStorage.setItem("flowdoc_access_token", result.access_token);
      window.location.href = "tools.html";
    } catch (error) {
      if (authFeedback) authFeedback.textContent = error.message || "Sign-in failed. Try again.";
    }
  });
}

document.querySelectorAll("[data-auth-provider]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const config = await fetch("/api/config").then((response) => response.json());
      if (!config.auth) {
        if (authFeedback) authFeedback.textContent = "Demo mode is active. You can use every tool without signing in.";
        return;
      }
      const provider = button.dataset.authProvider.toLowerCase();
      window.location.href = `${config.supabaseUrl}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(window.location.origin + "/tools.html")}`;
    } catch {
      if (authFeedback) authFeedback.textContent = "Unable to start provider sign-in.";
    }
  });
});

const passwordToggle = document.querySelector(".password-toggle");
const passwordInput = document.querySelector("#password");

if (passwordToggle && passwordInput) {
  passwordToggle.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    passwordToggle.setAttribute("aria-pressed", String(!isVisible));
    passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  });
}

document.querySelectorAll(".feature-card, .magic-card, .plan-card").forEach((card) => {
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

const collaborationCard = document.querySelector(".bento-collaboration");

if (collaborationCard) {
  const documentPreview = collaborationCard.querySelector(".document-preview");
  const startButton = documentPreview?.querySelector(".demo-start");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cursors = [
    {
      element: collaborationCard.querySelector(".cursor-leo"),
      startX: 0.16,
      startY: 0.38,
      phaseOffset: 0,
      wanderStart: 0,
    },
    {
      element: collaborationCard.querySelector(".cursor-maya"),
      startX: 0.44,
      startY: 0.56,
      phaseOffset: 2.2,
      wanderStart: 0,
    },
  ].filter((cursor) => cursor.element);

  if (documentPreview && startButton && cursors.length) {
    const phases = [
      { type: "wander", duration: 5.5 },
      ...cursors.flatMap((_, cursorIndex) => [
        { type: "approach", cursorIndex, duration: 1.1 },
        { type: "click", cursorIndex, duration: 0.3 },
        { type: "return", cursorIndex, duration: 0.9 },
      ]),
    ];
    const positions = cursors.map((cursor) => ({ x: cursor.startX, y: cursor.startY }));
    let phaseIndex = 0;
    let phaseElapsed = 0;
    let previousFrameTime = 0;
    let animationFrame = 0;
    let actionStart = null;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const getStartPosition = () => {
      const previewBounds = documentPreview.getBoundingClientRect();
      const buttonBounds = startButton.getBoundingClientRect();
      return {
        x: clamp((buttonBounds.left + buttonBounds.width / 2 - previewBounds.left) / previewBounds.width, 0, 1),
        y: clamp((buttonBounds.top + buttonBounds.height / 2 - previewBounds.top) / previewBounds.height, 0, 1),
      };
    };
    const setPosition = (cursor, position) => {
      cursor.element.style.left = `${position.x * 100}%`;
      cursor.element.style.top = `${position.y * 100}%`;
    };
    const getWanderPosition = (cursor, time) => {
      const elapsed = Math.max(0, time - cursor.wanderStart);
      const angle = elapsed * 1.5 + cursor.phaseOffset;
      const x = cursor.startX
        + 0.1 * (Math.sin(angle) - Math.sin(cursor.phaseOffset))
        + 0.035 * (Math.sin(angle * 2.3) - Math.sin(cursor.phaseOffset * 2.3));
      const y = cursor.startY
        + 0.13 * (Math.sin(angle * 0.76) - Math.sin(cursor.phaseOffset * 0.76))
        + 0.055 * (Math.sin(angle * 1.9) - Math.sin(cursor.phaseOffset * 1.9));

      return { x: clamp(x, 0.02, 0.85), y: clamp(y, 0.08, 0.82) };
    };
    const enterPhase = (nextIndex, time) => {
      const previousPhase = phases[phaseIndex];
      if (previousPhase.type === "click") {
        startButton.classList.remove("is-clicked");
        cursors[previousPhase.cursorIndex].element.classList.remove("is-clicking");
      }
      if (previousPhase.type === "return") {
        cursors[previousPhase.cursorIndex].wanderStart = time;
      }

      phaseIndex = nextIndex % phases.length;
      phaseElapsed = 0;
      const nextPhase = phases[phaseIndex];
      if (nextPhase.type === "approach" || nextPhase.type === "return") {
        actionStart = { ...positions[nextPhase.cursorIndex] };
      }
      if (nextPhase.type === "click") {
        startButton.classList.add("is-clicked");
        cursors[nextPhase.cursorIndex].element.classList.add("is-clicking");
      }
    };
    const renderFrame = (time) => {
      animationFrame = 0;
      const seconds = time / 1000;
      const delta = previousFrameTime
        ? Math.min((time - previousFrameTime) / 1000, 0.05)
        : 0;
      previousFrameTime = time;
      phaseElapsed += delta;

      while (phaseElapsed >= phases[phaseIndex].duration) {
        phaseElapsed -= phases[phaseIndex].duration;
        enterPhase(phaseIndex + 1, seconds);
      }

      const phase = phases[phaseIndex];
      cursors.forEach((cursor, cursorIndex) => {
        let position = getWanderPosition(cursor, seconds);
        if (phase.type !== "wander" && phase.cursorIndex === cursorIndex) {
          const target = getStartPosition();
          if (phase.type === "click") {
            position = target;
          } else {
            const progress = clamp(phaseElapsed / phase.duration, 0, 1);
            const eased = phase.type === "approach"
              ? 1 - (1 - progress) ** 3
              : progress * progress * (3 - 2 * progress);
            const destination = phase.type === "approach"
              ? target
              : { x: cursor.startX, y: cursor.startY };
            position = {
              x: actionStart.x + (destination.x - actionStart.x) * eased,
              y: actionStart.y + (destination.y - actionStart.y) * eased,
            };
          }
        }

        positions[cursorIndex] = position;
        setPosition(cursor, position);
      });

      if (!prefersReducedMotion.matches) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };
    const updateCursorMotion = () => {
      if (prefersReducedMotion.matches) {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        previousFrameTime = 0;
        startButton.classList.remove("is-clicked");
        cursors.forEach((cursor, index) => {
          cursor.element.classList.remove("is-clicking");
          positions[index] = { x: cursor.startX, y: cursor.startY };
          setPosition(cursor, positions[index]);
        });
        return;
      }

      if (!animationFrame) {
        previousFrameTime = 0;
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    cursors.forEach((cursor) => {
      cursor.wanderStart = performance.now() / 1000;
      setPosition(cursor, { x: cursor.startX, y: cursor.startY });
    });
    updateCursorMotion();
    prefersReducedMotion.addEventListener("change", updateCursorMotion);
  }
}


const shapeGridContainer = document.querySelector(".page-shape-grid");
const shapeGridCanvas = shapeGridContainer?.querySelector(".shape-grid-canvas");
const shapeGridContext = shapeGridCanvas?.getContext("2d");

if (shapeGridContainer && shapeGridCanvas && shapeGridContext) {
  const cellSize = 40;
  const trail = 0.6;
  const hoverRadius = cellSize * 1.5;
  const getThemeColor = (property, fallback) => (
    getComputedStyle(document.documentElement).getPropertyValue(property).trim() || fallback
  );
  let hoverColor = getThemeColor("--grid-hover", "#5c5564");
  let gridLineColor = getThemeColor("--grid-line", "#2a2734");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const litCells = new Map();
  const cascades = [];
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let elapsed = 0;
  let previousFrame = 0;
  let animationFrame = 0;
  let pointerActive = false;
  let pointerX = 0;
  let pointerY = 0;
  let pointerVelocityX = 0;
  let pointerVelocityY = 0;
  let targetX = 0;
  let targetY = 0;
  let spotlight = 0;

  const cellKey = (column, row) => (column + 32768) * 65536 + row + 32768;

  const requestShapeGridFrame = () => {
    if (!animationFrame) animationFrame = window.requestAnimationFrame(animateShapeGrid);
  };

  const resizeShapeGrid = () => {
    const bounds = shapeGridContainer.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelCount = width * height * pixelRatio * pixelRatio;

    if (pixelCount > 8000000) {
      pixelRatio *= Math.sqrt(8000000 / pixelCount);
    }

    shapeGridCanvas.width = Math.max(1, Math.round(width * pixelRatio));
    shapeGridCanvas.height = Math.max(1, Math.round(height * pixelRatio));
    requestShapeGridFrame();
  };

  const drawShapeGrid = () => {
    const context = shapeGridContext;
    const startColumn = -1;
    const endColumn = Math.ceil(width / cellSize) + 1;
    const startRow = -1;
    const endRow = Math.ceil(height / cellSize) + 1;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, shapeGridCanvas.width, shapeGridCanvas.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.strokeStyle = gridLineColor;
    context.lineWidth = 1;
    context.beginPath();

    for (let x = 0; x <= width; x += cellSize) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }

    for (let y = 0; y <= height; y += cellSize) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }

    context.stroke();

    for (let column = startColumn; column <= endColumn; column += 1) {
      for (let row = startRow; row <= endRow; row += 1) {
        const key = cellKey(column, row);
        let value = litCells.get(key) || 0;
        const left = column * cellSize;
        const top = row * cellSize;
        const centerX = left + cellSize / 2;
        const centerY = top + cellSize / 2;

        for (const cascade of cascades) {
          const ring = Math.round(Math.hypot(centerX - cascade.x, centerY - cascade.y) / cellSize);
          const localTime = elapsed - cascade.time - ring * 0.055;
          if (localTime < 0) continue;
          const pulse = Math.exp(-((localTime / 0.085) ** 2))
            * Math.max(0, 1 - ring / cascade.reach);
          value = Math.max(value, pulse);
        }

        if (value <= 0.01) continue;

        context.beginPath();
        context.rect(left, top, cellSize, cellSize);
        context.globalAlpha = Math.min(1, value) * 0.15;
        context.fillStyle = hoverColor;
        context.fill();
        context.globalAlpha = Math.min(1, value) * 0.85;
        context.strokeStyle = hoverColor;
        context.lineWidth = 1 + value * 0.6;
        context.shadowColor = hoverColor;
        context.shadowBlur = 0.35 * 16 * value;
        context.stroke();
        context.shadowBlur = 0;
      }
    }

    context.globalAlpha = 1;
  };

  function animateShapeGrid(timestamp) {
    animationFrame = 0;
    const delta = previousFrame
      ? Math.min((timestamp - previousFrame) / 1000, 0.05)
      : 1 / 60;
    previousFrame = timestamp;
    elapsed += delta;

    const targetSpotlight = pointerActive ? 1 : 0;
    spotlight += (targetSpotlight - spotlight) * (1 - Math.exp(-(targetSpotlight ? 10 : 5) * delta));

    if (pointerActive) {
      const stiffness = 220;
      const damping = 2 * Math.sqrt(stiffness) * 0.85;
      pointerVelocityX += (stiffness * (targetX - pointerX) - damping * pointerVelocityX) * delta;
      pointerVelocityY += (stiffness * (targetY - pointerY) - damping * pointerVelocityY) * delta;
      pointerX += pointerVelocityX * delta;
      pointerY += pointerVelocityY * delta;
    } else {
      pointerVelocityX = 0;
      pointerVelocityY = 0;
    }

    if (spotlight > 0.01) {
      const centerColumn = Math.round(pointerX / cellSize - 0.5);
      const centerRow = Math.round(pointerY / cellSize - 0.5);
      const span = Math.ceil(hoverRadius / cellSize) + 2;

      for (let column = centerColumn - span; column <= centerColumn + span; column += 1) {
        for (let row = centerRow - span; row <= centerRow + span; row += 1) {
          const distance = Math.hypot(
            (column + 0.5) * cellSize - pointerX,
            (row + 0.5) * cellSize - pointerY,
          );
          const amount = Math.max(0, Math.min(1, (hoverRadius - distance) / (hoverRadius * 0.85)));
          const value = amount * amount * (3 - 2 * amount) * spotlight;
          const key = cellKey(column, row);
          if (value > (litCells.get(key) || 0)) litCells.set(key, value);
        }
      }
    }

    const decay = Math.exp(-delta / trail);
    for (const [key, value] of litCells) {
      const next = value * decay;
      if (next < 0.004) litCells.delete(key);
      else litCells.set(key, next);
    }

    const maximumCascadeAge = Math.hypot(width, height) / cellSize * 0.055 + 0.4;
    for (let index = cascades.length - 1; index >= 0; index -= 1) {
      if (elapsed - cascades[index].time > maximumCascadeAge) cascades.splice(index, 1);
    }

    drawShapeGrid();

    if (pointerActive || litCells.size || cascades.length || spotlight > 0.005) {
      requestShapeGridFrame();
    } else {
      previousFrame = 0;
    }
  }

  const onPointerMove = (event) => {
    if (reducedMotion.matches) return;
    const inside = event.clientX >= 0 && event.clientX <= width
      && event.clientY >= 0 && event.clientY <= height;

    if (!inside) {
      if (pointerActive) {
        pointerActive = false;
        requestShapeGridFrame();
      }
      return;
    }

    if (!pointerActive && spotlight < 0.02) {
      pointerX = event.clientX;
      pointerY = event.clientY;
    }

    pointerActive = true;
    targetX = event.clientX;
    targetY = event.clientY;
    requestShapeGridFrame();
  };

  const onPointerLeave = () => {
    pointerActive = false;
    requestShapeGridFrame();
  };

  const onPointerDown = (event) => {
    if (reducedMotion.matches) return;
    if (event.clientX < 0 || event.clientX > width || event.clientY < 0 || event.clientY > height) return;
    cascades.push({
      x: event.clientX,
      y: event.clientY,
      time: elapsed,
      reach: Math.hypot(width, height) / cellSize,
    });
    if (cascades.length > 6) cascades.shift();
    requestShapeGridFrame();
  };

  const resizeObserver = new ResizeObserver(resizeShapeGrid);
  resizeObserver.observe(shapeGridContainer);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("blur", onPointerLeave);
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      pointerActive = false;
      litCells.clear();
      cascades.length = 0;
    }
    requestShapeGridFrame();
  });
  resizeShapeGrid();
}
})();
