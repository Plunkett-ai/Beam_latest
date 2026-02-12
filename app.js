/*
  BEAM Value Proposition – ICB Localiser
  - Renders full 16-slide deck as images
  - Populates slides 2, 3, and 5 with ICB-specific values
  - Map highlight + click-to-select on slide 2
  - Adoption % input on slide 3 drives savings / capacity / wait impact
  - Localised referrals/accessed chart + snapshot on slide 5

  This build is fully offline: no fetch() and no external libraries.
*/

(function(){
  'use strict';

  const BRAND_BLUE = '#141B8C';
  const REFERRALS_GREY = '#D1D5DB';
  const STROKE_GREY = '#ffffff';

  // --- DOM helpers ---
  const qs = (sel) => document.querySelector(sel);

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k, String(v)));
    for (const child of children) node.appendChild(child);
    return node;
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Reduce font-size until the text fits inside the element.
  function fitText(elm, maxPx, minPx){
    if (!elm) return;
    // If the element isn't currently laid out (e.g., its slide is hidden),
    // don't shrink it based on zero sizes.
    if (elm.clientWidth < 10 || elm.clientHeight < 10){
      elm.style.fontSize = `${Number(maxPx) || 32}px`;
      return;
    }
    const max = Number(maxPx) || 32;
    const min = Number(minPx) || 12;
    let size = max;
    elm.style.fontSize = `${size}px`;
    // Force reflow
    void elm.offsetWidth;

    // If it wraps or overflows, step down.
    while (size > min && (elm.scrollWidth > elm.clientWidth + 1 || elm.scrollHeight > elm.clientHeight + 1)){
      size -= 1;
      elm.style.fontSize = `${size}px`;
      void elm.offsetWidth;
    }
  }

  // --- Formatting ---
  const numberFmt0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const numberFmt1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  function formatCount(n){
    if (n == null || Number.isNaN(n)) return '—';
    return numberFmt0.format(Math.round(n));
  }

  function formatPercent(p){
    if (p == null || Number.isNaN(p)) return '—';
    return `${Math.round(p * 100)}%`;
  }

  function formatCurrencyShort(n){
    if (n == null || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}£${numberFmt1.format(abs/1e9)}bn`;
    if (abs >= 1e6) return `${sign}£${numberFmt1.format(abs/1e6)}m`;
    if (abs >= 1e3) return `${sign}£${numberFmt1.format(abs/1e3)}k`;
    return `${sign}£${numberFmt0.format(abs)}`;
  }

  function formatCurrency0(n){
    if (n == null || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    return `${sign}£${numberFmt0.format(Math.round(abs))}`;
  }

  function formatShortNumber(n){
    if (n == null || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e6) return `${sign}${numberFmt1.format(abs/1e6)}m`;
    if (abs >= 1e3) return `${sign}${numberFmt1.format(abs/1e3)}k`;
    return `${sign}${numberFmt0.format(abs)}`;
  }

  // --- Model calculations (aligned to Excel assumptions) ---
  function computeScenario(icb, model){
    const referrals = icb.annualised_referrals;
    const adoption = model.beam_adoption;

    const therapyCost = model.talking_therapies_cost_per_patient;
    const deviceCost = model.beam_device_cost;
    const apptsPerPatient = model.avg_appointments_per_patient;
    const hoursPerWte = model.clinical_hours_per_wte_per_year;
    const waitElasticity = model.wait_time_elasticity;

    const switched = referrals * adoption;
    const baselineSpend = referrals * therapyCost;
    const saving = switched * (therapyCost - deviceCost);

    const appointmentsFreed = switched * apptsPerPatient;
    const wteReleased = appointmentsFreed / hoursPerWte;

    const baselineWait = icb.median_wait_access_days;
    const waitAfter = baselineWait * (1 - adoption * waitElasticity);
    const waitAfterClamped = Math.max(0, waitAfter);
    const waitReduction = baselineWait - waitAfterClamped;

    return {
      switched,
      baselineSpend,
      saving,
      appointmentsFreed,
      wteReleased,
      baselineWait,
      waitAfter: waitAfterClamped,
      waitReduction,
    };
  }

  // --- Localise national series using current ICB share ---
  function localiseSeries(nationalSeries, icb){
    // We only have one quarter of local ICB data (annualised). To create a
    // local year series without overfitting, scale the national series so the
    // latest year matches the ICB annualised values.
    const last = nationalSeries[nationalSeries.length - 1];
    const shareRef = (icb?.annualised_referrals != null && last?.referrals)
      ? (icb.annualised_referrals / last.referrals)
      : 0;
    const shareAcc = (icb?.annualised_accessing_services != null && last?.accessed)
      ? (icb.annualised_accessing_services / last.accessed)
      : 0;

    return nationalSeries.map(d => ({
      year: d.year,
      referrals: d.referrals * shareRef,
      accessed: d.accessed * shareAcc,
    }));
  }

  // --- SVG map rendering (no external libs) ---
  function mercatorProject(lon, lat){
    // lon/lat in degrees
    const λ = lon * Math.PI / 180;
    const φ = lat * Math.PI / 180;
    const x = λ;
    const y = Math.log(Math.tan(Math.PI/4 + φ/2));
    return [x, y];
  }

  function forEachCoord(geom, cb){
    if (!geom) return;
    const type = geom.type;
    const coords = geom.coordinates;

    if (type === 'Polygon'){
      for (const ring of coords){
        for (const pt of ring) cb(pt);
      }
      return;
    }

    if (type === 'MultiPolygon'){
      for (const poly of coords){
        for (const ring of poly){
          for (const pt of ring) cb(pt);
        }
      }
      return;
    }

    // Fallback for other types
    if (Array.isArray(coords)){
      (function walk(arr){
        if (typeof arr[0] === 'number' && typeof arr[1] === 'number'){
          cb(arr);
          return;
        }
        for (const item of arr) walk(item);
      })(coords);
    }
  }

  function buildGeoProjection(geo, W, H){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const feat of geo.features){
      forEachCoord(feat.geometry, ([lon,lat]) => {
        const [x,y] = mercatorProject(lon,lat);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
    }

    const dx = maxX - minX;
    const dy = maxY - minY;
    const pad = 0.96;
    const scale = pad * Math.min(W/dx, H/dy);
    const mapW = dx * scale;
    const mapH = dy * scale;
    const tx = (W - mapW)/2 - minX*scale;
    const ty = (H - mapH)/2 + maxY*scale; // note: we flip Y by using maxY - y

    return {
      project: ([lon,lat]) => {
        const [x,y] = mercatorProject(lon,lat);
        const px = x*scale + tx;
        const py = (-y)*scale + ty;
        return [px,py];
      }
    };
  }

  function geomToPath(geom, project){
    if (!geom) return '';
    const type = geom.type;
    const coords = geom.coordinates;

    const ringToPath = (ring) => {
      if (!ring || ring.length === 0) return '';
      let d = '';
      for (let i=0; i<ring.length; i++){
        const [lon,lat] = ring[i];
        const [x,y] = project([lon,lat]);
        d += (i===0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
      }
      return d + 'Z';
    };

    if (type === 'Polygon'){
      return coords.map(ringToPath).join('');
    }

    if (type === 'MultiPolygon'){
      return coords.map(poly => poly.map(ringToPath).join('')).join('');
    }

    return '';
  }

  function renderMap(container, geo, onPick){
    const W = 1000;
    const H = 680;

    // Clear
    container.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'ICB map' });

    const proj = buildGeoProjection(geo, W, H);

    const pathsByCd = new Map();

    for (const feat of geo.features){
      const cd = feat.properties?.icb23cd;
      const nm = feat.properties?.icb_name_short || feat.properties?.icb23nm || cd || 'ICB';

      const pathD = geomToPath(feat.geometry, proj.project);
      const path = el('path', {
        d: pathD,
        fill: '#c7cdd9',
        stroke: STROKE_GREY,
        'stroke-width': 1,
        'fill-rule': 'evenodd',
        tabindex: 0,
        'data-icb23cd': cd || ''
      });

      // Tooltip
      const title = el('title', {}, []);
      title.textContent = nm;
      path.appendChild(title);

      const pick = () => {
        if (cd) onPick(cd);
      };
      path.addEventListener('click', pick);
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });

      svg.appendChild(path);
      if (cd) pathsByCd.set(cd, path);
    }

    // Hover style
    svg.classList.add('icb-map');

    container.appendChild(svg);

    return {
      setSelected: (cd) => {
        for (const [k, path] of pathsByCd.entries()){
          path.setAttribute('fill', k === cd ? BRAND_BLUE : '#c7cdd9');
          path.setAttribute('opacity', k === cd ? '1' : '0.95');
        }
      }
    };
  }

  // --- SVG chart rendering (referrals vs accessed, in millions) ---
  function renderReferralsChart(container, series){
    const W = 1000;
    const ratio = (container && container.clientWidth > 0 && container.clientHeight > 0)
      ? (container.clientHeight / container.clientWidth)
      : (680/1000);
    const H = Math.round(W * ratio);
    const margin = { top: 70, right: 30, bottom: 70, left: 80 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    container.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Referrals and accessed services' });

    const dataM = series.map(d => ({
      year: d.year,
      referrals: d.referrals / 1e6,
      accessed: d.accessed / 1e6,
    }));

    const maxVal = Math.max(...dataM.flatMap(d => [d.referrals, d.accessed, 0]));

    const step = (maxVal <= 0.2) ? 0.05 : (maxVal <= 0.5) ? 0.1 : (maxVal <= 1.0) ? 0.2 : 0.5;
    const yMax = Math.max(step, Math.ceil((maxVal * 1.12) / step) * step);

    const yScale = (v) => margin.top + (1 - (v / yMax)) * innerH;
    const xBand = innerW / dataM.length;

    const y0 = yScale(0);

    // Gridlines + y labels
    for (let t = 0; t <= yMax + 1e-9; t += step){
      const y = yScale(t);
      svg.appendChild(el('line', {
        x1: margin.left,
        x2: margin.left + innerW,
        y1: y,
        y2: y,
        stroke: '#d1d5db',
        'stroke-width': 1
      }));

      svg.appendChild(el('text', {
        x: margin.left - 10,
        y: y + 5,
        'text-anchor': 'end',
        'font-size': 16,
        'font-weight': 600,
        fill: '#d1d5db'
      }, [])).textContent = (t % 1 === 0) ? String(Math.round(t)) : t.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    }

    // Axes
    svg.appendChild(el('line', {
      x1: margin.left,
      x2: margin.left,
      y1: margin.top,
      y2: y0,
      stroke: '#6b7280',
      'stroke-width': 1.5
    }));
    svg.appendChild(el('line', {
      x1: margin.left,
      x2: margin.left + innerW,
      y1: y0,
      y2: y0,
      stroke: '#6b7280',
      'stroke-width': 1.5
    }));

    // Legend
    const legendY = margin.top - 40;
    const legendX = margin.left + 260;

    const legendItem = (x, color, label) => {
      svg.appendChild(el('rect', { x, y: legendY - 10, width: 14, height: 14, fill: color }));
      svg.appendChild(el('text', {
        x: x + 20,
        y: legendY + 2,
        'text-anchor': 'start',
        'font-size': 18,
        'font-weight': 700,
        fill: '#d1d5db'
      }, [])).textContent = label;
    };

    legendItem(legendX, REFERRALS_GREY, 'Referrals (m)');
    legendItem(legendX + 170, BRAND_BLUE, 'Accessed services (m)');

    // Bars
    for (let i=0; i<dataM.length; i++){
      const d = dataM[i];
      const groupX = margin.left + i * xBand;
      const barTotal = xBand * 0.62;
      const barGap = barTotal * 0.10;
      const barW = (barTotal - barGap) / 2;
      const offset = (xBand - barTotal) / 2;

      const xRef = groupX + offset;
      const xAcc = xRef + barW + barGap;

      const yRef = yScale(d.referrals);
      const yAcc = yScale(d.accessed);

      svg.appendChild(el('rect', {
        x: xRef,
        y: yRef,
        width: barW,
        height: Math.max(0, y0 - yRef),
        fill: REFERRALS_GREY
      }));

      svg.appendChild(el('rect', {
        x: xAcc,
        y: yAcc,
        width: barW,
        height: Math.max(0, y0 - yAcc),
        fill: BRAND_BLUE
      }));

      // X label
      svg.appendChild(el('text', {
        x: groupX + xBand/2,
        y: y0 + 46,
        'text-anchor': 'middle',
        'font-size': 18,
        'font-weight': 700,
        fill: '#d1d5db'
      }, [])).textContent = d.year;
    }

    container.appendChild(svg);
  }

  // --- SVG line chart rendering (sessions per course) ---
  function renderSessionsChart(container, series){
    const W = 1000;
    const ratio = (container && container.clientWidth > 0 && container.clientHeight > 0)
      ? (container.clientHeight / container.clientWidth)
      : (680/1000);
    const H = Math.round(W * ratio);
    const margin = { top: Math.round(40 * (H/680)), right: Math.round(30 * (H/680)), bottom: Math.round(70 * (H/680)), left: Math.round(80 * (H/680)) };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    container.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Average sessions per course' });

    // Opaque background to hide the static chart in the PNG underneath.
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#f7f8fb' }));

    const data = (series || []).map(d => ({ year: String(d.year), sessions: Number(d.sessions) }));

    // Match the deck axis range and ticks.
    const yMin = 7.6;
    const yMax = 8.5;
    const yStep = 0.1;

    const yScale = (v) => margin.top + (1 - ((v - yMin) / (yMax - yMin))) * innerH;
    const xStep = innerW / Math.max(1, (data.length - 1));
    const xScale = (i) => margin.left + i * xStep;

    // Gridlines + y labels
    for (let t = yMin; t <= yMax + 1e-9; t += yStep){
      const y = yScale(t);
      svg.appendChild(el('line', {
        x1: margin.left,
        x2: margin.left + innerW,
        y1: y,
        y2: y,
        stroke: '#d1d5db',
        'stroke-width': 1
      }));

      svg.appendChild(el('text', {
        x: margin.left - 10,
        y: y + 5,
        'text-anchor': 'end',
        'font-size': Math.max(12, Math.round(18 * (H/680))),
        'font-weight': 600,
        fill: '#d1d5db'
      }, [])).textContent = (t % 1 === 0) ? String(Math.round(t)) : t.toFixed(1);
    }

    // Axes
    const y0 = yScale(yMin);
    svg.appendChild(el('line', {
      x1: margin.left,
      x2: margin.left,
      y1: margin.top,
      y2: y0,
      stroke: '#6b7280',
      'stroke-width': 1.5
    }));
    svg.appendChild(el('line', {
      x1: margin.left,
      x2: margin.left + innerW,
      y1: y0,
      y2: y0,
      stroke: '#6b7280',
      'stroke-width': 1.5
    }));

    // X labels
    for (let i=0; i<data.length; i++){
      const x = xScale(i);
      svg.appendChild(el('text', {
        x,
        y: y0 + 46,
        'text-anchor': 'middle',
        'font-size': Math.max(12, Math.round(18 * (H/680))),
        'font-weight': 700,
        fill: '#d1d5db'
      }, [])).textContent = data[i].year;
    }

    // Line path
    if (data.length){
      let d = '';
      for (let i=0; i<data.length; i++){
        const x = xScale(i);
        const y = yScale(data[i].sessions);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
      }

      svg.appendChild(el('path', {
        d,
        fill: 'none',
        stroke: BRAND_BLUE,
        'stroke-width': Math.max(5, Math.round(8 * (H/680))),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }));

      for (let i=0; i<data.length; i++){
        const x = xScale(i);
        const y = yScale(data[i].sessions);
        svg.appendChild(el('circle', {
          cx: x,
          cy: y,
          r: Math.max(4, Math.round(7 * (H/680))),
          fill: BRAND_BLUE
        }));
      }
    }

    container.appendChild(svg);
  }

  // --- App state ---
  const state = {
    data: null,
    geo: null,
    selectedIcbName: null,
    adoption: null,
    mapApi: null,
    slideCount: 16,
    activeSlide: 1,
  };

  function showLoading(show){
    const node = qs('#loading');
    if (!node) return;
    node.classList.toggle('show', !!show);
  }

  function getIcbByName(name){
    return state.data.icbs.find(i => i.icb_name === name);
  }

  function getIcbByCd(cd){
    return state.data.icbs.find(i => i.icb23cd === cd);
  }

  function updateSlide2(icb){
    const referrals = qs('#s2Referrals');
    const pop = qs('#s2Population');
    const rec = qs('#s2Recovery');
    const spend = qs('#s2Spend');
    const nameBox = qs('#s2IcbName');
    const exampleLine = qs('#s2ExampleLine');

    if (nameBox) nameBox.textContent = icb.icb_name;
    if (exampleLine) exampleLine.textContent = `Example shown: ${icb.icb_name} (highlighted)`;

    if (referrals) referrals.textContent = formatCount(icb.annualised_referrals);
        // Commissioning population (2026/27) from commissioning need workbook.
    if (pop) pop.textContent = formatCount(icb.commissioning_population_2026_27);
    if (rec) rec.textContent = formatPercent(icb.recovery_rate);

    const baselineSpend = icb.annualised_referrals * state.data.defaults.talking_therapies_cost_per_patient;
    if (spend) spend.textContent = formatCurrencyShort(baselineSpend);
  }

  function updateSlide3(icb){
    const challengeRef = qs('#s3AnnualReferrals');
    const challengeComp = qs('#s3Completed');
    const challengeWait = qs('#s3MedianWait');
    const standards = qs('#s3Standards');

    if (challengeRef) challengeRef.textContent = formatCount(icb.annualised_referrals);
    if (challengeComp) challengeComp.textContent = formatCount(icb.annualised_accessing_services);
    if (challengeWait) challengeWait.textContent = `${Math.round(icb.median_wait_access_days)} days`;
    if (standards) standards.textContent = '75% / 95%';

    const model = {
      ...state.data.defaults,
      beam_adoption: state.adoption,
    };

    const s = computeScenario(icb, model);

    const saving = qs('#s3Saving');
    const appts = qs('#s3ApptsFreed');
    const wte = qs('#s3Wte');
    const wait = qs('#s3WaitReduction');

    if (saving) saving.textContent = formatCurrencyShort(s.saving);
    if (appts) appts.textContent = formatShortNumber(s.appointmentsFreed);
    if (wte) wte.textContent = numberFmt0.format(Math.round(s.wteReleased));
    if (wait) wait.textContent = `${s.waitReduction.toFixed(1)} days`;
  }

  function updateSlide5(icb){
    const series = localiseSeries(state.data.national.series, icb);
    const chartEl = qs('#s5Chart');
    if (chartEl) renderReferralsChart(chartEl, series);

    const snap = state.data.national.snapshot_2024_25;

    const completionRate = (snap?.completed != null && snap?.accessed)
      ? (snap.completed / snap.accessed)
      : null;

    const last = series[series.length - 1];
    const ref = last?.referrals ?? null;
    const acc = last?.accessed ?? null;
    const comp = (acc != null && completionRate != null) ? acc * completionRate : null;

    const s5Ref = qs('#s5Referrals');
    const s5Acc = qs('#s5Accessed');
    const s5Comp = qs('#s5Completed');
    const s5Sess = qs('#s5Sessions');
    const s5Rec = qs('#s5Recovery');

    if (s5Ref) s5Ref.textContent = formatShortNumber(ref);
    if (s5Acc) s5Acc.textContent = formatShortNumber(acc);
    if (s5Comp) s5Comp.textContent = formatShortNumber(comp);
    if (s5Sess) s5Sess.textContent = (icb.mean_sessions_per_course == null || Number.isNaN(icb.mean_sessions_per_course)) ? '—' : icb.mean_sessions_per_course.toFixed(1);
    if (s5Rec) s5Rec.textContent = formatPercent(icb.recovery_rate);
  }

  function updateSlide6(icb){
    // Capacity demand slide: localise scale-of-activity and the sessions-per-course trend.
    const snap = state.data.national.snapshot_2024_25;
    const completionRate = (snap?.completed != null && snap?.accessed)
      ? (snap.completed / snap.accessed)
      : null;

    // Completed courses: estimate using the national completed/accessed ratio.
    const completed = (icb?.annualised_accessing_services != null && completionRate != null)
      ? Math.round(icb.annualised_accessing_services * completionRate)
      : null;

    const sessionsEach = (icb?.mean_sessions_per_course != null && !Number.isNaN(icb.mean_sessions_per_course))
      ? icb.mean_sessions_per_course
      : (snap?.avg_sessions_per_course != null ? snap.avg_sessions_per_course : null);

    const totalSessions = (completed != null && sessionsEach != null)
      ? completed * sessionsEach
      : null;

    const s6Comp = qs('#s6CompletedCourses');
    const s6Each = qs('#s6SessionsEach');
    const s6Total = qs('#s6TotalSessions');

    if (s6Comp) s6Comp.textContent = completed == null ? '' : `${formatCount(completed)} completed courses`;
    if (s6Each) s6Each.textContent = sessionsEach == null ? '' : `× ${sessionsEach.toFixed(1)} sessions each (avg)`;
    if (s6Total) s6Total.textContent = totalSessions == null ? '' : `${formatShortNumber(totalSessions)} sessions / year`;
    // Match PowerPoint sizing and avoid overflow on large ICBs.
    if (s6Total) fitText(s6Total, 26, 14);

    // Local sessions-per-course trend: scale the national line so 2024/25 matches the ICB.
    const nationalSessions = [
      { year: '2021/22', sessions: 7.9 },
      { year: '2022/23', sessions: 8.1 },
      { year: '2023/24', sessions: 8.2 },
      { year: '2024/25', sessions: 8.4 },
    ];

    // Keep the chart within the deck axis range so it always renders visibly,
    // while still showing the true local mean in the right-hand box.
    const yMin = 7.6;
    const yMax = 8.5;
    const target = (sessionsEach != null) ? clamp(sessionsEach, yMin, yMax) : 8.4;
    const delta = target - 8.4;
    const localSessions = nationalSessions.map(d => ({
      year: d.year,
      sessions: clamp(d.sessions + delta, yMin, yMax),
    }));

    const chartEl = qs('#s6Chart');
    if (chartEl) renderSessionsChart(chartEl, localSessions);
  }

  function updateSlide7(icb){
    const lbl = qs('#s7WaitLabel');
    const val = qs('#s7WaitValue');
    if (lbl) lbl.textContent = 'Selected ICB median wait (Q2 2025/26)';
    if (val) val.textContent = `${Math.round(icb.median_wait_access_days)} days`;
    // Match PowerPoint sizing and avoid overflow on 2–3 digit waits.
    if (val) fitText(val, 35, 18);
  }

  function updateSlide15(icb){
    // Slide 15 uses form-style boxes in the background image.
    const inRef = qs('#s15InReferrals');
    const inWait = qs('#s15InMedianWait');
    const inRec = qs('#s15InRecovery');
    const inCost = qs('#s15InUnitCost');
    const inSess = qs('#s15InSessions');
    const inAdopt = qs('#s15InAdoption');

    const outSave = qs('#s15OutSavings');
    const outAppt = qs('#s15OutApptsWte');
    const outWait = qs('#s15OutWaitRed');
    const outSwitch = qs('#s15OutSwitchedBudget');

    if (!inRef || !inWait || !inRec || !inCost || !inSess || !inAdopt || !outSave || !outAppt || !outWait || !outSwitch){
      return;
    }

    const model = {
      ...state.data.defaults,
      beam_adoption: state.adoption,
    };
    const s = computeScenario(icb, model);

    const unitCost = state.data.defaults.talking_therapies_cost_per_patient;
    const programmeBudget = s.switched * state.data.defaults.beam_device_cost;

    const sessionsStr = (icb.mean_sessions_per_course == null || Number.isNaN(icb.mean_sessions_per_course))
      ? '—'
      : icb.mean_sessions_per_course.toFixed(1);

    inRef.textContent = formatCount(icb.annualised_referrals);
    inWait.textContent = `${Math.round(icb.median_wait_access_days)} days`;
    inRec.textContent = formatPercent(icb.recovery_rate);
    inCost.textContent = formatCurrency0(unitCost);
    inSess.textContent = sessionsStr;
    inAdopt.textContent = `${Math.round(state.adoption * 100)}%`;

    outSave.textContent = formatCurrencyShort(s.saving);
    outAppt.textContent = `${formatShortNumber(s.appointmentsFreed)}; ${numberFmt0.format(Math.round(s.wteReleased))} WTE`;
    outWait.textContent = `${s.waitReduction.toFixed(1)} days`;
    outSwitch.textContent = `${formatShortNumber(s.switched)}; ${formatCurrencyShort(programmeBudget)}`;

    // Ensure values fit neatly into the drawn boxes.
    [inRef,inWait,inRec,inCost,inSess,inAdopt,outSave,outAppt,outWait,outSwitch].forEach(node => fitText(node, 20, 12));
  }

  function updateAll(){
    const icb = getIcbByName(state.selectedIcbName);
    if (!icb) return;

    // Slide 2
    updateSlide2(icb);

    // Slide 3
    updateSlide3(icb);

    // Slide 5
    updateSlide5(icb);

    // Slide 6
    updateSlide6(icb);

    // Slide 7
    updateSlide7(icb);

    // Slide 15
    updateSlide15(icb);

    // Map highlight
    if (state.mapApi) state.mapApi.setSelected(icb.icb23cd);

    // Persist
    try{
      localStorage.setItem('beam.selectedIcbName', state.selectedIcbName);
      localStorage.setItem('beam.adoption', String(state.adoption));
    }catch(_){ /* ignore */ }
  }

  // --- Slides navigation ---
  function setActiveSlide(n){
    const idx = clamp(Number(n) || 1, 1, state.slideCount);
    state.activeSlide = idx;

    for (let i=1; i<=state.slideCount; i++){
      const slide = qs(`#slide${i}`);
      if (!slide) continue;
      slide.classList.toggle('hidden', i !== idx);
    }

    const slideSelect = qs('#slideSelect');
    if (slideSelect) slideSelect.value = String(idx);

    try{ localStorage.setItem('beam.activeSlide', String(idx)); }catch(_){ /* ignore */ }

    // Re-run sizing-dependent layout (e.g., fitText) once the slide is visible.
    requestAnimationFrame(() => updateAll());
  }

  function initSlideControls(){
    const slideSelect = qs('#slideSelect');
    const prev = qs('#prevSlide');
    const next = qs('#nextSlide');

    if (slideSelect){
      slideSelect.innerHTML = '';
      for (let i=1; i<=state.slideCount; i++){
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `Slide ${i}`;
        slideSelect.appendChild(opt);
      }
      slideSelect.addEventListener('change', () => setActiveSlide(slideSelect.value));
    }

    if (prev) prev.addEventListener('click', () => setActiveSlide(state.activeSlide - 1));
    if (next) next.addEventListener('click', () => setActiveSlide(state.activeSlide + 1));

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return;
      if (e.key === 'ArrowLeft') setActiveSlide(state.activeSlide - 1);
      if (e.key === 'ArrowRight') setActiveSlide(state.activeSlide + 1);
    });
  }

  // --- Controls ---
  function initIcbSelect(){
    const select = qs('#icbSelect');
    if (!select) return;

    select.innerHTML = '';

    const sorted = [...state.data.icbs].sort((a,b) => a.icb_name.localeCompare(b.icb_name));
    for (const icb of sorted){
      const opt = document.createElement('option');
      opt.value = icb.icb_name;
      opt.textContent = icb.icb_name;
      select.appendChild(opt);
    }

    select.value = state.selectedIcbName;

    select.addEventListener('change', () => {
      state.selectedIcbName = select.value;
      updateAll();
    });
  }

  function initAdoptionInput(){
    const input = qs('#adoptionInput');
    if (!input) return;

    const setFromState = () => {
      input.value = String(Math.round(state.adoption * 100));
    };

    setFromState();

    const onChange = () => {
      const raw = Number(input.value);
      if (Number.isNaN(raw)) return;
      const pct = clamp(raw, 0, 100);
      state.adoption = pct / 100;
      input.value = String(Math.round(pct));
      updateAll();
    };

    input.addEventListener('change', onChange);
    input.addEventListener('blur', onChange);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){
        e.preventDefault();
        onChange();
        input.blur();
      }
    });
  }

  function initMap(){
    const container = qs('#mapContainer');
    if (!container) return;

    state.mapApi = renderMap(container, state.geo, (icb23cd) => {
      const icb = getIcbByCd(icb23cd);
      if (!icb) return;

      state.selectedIcbName = icb.icb_name;
      const select = qs('#icbSelect');
      if (select) select.value = icb.icb_name;
      updateAll();
    });
  }

  // --- Boot ---
  function boot(){
    showLoading(true);

    const data = window.BEAM_ICB_DATA;
    const geo = window.BEAM_ICB_GEO;

    if (!data || !geo){
      showLoading(false);
      // Fail loudly but informatively
      console.error('Missing BEAM_ICB_DATA or BEAM_ICB_GEO');
      alert('Data files missing. Make sure you are running the app from the unzipped folder.');
      return;
    }

    state.data = data;
    state.geo = geo;

    // Defaults
    const storedIcb = (() => { try { return localStorage.getItem('beam.selectedIcbName'); } catch { return null; } })();
    const storedAdoption = (() => { try { return localStorage.getItem('beam.adoption'); } catch { return null; } })();
    const storedSlide = (() => { try { return localStorage.getItem('beam.activeSlide'); } catch { return null; } })();

    state.selectedIcbName = storedIcb || data.defaults.default_icb || 'NHS Greater Manchester ICB';
    state.adoption = storedAdoption != null && !Number.isNaN(Number(storedAdoption))
      ? clamp(Number(storedAdoption), 0, 1)
      : data.defaults.beam_adoption;

    initSlideControls();
    initIcbSelect();
    initAdoptionInput();
    initMap();

    setActiveSlide(storedSlide || 1);

    updateAll();

    showLoading(false);
  }

  // Ensure DOM loaded
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }
})();
