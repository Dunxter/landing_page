const svg = document.querySelector("svg");
const paths = [...svg.querySelectorAll("path")];

const POINTS = 200;
const STIFFNESS = 0.02;
const DAMPING = 0.5;
const MAX_STRETCH = 20;
const NEIGHBOR_FORCE = 0.18;
const GRAB_RADIUS = 200;

let dragging = null;
let allGroups = [];

// --- helpers ---
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// --- sample paths ---
paths.forEach(path => {
  const len = path.getTotalLength();
  const group = [];

  for (let i = 0; i < POINTS; i++) {
    const p = path.getPointAtLength((i / POINTS) * len);
    group.push({
      x: p.x,
      y: p.y,
      ox: p.x,
      oy: p.y,
      vx: 0,
      vy: 0,
      path
    });
  }

  allGroups.push(group);
});

// --- pointer ---
svg.addEventListener("pointerdown", e => {
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

window.addEventListener("pointerup", () => dragging = null);

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

        p.x = p.ox + dx * w * resistance;
        p.y = p.oy + dy * w * resistance;
      }
    });
  });
});

// --- animation ---
function tick() {
  allGroups.forEach(group => {
    group.forEach(p => {
      if (p !== dragging) {
        const fx = (p.ox - p.x) * STIFFNESS;
        const fy = (p.oy - p.y) * STIFFNESS;

        p.vx = (p.vx + fx) * DAMPING;
        p.vy = (p.vy + fy) * DAMPING;

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

      a.x += dx * NEIGHBOR_FORCE * 0.5;
      a.y += dy * NEIGHBOR_FORCE * 0.5;
      b.x -= dx * NEIGHBOR_FORCE * 0.5;
      b.y -= dy * NEIGHBOR_FORCE * 0.5;
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
