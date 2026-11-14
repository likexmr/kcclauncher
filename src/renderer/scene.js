// 홈 배경: 그림 파일 없이 그리는 픽셀 밤 풍경. 카드 크기를 3px 칸으로 나눈 해상도로 그려서 늘림(픽셀이 정사각형).
// 블록 지형 세 겹(멀수록 흐림)·나무·별 반짝임·달·천천히 흐르는 구름·반딧불. 창이 안 보이면 멈춘다.
(function () {
  const cv = document.getElementById("scene");
  if (!cv) return;
  const g = cv.getContext("2d");
  const PX = 3;
  let W = 0, H = 0, world = null;

  function makeRnd(seed) {
    return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  }

  function build() {
    const r = cv.parentElement.getBoundingClientRect();
    const w = Math.max(80, Math.ceil(r.width / PX)), h = Math.max(60, Math.ceil(r.height / PX));
    if (w === W && h === H && world) return;
    W = w; H = h; cv.width = W; cv.height = H;
    const rnd = makeRnd(1337);

    const noise = () => {
      const pts = Array.from({ length: 80 }, rnd);
      return (x) => {
        const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
        return pts[((i % 80) + 80) % 80] * (1 - t) + pts[(((i + 1) % 80) + 80) % 80] * t;
      };
    };
    // 블록 계단 지형: step 칸마다 높이가 바뀜
    const ridge = (base, amp, scale, step) => {
      const a = noise(), b = noise();
      const hs = new Int16Array(W + 64);
      for (let x = 0; x < hs.length; x++) {
        const bx = Math.floor(x / step) * step;
        hs[x] = Math.round(base - (a(bx / scale) * 0.75 + b(bx / (scale / 3)) * 0.25) * amp);
      }
      return hs;
    };
    const layers = [
      { hs: ridge(H * 0.62, H * 0.2, 34, 5), col: "#132c35", top: "#1a3a44", speed: 0.015 },
      { hs: ridge(H * 0.75, H * 0.13, 22, 4), col: "#0e2028", top: "#163039", speed: 0.04 },
      { hs: ridge(H * 0.88, H * 0.07, 14, 3), col: "#09141a", top: "#1d4a4c", speed: 0.09 },
    ];
    const trees = [];
    for (let i = 0; i < Math.round(W / 14); i++) trees.push({ x: Math.floor(rnd() * (W + 60)), h: 6 + Math.floor(rnd() * 6) });
    const stars = [];
    for (let i = 0; i < Math.round(W * H / 220); i++) stars.push({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * H * 0.55), p: rnd() * 6.28, s: rnd() });
    const clouds = [];
    for (let i = 0; i < 5; i++) clouds.push({ x: rnd() * W, y: Math.floor(H * 0.1 + rnd() * H * 0.25), w: 14 + Math.floor(rnd() * 22) });
    const flies = [];
    for (let i = 0; i < 10; i++) flies.push({ x: rnd() * W, y: H * 0.78 + rnd() * H * 0.18, p: rnd() * 6.28 });

    const sky = document.createElement("canvas");
    sky.width = W; sky.height = H;
    const s = sky.getContext("2d");
    const gr = s.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#06090e");
    gr.addColorStop(0.6, "#0b1820");
    gr.addColorStop(1, "#11282f");
    s.fillStyle = gr; s.fillRect(0, 0, W, H);
    // 오로라 띠(포인트 색 아주 옅게)
    for (let x = 0; x < W; x++) {
      const y = H * 0.22 + Math.sin(x / 19) * 5 + Math.sin(x / 7) * 1.5;
      for (let k = 0; k < 16; k++) {
        s.fillStyle = `rgba(79,209,197,${0.045 * (1 - k / 16)})`;
        s.fillRect(x, Math.round(y + k), 1, 1);
      }
    }
    world = { layers, trees, stars, clouds, flies, sky, moon: { x: Math.round(W * 0.8), y: Math.round(H * 0.12) } };
  }

  let t = 0, last = 0, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 66) return; // 15fps 면 충분
    last = now; t += 1;
    build();
    const { layers, trees, stars, clouds, flies, sky, moon } = world;

    g.drawImage(sky, 0, 0);

    for (const st of stars) {
      const a = 0.3 + 0.7 * Math.max(0, Math.sin(t * 0.05 * (0.5 + st.s) + st.p));
      g.fillStyle = `rgba(220,240,245,${a * (0.35 + st.s * 0.65)})`;
      g.fillRect(st.x, st.y, 1, 1);
    }

    // 달(네모, 둘레 옅은 빛)
    g.fillStyle = "rgba(217,239,233,.06)";
    g.fillRect(moon.x - 2, moon.y + 1, 12, 6); g.fillRect(moon.x + 1, moon.y - 2, 6, 12);
    g.fillStyle = "#d6ece6"; g.fillRect(moon.x, moon.y, 8, 8);
    g.fillStyle = "#b4d0ca"; g.fillRect(moon.x + 2, moon.y + 2, 2, 2); g.fillRect(moon.x + 5, moon.y + 5, 1, 1);

    for (const c of clouds) {
      c.x -= 0.05;
      if (c.x + c.w < 0) c.x = W + 4;
      const x = Math.round(c.x);
      g.fillStyle = "rgba(150,195,200,.06)";
      g.fillRect(x, c.y, c.w, 2);
      g.fillRect(x + 3, c.y - 1, c.w - 7, 1);
    }

    for (let i = 0; i < layers.length; i++) {
      const L = layers[i], n = L.hs.length;
      const off = Math.floor(t * L.speed);
      const at = (x) => L.hs[(((x + off) % n) + n) % n];
      g.fillStyle = L.col;
      for (let x = 0; x < W; x++) { const h = at(x); g.fillRect(x, h, 1, H - h); }
      g.fillStyle = L.top;
      for (let x = 0; x < W; x++) g.fillRect(x, at(x), 1, 1);
      if (i === 2) {
        g.fillStyle = "#050c10";
        for (const tr of trees) {
          const x = (((tr.x - off) % (W + 60)) + W + 60) % (W + 60) - 30;
          if (x < -6 || x > W + 6) continue;
          const base = at(x) + 1;
          g.fillRect(x, base - tr.h - 1, 1, tr.h + 1);
          for (let k = 0; k < tr.h - 1; k++) {
            const w = Math.floor((k + 1) / 2.4);
            g.fillRect(x - w, base - tr.h + k, w * 2 + 1, 1);
          }
        }
      }
    }

    for (const f of flies) {
      f.p += 0.06;
      const x = Math.round(f.x + Math.sin(f.p) * 6), y = Math.round(f.y + Math.cos(f.p * 0.7) * 3);
      g.fillStyle = `rgba(79,209,197,${0.25 + 0.75 * Math.max(0, Math.sin(f.p * 1.7))})`;
      g.fillRect(x, y, 1, 1);
    }
  }

  function run() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
  window.kccScene = { run, stop };
  run();
})();
