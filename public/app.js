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
  renderWeather(data.weather || []);
  renderStories('politics', data.politics);
  renderStories('medicineTech', data.medicineTech);
  renderStories('genai', data.genai);
})();

function renderMeta(data) {
  const meta = document.getElementById('meta');
  if (!data.generatedAt) {
    meta.textContent = 'No data yet.';
    return;
  }
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

function renderWeather(cities) {
  const root = document.getElementById('weather-cards');
  root.innerHTML = '';
  if (!cities.length) {
    root.innerHTML = '<div class="empty">Weather unavailable.</div>';
    return;
  }
  for (const c of cities) {
    const card = document.createElement('div');
    card.className = 'weather-card';
    const today = c.today || {};
    const forecast = (c.forecast || []).slice(1, 7); // next 6 days
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
      </div>
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

function renderStories(id, stories) {
  const ul = document.getElementById(id);
  ul.innerHTML = '';
  if (!stories || !stories.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No stories available.';
    ul.appendChild(li);
    return;
  }
  for (const s of stories) {
    const li = document.createElement('li');
    li.className = 'story';
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
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

// Clean up common feed-description noise (NewsAPI "[+1234 chars]", duplicate-of-title, etc.)
function cleanDescription(desc, title) {
  if (!desc) return '';
  let d = String(desc).replace(/\s*\[\+\d+\s*chars\]\s*$/, '').trim();
  // If description is just a prefix of the title, it's not useful.
  if (title && d && (title.startsWith(d) || d === title)) return '';
  return d;
}

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
