const svg = document.querySelector("svg");
const paths = [...svg.querySelectorAll("path")];

const POINTS = 100;
const STIFFNESS = 0.04;
const DAMPING = 0.5;
const MAX_STRETCH = 20;
const NEIGHBOR_FORCE = 0.18;
const GRAB_RADIUS = 100;
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const coneIntensity = 0.7;

const vb = svg.viewBox.baseVal;
const originalViewBox = {
  x: vb.x,
  y: vb.y,
  w: vb.width,
  h: vb.height
};


const size = 1417.32;
const zoom = 3;

const newSize = size / zoom;
const offset = (size - newSize) / 2;

svg.setAttribute ("viewBox", `${offset} ${offset} ${newSize} ${newSize}`)
const center = {
  x: offset + newSize / 2,
  y: offset + newSize / 2
};


let dragging = null;
let allGroups = [];
let isDragging = false;
let grabStrength = 0;
let pressure = 0; // 0 → normal, 1 → collapse
let breath = 0;
let breathPhase = 0;
let effectivePoints = POINTS;
let disableStrengthVariation = false;
let hasExitedSite = false;

let fadeT = 0;               // 0 → normal, 1 → white
let fadeActive = false;
const FADE_DURATION = 7000; // ms


const hint = document.getElementById("scroll-hint");

let hintTimer = null;
let hintVisible = false;
let hintDisabledForever = false;

// start timer on load
hintTimer = setTimeout(() => {
  if (!hintDisabledForever) {
    hint.style.opacity = 1;
    hintVisible = true;
  }
}, 3000);


window.addEventListener("wheel", e => {
  pressure += e.deltaY * 0.00045;
  pressure = clamp01(pressure);

  // --- handle hint ---
  if (!hintDisabledForever) {
    hintDisabledForever = true;
    clearTimeout(hintTimer);

    if (hintVisible) {
      hint.style.opacity = 0;
      hintVisible = false;
    }
  }

}, { passive: true });

// --- helpers ---
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const easeInOutCubic = t =>
  t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;

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

// --- pointer ---
svg.addEventListener("pointerdown", e => {
  if (fadeActive) return; // 👈 disable interaction during fade
  
  svg.setPointerCapture(e.pointerId);
  grabStrength = 0;
  isDragging = true;
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

  dragging = best;
});

window.addEventListener("pointerup", e => {
  try { svg.releasePointerCapture(e.pointerId); } catch {}
  isDragging = false;
  dragging = null
  allGroups.forEach(group => {
  group.forEach(p => {
      p.tx = p.ox;
      p.ty = p.oy;
    });
  });
});

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

function mix(a, b, t) {
return Math.round(a + (b - a) * t);
}

function updateBackground() {
  const t = clamp01(pressure / 0.5); // only first half

  const r = Math.round(mix(139, 255, t));
  const g = Math.round(mix(154, 255, t));
  const b = Math.round(mix(191, 255, t));

  document.body.style.backgroundColor = `rgb(${r},${g},${b})`;
}

function updateLogoColor() {
  // --- stage 1: scroll-based color (white → bluish)
  const tScroll = clamp01((pressure - 0.5) / 0.5);

  const baseR = mix(255, 139, tScroll);
  const baseG = mix(255, 154, tScroll);
  const baseB = mix(255, 191, tScroll);

  // --- stage 2: eased fade to white
  const easedFade = easeInOutCubic(fadeT);

  const r = mix(baseR, 255, easedFade);
  const g = mix(baseG, 255, easedFade);
  const b = mix(baseB, 255, easedFade);

  const fill = `rgb(${r},${g},${b})`;

  document.querySelectorAll("#outer, #shape2")
    .forEach(p => p.setAttribute("fill", fill));
}




// --- animation ---
function tick() {

  // --- fade logic ---
if (fadeActive) {
  fadeT += 1 / (FADE_DURATION / 16.666); // frame-based, ~60fps
} else {
  fadeT -= 1 / (FADE_DURATION / 16.666);
}

fadeT = clamp01(fadeT);

if (fadeT >= 1 && pressure >= 1 && !hasExitedSite) {
  window.location.href = "https://gerardsanmiguel.com/";
  hasExitedSite = true;
}

updateBackground();
updateLogoColor();
  
  breathPhase += 0.01;
  
  const energy = clamp01(pressure);

  const effectiveStiffness =
    STIFFNESS * lerp(1.0, 2.5, energy);

  const effectiveNeighbor =
  NEIGHBOR_FORCE * lerp(1.0, 0.25, energy);


  if (!disableStrengthVariation) {
    if (isDragging) {
      grabStrength = Math.min(1, grabStrength + 0.08);
      } else {
        grabStrength = 0;
      }
  }

  


  allGroups.forEach(group => {
    group.forEach(p => {

      p.x = lerp(p.x, p.tx, grabStrength);
      p.y = lerp(p.y, p.ty, grabStrength);

      if (!isDragging) {
        


        let restX = p.ox;
        let restY = p.oy;

        // vector from point → center
        const dx = center.x - p.ox;
        const dy = center.y - p.oy;

        const dist = Math.hypot(dx, dy) + 0.0001;

        // cone amount (non-linear so it feels organic)
        const cone = pressure * pressure;

        let pull = cone * -coneIntensity;

        if (pressure >= 1) {
          disableStrengthVariation = true;
          grabStrength = 2.01;

          fadeActive = true;
      } else {
          disableStrengthVariation = false;
          fadeActive = false;
      }

        restX += dx * pull;
        restY += dy * pull;

  
        const amp = 3.5; // keep small
        restX += Math.sin(breathPhase + p.ox * 0.01) * amp;
        restY += Math.cos(breathPhase + p.oy * 0.01) * amp;

        

        const fx = (restX - p.x) * effectiveStiffness;
        const fy = (restY - p.y) * effectiveStiffness;

        const damp = lerp(0.55, 0.88, energy);

        p.vx = (p.vx + fx) * damp;
        p.vy = (p.vy + fy) * damp;

        p.x += p.vx;
        p.y += p.vy;

        
      }
    });
    

    // neighbor cohesion (local, not global)
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      const b = group[(i + 1) % group.length];

      const dx = b.x - a.x;
      const dy = b.y - a.y;

    const restDx = b.ox - a.ox;
    const restDy = b.oy - a.oy;

    const fx = (dx - restDx) * effectiveNeighbor;;
    const fy = (dy - restDy) * effectiveNeighbor;;

    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
    }

    // --- smooth CLOSED path ---
let d = "";

// start at midpoint between first two points
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
