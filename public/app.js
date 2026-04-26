// Dashboard renderer. Loads data.json, populates always-on Tech & Science,
// daily brief, weather (with UV + tides), and three tabbed regional panes
// (US / Mexico / International). Tab choice persists via localStorage with
// a smart-detect default based on browser timezone.

(async () => {
  const meta = document.getElementById('meta');
  let data;
  try {
    const res = await fetch('data.json?_=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    meta.textContent = `Failed to load data: ${e.message}`;
    meta.classList.add('error');
    return;
  }

  renderMeta(data);
  renderBrief(data.dailyBrief);
  renderWeather(data.weather || []);
  renderStories('medicineTech', data.medicineTech, 'count-medicineTech');
  renderStories('genai',        data.genai,        'count-genai');

  renderStories('us-politics',  data.us?.politics,                'count-us-politics');
  renderStories('mx-politics',  data.mexico?.politics,            'count-mx-politics');
  renderStories('mx-culture',   data.mexico?.culture,             'count-mx-culture');
  renderStories('mx-oaxaca',    data.mexico?.oaxacaCoast,         'count-mx-oaxaca');
  renderStories('intl-politics',data.international?.politics,     'count-intl-politics');
  renderStories('intl-general', data.international?.generalNews,  'count-intl-general');
  renderStories('intl-travel',  data.international?.travelStyle,  'count-intl-travel');

  initTabs();
})();

// ---------- meta + brief ----------

function renderMeta(data) {
  const meta = document.getElementById('meta');
  if (!data.generatedAt) { meta.textContent = 'No data yet.'; return; }
  const d = new Date(data.generatedAt);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  meta.textContent = `Last updated ${fmt.format(d)} · ${tz}`;
  if (data.errors?.length) {
    const span = document.createElement('span');
    span.className = 'error';
    span.style.marginLeft = '8px';
    span.textContent = `(${data.errors.length} source error${data.errors.length > 1 ? 's' : ''})`;
    span.title = data.errors.join('\n');
    meta.appendChild(span);
  }
}

function renderBrief(brief) {
  const section = document.getElementById('brief');
  const text = document.getElementById('brief-text');
  if (!brief || !brief.trim()) { section.hidden = true; return; }
  text.textContent = brief.trim();
  section.hidden = false;
}

// ---------- weather ----------

function renderWeather(cities) {
  const root = document.getElementById('weather-cards');
  root.innerHTML = '';
  if (!cities.length) { root.innerHTML = '<div class="empty">Weather unavailable.</div>'; return; }
  for (const c of cities) {
    const card = document.createElement('div');
    card.className = 'weather-card';
    const today = c.today || {};
    const forecast = (c.forecast || []).slice(1, 7);
    const uv = c.uv || null;
    const tides = c.tides || null;

    const uvBadge = uv != null
      ? `<span class="uv-badge uv-${escapeHtml(uv.level)}" title="Max UV index today">☀️ UV ${uv.max} ${escapeHtml(uv.label)}</span>`
      : '';

    const tideBlock = tides && tides.length
      ? `<div class="tides" aria-label="Tides today">
          <div class="tides-label">Tides Today</div>
          ${tides.map(t => `
            <div class="tide-row">
              <span class="tide-mark${t.type === 'L' ? ' tide-low' : ''}">${t.type}</span>
              <span class="tide-time">${escapeHtml(t.timeLabel)}</span>
              <span class="tide-height">${t.heightFt} ft</span>
            </div>
          `).join('')}
         </div>`
      : '';

    card.innerHTML = `
      <div class="wx-current">
        <div class="icon" aria-hidden="true">${escapeHtml(c.current.icon || '')}</div>
        <div>
          <p class="city">${escapeHtml(c.cityName)}</p>
          <div class="temp">${c.current.tempF != null ? c.current.tempF + '°' : '—'}</div>
          <div class="cond">${escapeHtml(c.current.condition || '')}</div>
        </div>
      </div>
      <div class="extras">
        <span>H ${today.highF ?? '—'}° / L ${today.lowF ?? '—'}°</span>
        ${today.precipChance != null ? `<span>💧 ${today.precipChance}%</span>` : ''}
        ${c.current.windMph != null ? `<span>💨 ${c.current.windMph} mph</span>` : ''}
        ${c.current.humidity != null ? `<span>${c.current.humidity}% humidity</span>` : ''}
        ${uvBadge}
      </div>
      ${tideBlock}
      ${forecast.length ? `
        <div class="forecast" aria-label="6-day forecast">
          ${forecast.map(d => `
            <div class="forecast-day" title="${escapeHtml(d.condition || '')}${d.precipChance != null ? ' · ' + d.precipChance + '% precip' : ''}">
              <div class="fd-dow">${escapeHtml(d.dow || '')}</div>
              <div class="fd-icon" aria-hidden="true">${escapeHtml(d.icon || '')}</div>
              <div class="fd-temps"><span class="fd-hi">${d.highF ?? '—'}°</span> <span class="fd-lo">${d.lowF ?? '—'}°</span></div>
              ${d.precipChance != null && d.precipChance >= 20 ? `<div class="fd-precip">💧${d.precipChance}%</div>` : '<div class="fd-precip">&nbsp;</div>'}
            </div>
          `).join('')}
        </div>
      ` : ''}`;
    root.appendChild(card);
  }
}

// ---------- stories ----------

function renderStories(elementId, stories, countId) {
  const ul = document.getElementById(elementId);
  if (!ul) return;
  const countEl = countId ? document.getElementById(countId) : null;
  ul.innerHTML = '';
  const list = stories || [];
  if (countEl) countEl.textContent = list.length ? `${list.length} ${list.length === 1 ? 'story' : 'stories'}` : '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No stories available.';
    ul.appendChild(li);
    return;
  }
  for (const s of list) {
    const li = document.createElement('li');
    li.className = 'story';
    const a = document.createElement('a');
    a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'story-title';
    a.textContent = s.title;
    li.appendChild(a);

    const desc = cleanDescription(s.description, s.title);
    if (desc) {
      const p = document.createElement('p');
      p.className = 'story-summary';
      p.textContent = desc;
      li.appendChild(p);
    }

    if (s.whyItMatters) {
      const why = document.createElement('p');
      why.className = 'story-why';
      const label = document.createElement('span');
      label.className = 'story-why-label';
      label.textContent = 'Why it matters: ';
      why.appendChild(label);
      why.appendChild(document.createTextNode(s.whyItMatters));
      li.appendChild(why);
    }

    const meta = document.createElement('div');
    meta.className = 'story-meta';
    if (s.source) {
      const src = document.createElement('span');
      src.className = 'story-source';
      src.textContent = s.source;
      meta.appendChild(src);
    }
    if (s.bias) {
      const b = document.createElement('span');
      b.className = `bias bias-${s.bias}`;
      b.textContent = s.biasLabel || s.bias;
      meta.appendChild(b);
    } else if (s.region === 'mexico') {
      const b = document.createElement('span');
      b.className = `bias region-mexico${s.isOaxaca ? ' region-oaxaca' : ''}`;
      b.textContent = s.isOaxaca ? '🇲🇽 Oaxaca' : '🇲🇽 Mexico';
      meta.appendChild(b);
    }
    if (s.language && s.language !== 'en') {
      const lang = document.createElement('span');
      lang.className = 'lang-tag';
      lang.textContent = s.language.toUpperCase();
      lang.title = `Article in ${s.language === 'es' ? 'Spanish' : s.language}`;
      meta.appendChild(lang);
    }
    if (s.publishedAt) {
      const t = document.createElement('span');
      t.textContent = relativeTime(s.publishedAt);
      meta.appendChild(t);
    }
    li.appendChild(meta);
    ul.appendChild(li);
  }
}

function cleanDescription(desc, title) {
  if (!desc) return '';
  let d = String(desc).replace(/\s*\[\+\d+\s*chars\]\s*$/, '').trim();
  if (title && d && (title.startsWith(d) || d === title)) return '';
  return d;
}

// ---------- tabs ----------

const TAB_KEY = 'news-app:tab';
const TAB_ORDER = ['us', 'mx', 'intl'];

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panes = document.querySelectorAll('.tab-pane');
  function activate(name) {
    for (const t of tabs) t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
    for (const p of panes) p.hidden = p.dataset.pane !== name;
    try { localStorage.setItem(TAB_KEY, name); } catch {}
  }
  for (const t of tabs) {
    t.addEventListener('click', () => activate(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const idx = TAB_ORDER.indexOf(t.dataset.tab);
      if (e.key === 'ArrowRight') activate(TAB_ORDER[(idx + 1) % TAB_ORDER.length]);
      if (e.key === 'ArrowLeft')  activate(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
    });
  }
  let initial = smartDefaultTab();
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved && TAB_ORDER.includes(saved)) initial = saved;
  } catch {}
  activate(initial);
}

// Default to Mexico tab when user's phone/browser is in a Mexican timezone.
function smartDefaultTab() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Mexico|Tijuana|Hermosillo|Mazatlan|Mexico_City|Cancun|Chihuahua|Merida|Monterrey|Bahia_Banderas/i.test(tz)) {
      return 'mx';
    }
  } catch {}
  return 'us';
}

// ---------- helpers ----------

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
