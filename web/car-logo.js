(function () {
"use strict";
/* Wyze Car — klein 3D-model met eigen SVG-renderer.
   Eenheden: pixels van de orthografische productfoto's (bandhoogte 182 px).
   Assen: X = linkerzijde van de auto, Y = omhoog, Z = voorwaarts.
   Maten komen uit de gemeten silhouetten van zij-, voor- en onderaanzicht. */
function WyzeCar() {
  "use strict";
  var M = Math, PI = M.PI, TAU = 2 * PI;

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function crs(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return M.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function nrm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  /* ---------------- materialen ----------------
     c = albedo (lineair), s = glans, p = scherpte, e = eigen licht */
  var MAT = {
    body:   { c: [.030, .031, .033], s: .22, p: 22 },
    under:  { c: [.019, .020, .021], s: .12, p: 16 },
    strap:  { c: [.044, .044, .045], s: .06, p: 10 },
    tread:  { c: [.034, .034, .035], s: .08, p: 12 },
    groove: { c: [.020, .020, .021], s: .02, p: 8 },
    side:   { c: [.030, .030, .031], s: .06, p: 10 },
    rim:    { c: [.016, .016, .018], s: .25, p: 30 },
    spoke:  { c: [.052, .053, .056], s: .50, p: 40 },
    bead:   { c: [.042, .043, .046], s: .45, p: 40 },
    bolt:   { c: [.130, .132, .140], s: .70, p: 50 },
    hub:    { c: [.060, .061, .064], s: .60, p: 40 },
    cam:    { c: [.034, .035, .037], s: .28, p: 30 },
    metal:  { c: [.25, .26, .275], s: .90, p: 18 },
    engr:   { c: [.16, .165, .17], s: .30, p: 20 },
    tube:   { c: [.034, .035, .037], s: .55, p: 34 },
    spring: { c: [.030, .030, .032], s: .40, p: 30 },
    bezel:  { c: [.012, .012, .014], s: .95, p: 70 },
    bezel2: { c: [.020, .020, .023], s: .95, p: 70 },
    ring:   { c: [.120, .125, .135], s: .90, p: 60 },
    glass:  { c: [.004, .005, .008], s: 1.2, p: 90 },
    frame:  { c: [.010, .010, .011], s: .30, p: 30 },
    ridge:  { c: [.050, .050, .052], s: .15, p: 16 },
    hole:   { c: [.004, .004, .005], s: 0, p: 1 },
    led:    { e: [.86, .70, .24] },
    ledHi:  { e: [1.0, .88, .44] },
    ledDot: { e: [.55, .44, .20] }
  };

  /* ---------------- geometrie-opslag ---------------- */
  var faces = [], tubes = [], balls = [], shocks = [];

  function newell(p) {
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < p.length; i++) {
      var a = p[i], b = p[(i + 1) % p.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return nrm([nx, ny, nz]);
  }
  function centroid(p) {
    var c = [0, 0, 0];
    for (var i = 0; i < p.length; i++) { c[0] += p[i][0]; c[1] += p[i][1]; c[2] += p[i][2]; }
    return scl(c, 1 / p.length);
  }
  /* Een vlak; `out` wijst naar buiten, zodat de windingsrichting klopt. */
  function face(p, m, out, bias) {
    var n = newell(p);
    if (out && dot(n, out) < 0) { p = p.slice().reverse(); n = scl(n, -1); }
    var f = { p: p, m: m, n: n, c: centroid(p), bias: bias || 0, dec: null };
    faces.push(f);
    return f;
  }
  /* Een decal ligt in het vlak van zijn drager en wordt direct erna getekend.
     Meerdere contouren mogen (gaten: tegengestelde draairichting). */
  function decal(parent, contours, m) {
    var n = newell(contours[0]);
    if (dot(n, parent.n) < 0) contours = contours.map(function (c) { return c.slice().reverse(); });
    (parent.dec || (parent.dec = [])).push({ cs: contours, m: m });
  }
  function frame2(o, u, v) {
    return function (a, b) { return [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b]; };
  }
  function circ(F, cx, cy, r, n, rev) {
    var p = [];
    for (var i = 0; i < n; i++) { var t = (rev ? -1 : 1) * i / n * TAU; p.push(F(cx + r * M.cos(t), cy + r * M.sin(t))); }
    return p;
  }
  function rrect(F, x0, y0, x1, y1, r, seg) { /* afgeronde rechthoek, CCW */
    var p = [], cs = [[x1 - r, y0 + r, -PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, PI / 2], [x0 + r, y0 + r, PI]];
    for (var k = 0; k < 4; k++) for (var i = 0; i <= seg; i++) {
      var t = cs[k][2] + i / seg * PI / 2; p.push(F(cs[k][0] + r * M.cos(t), cs[k][1] + r * M.sin(t)));
    }
    return p;
  }

  /* Rechthoek in een vlak, onderverdeeld in tegels: kleine vlakken sorteren beter. */
  function quad3(o, U, V, a0, a1, b0, b1, m, out, cell, bias) {
    var nx = cell ? M.max(1, M.round((a1 - a0) / cell)) : 1, ny = cell ? M.max(1, M.round((b1 - b0) / cell)) : 1;
    var F = frame2(o, U, V), res = [];
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var A0 = a0 + (a1 - a0) * i / nx, A1 = a0 + (a1 - a0) * (i + 1) / nx;
      var B0 = b0 + (b1 - b0) * j / ny, B1 = b0 + (b1 - b0) * (j + 1) / ny;
      res.push(face([F(A0, B0), F(A1, B0), F(A1, B1), F(A0, B1)], m, out, bias));
    }
    return res;
  }
  var EX = [1, 0, 0], EY = [0, 1, 0], EZ = [0, 0, 1];
  function qX(x, y0, y1, z0, z1, s, m, cell) { return quad3([x, 0, 0], EY, EZ, y0, y1, z0, z1, m, [s, 0, 0], cell); }
  function qY(y, x0, x1, z0, z1, s, m, cell) { return quad3([0, y, 0], EX, EZ, x0, x1, z0, z1, m, [0, s, 0], cell); }
  function qZ(z, x0, x1, y0, y1, s, m, cell) { return quad3([0, 0, z], EX, EY, x0, x1, y0, y1, m, [0, 0, s], cell); }
  function box(x0, x1, y0, y1, z0, z1, m, skip, cell) {
    skip = skip || "";
    if (skip.indexOf("px") < 0) qX(x1, y0, y1, z0, z1, 1, m, cell);
    if (skip.indexOf("nx") < 0) qX(x0, y0, y1, z0, z1, -1, m, cell);
    if (skip.indexOf("py") < 0) qY(y1, x0, x1, z0, z1, 1, m, cell);
    if (skip.indexOf("ny") < 0) qY(y0, x0, x1, z0, z1, -1, m, cell);
    if (skip.indexOf("pz") < 0) qZ(z1, x0, x1, y0, y1, 1, m, cell);
    if (skip.indexOf("nz") < 0) qZ(z0, x0, x1, y0, y1, -1, m, cell);
  }
  /* Rechthoek met banden (riemen) van ander materiaal langs één as. */
  function bandedZ(fn, lo, hi, cuts, bands, m, mb, step) {
    var zs = [lo, hi].concat(cuts.filter(function (z) { return z > lo && z < hi; }));
    zs.sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < zs.length - 1; i++) {
      var a = zs[i], b = zs[i + 1], n = M.max(1, M.round((b - a) / step));
      var mid = (a + b) / 2, inBand = bands.some(function (bd) { return mid > bd[0] && mid < bd[1]; });
      for (var k = 0; k < n; k++) out.push(fn(a + (b - a) * k / n, a + (b - a) * (k + 1) / n, inBand ? mb : m));
    }
    return out;
  }
  /* Vlakke veelhoek in 2D-kader, bijgesneden op een raster. */
  function clipRect(poly, x0, x1, y0, y1) {
    function clip(p, inside, inter) {
      var o = [];
      for (var i = 0; i < p.length; i++) {
        var a = p[i], b = p[(i + 1) % p.length], ia = inside(a), ib = inside(b);
        if (ia) o.push(a);
        if (ia !== ib) o.push(inter(a, b));
      }
      return o;
    }
    function ix(x) { return function (a, b) { var t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + (b[1] - a[1]) * t]; }; }
    function iy(y) { return function (a, b) { var t = (y - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y]; }; }
    var p = poly;
    p = clip(p, function (q) { return q[0] >= x0; }, ix(x0)); if (p.length < 3) return p;
    p = clip(p, function (q) { return q[0] <= x1; }, ix(x1)); if (p.length < 3) return p;
    p = clip(p, function (q) { return q[1] >= y0; }, iy(y0)); if (p.length < 3) return p;
    p = clip(p, function (q) { return q[1] <= y1; }, iy(y1));
    return p;
  }
  function area2(p) { var s = 0; for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  function planar(poly, F, m, out, cell) {
    var xs = poly.map(function (q) { return q[0]; }), ys = poly.map(function (q) { return q[1]; });
    var x0 = M.min.apply(0, xs), x1 = M.max.apply(0, xs), y0 = M.min.apply(0, ys), y1 = M.max.apply(0, ys);
    var nx = M.max(1, M.round((x1 - x0) / cell)), ny = M.max(1, M.round((y1 - y0) / cell)), res = [];
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var pc = clipRect(poly, x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx, y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny);
      if (pc.length >= 3 && M.abs(area2(pc)) > 1) res.push(face(pc.map(function (q) { return F(q[0], q[1]); }), m, out));
    }
    return res;
  }
  /* Georiënteerde balk van p0 naar p1; `up` bepaalt de hoogterichting. */
  function obox(p0, p1, up, h, w, m) {
    var t = nrm(sub(p1, p0)), s = nrm(crs(t, up)), u = crs(s, t);
    var c = mix(p0, p1, .5), res = {};
    function P(e, a, b) { return add(e, add(scl(u, a * h / 2), scl(s, b * w / 2))); }
    var q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    var A = q.map(function (k) { return P(p0, k[0], k[1]); }), B = q.map(function (k) { return P(p1, k[0], k[1]); });
    res.sides = [];
    for (var i = 0; i < 4; i++) {
      var j = (i + 1) % 4, f = [A[i], A[j], B[j], B[i]];
      res.sides.push(face(f, m, sub(centroid(f), c)));
    }
    face(A.slice(), m, scl(t, -1)); face(B.slice(), m, t);
    res.u = u; res.s = s; res.t = t;
    res.facing = function (d) { var b = null, bd = -2; res.sides.forEach(function (f) { var q = dot(f.n, d); if (q > bd) { bd = q; b = f; } }); return b; };
    return res;
  }

  /* ---------------- buizen en bollen (penseelstreken) ---------------- */
  function bez(a, c, b, s) { var t = 1 - s; return add(add(scl(a, t * t), scl(c, 2 * t * s)), scl(b, s * s)); }
  function fillet(pts, rad, seg) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var p = pts[i], a = sub(pts[i - 1], p), b = sub(pts[i + 1], p), la = len(a), lb = len(b);
      a = scl(a, 1 / la); b = scl(b, 1 / lb);
      var ang = M.acos(M.max(-1, M.min(1, dot(a, b))));
      if (ang > PI - .02) { out.push(p); continue; }
      var t = M.min(rad / M.tan(ang / 2), la * .48, lb * .48);
      var p1 = add(p, scl(a, t)), p2 = add(p, scl(b, t));
      for (var k = 0; k <= seg; k++) out.push(bez(p1, p, p2, k / seg));
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function splitLong(pts, maxL) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], n = M.ceil(len(sub(b, a)) / maxL);
      for (var k = 1; k <= n; k++) out.push(mix(a, b, k / n));
    }
    return out;
  }
  function tube(pts, r, m, opt) {
    opt = opt || {};
    var p = opt.fillet ? fillet(pts, opt.fillet, opt.seg || 4) : pts;
    p = splitLong(p, opt.maxL || 45);
    /* opeenvolgende korte stukken (bochten) vormen samen één 'run' zonder naden */
    var runs = [], start = 0, acc = 0, runL = opt.run || 46;
    for (var i = 0; i < p.length - 1; i++) {
      acc += len(sub(p[i + 1], p[i]));
      if (acc >= runL * .8 || i === p.length - 2) { runs.push([start, i + 1]); start = i + 1; acc = 0; }
    }
    tubes.push({ p: p, runs: runs, r: r, m: m, hl: opt.hl !== false, caps: opt.caps !== false });
  }
  function ball(c, r, m) { balls.push({ c: c, r: r, m: m }); }

  /* =====================================================================
     HET MODEL
     ===================================================================== */
  var WB = 226.5, TR = 170.5, WR = 91;   /* halve wielbasis, halve spoorbreedte, bandstraal */

  /* ---------- wielen ---------- */
  function wheel(cx, cy, cz, s, phase) {
    /* Ronde ballonband (vooraanzicht: 70 breed), 20 noppen per rij in V-patroon.
       u = axiaal vanaf het bandmidden (naar buiten +), r = straal. */
    var NL = 20, NH = 2 * NL, dth = TAU / NH, C = [cx, cy, cz];
    function P(u, r, th) { return [cx + s * u, cy + r * M.cos(th), cz + r * M.sin(th)]; }
    var BASE = [[0, 86.5], [16, 85.8], [24, 83.3], [28.5, 78.5], [30.5, 71.5]];
    var SIDE = [[30.5, 71.5], [30, 62.5], [26.5, 54]];
    /* nop = basisprofiel 4,5 naar buiten langs de profielnormaal */
    var LUG = BASE.map(function (p, i) {
      var a = BASE[M.max(0, i - 1)], b = BASE[M.min(BASE.length - 1, i + 1)];
      var du = b[0] - a[0], dr = b[1] - a[1], l = M.hypot(du, dr);
      return [i === 0 ? 0 : p[0] - 4.5 * dr / l, p[1] + 4.5 * du / l];
    });
    var SK = .8 * dth, UE = BASE[BASE.length - 1][0];
    function sh(u) { return SK * M.min(1, M.abs(u) / UE); }
    function isLug(j, h) { return ((j + (h > 0 ? 0 : 1)) % 2 + 2) % 2 === 0; }
    var j, k, last = BASE.length - 1;
    for (j = 0; j < NH; j++) {
      var ta = j * dth + phase, tb = (j + 1) * dth + phase;
      [1, -1].forEach(function (h) {
        var lug = isLug(j, h), pr = lug ? LUG : BASE, q;
        for (k = 0; k < last; k++) {
          var u0 = pr[k][0], r0 = pr[k][1], u1 = pr[k + 1][0], r1 = pr[k + 1][1];
          q = [P(h * u0, r0, ta + sh(u0)), P(h * u1, r1, ta + sh(u1)), P(h * u1, r1, tb + sh(u1)), P(h * u0, r0, tb + sh(u0))];
          face(q, lug ? "tread" : (k >= 2 ? "side" : "groove"), sub(centroid(q), C));
        }
        if (lug) {
          var a = LUG[last], b = BASE[last], tm = (ta + tb) / 2;
          q = [P(h * a[0], a[1], ta + sh(a[0])), P(h * a[0], a[1], tb + sh(a[0])), P(h * b[0], b[1], tb + sh(b[0])), P(h * b[0], b[1], ta + sh(b[0]))];
          face(q, "side", [0, -M.cos(tm), -M.sin(tm)]);
          q = [P(0, LUG[0][1], ta), P(0, LUG[0][1], tb), P(0, BASE[0][1], tb), P(0, BASE[0][1], ta)];
          face(q, "tread", [-h * s, 0, 0]);
        }
        if (lug !== isLug(j + 1, h)) {
          var pts = [];
          LUG.forEach(function (w) { pts.push(P(h * w[0], w[1], tb + sh(w[0]))); });
          for (k = last; k >= 0; k--) pts.push(P(h * BASE[k][0], BASE[k][1], tb + sh(BASE[k][0])));
          var t = [0, -M.sin(tb), M.cos(tb)];
          face(pts, "tread", lug ? t : scl(t, -1));
        }
      });
    }
    /* zijwand per twee halve vakken: vijfhoek boven (sluit aan op de noppen), vierhoek onder */
    var so = sh(UE);
    for (j = 0; j < NH; j += 2) {
      var a0 = j * dth + phase + so, a1 = (j + 1) * dth + phase + so, a2 = (j + 2) * dth + phase + so;
      [1, -1].forEach(function (h) {
        var S0 = SIDE[0], S1 = SIDE[1], S2 = SIDE[2];
        face([P(h * S0[0], S0[1], a0), P(h * S0[0], S0[1], a1), P(h * S0[0], S0[1], a2), P(h * S1[0], S1[1], a2), P(h * S1[0], S1[1], a0)], "side", [h * s, 0, 0]);
        face([P(h * S1[0], S1[1], a0), P(h * S1[0], S1[1], a2), P(h * S2[0], S2[1], a2), P(h * S2[0], S2[1], a0)], "side", [h * s, 0, 0]);
      });
    }
    var ro = [], ri = [], RU = SIDE[2][0], RR = SIDE[2][1];
    for (j = 0; j < NH; j++) { var th = j * dth + phase + so; ro.push(P(RU, RR, th)); ri.push(P(-RU, RR, th)); }
    var fo = face(ro, "rim", [s, 0, 0]), fi = face(ri, "rim", [-s, 0, 0]);
    /* velg: beadlock-ring met bouten, vijf V-spaken, naaf */
    var F = frame2([cx + s * RU, cy, cz], EY, EZ);
    decal(fo, [circ(F, 0, 0, 53.2, 40), circ(F, 0, 0, 44.5, 40, true)], "bead");
    var bolts = [];
    for (var i = 0; i < 12; i++) { var bt = i / 12 * TAU + phase; bolts.push(circ(F, 49 * M.cos(bt), 49 * M.sin(bt), 1.7, 6)); }
    decal(fo, bolts, "bolt");
    var sp = [];
    for (i = 0; i < 5; i++) {
      var st = i / 5 * TAU + phase * 1.3, c = M.cos(st), sn = M.sin(st);
      var Q = function (r, w) { return F(c * r - sn * w, sn * r + c * w); };
      sp.push([Q(9, -6), Q(44.5, -13), Q(44.5, -3.5), Q(21, 0), Q(44.5, 3.5), Q(44.5, 13), Q(9, 6)]);
    }
    decal(fo, sp, "spoke");
    decal(fo, [circ(F, 0, 0, 13, 14)], "hub");
    decal(fo, [circ(F, 0, 0, 6.5, 6)], "bolt");
    var Fi = frame2([cx - s * RU, cy, cz], EY, EZ);
    decal(fi, [circ(Fi, 0, 0, 20, 14)], "hub");
  }
  wheel(TR, WR, WB, 1, .10);
  wheel(-TR, WR, WB, -1, .31);
  wheel(TR, WR, -WB, 1, .52);
  wheel(-TR, WR, -WB, -1, .77);

  /* ---------- assen, differentiëlen, stuurservo, beschermplaat ---------- */
  var AY = 98;                                   /* ashuis iets boven het wielcentrum (vooraanzicht) */
  function cyl(c, axis, r, h0, h1, n, m, capLo, capHi) {
    var a = nrm(axis), u = nrm(crs(a, M.abs(a[1]) > .9 ? EX : EY)), v = crs(a, u), lo = [], hi = [], i;
    for (i = 0; i < n; i++) {
      var t = i / n * TAU, o = add(scl(u, r * M.cos(t)), scl(v, r * M.sin(t)));
      lo.push(add(add(c, scl(a, h0)), o)); hi.push(add(add(c, scl(a, h1)), o));
    }
    var mid = add(c, scl(a, (h0 + h1) / 2)), res = {};
    for (i = 0; i < n; i++) { var j = (i + 1) % n, q = [lo[i], lo[j], hi[j], hi[i]]; face(q, m, sub(centroid(q), mid)); }
    if (capLo) res.lo = face(lo.slice(), m, scl(a, -1));
    if (capHi) res.hi = face(hi.slice(), m, a);
    return res;
  }
  [1, -1].forEach(function (e) {           /* e = +1 vooras, -1 achteras */
    var z = e * WB, k;
    tube([[-138, AY, z], [138, AY, z]], 12.5, "under", { maxL: 40 });
    /* differentieel: bol huis rond de as, iets uit het midden */
    var dx = 14 * e, dh = cyl([dx, AY, z], [0, 0, e], 25, -17, 17, 14, "under", true, true);
    decal(dh.hi, [circ(frame2([dx, AY, z + e * 17], EX, EY), 0, 0, 16, 14)], "body");
    /* versnellingsbak boven de as; de voorkant heeft een motorcilinder met kruiskap (foto) */
    if (e > 0) {
      box(-52, 14, 124, 176, 206, 250, "under", "py");
      qY(176, -52, -40, 206, 250, 1, "under");
      var mot = cyl([34, 148, 0], [0, 0, 1], 20, 206, 256, 16, "under", false, true), K = frame2([34, 148, 256], EX, EY);
      decal(mot.hi, [circ(K, 0, 0, 14.5, 16)], "body");
      decal(mot.hi, [[K(-1.7, -12), K(1.7, -12), K(1.7, 12), K(-1.7, 12)], [K(-12, -1.7), K(12, -1.7), K(12, 1.7), K(-12, 1.7)]], "hole");
      /* stuurservo boven op de bak: blok boven de voorband in het zijaanzicht */
      box(-40, 22, 176, 194, 190, 292, "body", "ny", 40);
      qY(176, -40, 22, 190, 206, -1, "body"); qY(176, -40, 22, 250, 292, -1, "body"); qY(176, 14, 22, 206, 250, -1, "body");
      /* schuine beschermplaat met ribbels */
      var skid = obox([0, 68, 318], [0, 128, 298], [1, 0, 0], 92, 7, "body");
      var sf = skid.facing([0, .35, .94]), Vs = nrm(sub([0, 128, 298], [0, 68, 318])), Fp = frame2(sf.c, EX, Vs), rs = [];
      for (k = -3; k <= 3; k++) rs.push([Fp(k * 12 - 2.2, -27), Fp(k * 12 + 2.2, -27), Fp(k * 12 + 2.2, 27), Fp(k * 12 - 2.2, 27)]);
      decal(sf, rs, "ridge");
    } else {
      box(-46, 50, 124, 166, -254, -206, "under", "");
      var gf = faces.filter(function (f) { return f.n[2] < -.99 && M.abs(f.c[2] + 254) < .01; })[0];
      var G2 = frame2([0, 0, -254], EX, EY), vents = [];
      for (k = -1; k <= 1; k++) vents.push([G2(k * 12 - 3, 131), G2(k * 12 - 3, 157), G2(k * 12 + 3, 157), G2(k * 12 + 3, 131)]);
      decal(gf, vents, "hole");
    }
    /* stangen (zijaanzicht): platte onderstang met gaten, dichte bovenstang */
    [1, -1].forEach(function (sd) {
      var lo = obox([sd * 58, 150, e * 80], [sd * 58, 82, e * 206], [sd, 0, 0], 5, 15, "under");
      var outer = lo.facing([sd, 0, 0]), Fh = frame2(outer.c, lo.t, lo.s), hs = [];
      for (var k2 = -2; k2 <= 2; k2++) hs.push(circ(Fh, k2 * 13, 0, 2.7, 8));
      decal(outer, hs, "hole");
      obox([sd * 40, 176, e * 80], [sd * 40, 128, e * 204], [sd, 0, 0], 5, 12, "under");
      /* schokdemper: huis, zuiger, veer — één object met eigen tekenvolgorde */
      var top = e > 0 ? [sd * 88, 219, 132] : [sd * 88, 221, -126], bot = e > 0 ? [sd * 97, 116, 193] : [sd * 97, 116, -187];
      var ax = sub(bot, top), d = nrm(ax);
      var s1 = nrm(crs(d, [1, 0, 0])), s2 = crs(d, s1), hel = [], turns = 7, N = turns * 8;
      for (var q = 0; q <= N; q++) {
        var tt = q / N, ang = tt * turns * TAU, cc = add(top, scl(ax, .13 + .74 * tt));
        hel.push({ p: add(cc, add(scl(s1, 10.5 * M.cos(ang)), scl(s2, 10.5 * M.sin(ang)))), a: cc });
      }
      shocks.push({ top: top, bot: bot, mid: add(top, scl(ax, .5)), hel: hel });
      box(sd * 88 - 8, sd * 88 + 8, 206, 216, top[2] - 9, top[2] + 9, "under", "py");
    });
  });

  /* ---------- centrale bak onder het chassis (iets taps) ---------- */
  (function () {
    var t = [[-73, 216, -78], [73, 216, -78], [73, 216, 85], [-73, 216, 85]];
    var b = [[-67, 154, -72], [67, 154, -72], [67, 154, 79], [-67, 154, 79]], c = [0, 185, 3];
    for (var i = 0; i < 4; i++) {
      var j = (i + 1) % 4, q = [t[i], t[j], b[j], b[i]];
      face(q, "under", sub(centroid(q), c));
    }
    face(b.slice(), "under", [0, -1, 0]);
  })();

  /* ---------- chassisplaat ---------- */
  qX(103, 216, 231, -206, 144, 1, "under", 50); qX(-103, 216, 231, -206, 144, -1, "under", 50);
  qZ(144, -103, 103, 216, 231, 1, "under", 50); qZ(-206, -103, 103, 216, 231, -1, "under", 50);
  qY(216, 73, 103, -78, 85, -1, "under", 50); qY(216, -103, -73, -78, 85, -1, "under", 50);
  qY(216, -103, 103, 85, 144, -1, "under", 50); qY(216, -103, 103, -206, -78, -1, "under", 50);

  /* ---------- laadbak: hoeken afgeschuind, zoals de afgeronde bak op de foto ---------- */
  var STRAPS = [[40, 62], [-108, -86]], SC = [40, 62, -108, -86], TC = 10, BX = 123.5, BZ0 = -212, BZ1 = 199;
  [1, -1].forEach(function (s) {
    var xo = s * BX;
    function onTop(x, z) { return [s * x, 274, z]; }
    function onBottom(x, z) { return [s * x, 231, z]; }
    bandedZ(function (a, b, m) { return qX(xo, 231, 274, a, b, s, m); }, BZ0 + TC, BZ1 - TC, SC, STRAPS, "body", "strap", 52);
    bandedZ(function (a, b, m) { return qY(274, M.min(s * 98, xo), M.max(s * 98, xo), a, b, 1, m); }, -140, 131, SC, STRAPS, "body", "strap", 56);
    planar([[40, -140], [BX, -140], [BX, BZ0 + TC], [BX - TC, BZ0], [40, BZ0]], onTop, "body", [0, 1, 0], 42);
    qZ(BZ1, M.min(s * 71, s * (BX - TC)), M.max(s * 71, s * (BX - TC)), 231, 274, 1, "body");
    face([[s * BX, 231, BZ1 - TC], [s * (BX - TC), 231, BZ1], [s * (BX - TC), 274, BZ1], [s * BX, 274, BZ1 - TC]], "body", [s, 0, 1]);
    face([[s * BX, 231, BZ0 + TC], [s * (BX - TC), 231, BZ0], [s * (BX - TC), 274, BZ0], [s * BX, 274, BZ0 + TC]], "body", [s, 0, -1]);
    planar([[103, BZ0], [BX - TC, BZ0], [BX, BZ0 + TC], [BX, BZ1 - TC], [BX - TC, BZ1], [103, BZ1]], onBottom, "under", [0, -1, 0], 55);
  });
  planar([[-BX, 131], [BX, 131], [BX, BZ1 - TC], [BX - TC, BZ1], [-BX + TC, BZ1], [-BX, BZ1 - TC]], function (x, z) { return [x, 274, z]; }, "body", [0, 1, 0], 45);
  qY(274, -40, 40, BZ0, -182, 1, "body", 40);
  qZ(BZ0, -(BX - TC), BX - TC, 231, 274, -1, "body", 50);
  qY(231, -103, 103, 144, BZ1, -1, "under", 55);
  qY(231, -103, 103, BZ0, -206, -1, "under", 55);
  /* groeven tussen de panelen van de bakzijde */
  faces.filter(function (f) { return M.abs(M.abs(f.c[0]) - 123.5) < .01 && f.m === "body"; }).forEach(function (f) {
    [-30, 130].forEach(function (zg) {
      var zs = f.p.map(function (p) { return p[2]; });
      if (zg > M.min.apply(0, zs) + 2 && zg < M.max.apply(0, zs) - 2) {
        var x = f.c[0];
        decal(f, [[[x, 234, zg - 1.4], [x, 234, zg + 1.4], [x, 272, zg + 1.4], [x, 272, zg - 1.4]]], "hole");
      }
    });
  });

  /* ---------- accubak met riemen (loopt door tot onder de camerahouder) ---------- */
  [1, -1].forEach(function (s) {
    bandedZ(function (a, b, m) { return qX(s * 98, 274, 312, a, b, s, m); }, -140, 131, SC, STRAPS, "body", "strap", 56);
    qZ(-140, M.min(s * 40, s * 98), M.max(s * 40, s * 98), 274, 312, -1, "body");
  });
  qZ(131, -98, 98, 274, 312, 1, "body", 50);
  qZ(-140, -40, 40, 300, 312, -1, "body");
  [[-98, -33], [-33, 33], [33, 98]].forEach(function (xr) {
    bandedZ(function (a, b, m) { return qY(312, xr[0], xr[1], a, b, 1, m); }, -140, 131, SC, STRAPS, "body", "strap", 56);
  });
  box(-40, 40, 274, 300, -182, -140, "body", "ny pz");

  /* ---------- camerahouder, lampkap met WYZE-band, camera ----------
     Zijaanzicht: onder de houder zit een open ruimte (Z 131–199, Y 274–320). */
  var CH = 7, HB = 199, CT = 388;                /* afschuining, achterkant kap, bovenkant houder */
  var PROF = [[354, 222], [306, 247], [298, 243], [286, 233], [276, 228], [270, 225.5], [238, 218], [226, 216]];
  (function () {
    var i, a, b;
    for (i = 0; i < PROF.length - 1; i++) {
      a = PROF[i]; b = PROF[i + 1];
      var m = i === 0 ? "metal" : "body";
      var fq = face([[-71 + CH, a[0], a[1]], [71 - CH, a[0], a[1]], [71 - CH, b[0], b[1]], [-71 + CH, b[0], b[1]]], m, [0, .2, 1]);
      [1, -1].forEach(function (s) {
        var q = [[s * (71 - CH), a[0], a[1]], [s * 71, a[0], a[1] - CH], [s * 71, b[0], b[1] - CH], [s * (71 - CH), b[0], b[1]]];
        face(q, m, [s, 0, 1]);
      });
      if (i === 0) {
        /* WYZE in dunne, schuine streken, zoals gegraveerd in de zilveren band */
        var V = nrm(sub([0, a[0], a[1]], [0, b[0], b[1]])), W = frame2([0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], EX, V);
        var H = 21, sw = 1.35, sl = .22, x = -33, cs = [];
        var st = function (p, q) {
          var P0 = [x + (p[0] + p[1] * sl) * H, (p[1] - .5) * H], P1 = [x + (q[0] + q[1] * sl) * H, (q[1] - .5) * H];
          var dx = P1[0] - P0[0], dy = P1[1] - P0[1], l = M.hypot(dx, dy), nx = -dy / l * sw, ny = dx / l * sw;
          cs.push([W(P0[0] + nx, P0[1] + ny), W(P1[0] + nx, P1[1] + ny), W(P1[0] - nx, P1[1] - ny), W(P0[0] - nx, P0[1] - ny)]);
        };
        st([0, 1], [.2, 0]); st([.2, 0], [.4, .78]); st([.4, .78], [.6, 0]); st([.6, 0], [.8, 1]); x += .98 * H;
        st([0, 1], [.28, .5]); st([.56, 1], [.28, .5]); st([.28, .5], [.28, 0]); x += .72 * H;
        st([0, 1], [.58, 1]); st([.58, 1], [0, 0]); st([0, 0], [.58, 0]); x += .76 * H;
        st([0, 1], [.56, 1]); st([.04, .5], [.5, .5]); st([0, 0], [.56, 0]);
        decal(fq, cs, "engr");
      }
      if (a[0] === 270) {
        var Vb = nrm(sub([0, a[0], a[1]], [0, b[0], b[1]])), B = frame2([0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], EX, Vb);
        decal(fq, [rrect(B, -55, -15, 55, 15, 6, 3)], "frame");
        decal(fq, [rrect(B, -50, -11.5, 50, 11.5, 4, 3)], "led");
        decal(fq, [rrect(B, -43, -6, 43, 6.5, 3, 2)], "ledHi");
        decal(fq, [circ(B, -41, -1, 1.6, 6)], "ledDot");
        fq.glow = true;
      }
    }
    var yb = PROF[PROF.length - 1][0], zb = PROF[PROF.length - 1][1];
    face([[-71, yb, HB], [-71, yb, zb - CH], [-71 + CH, yb, zb], [71 - CH, yb, zb], [71, yb, zb - CH], [71, yb, HB]], "under", [0, -1, 0]);
    /* zijvlak van kap + houder in één veelhoek (Z, Y), met de open ruimte eronder */
    var side = [[99, 320], [HB, 320], [HB, yb]];
    for (i = PROF.length - 1; i >= 1; i--) side.push([PROF[i][1] - CH, PROF[i][0]]);
    side.push([222 - CH, 354], [222, 354], [222, CT], [99, CT]);
    [1, -1].forEach(function (s) {
      planar(side, function (z, y) { return [s * 71, y, z]; }, "body", [s, 0, 0], 46);
      face([[s * (71 - CH), 354, 222], [s * 71, 354, 222], [s * 71, 354, 222 - CH]], "body", [0, 1, 0]);
      face([[s * 58, 354, 222], [s * (71 - CH), 354, 222], [s * (71 - CH), CT, 222], [s * 58, CT, 222]], "body", [0, 0, 1]);
      face([[s * (71 - CH), 354, 222], [s * 71, 354, 222 - CH], [s * 71, CT, 222 - CH], [s * (71 - CH), CT, 222]], "body", [s, 0, 1]);
      qY(CT, M.min(s * 58, s * 71), M.max(s * 58, s * 71), 99, 222 - CH, 1, "body", 45);
      face([[s * 58, CT, 222 - CH], [s * 71, CT, 222 - CH], [s * (71 - CH), CT, 222], [s * 58, CT, 222]], "body", [0, 1, 0]);
    });
    qY(CT, -58, 58, 99, 109, 1, "body");
    qZ(99, -71, 71, 320, CT, -1, "body", 40);
    qY(320, -71, 71, 99, HB, -1, "under", 50);       /* plafond van de open ruimte */
    qZ(HB, -71, 71, 274, 320, -1, "body", 50);       /* achterkant van de kap, zichtbaar door de opening */
    qZ(HB, -71, 71, yb, 231, -1, "under");
    box(-26, 26, CT, 402, 84, 109, "body", "ny");    /* klemmetje achter de camera */
  })();

  (function camera() {
    var r = 6, seg = 3, x0 = -58, x1 = 58, z0 = 109, z1 = 222;
    function sect(y, inset) {
      var rr = M.max(.001, r - inset), p = [];
      var cs = [[x1 - r, z0 + r, -PI / 2], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, PI / 2], [x0 + r, z0 + r, PI]];
      for (var k = 0; k < 4; k++) for (var i = 0; i <= seg; i++) {
        var t = cs[k][2] + i / seg * PI / 2;
        p.push([cs[k][0] + rr * M.cos(t), y, cs[k][1] + rr * M.sin(t)]);
      }
      return p;
    }
    /* zijden: onderste band alleen de voorhoeken (de houder dekt de rest) */
    var S = [sect(354, 0), sect(CT, 0), sect(460, 0), sect(463.2, .8), sect(465.2, 3), sect(466, 6)];
    var n = S[0].length, cen = [0, 0, (z0 + z1) / 2];
    for (var b = 0; b < S.length - 1; b++) {
      for (var i = 0; i < n; i++) {
        var j = (i + 1) % n, A = S[b], B = S[b + 1];
        if (M.abs(A[i][0] - A[j][0]) < 1e-6 && M.abs(A[i][2] - A[j][2]) < 1e-6) continue;
        var q = [A[i], A[j], B[j], B[i]], c = centroid(q), frontEdge = i === seg * 2 + 1;
        if (b < 2 && frontEdge) continue;
        if (b === 0 && !(c[2] > z1 - r - .5)) continue;
        face(q, "cam", [c[0] - cen[0], b >= 2 ? (c[1] - 440) : 0, c[2] - cen[2]]);
      }
    }
    face(S[S.length - 1].slice(), "cam", [0, 1, 0]);
    var front = face([[x0 + r, 354, z1], [x1 - r, 354, z1], [x1 - r, 460, z1], [x0 + r, 460, z1]], "cam", [0, 0, 1]);
    var F = frame2([0, 0, z1], EX, EY);
    decal(front, [circ(F, 0, 420, 37.5, 36)], "bezel");
    var quads = [];
    for (var k = 0; k < 2; k++) {
      var t0 = PI / 4 + k * PI, pts = [F(0, 420)];
      for (i = 0; i <= 9; i++) { var t = t0 + i / 9 * PI / 2; pts.push(F(37 * M.cos(t), 420 + 37 * M.sin(t))); }
      quads.push(pts);
    }
    decal(front, quads, "bezel2");
    decal(front, [circ(F, 0, 420, 21, 28), circ(F, 0, 420, 17.5, 28, true)], "ring");
    decal(front, [circ(F, 0, 420, 17.5, 28)], "glass");
    decal(front, [circ(F, 0, 420, 9.5, 20), circ(F, 0, 420, 8, 20, true)], "bezel2");
    decal(front, [circ(F, -5.5, 425.5, 2.6, 10)], "bolt");
    decal(front, [circ(F, 0, 453.5, 3.4, 10)], "bezel2");
    decal(front, [circ(F, 0, 394, 1.3, 6)], "hole");
    decal(front, [circ(F, 0, 371, 11.5, 22)], "bezel");
  })();

  /* ---------- rolkooi ---------- */
  var TUBE_R = 4.6, TOPRAIL = function (z) { return 424 - .2426 * (89.5 - z); };
  [1, -1].forEach(function (s) {
    var X = s * 111;
    /* voorpaal, bovenrail, achterboog */
    tube([[X, 274, 89.5], [X, 424, 89.5], [X, 354, -199], [X, 337, -211], [X, 276, -198]], TUBE_R, "tube", { fillet: 15, seg: 4, maxL: 55 });
    /* onderrail */
    tube([[X, 358, 4], [X, 309.5, -204.5]], TUBE_R, "tube", { maxL: 55 });
    /* schoor van bovenrail naar voorpaal */
    tube([[X, TOPRAIL(-13), -13], [X, 327, 16], [X, 314, 42], [X, 314, 89.5]], TUBE_R, "tube", { fillet: 16, seg: 4 });
    /* voorarm naast de camera; de "bolletjes" op de zijfoto zijn dwarsbuisjes naar de houder */
    tube([[X, 372, 89.5], [X, 358, 135], [X, 336, 188], [X, 318, 196], [X, 276, 195]], TUBE_R, "tube", { fillet: 12, seg: 4 });
    tube([[X, 358, 135], [s * 71, 358, 135]], TUBE_R, "tube");
    tube([[X, 318, 196], [s * 71, 318, 196]], TUBE_R, "tube");
    ball([X, TOPRAIL(64), 64], 6.6, "tube");
    ball([X, 354, -199], 6.6, "tube");
    ball([s * 112.5, 358, 135], 5.8, "tube");
    ball([s * 112.5, 318, 196], 5.8, "tube");
  });
  tube([[-111, TOPRAIL(80), 80], [111, TOPRAIL(80), 80]], TUBE_R, "tube", { maxL: 45 });
  tube([[-111, 354, -199], [111, 354, -199]], TUBE_R, "tube", { maxL: 45 });
  tube([[-111, 309.5, -204.5], [111, 309.5, -204.5]], TUBE_R, "tube", { maxL: 45 });
  /* kabels: achter de accu (zijfoto) en rechts naar de camera (voorfoto) */
  tube([[50, 290, -182], [50, 288, -222], [50, 262, -234], [50, 234, -230], [50, 224, -212]], 4, "tube", { fillet: 13, seg: 4, maxL: 30 });
  tube([[-96, 312, 62], [-97, 342, 70], [-84, 380, 88], [-60, 396, 100], [-36, 400, 104]], 3.2, "tube", { fillet: 18, seg: 4, maxL: 30 });

  /* =====================================================================
     RENDERER
     ===================================================================== */
  var LIGHTS = [
    { d: nrm([-.55, .64, .54]), i: [2.05, 2.0, 1.92] },    /* sleutel: linksboven-voor */
    { d: nrm([.86, .12, .34]), i: [.24, .34, .30] },       /* vulling rechts, mintkleurig */
    { d: nrm([.10, .78, -.62]), i: [.55, .64, .62] }       /* strijklicht van achter */
  ];
  var SKY = [.022, .062, .052], GND = [.004, .009, .008];

  function tone(x) { return x < .6 ? x : .6 + .4 * (1 - M.exp(-(x - .6) / .4)); }
  function hex(c) {
    var s = "#";
    for (var i = 0; i < 3; i++) {
      var v = M.round(255 * M.pow(M.max(0, tone(c[i])), 1 / 2.2));
      v = v > 255 ? 255 : v;
      s += (v < 16 ? "0" : "") + v.toString(16);
    }
    return s;
  }
  /* y = hoogte in het model: laag bij de grond vangt minder omgevingslicht */
  function shadeLin(n, v, m, y) {
    var mat = MAT[m];
    if (mat.e) return mat.e;
    var occ = y == null ? 1 : .45 + .55 * M.min(1, M.max(0, y / 250));
    var h = .5 + .5 * n[1];
    var r = (SKY[0] * h + GND[0] * (1 - h)) * occ, g = (SKY[1] * h + GND[1] * (1 - h)) * occ, b = (SKY[2] * h + GND[2] * (1 - h)) * occ;
    var sr = 0, sg = 0, sb = 0;
    for (var k = 0; k < LIGHTS.length; k++) {
      var L = LIGHTS[k], nd = dot(n, L.d), lo = k === 0 ? .7 + .3 * occ : occ;
      if (nd > 0) {
        r += L.i[0] * nd * lo; g += L.i[1] * nd * lo; b += L.i[2] * nd * lo;
        var hv = nrm(add(L.d, v)), nh = dot(n, hv);
        if (nh > 0) { var sp = M.pow(nh, mat.p) * mat.s * lo; sr += L.i[0] * sp; sg += L.i[1] * sp; sb += L.i[2] * sp; }
      }
    }
    return [mat.c[0] * r + sr * .1, mat.c[1] * g + sg * .1, mat.c[2] * b + sb * .1];
  }
  function shade(n, v, m, y) { return hex(shadeLin(n, v, m, y)); }
  var V0 = [0, 0, 1];                  /* vaste kijkrichting: coplanaire tegels krijgen dezelfde kleur */

  var VIEW = { D: 1250, F: 1330, T: [0, 212, 0], CX: 500, CY: 482 };

  function frame(yawDeg, pitchDeg, opt) {
    opt = opt || {};
    var a = yawDeg * PI / 180, e = pitchDeg * PI / 180;
    var ca = M.cos(a), sa = M.sin(a), ce = M.cos(e), se = M.sin(e);
    var D = VIEW.D, FO = VIEW.F, T = VIEW.T, CX = opt.CX != null ? opt.CX : VIEW.CX, CY = opt.CY != null ? opt.CY : VIEW.CY, ortho = opt.ortho;
    function xf(p) {
      var x = p[0] - T[0], y = p[1] - T[1], z = p[2] - T[2];
      var x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
      return [x1, y * ce - z1 * se, y * se + z1 * ce];
    }
    function rn(n) {
      var x1 = n[0] * ca + n[2] * sa, z1 = -n[0] * sa + n[2] * ca;
      return [x1, n[1] * ce - z1 * se, n[1] * se + z1 * ce];
    }
    function pr(q) {
      if (ortho) return [CX + q[0] * ortho, CY - q[1] * ortho, D - q[2]];
      var d = D - q[2]; return [CX + FO * q[0] / d, CY - FO * q[1] / d, d];
    }
    function toCam(q) { return ortho ? [0, 0, 1] : nrm([-q[0], -q[1], D - q[2]]); }
    function f1(v) { return M.round(v * 10) / 10; }
    function pathOf(pts) {
      var s = "", sa2 = 0;
      for (var i = 0; i < pts.length; i++) { var a2 = pts[i], b2 = pts[(i + 1) % pts.length]; sa2 += a2[0] * b2[1] - b2[0] * a2[1]; }
      return { a: sa2, pts: pts };
    }
    function dstr(contours) {
      /* eerste contour positief georiënteerd, zodat samengevoegde paden (nonzero) kloppen */
      var s = "", flip = false;
      for (var c = 0; c < contours.length; c++) {
        var pts = contours[c];
        if (c === 0) flip = pathOf(pts).a < 0;
        var n = pts.length;
        for (var i = 0; i < n; i++) {
          var q = pts[flip ? n - 1 - i : i];
          s += (i ? "L" : "M") + f1(q[0]) + " " + f1(q[1]);
        }
        s += "Z";
      }
      return s;
    }
    var groups = [], i, k, bb = [1e9, 1e9, -1e9, -1e9];
    function grow(x, y, m) { if (x - m < bb[0]) bb[0] = x - m; if (y - m < bb[1]) bb[1] = y - m; if (x + m > bb[2]) bb[2] = x + m; if (y + m > bb[3]) bb[3] = y + m; }
    /* vlakken */
    for (i = 0; i < faces.length; i++) {
      var f = faces[i], cv = xf(f.c), nv = rn(f.n);
      var tc = ortho ? [0, 0, 1] : [-cv[0], -cv[1], D - cv[2]];
      if (dot(nv, tc) <= 0) continue;
      var v = V0, sp = [];
      for (k = 0; k < f.p.length; k++) { var pp0 = pr(xf(f.p[k])); sp.push(pp0); grow(pp0[0], pp0[1], 0); }
      var prims = [{ k: "f", d: dstr([sp]), c: shade(nv, v, f.m, f.c[1]) }];
      if (f.dec) for (k = 0; k < f.dec.length; k++) {
        var dc = f.dec[k], cs = dc.cs.map(function (cn) { return cn.map(function (p) { return pr(xf(p)); }); });
        prims.push({ k: "f", d: dstr(cs), c: shade(nv, v, dc.m, f.c[1]), glow: f.glow && MAT[dc.m].e && dc.m === "led" });
      }
      groups.push({ z: D - cv[2] + f.bias, p: prims });
    }
    /* buizen: elk segment een streek met een smalle glanslijn aan de lichtkant */
    var L0 = LIGHTS[0].d;
    function stroke(A, B, r, m, capA, capB, ext, hl) {
      /* A, B in camerabeeld; geeft primitieven en diepte terug */
      var mid = mix(A, B, .5), t = nrm(sub(B, A)), vv = V0;
      var nvw = nrm(sub(vv, scl(t, dot(vv, t))));
      var nl = sub(L0, scl(t, dot(L0, t))), nlL = len(nl);
      var nh = nlL > 1e-3 ? nrm(add(nvw, scl(nl, 1.25 / nlL))) : nvw;
      var sa3 = pr(A), sb3 = pr(B), dm = (sa3[2] + sb3[2]) / 2;
      var w = ortho ? 2 * r * ortho : 2 * r * FO / dm;
      var dx = sb3[0] - sa3[0], dy = sb3[1] - sa3[1], dl = M.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
      var e0 = ext[0] * w * .12, e1 = ext[1] * w * .12;
      var base = shade(nvw, vv, m);
      var out = [{ k: "t", d: "M" + f1(sa3[0] - ux * e0) + " " + f1(sa3[1] - uy * e0) + "L" + f1(sb3[0] + ux * e1) + " " + f1(sb3[1] + uy * e1), c: base, w: f1(w) }];
      if (capA) out.push({ k: "f", d: disc(sa3[0], sa3[1], w / 2), c: base });
      if (capB) out.push({ k: "f", d: disc(sb3[0], sb3[1], w / 2), c: base });
      if (hl && w > 4.5) {
        var px = -uy, py = ux, off = (nh[0] * px - nh[1] * py) * w * .3, hx = px * off, hy = py * off;
        var i0 = capA ? w * .15 : -e0 * .5, i1 = capB ? w * .15 : -e1 * .5;
        out.push({ k: "t", d: "M" + f1(sa3[0] + hx + ux * i0) + " " + f1(sa3[1] + hy + uy * i0) + "L" + f1(sb3[0] + hx - ux * i1) + " " + f1(sb3[1] + hy - uy * i1), c: shade(nh, vv, m), w: f1(w * .3) });
      }
      return { p: out, z: dm };
    }
    function polyD(pts) { var o = ""; for (var q = 0; q < pts.length; q++) o += (q ? "L" : "M") + f1(pts[q][0]) + " " + f1(pts[q][1]); return o; }
    function ends(pts, ea, eb) {        /* positief verlengt, negatief kort in, langs het eindsegment */
      var n = pts.length;
      if (ea) { var p0 = pts[0], p1 = pts[1], dx = p0[0] - p1[0], dy = p0[1] - p1[1], l = M.hypot(dx, dy) || 1; pts[0] = [p0[0] + dx / l * ea, p0[1] + dy / l * ea]; }
      if (eb) { var q0 = pts[n - 1], q1 = pts[n - 2], ex = q0[0] - q1[0], ey = q0[1] - q1[1], l2 = M.hypot(ex, ey) || 1; pts[n - 1] = [q0[0] + ex / l2 * eb, q0[1] + ey / l2 * eb]; }
      return pts;
    }
    for (i = 0; i < tubes.length; i++) {
      var tb = tubes[i], P = tb.p.map(xf), S = P.map(pr), last = P.length - 1;
      for (var ri = 0; ri < tb.runs.length; ri++) {
        var r0 = tb.runs[ri][0], r1 = tb.runs[ri][1], nsg = r1 - r0, lin = [0, 0, 0], hlin = [0, 0, 0], offs = [], dsum = 0, ysum = 0;
        for (k = r0; k < r1; k++) {
          var A = P[k], B = P[k + 1], t = nrm(sub(B, A));
          var nvw = nrm(sub(V0, scl(t, dot(V0, t))));
          var nl = sub(L0, scl(t, dot(L0, t))), nlL = len(nl);
          var nh = nlL > 1e-3 ? nrm(add(nvw, scl(nl, 1.25 / nlL))) : nvw;
          var yy = (tb.p[k][1] + tb.p[k + 1][1]) / 2;
          lin = add(lin, shadeLin(nvw, V0, tb.m, yy)); hlin = add(hlin, shadeLin(nh, V0, tb.m, yy));
          var sa3 = S[k], sb3 = S[k + 1], dx = sb3[0] - sa3[0], dy = sb3[1] - sa3[1], dl = M.hypot(dx, dy) || 1;
          var px = -dy / dl, py = dx / dl, off = nh[0] * px - nh[1] * py;
          offs.push([px * off, py * off]);
          dsum += sa3[2] + sb3[2];
        }
        var dm = dsum / (2 * nsg), w = ortho ? 2 * tb.r * ortho : 2 * tb.r * FO / dm;
        for (k = r0; k <= r1; k++) grow(S[k][0], S[k][1], w / 2);
        var base = hex(scl(lin, 1 / nsg));
        var bp = ends(S.slice(r0, r1 + 1).map(function (q) { return [q[0], q[1]]; }), r0 > 0 ? w * .12 : 0, r1 < last ? w * .12 : 0);
        var prim = [{ k: "t", d: polyD(bp), c: base, w: f1(w) }];
        if (tb.caps && r0 === 0) prim.push({ k: "f", d: disc(S[0][0], S[0][1], w / 2), c: base });
        if (tb.caps && r1 === last) prim.push({ k: "f", d: disc(S[last][0], S[last][1], w / 2), c: base });
        if (tb.hl && w > 4.5) {
          var hp = [];
          for (var qv = r0; qv <= r1; qv++) {
            var oa = offs[M.max(0, qv - r0 - 1)], ob = offs[M.min(nsg - 1, qv - r0)];
            hp.push([S[qv][0] + (oa[0] + ob[0]) / 2 * w * .3, S[qv][1] + (oa[1] + ob[1]) / 2 * w * .3]);
          }
          ends(hp, tb.caps && r0 === 0 ? -w * .15 : 0, tb.caps && r1 === last ? -w * .15 : 0);
          prim.push({ k: "t", d: polyD(hp), c: hex(scl(hlin, 1 / nsg)), w: f1(w * .3) });
        }
        groups.push({ z: ortho ? D - (P[r0][2] + P[r1][2]) / 2 : dm, p: prim });
      }
    }
    /* schokdempers: veerwindingen achter het huis, dan huis en zuiger, dan de voorste windingen */
    for (i = 0; i < shocks.length; i++) {
      var sk = shocks[i], T0 = xf(sk.top), T1 = xf(sk.mid), T2 = xf(sk.bot);
      var back = "", front = "", run = null, wsum = 0, wn = 0;
      for (k = 0; k < sk.hel.length - 1; k++) {
        var h0 = xf(sk.hel[k].p), h1 = xf(sk.hel[k + 1].p), ac = xf(mix(sk.hel[k].a, sk.hel[k + 1].a, .5));
        var isBack = (h0[2] + h1[2]) / 2 < ac[2], q0 = pr(h0), q1 = pr(h1);
        var seg2 = (run === isBack ? "" : "M" + f1(q0[0]) + " " + f1(q0[1])) + "L" + f1(q1[0]) + " " + f1(q1[1]);
        if (isBack) back += seg2; else front += seg2;
        run = isBack; wsum += q0[2]; wn++;
      }
      var wc = ortho ? 2 * 1.7 * ortho : 2 * 1.7 * FO / (wsum / wn), vS = toCam(T1);
      var body = stroke(T0, T1, 7, "under", true, false, [0, 1], true), rod = stroke(T1, T2, 3.4, "tube", false, true, [1, 0], false);
      var pp = [];
      if (back) pp.push({ k: "t", d: back, c: shade(scl(vS, -1), vS, "spring"), w: f1(wc) });
      pp = pp.concat(body.p, rod.p);
      if (front) pp.push({ k: "t", d: front, c: shade(nrm(add(vS, [0, .5, 0])), vS, "spring"), w: f1(wc) });
      [[sk.top, 6.2], [sk.bot, 5.6]].forEach(function (bb) {
        var q = xf(bb[0]), s2 = pr(q), rr = ortho ? bb[1] * ortho : bb[1] * FO / s2[2], vb = toCam(q), hn = nrm(add(vb, L0));
        pp.push({ k: "f", d: disc(s2[0], s2[1], rr), c: shade(vb, vb, "tube") });
        pp.push({ k: "f", d: disc(s2[0] + hn[0] * rr * .38, s2[1] - hn[1] * rr * .38, rr * .42), c: shade(hn, vb, "tube") });
      });
      groups.push({ z: ortho ? D - T1[2] : pr(T1)[2], p: pp });
    }
    /* bollen */
    for (i = 0; i < balls.length; i++) {
      var bl = balls[i], q = xf(bl.c), s2 = pr(q), rr = ortho ? bl.r * ortho : bl.r * FO / s2[2], vb = toCam(q);
      var hn = nrm(add(vb, L0)), hs = [hn[0] * rr * .38, -hn[1] * rr * .38];
      groups.push({
        z: (ortho ? D - q[2] : s2[2]) - bl.r * .6, p: [
          { k: "f", d: disc(s2[0], s2[1], rr), c: shade(vb, vb, bl.m) },
          { k: "f", d: disc(s2[0] + hs[0], s2[1] + hs[1], rr * .42), c: shade(hn, vb, bl.m) }
        ]
      });
    }
    groups.sort(function (A2, B2) { return B2.z - A2.z; });
    var out = [];
    for (i = 0; i < groups.length; i++) for (k = 0; k < groups[i].p.length; k++) out.push(groups[i].p[k]);

    /* schaduw op de vloer */
    function gpoly(pts) { return dstr([pts.map(function (p) { return pr(xf(p)); })]); }
    var shadow = {
      body: gpoly([[-128, 0, -236], [128, 0, -236], [128, 0, 236], [-128, 0, 236]]),
      wheels: [[TR, WB], [-TR, WB], [TR, -WB], [-TR, -WB]].map(function (w) {
        return gpoly([[w[0] - 33, 0, w[1] - 30], [w[0] + 33, 0, w[1] - 30], [w[0] + 33, 0, w[1] + 30], [w[0] - 33, 0, w[1] + 30]]);
      }).join("")
    };
    return { bbox: bb, prims: out, shadow: shadow, glow: out.filter(function (p) { return p.glow; }).map(function (p) { return p.d; }).join("") };
  }
  function disc(x, y, r) {
    r = M.max(.3, M.round(r * 10) / 10); x = M.round(x * 10) / 10; y = M.round(y * 10) / 10;
    return "M" + (M.round((x - r) * 10) / 10) + " " + y + "a" + r + " " + r + " 0 1 0 " + (2 * r).toFixed(1) + " 0a" + r + " " + r + " 0 1 0 " + (-2 * r).toFixed(1) + " 0Z";
  }

  /* Samenvoegen: opeenvolgende paden met dezelfde kleur worden één element. */
  function merge(prims) {
    var out = [];
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i], l = out[out.length - 1];
      if (l && l.k === p.k && l.c === p.c && l.w === p.w && !p.glow && !l.glow) { l.d += p.d; continue; }
      out.push({ k: p.k, c: p.c, w: p.w, d: p.d, glow: p.glow });
    }
    return out;
  }

  return {
    frame: frame, merge: merge, view: VIEW,
    stats: function () { return { faces: faces.length, tubes: tubes.reduce(function (s, t) { return s + t.p.length - 1; }, 0), balls: balls.length, shocks: shocks.length }; }
  };
}

/* Interactie: draaien bij hover, slepen met de hand, daarna terug naar de heldenhoek. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var root = document.getElementById("car-logo");
  if (!root || root.__wyzeCar) return;
  var car = WyzeCar();
  var HERO_YAW = -44, HERO_PITCH = 0;
  var scene = root.querySelector("#wc-scene"), glow = root.querySelector("#wc-glow");
  var shBody = root.querySelector("#wc-shadow-body"), shWheels = root.querySelector("#wc-shadow-wheels");
  var pool = Array.prototype.slice.call(scene.children);
  var last = pool.map(function (el) {
    return { k: el.getAttribute("class"), d: el.getAttribute("d"), c: el.getAttribute("color"), w: el.getAttribute("stroke-width"), hidden: false };
  });

  function draw(yaw, pitch) {
    var fr = car.frame(yaw, pitch), prims = car.merge(fr.prims), i;
    for (i = 0; i < prims.length; i++) {
      var p = prims[i], el = pool[i], L = last[i];
      if (!el) {
        el = document.createElementNS(NS, "path"); scene.appendChild(el); pool.push(el);
        L = last[i] = { hidden: false };
      }
      var cls = p.k === "t" ? "wc-t" : "wc-f";
      if (L.hidden) { el.removeAttribute("display"); L.hidden = false; }
      if (L.k !== cls) { el.setAttribute("class", cls); L.k = cls; }
      if (L.d !== p.d) { el.setAttribute("d", p.d); L.d = p.d; }
      if (L.c !== p.c) { el.setAttribute("color", p.c); L.c = p.c; }
      var w = p.k === "t" ? String(p.w) : null;
      if (L.w !== w) { if (w) el.setAttribute("stroke-width", w); else el.removeAttribute("stroke-width"); L.w = w; }
    }
    for (; i < pool.length; i++) if (!last[i].hidden) { pool[i].setAttribute("display", "none"); last[i].hidden = true; }
    shBody.setAttribute("d", fr.shadow.body);
    shWheels.setAttribute("d", fr.shadow.wheels);
    glow.setAttribute("d", fr.glow || "M0 0");
  }

  var motionQuery = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduce = motionQuery && motionQuery.matches;
  var st = { yaw: HERO_YAW, vel: 0, pitch: HERO_PITCH, hover: false, drag: null, dir: 1, mx: .5, my: .45, t: 0, raf: 0, drawn: null, phase: null, tw: null };
  var SPIN = 46;                                  /* graden per seconde tijdens hover */

  function box() { return root.getBoundingClientRect(); }
  function pointer(ev) {
    var r = box();
    st.mx = r.width ? (ev.clientX - r.left) / r.width : .5;
    st.my = r.height ? (ev.clientY - r.top) / r.height : .5;
    /* draairichting volgt de kant waar de muis staat, met wat speling rond het midden */
    if (st.mx > .62) st.dir = 1; else if (st.mx < .38) st.dir = -1;
  }
  function wake() { if (!st.raf) { st.t = 0; st.raf = requestAnimationFrame(tick); } }

  function tick(now) {
    // Cap this decorative renderer at 30 fps to leave room for live video.
    if (st.t && now - st.t < 1000 / 30) { st.raf = requestAnimationFrame(tick); return; }
    var dt = st.t ? Math.min(.05, (now - st.t) / 1000) : 1 / 60;
    st.t = now; st.raf = 0;
    var busy = true;
    if (st.hover || st.drag) st.phase = null;
    if (st.drag) {
      st.vel *= Math.exp(-dt * 10);
    } else if (st.hover && !reduce) {
      var target = st.dir * SPIN * (.75 + .9 * Math.abs(st.mx - .5));
      st.vel += (target - st.vel) * Math.min(1, dt * 2.4);
      st.yaw += st.vel * dt;
    } else if (st.hover && reduce) {
      /* bewegingsarm: de muispositie bepaalt de hoek direct, geen automatische draai */
      var want = HERO_YAW + (st.mx - .5) * 300;
      st.yaw += (want - st.yaw) * Math.min(1, dt * 6);
      st.vel = 0;
    } else if (st.phase !== "return") {
      /* uitrollen; onder een drempel met een vloeiende kromme terug naar de heldenhoek */
      st.vel *= Math.exp(-dt * 2.6);
      st.yaw += st.vel * dt;
      if (Math.abs(st.vel) < 14) {
        var goal = HERO_YAW + 360 * Math.round((st.yaw - HERO_YAW) / 360);
        st.tw = { p0: st.yaw, v0: st.vel, p1: goal, T: .5 + Math.abs(goal - st.yaw) / 130, t: 0 };
        st.phase = "return";
      }
    } else {
      var tw = st.tw, u, T = tw.T;
      tw.t = Math.min(T, tw.t + dt); u = tw.t / T;
      var u2 = u * u, u3 = u2 * u;
      st.yaw = (2 * u3 - 3 * u2 + 1) * tw.p0 + (u3 - 2 * u2 + u) * T * tw.v0 + (3 * u2 - 2 * u3) * tw.p1;
      st.vel = ((6 * u2 - 6 * u) * tw.p0 + (3 * u2 - 4 * u + 1) * T * tw.v0 + (6 * u - 6 * u2) * tw.p1) / T;
      if (u >= 1) { st.yaw = HERO_YAW; st.vel = 0; st.phase = null; busy = false; }
    }
    var pitchGoal = st.hover || st.drag ? 25 - 29 * Math.min(1, Math.max(0, st.my)) : HERO_PITCH;
    st.pitch += (pitchGoal - st.pitch) * Math.min(1, dt * 3.2);
    if (!busy && Math.abs(pitchGoal - st.pitch) > .02) busy = true;
    if (!busy) st.pitch = pitchGoal;
    var key = st.yaw.toFixed(2) + "/" + st.pitch.toFixed(2);
    if (key !== st.drawn) { draw(st.yaw, st.pitch); st.drawn = key; }
    if (busy || st.hover || st.drag) st.raf = requestAnimationFrame(tick);
  }

  root.addEventListener("pointerenter", function (ev) {
    if (ev.pointerType === "touch") return;
    pointer(ev); st.hover = true; wake();
  });
  root.addEventListener("pointerleave", function (ev) {
    if (ev.pointerType === "touch") return;
    st.hover = false; wake();
  });
  root.addEventListener("pointermove", function (ev) {
    pointer(ev);
    if (st.drag && ev.pointerId === st.drag.id) {
      var r = box(), dx = ev.clientX - st.drag.x, now = ev.timeStamp;
      var yaw = st.drag.yaw0 + dx / (r.width || 1) * 360;
      var dtm = Math.max(1, now - st.drag.t);
      st.drag.v = .7 * st.drag.v + .3 * ((yaw - st.yaw) / dtm * 1000);
      st.drag.t = now; st.yaw = yaw;
      if (Math.abs(dx) > 4) st.drag.moved = true;
      wake();
    }
  });
  root.addEventListener("pointerdown", function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    pointer(ev);
    st.drag = { id: ev.pointerId, x: ev.clientX, yaw0: st.yaw, t: ev.timeStamp, v: 0, moved: false, touch: ev.pointerType === "touch" };
    try { root.setPointerCapture(ev.pointerId); } catch (e) { /* oudere browsers */ }
    root.classList.add("drag");
    wake();
  });
  function release(ev) {
    if (!st.drag || ev.pointerId !== st.drag.id) return;
    var d = st.drag; st.drag = null;
    root.classList.remove("drag");
    st.vel = Math.max(-720, Math.min(720, d.v));
    if (Math.abs(st.vel) > 20) st.dir = st.vel > 0 ? 1 : -1;
    /* op aanraakschermen schakelt een tik het draaien aan en uit */
    if (d.touch && !d.moved) st.hover = !st.hover;
    wake();
  }
  root.addEventListener("pointerup", release);
  function rest() {
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0; st.t = 0; st.hover = false; st.drag = null;
    st.vel = 0; st.phase = null; st.tw = null;
    st.yaw = HERO_YAW; st.pitch = HERO_PITCH;
    root.classList.remove("drag");
    draw(HERO_YAW, HERO_PITCH);
    st.drawn = HERO_YAW.toFixed(2) + "/" + HERO_PITCH.toFixed(2);
  }
  root.addEventListener("pointercancel", rest);
  root.addEventListener("lostpointercapture", function () { if (st.drag) rest(); });
  window.addEventListener("blur", rest);
  document.addEventListener("visibilitychange", function () { if (document.hidden) rest(); });
  if (window.IntersectionObserver) {
    var observer = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) rest();
    });
    observer.observe(root);
  }
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener("change", function (event) { reduce = event.matches; rest(); });
  }

  root.__wyzeCar = { draw: draw, state: st, car: car };
})();
})();
