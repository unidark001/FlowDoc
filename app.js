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

const collaborationCard = document.querySelector(".bento-collaboration");

if (collaborationCard) {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cursors = [
    {
      element: collaborationCard.querySelector(".cursor-leo"),
      phase: 0,
      period: 12,
      radiusX: 12,
      radiusY: 4,
      wobbleX: 2,
      wobbleY: 1.5,
    },
    {
      element: collaborationCard.querySelector(".cursor-maya"),
      phase: 2.4,
      period: 14,
      radiusX: 10,
      radiusY: 5,
      wobbleX: 2.4,
      wobbleY: 1.5,
    },
  ].filter((cursor) => cursor.element);
  let motionSpeed = 0;
  let targetSpeed = 0;
  let animationFrame = 0;
  let previousFrameTime = 0;

  const animateCursors = (time) => {
    animationFrame = 0;
    const delta = previousFrameTime
      ? Math.min((time - previousFrameTime) / 1000, 0.05)
      : 0;
    previousFrameTime = time;
    motionSpeed += (targetSpeed - motionSpeed) * (1 - Math.exp(-delta / 0.65));

    cursors.forEach((cursor) => {
      cursor.phase += (delta * motionSpeed * 2 * Math.PI) / cursor.period;
      const x = cursor.radiusX * Math.cos(cursor.phase)
        + cursor.wobbleX * Math.sin(cursor.phase * 2);
      const y = cursor.radiusY * Math.sin(cursor.phase)
        + cursor.wobbleY * Math.sin(cursor.phase * 1.7);
      cursor.element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    });

    if (targetSpeed > 0 || motionSpeed > 0.003) {
      animationFrame = window.requestAnimationFrame(animateCursors);
    } else {
      motionSpeed = 0;
      previousFrameTime = 0;
    }
  };

  const setCursorMotion = (isHovered) => {
    collaborationCard.classList.add("cursors-active");
    targetSpeed = isHovered && !prefersReducedMotion.matches ? 1 : 0;

    if (!animationFrame && (targetSpeed > 0 || motionSpeed > 0.003)) {
      animationFrame = window.requestAnimationFrame(animateCursors);
    }
  };

  collaborationCard.addEventListener("pointerenter", () => setCursorMotion(true));
  collaborationCard.addEventListener("pointerleave", () => setCursorMotion(false));
}

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

const shapeGridContainer = document.querySelector(".page-shape-grid");
const shapeGridCanvas = shapeGridContainer?.querySelector(".shape-grid-canvas");
const shapeGridContext = shapeGridCanvas?.getContext("2d");

if (shapeGridContainer && shapeGridCanvas && shapeGridContext) {
  const cellSize = 40;
  const speed = 0.25;
  const trail = 0.6;
  const hoverRadius = cellSize * 1.5;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const litCells = new Map();
  const cascades = [];
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let offsetX = 0;
  let offsetY = 0;
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
    const diagonal = Math.hypot(width, height);
    const introRadius = reducedMotion.matches ? Infinity : elapsed * diagonal * 0.9;
    const introActive = Number.isFinite(introRadius) && introRadius < diagonal;
    const startColumn = Math.floor(offsetX / cellSize) - 1;
    const endColumn = Math.ceil((width + offsetX) / cellSize) + 1;
    const startRow = Math.floor(offsetY / cellSize) - 1;
    const endRow = Math.ceil((height + offsetY) / cellSize) + 1;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, shapeGridCanvas.width, shapeGridCanvas.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.strokeStyle = "#2a2734";
    context.lineWidth = 1;
    if (introActive) {
      context.save();
      context.beginPath();
      context.arc(width / 2, height / 2, introRadius, 0, Math.PI * 2);
      context.clip();
    }

    context.beginPath();

    const firstX = ((-offsetX % cellSize) + cellSize) % cellSize;
    const firstY = ((-offsetY % cellSize) + cellSize) % cellSize;

    for (let x = firstX; x <= width; x += cellSize) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }

    for (let y = firstY; y <= height; y += cellSize) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }

    context.stroke();
    if (introActive) context.restore();

    for (let column = startColumn; column <= endColumn; column += 1) {
      for (let row = startRow; row <= endRow; row += 1) {
        const key = cellKey(column, row);
        let value = litCells.get(key) || 0;
        const left = column * cellSize - offsetX;
        const top = row * cellSize - offsetY;
        const centerX = left + cellSize / 2;
        const centerY = top + cellSize / 2;

        if (introActive) {
          const front = introRadius - Math.hypot(centerX - width / 2, centerY - height / 2);
          if (front >= 0) {
            value = Math.max(value, Math.exp(-((front / (cellSize * 1.4)) ** 2)) * 0.85);
          }
        }

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
        context.fillStyle = "#ffffff";
        context.fill();
        context.globalAlpha = Math.min(1, value) * 0.85;
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1 + value * 0.6;
        context.shadowColor = "#ffffff";
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

    if (!reducedMotion.matches) {
      const direction = Math.SQRT1_2 * speed * 60 * delta;
      offsetX -= direction;
      offsetY += direction;
    }

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
      const worldX = pointerX + offsetX;
      const worldY = pointerY + offsetY;
      const centerColumn = Math.round(worldX / cellSize - 0.5);
      const centerRow = Math.round(worldY / cellSize - 0.5);
      const span = Math.ceil(hoverRadius / cellSize) + 2;

      for (let column = centerColumn - span; column <= centerColumn + span; column += 1) {
        for (let row = centerRow - span; row <= centerRow + span; row += 1) {
          const distance = Math.hypot(
            (column + 0.5) * cellSize - worldX,
            (row + 0.5) * cellSize - worldY,
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

    if (!reducedMotion.matches || pointerActive || litCells.size || cascades.length || elapsed < 1) {
      requestShapeGridFrame();
    } else {
      previousFrame = 0;
    }
  }

  const onPointerMove = (event) => {
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
  reducedMotion.addEventListener("change", requestShapeGridFrame);
  resizeShapeGrid();
}
