const svg = document.querySelector("svg");
const paths = [...svg.querySelectorAll("path")];

const POINTS = 100;
const STIFFNESS = 0.04;
const DAMPING = 0.5;
const MAX_STRETCH = 20;
const NEIGHBOR_FORCE = 0.18;
const GRAB_RADIUS = 100;
const coneIntensity = 0.7;
const FADE_DURATION = 3000; // ms

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const easeInOutCubic = t =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const mix = (a, b, t) => Math.round(a + (b - a) * t);

const vb = svg.viewBox.baseVal;
const originalViewBox = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };

const size = 1417.32;
const zoom = 3;
const newSize = size / zoom;
const offset = (size - newSize) / 2;

svg.setAttribute("viewBox", `${offset} ${offset} ${newSize} ${newSize}`);

const center = { x: offset + newSize / 2, y: offset + newSize / 2 };

// --- state ---
let dragging = null;
let isDragging = false;
let grabStrength = 0;
let pressure = 0; // 0 → normal, 1 → collapse
let breath = 0;
let breathPhase = 0;
let effectivePoints = POINTS;
let disableStrengthVariation = false;
let hasExitedSite = false;
let pull_multiplier = 1;

let fadeStartTime = null;
let fadeT = 0; // 0 → normal, 1 → white
let fadeActive = false;

let collapseProgress = 0; // 0 → no collapse, 1 → full cone

let limitScroll = 0.9;

let allGroups = [];

let isPenActive = false;

window.onbeforeunload = function () {
  document.querySelector('html').style.scrollBehavior = '';
  window.scrollTo(0, 0);
  return;
}


const progressTop = document.querySelector(".progress-top");


// --- scroll hint ---
const hint = document.getElementById("scroll-hint");
const scrollIcon = hint.querySelector(".scroll-icon");
const scrollArrow = hint.querySelector(".scroll-arrow");

function updateScrollHintForDevice() {
  if (isTouchDevice || isPenActive) {
    // Touch device: show swipe text and invert icon animation
    scrollIcon.style.setProperty('--initialTranslate', '12px');
    scrollIcon.style.setProperty('--finalTranslate', '-12px');
    scrollArrow.textContent = '↑  swipe  ↑';  // upper arrow
  } else {
    // PC: default down arrow and animation
    scrollArrow.textContent = '↓  scroll  ↓';
  }
}

// Call this once on load
updateScrollHintForDevice();

let hintTimer = null;
let idleTimer = null;
let hintVisible = false;
let arrowVisible = false;
const IDLE_DELAY = 6000; // 7 seconds

scrollIcon.style.pointerEvents = "none";
scrollArrow.style.pointerEvents = "none";

function showHintIcon() {
  hint.style.opacity = 1;
  scrollIcon.style.opacity = 1;
  scrollIcon.style.pointerEvents = "auto";
  scrollArrow.style.opacity = 0;
  scrollArrow.style.pointerEvents = "none";
  hintVisible = true;
  arrowVisible = false;
}

function showArrowText() {
  scrollIcon.style.opacity = 0;
  scrollIcon.style.pointerEvents = "none";
  scrollArrow.style.opacity = 1;
  scrollArrow.style.pointerEvents = "auto";
  arrowVisible = true;
  hintVisible = false;
}

function startIconTimer() {
  // Initial hint after 3s
  hintTimer = setTimeout(() => {
    
    if (fadeActive) {resetIdleTimer(); return;}
    
    showHintIcon();
    startIdleTimer();
  }, 3000);
}

startIconTimer()

// Start idle timer
function startIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showArrowText();
  }, IDLE_DELAY);
}


function resetIdleTimer() {
  clearTimeout(idleTimer);
  startIconTimer();
}

function updatePressureFromScroll() {
  const scrollMax = document.documentElement.scrollHeight - window.innerHeight;

  if (scrollMax <= 0) return;

  const scrollY = window.scrollY;

  pressure = clamp01(scrollY / scrollMax);

  // Only hide hint when user hits the bottom
  if ((hintVisible || arrowVisible) && pressure >= limitScroll) {
    scrollIcon.style.opacity = 0;
    scrollArrow.style.opacity = 0;
    scrollIcon.style.pointerEvents = "none";
    scrollArrow.style.pointerEvents = "none";
    hintVisible = false;
    arrowVisible = false;
    resetIdleTimer();
  }


}

window.addEventListener("scroll", () => {
  updatePressureFromScroll();

}, { passive: true });

// Scroll to bottom on click
[scrollIcon, scrollArrow].forEach(el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });

    scrollIcon.style.opacity = 0;
    scrollArrow.style.opacity = 0;
    scrollIcon.style.pointerEvents = "none";
    scrollArrow.style.pointerEvents = "none";
  });
});


// --- sample paths ---
paths.forEach(path => {
  const len = path.getTotalLength();
  const group = [];

  for (let i = 0; i < effectivePoints; i++) {
    const p = path.getPointAtLength((i / effectivePoints) * len);
    group.push({
      x: p.x,
      y: p.y,
      tx: p.x,
      ty: p.y,
      ox: p.x,
      oy: p.y,
      vx: 0,
      vy: 0,
      grabbed: false,
      path
    });
  }

  allGroups.push(group);
});

// --- pointer events ---

window.addEventListener("pointercancel", resetInteraction);

function resetInteraction(e) {
  try {
    if (e && e.pointerId) {
      svg.releasePointerCapture(e.pointerId);
    }
  } catch {}

  isDragging = false;
  dragging = null;

  allGroups.forEach(group => {
    group.forEach(p => {
      p.tx = p.ox;
      p.ty = p.oy;
    });
  });
}


svg.addEventListener("pointerdown", e => {
  if (e.pointerType == "pen") {
    isPenActive = true;
    updateScrollHintForDevice();
  }
  if (fadeActive) return;

  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const m = pt.matrixTransform(svg.getScreenCTM().inverse());

  let best = null;
  let dmin = 9999;

  allGroups.flat().forEach(p => {
    const d = dist(p, m);
    if (d < dmin) {
      dmin = d;
      best = p;
    }
  });

  // Only start dragging if close enough
  if (dmin < GRAB_RADIUS) {
    svg.setPointerCapture(e.pointerId);
    isDragging = true;
    grabStrength = 0;
    dragging = best;
  }
});

window.addEventListener("pointerup", resetInteraction);

window.addEventListener("pointermove", e => {
  if (!dragging) return;

  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const m = pt.matrixTransform(svg.getScreenCTM().inverse());

  allGroups.forEach(group => {
    group.forEach(p => {
      const d = Math.hypot(p.ox - dragging.ox, p.oy - dragging.oy);

      if (d < GRAB_RADIUS) {
        const w = 1 - d / GRAB_RADIUS;
        const dx = m.x - p.ox;
        const dy = m.y - p.oy;
        const stretch = Math.hypot(dx, dy);
        const resistance = 1 / (1 + stretch / MAX_STRETCH);

        p.tx = p.ox + dx * w * resistance;
        p.ty = p.oy + dy * w * resistance;
      }
    });
  });
});

// --- update visuals ---
function updateBackground() {
  const t = clamp01(pressure / (limitScroll/2));
  const r = mix(139, 255, t);
  const g = mix(154, 255, t);
  const b = mix(191, 255, t);

  document.body.style.backgroundColor = `rgb(${r},${g},${b})`;
}

function updateLogoColor() {
  const tScroll = clamp01((pressure - (limitScroll/2)) / (limitScroll/2));

  const baseR = mix(255, 139, tScroll);
  const baseG = mix(255, 154, tScroll);
  const baseB = mix(255, 191, tScroll);

  const easedFade = easeInOutCubic(fadeT);

  const r = mix(baseR, 255, easedFade);
  const g = mix(baseG, 255, easedFade);
  const b = mix(baseB, 255, easedFade);

  const fill = `rgb(${r},${g},${b})`;

  document.querySelectorAll("#outer, #shape2")
    .forEach(p => p.setAttribute("fill", fill));

  scrollIcon.style.color = fill;
  scrollArrow.style.color = fill;
}



// --- animation loop ---
function tick() {
  // fade logic
  const now = performance.now();

  if (fadeActive) {
    if (!fadeStartTime) fadeStartTime = now;

    const elapsed = now - fadeStartTime;
    fadeT = clamp01(elapsed / FADE_DURATION);
    const barProgress = Math.min(elapsed / FADE_DURATION, 1);

    progressTop.style.width = `${barProgress * 100}%`;

    // END BEHAVIOUR PER FRAME
    const t = easeInOutCubic(fadeT);

    // collapse grows nonlinearly
    collapseProgress = t * t; 

    // amplify inward pull progressively
    pull_multiplier = lerp(0, -1, collapseProgress);
    
  } else {
    fadeStartTime = null;
    fadeT = clamp01(fadeT - 0.02); // smooth reverse
    pull_multiplier = 1;
    collapseProgress = 0;
  }

  if (fadeT >= 1 && !hasExitedSite) {
    window.location.href = "https://gerardsanmiguel.com/";
    hasExitedSite = true;
  }

  updateBackground();
  updateLogoColor();

  breathPhase += 0.01;
  const energy = clamp01(pressure);
  const effectiveStiffness = STIFFNESS * lerp(1.0, 2.5, energy);
  const effectiveNeighbor = NEIGHBOR_FORCE * lerp(1.0, 0.25, energy);

  if (!disableStrengthVariation) {
    grabStrength = isDragging ? Math.min(1, grabStrength + 0.08) : 0;
  }

  allGroups.forEach(group => {
    group.forEach(p => {
      p.x = lerp(p.x, p.tx, grabStrength);
      p.y = lerp(p.y, p.ty, grabStrength);

      if (!isDragging) {
        let restX = p.ox;
        let restY = p.oy;

        const dx = center.x - p.ox;
        const dy = center.y - p.oy;
        const dist = Math.hypot(dx, dy) + 0.0001;

        const cone = pressure * pressure;
        let pull = cone * -coneIntensity * pull_multiplier;

                // EXTRA collapse bias during fade
        if (fadeActive) {
          const inward = collapseProgress * 0.25; 
          restX += dx * inward;
          restY += dy * inward;
        }

        if (pressure >= limitScroll) {
          disableStrengthVariation = true;
          fadeActive = true;
          grabStrength = 2;

          //fade active
        } else {
          disableStrengthVariation = false;
          fadeActive = false;
          progressTop.style.width = "0%";
        }

        restX += dx * pull + Math.sin(breathPhase + p.ox * 0.01) * 3.5;
        restY += dy * pull + Math.cos(breathPhase + p.oy * 0.01) * 3.5;

        const fx = (restX - p.x) * effectiveStiffness;
        const fy = (restY - p.y) * effectiveStiffness;

        const damp = lerp(0.55, 0.88, energy);

        p.vx = (p.vx + fx) * damp;
        p.vy = (p.vy + fy) * damp;

        p.x += p.vx;
        p.y += p.vy;
      }
    });

    // neighbor cohesion
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      const b = group[(i + 1) % group.length];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const restDx = b.ox - a.ox;
      const restDy = b.oy - a.oy;

      const fx = (dx - restDx) * effectiveNeighbor;
      const fy = (dy - restDy) * effectiveNeighbor;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // smooth closed path
    let d = "";
    const first = group[0];
    const second = group[1];
    let mx = (first.x + second.x) / 2;
    let my = (first.y + second.y) / 2;

    d += `M ${mx} ${my}`;

    for (let i = 1; i < group.length; i++) {
      const curr = group[i];
      const next = group[(i + 1) % group.length];
      const cx = curr.x;
      const cy = curr.y;
      const nx = (curr.x + next.x) / 2;
      const ny = (curr.y + next.y) / 2;
      d += ` Q ${cx} ${cy} ${nx} ${ny}`;
    }

    d += " Z";
    group[0].path.setAttribute("d", d);

    
  });

  requestAnimationFrame(tick);
}

tick();