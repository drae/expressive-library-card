/*
 * expressive-library-card
 * Copyright (c) 2026 Paul Owen
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * What's on the media server and what's coming, from Sonarr, Radarr, Plex and Tautulli.
 * Several views of one shared data set, each drawing its own block heading:
 *
 *   type: custom:expressive-library-card
 *   show: glance                        # glance: Unwatched and Problems buttons
 *                                       # attention: queue problems and health warnings, with the reasons
 *                                       # streaming: what's playing now
 *                                       # downloads: the download queue
 *                                       # agenda: yesterday onwards by day
 *   name: Server                        # block heading; defaults per view
 *   days: 7                             # how far ahead the agenda looks (yesterday is always included)
 *   films: true                         # include Radarr releases in the agenda
 *   services:                           # rest_commands returning the raw APIs (see media_library.yaml)
 *     sonarr: rest_command.sonarr_calendar
 *     radarr: rest_command.radarr_calendar
 *     sonarr_queue: rest_command.sonarr_queue
 *     radarr_queue: rest_command.radarr_queue
 *     sonarr_health: rest_command.sonarr_health
 *     radarr_health: rest_command.radarr_health
 *     plex_episodes: rest_command.plex_recent_episodes
 *     plex_films: rest_command.plex_recent_films
 *     activity: rest_command.tautulli_activity
 *   entities:
 *     watching: sensor.tautulli_watching
 *     download_speed: sensor.sabnzbd_speed
 *   styles:                             # one block per element; CSS names, bare numbers become px
 *     row:
 *       padding: 8
 *
 * Elements: heading, name, sub, button, value, label, disc, row, poster, title, subtitle, reason, pill, day, bar.
 * Data is fetched only while a card is on screen: the agenda and Plex every few minutes, the queues,
 * health and streams every 30 seconds.
 */

(() => {
  const VERSION = "0.2.3";
  const DAY_MS = 86400000;
  const SLOW_MS = 5 * 60000;
  const FAST_MS = 30000;

  const SERVICES = {
    sonarr: "rest_command.sonarr_calendar",
    radarr: "rest_command.radarr_calendar",
    sonarr_queue: "rest_command.sonarr_queue",
    radarr_queue: "rest_command.radarr_queue",
    sonarr_health: "rest_command.sonarr_health",
    radarr_health: "rest_command.radarr_health",
    plex_episodes: "rest_command.plex_recent_episodes",
    plex_films: "rest_command.plex_recent_films",
    activity: "rest_command.tautulli_activity",
  };
  const ENTITIES = {
    watching: "sensor.tautulli_watching",
    download_speed: "sensor.sabnzbd_speed",
  };
  const NAMES = { glance: "Server", attention: "Needs attention", streaming: "Streaming", downloads: "Downloads", agenda: "Coming up" };

  const TARGETS = {
    heading: ".heading", name: ".heading .name", sub: ".heading .hsub",
    button: ".ssm", value: ".ssm .l", label: ".ssm .n", disc: ".ssm .ic, .ar .dsc",
    row: ".ar", poster: ".ar img", title: ".ti", subtitle: ".su", reason: ".why", pill: ".pill", day: ".day", bar: ".bar",
  };
  const ALIASES = { size: "font-size", weight: "font-weight", colour: "color" };
  const UNITLESS = new Set(["font-weight", "opacity", "z-index", "line-height", "flex", "flex-grow", "flex-shrink", "order"]);
  const flat = (b) => (Array.isArray(b) ? Object.assign({}, ...b) : b && typeof b === "object" ? b : {});
  const userCss = (styles) =>
    Object.entries(styles ?? {})
      .filter(([el]) => TARGETS[el])
      .map(([el, block]) => {
        if (typeof block === "string") return `${TARGETS[el]} { ${block} }`;
        const decls = Object.entries(flat(block)).map(([k, v]) => {
          const prop = ALIASES[k] ?? k;
          return `${prop}: ${typeof v === "number" && !UNITLESS.has(prop) ? `${v}px` : v};`;
        });
        return decls.length ? `${TARGETS[el]} { ${decls.join(" ")} }` : "";
      })
      .filter(Boolean)
      .join("\n");

  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  // Dates in the HA time zone.
  const fmt = (tz, t, o) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(new Date(t));
  const dayKey = (tz, t) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const dayDiff = (tz, t, now) => Math.round((Date.parse(dayKey(tz, t)) - Date.parse(dayKey(tz, now))) / DAY_MS);
  const relDay = (tz, t, now) => {
    const d = dayDiff(tz, t, now);
    if (d === 0) return "Today";
    if (d === -1) return "Yesterday";
    if (d === 1) return "Tomorrow";
    return fmt(tz, t, d > -7 && d < 7 ? { weekday: "long" } : { weekday: "short", day: "numeric", month: "short" });
  };
  const dayPart = (tz, t) => {
    const h = Number(fmt(tz, t, { hour: "2-digit", hourCycle: "h23" }));
    return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  };

  // Show names without Sonarr's disambiguation: "Heartland (2007) (CA)" → "Heartland".
  const showName = (t) => String(t ?? "").replace(/\s*\((\d{4}|[A-Z]{2})\)/g, "").trim();
  const network = (n) => String(n ?? "").replace(/\s*\(.*?\)/g, "").replace(/\s+Television$/, "").trim();
  const runtime = (m) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : "");
  const span = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    const contiguous = s.every((n, i) => i === 0 || n === s[i - 1] + 1);
    return s.length === 1 ? `E${s[0]}` : contiguous ? `E${s[0]}–${s.at(-1)}` : s.map((n) => `E${n}`).join(", ");
  };
  const words = (s) => String(s ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const gb = (b) => (num(b) / 1e9).toFixed(1);
  // Sonarr/Radarr time left is "hh:mm:ss" or "d.hh:mm:ss".
  const timeLeft = (s) => {
    const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(String(s ?? ""));
    if (!m) return "";
    const mins = Number(m[1] ?? 0) * 1440 + Number(m[2]) * 60 + Number(m[3]);
    return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min left` : `${Math.max(1, mins)} min left`;
  };

  // Small artwork: TVDB has _t thumbnails, TMDB has sized paths.
  const thumb = (url) => {
    if (!url) return null;
    if (url.includes("image.tmdb.org/t/p/original/")) return url.replace("/t/p/original/", "/t/p/w154/");
    if (url.includes("artworks.thetvdb.com/banners/") && !/_t\.\w+$/.test(url)) return url.replace(/(\.\w+)$/, "_t$1");
    return url;
  };
  const posterOf = (images) => (images ?? []).find((i) => i.coverType === "poster")?.remoteUrl ?? null;

  // Rest command responses arrive as { status, content } with content parsed when the reply was JSON.
  const content = (r) => {
    const c = r?.response?.content;
    return typeof c === "string" ? JSON.parse(c) : c;
  };

  /* ---------- the model: pure functions of the API replies ---------- */

  // Sonarr calendar → one item per show per day; all episodes downloaded = on Plex.
  const episodeItems = (episodes, tz) => {
    const groups = new Map();
    for (const e of episodes ?? []) {
      if (!e?.airDateUtc || !e.series) continue;
      const key = `${e.seriesId}|${dayKey(tz, e.airDateUtc)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [...groups.values()].map((g) => {
      g.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
      const first = g[0];
      const season = first.seasonNumber;
      const premiere = first.episodeNumber === 1;
      const name = premiere ? (season === 1 ? "New series" : `Season ${season} starts`) : g.length > 1 ? `${g.length} episodes` : first.title;
      return {
        kind: "tv",
        at: Date.parse(first.airDateUtc),
        title: showName(first.series.title),
        ep: `S${season} ${span(g.filter((e) => e.seasonNumber === season).map((e) => e.episodeNumber))}`,
        name,
        network: network(first.series.network),
        poster: thumb(posterOf(first.series.images)),
        posterFull: posterOf(first.series.images),
        have: g.every((e) => e.hasFile),
        premiere,
      };
    });
  };

  // Radarr calendar → the digital or physical release (whichever falls first in the window), never cinemas.
  // Films already on disk only show if that release was yesterday or today.
  const filmItems = (movies, tz, now, end) => {
    const from = Date.parse(dayKey(tz, now - DAY_MS));
    const out = [];
    for (const m of movies ?? []) {
      if (!m?.monitored) continue;
      const rel = [["Digital", m.digitalRelease], ["Blu-ray", m.physicalRelease]]
        .map(([label, d]) => ({ label, at: Date.parse(d ?? "") }))
        .filter((r) => r.at >= from && r.at < end)
        .sort((a, b) => a.at - b.at)[0];
      if (!rel) continue;
      if (m.hasFile && dayDiff(tz, rel.at, now) > 0) continue;
      out.push({
        kind: "film",
        at: rel.at,
        title: m.title,
        release: rel.label,
        meta: [m.certification, runtime(m.runtime)].filter(Boolean).join(" · "),
        poster: thumb(posterOf(m.images)),
        posterFull: posterOf(m.images),
        have: !!m.hasFile,
      });
    }
    return out;
  };

  const agendaItems = (data, cfg, tz, now) => {
    const end = Date.parse(dayKey(tz, now)) + (cfg.days + 1) * DAY_MS;
    const tv = episodeItems(data.sonarr, tz).filter((i) => i.at < end && dayDiff(tz, i.at, now) >= -1);
    const films = cfg.films ? filmItems(data.radarr, tz, now, end) : [];
    return tv.concat(films).sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
  };

  // Added to Plex in the past 7 days and not watched yet (the token's account): one per show or film.
  const unwatched = (episodes, films, now) => {
    const recent = (m) => now - num(m.addedAt) * 1000 <= 7 * DAY_MS && !num(m.viewCount);
    const shows = new Set((episodes ?? []).filter(recent).map((m) => m.grandparentTitle));
    return shows.size + (films ?? []).filter(recent).length;
  };

  const STATE = {
    importBlocked: "import blocked", importPending: "import pending", importFailed: "import failed",
    failedPending: "download failed", failed: "download failed", downloading: "stalled", importing: "importing",
  };
  const isProblem = (r) => r && r.trackedDownloadStatus && r.trackedDownloadStatus !== "ok";
  const queueTitle = (r) =>
    r.series && r.episode ? `${showName(r.series.title)} · S${r.episode.seasonNumber} E${r.episode.episodeNumber}` : r.movie?.title ?? r.title;
  const queuePoster = (r) => posterOf(r.series?.images ?? r.movie?.images);

  // Queue problems and health warnings, worst first.
  const problemRows = (data) => {
    const rows = [];
    for (const [app, key] of [["Sonarr", "sonarr_queue"], ["Radarr", "radarr_queue"]]) {
      for (const r of data[key]?.records ?? []) {
        if (!isProblem(r)) continue;
        const reasons = (r.statusMessages ?? []).flatMap((m) => m.messages ?? []);
        rows.push({
          level: r.trackedDownloadStatus === "error" ? "error" : "warning",
          title: queueTitle(r),
          sub: `${app} · ${STATE[r.trackedDownloadState] ?? words(r.trackedDownloadState || r.status)}`,
          why: reasons[0] ?? r.errorMessage ?? "",
          poster: thumb(queuePoster(r)),
          posterFull: queuePoster(r),
        });
      }
    }
    for (const [app, key] of [["Sonarr", "sonarr_health"], ["Radarr", "radarr_health"]]) {
      for (const h of data[key] ?? []) {
        rows.push({ level: h.type === "error" ? "error" : "warning", title: `${app} health`, sub: words(h.source).replace(/ check$/, ""), why: h.message, icon: true });
      }
    }
    return rows.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  };

  const downloadRows = (data) =>
    ["sonarr_queue", "radarr_queue"].flatMap((key) =>
      (data[key]?.records ?? []).filter((r) => !isProblem(r)).map((r) => {
        const size = num(r.size), left = num(r.sizeleft);
        const pct = size ? ((size - left) / size) * 100 : 0;
        const active = r.status === "downloading";
        return {
          title: queueTitle(r),
          sub: active && size ? [`${gb(size - left)} of ${gb(size)} GB`, timeLeft(r.timeleft)].filter(Boolean).join(" · ") : words(r.status).replace(/^./, (c) => c.toUpperCase()),
          pct,
          active,
        };
      }));

  // Live TV has no position or programme times, so it shows the channel instead of progress.
  // channel_title is "<number> <call sign> (<name>)", and the name can hold its own brackets.
  const channel = (s) => /\((.+)\)/.exec(s.channel_title ?? "")?.[1] ?? s.channel_call_sign ?? "";
  const streamRows = (sessions) =>
    (sessions ?? []).map((s) => {
      const live = num(s.live) === 1;
      const tv = s.media_type === "episode" && s.grandparent_title;
      const left = Math.max(0, Math.round((num(s.duration) - num(s.view_offset)) / 60000));
      const how = s.transcode_decision === "transcode" ? "transcode" : s.transcode_decision === "copy" ? "direct stream" : "direct play";
      const who = s.friendly_name || s.user || s.player || s.product;
      return {
        title: tv ? `${s.grandparent_title} · S${s.parent_media_index} E${s.media_index}` : s.title,
        sub: [who, how, live ? channel(s) : left ? `${left} min left` : ""].filter(Boolean).join(" · "),
        pct: live ? null : num(s.progress_percent),
      };
    });

  /* ---------- shared store: one fetch serves every card on the page ---------- */

  const store = { cards: new Set(), data: {}, errors: {}, slowAt: 0, fastAt: 0, slow: null, fast: null, hass: null };

  const call = (hass, svc, data = {}) => {
    const [domain, service] = svc.split(".");
    return hass.callWS({ type: "call_service", domain, service, service_data: data, return_response: true });
  };
  const notify = () => store.cards.forEach((c) => c._render());
  const visibleCards = () => [...store.cards].filter((c) => c._visible);

  const fetchInto = async (key, fn) => {
    try {
      store.data[key] = await fn();
      delete store.errors[key];
    } catch (e) {
      store.errors[key] = String(e?.message ?? e);
    }
  };

  // Agenda and Plex: every few minutes.
  function loadSlow(force = false) {
    const cards = visibleCards();
    if (!cards.length || !store.hass || store.slow || (!force && Date.now() - store.slowAt < SLOW_MS)) return store.slow;
    const hass = store.hass, svc = cards[0]._config.services;
    const days = Math.max(...cards.map((c) => c._config.days));
    store.slow = Promise.all([
      fetchInto("sonarr", async () => content(await call(hass, svc.sonarr, { days }))),
      fetchInto("radarr", async () => content(await call(hass, svc.radarr, { days }))),
      fetchInto("plex_episodes", async () => content(await call(hass, svc.plex_episodes))?.MediaContainer?.Metadata ?? []),
      fetchInto("plex_films", async () => content(await call(hass, svc.plex_films))?.MediaContainer?.Metadata ?? []),
    ]).finally(() => {
      store.slow = null;
      store.slowAt = Date.now();
      notify();
    });
    return store.slow;
  }

  // Queues, health and streams: every 30 seconds, and whenever the watching count changes.
  function loadFast(force = false) {
    const cards = visibleCards();
    if (!cards.length || !store.hass || store.fast || (!force && Date.now() - store.fastAt < FAST_MS)) return store.fast;
    const hass = store.hass, cfg = cards[0]._config, svc = cfg.services;
    const watching = num(hass.states[cfg.entities.watching]?.state) > 0;
    store.fast = Promise.all([
      fetchInto("sonarr_queue", async () => content(await call(hass, svc.sonarr_queue))),
      fetchInto("radarr_queue", async () => content(await call(hass, svc.radarr_queue))),
      fetchInto("sonarr_health", async () => content(await call(hass, svc.sonarr_health))),
      fetchInto("radarr_health", async () => content(await call(hass, svc.radarr_health))),
      watching
        ? fetchInto("sessions", async () => content(await call(hass, svc.activity))?.response?.data?.sessions ?? [])
        : Promise.resolve((store.data.sessions = [])),
    ]).finally(() => {
      store.fast = null;
      store.fastAt = Date.now();
      notify();
    });
    return store.fast;
  }

  let timer = null;
  const startTimer = () => {
    if (timer) return;
    timer = setInterval(() => { loadSlow(); loadFast(); }, FAST_MS);
  };
  const stopTimer = () => {
    if (visibleCards().length) return;
    clearInterval(timer);
    timer = null;
  };

  /* ---------- the card ---------- */

  const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  class ExpressiveLibraryCard extends HTMLElement {
    setConfig(config) {
      const show = config?.show ?? "glance";
      if (!NAMES[show]) throw new Error(`show must be one of ${Object.keys(NAMES).join(", ")}`);
      this._config = {
        show,
        name: NAMES[show],
        days: 7,
        films: true,
        ...config,
        services: { ...SERVICES, ...(config.services ?? {}) },
        entities: { ...ENTITIES, ...(config.entities ?? {}) },
      };
      this._config.days = Math.min(30, Math.max(1, Math.round(num(this._config.days)) || 7));
      if (this.shadowRoot) {
        this.shadowRoot.getElementById("user").textContent = userCss(this._config.styles);
        this._render();
      }
    }

    set hass(hass) {
      const prev = this._hass;
      this._hass = hass;
      store.hass = hass;
      if (!this.shadowRoot) this._build();
      const e = this._config.entities;
      if (prev && prev.states[e.watching]?.state !== hass.states[e.watching]?.state && this._visible) loadFast(true);
      if (!prev || prev.states[e.download_speed] !== hass.states[e.download_speed]) this._render();
    }

    getCardSize() {
      return this._config?.show === "agenda" ? 6 : 2;
    }

    getGridOptions() {
      return { columns: 12, rows: "auto", min_columns: 6 };
    }

    connectedCallback() {
      store.cards.add(this);
      if (typeof IntersectionObserver === "undefined") this._setVisible(true);
      else {
        this._io ??= new IntersectionObserver((ents) => this._setVisible(ents.some((x) => x.isIntersecting)));
        this._io.observe(this);
      }
    }

    disconnectedCallback() {
      this._io?.disconnect();
      this._setVisible(false);
      store.cards.delete(this);
    }

    _setVisible(v) {
      this._visible = v;
      if (v) {
        startTimer();
        loadSlow();
        loadFast();
      } else stopTimer();
    }

    _build() {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${CSS}</style><style id="user">${userCss(this._config.styles)}</style>
        <div class="heading"><h4 class="name"></h4><span class="hl"></span><span class="hsub"></span></div>
        <div class="body"></div>`;
      this._render();
    }

    _render() {
      if (!this.shadowRoot || !this._hass) return;
      const root = this.shadowRoot;
      root.querySelector(".name").textContent = this._config.name;
      const [sub, html, live] = this[`_${this._config.show}`]();
      const hsub = root.querySelector(".hsub");
      hsub.textContent = sub;
      hsub.classList.toggle("live", !!live);
      const body = root.querySelector(".body");
      if (body._html !== html) {
        body.innerHTML = html;
        body._html = html;
        body.querySelectorAll("img[data-full]").forEach((img) => {
          img.addEventListener("error", () => { if (img.dataset.full && img.src !== img.dataset.full) img.src = img.dataset.full; }, { once: true });
        });
      }
    }

    _tz() {
      return this._hass?.config?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    }

    _poster(url, full) {
      return url ? `<img src="${esc(url)}" data-full="${esc(full ?? "")}" alt="" loading="lazy">` : `<span class="noimg"></span>`;
    }

    _disc(icon, on) {
      return `<span class="dsc ${on ? "on" : ""}"><ha-icon icon="${icon}"></ha-icon></span>`;
    }

    _bar(pct, amber) {
      return `<div class="bar ${amber ? "amb" : ""}"><i style="width:${Math.min(100, Math.max(0, pct)).toFixed(0)}%"></i></div>`;
    }

    _button(value, name, icon, alert) {
      return `<div class="ssm ${alert ? "alert" : ""}"><span class="l">${esc(value)}</span><span class="n">${esc(name)}</span><span class="ic"><ha-icon icon="${icon}"></ha-icon></span></div>`;
    }

    _glance() {
      const d = store.data;
      const unw = d.plex_episodes || d.plex_films ? unwatched(d.plex_episodes, d.plex_films, Date.now()) : "–";
      const loaded = d.sonarr_queue || d.radarr_queue || d.sonarr_health || d.radarr_health;
      const problems = loaded ? problemRows(d).length : "–";
      return ["Plex · Sonarr · Radarr", `<div class="pair">${this._button(unw, "Unwatched", "mdi:eye-outline")}${this._button(problems, "Problems", "mdi:alert-outline", problems > 0)}</div>`];
    }

    _attention() {
      const rows = problemRows(store.data);
      if (!rows.length) return ["", `<div class="msg">Nothing needs attention</div>`];
      const html = rows.map((r) => `<div class="ar">${r.icon ? this._disc("mdi:alert-outline") : this._poster(r.poster, r.posterFull)}
        <div class="tx"><div class="ti">${esc(r.title)}</div><div class="su">${esc(r.sub)}</div>${r.why ? `<div class="why">${esc(r.why)}</div>` : ""}</div>
        <div class="rt"><span class="pill ${r.level === "error" ? "err" : "amb"}">${r.level === "error" ? "Error" : "Warning"}</span></div></div>`).join("");
      return [`${rows.length} ${rows.length === 1 ? "problem" : "problems"}`, `<div class="rows">${html}</div>`, true];
    }

    _streaming() {
      const rows = streamRows(store.data.sessions);
      if (!rows.length) return ["", `<div class="msg">Nobody watching</div>`];
      const html = rows.map((r) => `<div class="ar">${this._disc("mdi:television", true)}<div class="tx"><div class="ti">${esc(r.title)}</div><div class="su">${esc(r.sub)}</div>${r.pct == null ? "" : this._bar(r.pct)}</div></div>`).join("");
      return [`${rows.length} now`, `<div class="rows">${html}</div>`, true];
    }

    _downloads() {
      const rows = downloadRows(store.data);
      if (!rows.length) return ["", `<div class="msg">Queue empty</div>`];
      const speed = num(this._hass.states[this._config.entities.download_speed]?.state);
      const sub = [`${rows.length} in queue`, speed > 0 ? `${speed.toFixed(0)} MB/s` : ""].filter(Boolean).join(" · ");
      const html = rows.map((r) => `<div class="ar">${this._disc("mdi:download", r.active)}<div class="tx"><div class="ti">${esc(r.title)}</div><div class="su">${esc(r.sub)}</div>${this._bar(r.pct, true)}</div><div class="rt"><span class="tm">${r.pct.toFixed(0)}%</span></div></div>`).join("");
      return [sub, `<div class="rows">${html}</div>`, true];
    }

    _agenda() {
      const tz = this._tz();
      const now = Date.now();
      const cfg = this._config;
      if (!store.data.sonarr && !store.data.radarr) {
        const msg = store.errors.sonarr ? "Couldn’t reach Sonarr" : "Loading…";
        return ["", `<div class="msg">${esc(msg)}</div>`];
      }
      const items = agendaItems(store.data, cfg, tz, now);
      const due = items.filter((i) => !i.have).length;
      const sub = `${due} due · next ${cfg.days} days`;
      if (!items.length) return [sub, `<div class="msg">Nothing due in the next ${cfg.days} days</div>`];
      const groups = new Map();
      for (const it of items) {
        const k = dayKey(tz, it.at);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      let h = "";
      for (const list of groups.values()) {
        const t = list[0].at;
        h += `<div class="day"><span>${esc(relDay(tz, t, now))}</span><span>${esc(fmt(tz, t, { day: "numeric", month: "short" }))}</span></div>`;
        for (const it of list) {
          const sub2 = it.kind === "film" ? ["Film", it.meta].filter(Boolean).join(" · ") : `${it.ep} · ${it.name}`;
          let pill;
          if (it.have) pill = `<span class="pill have">${TICK}On Plex</span>`;
          else if (it.kind === "film") pill = `<span class="pill amb">${esc(it.release)}</span>`;
          else if (it.premiere) pill = `<span class="pill amb">Premiere</span>`;
          else pill = `<span class="pill due">${esc(dayPart(tz, it.at))}</span>`;
          const net = it.kind === "tv" && it.network ? `<span class="tm">${esc(it.network)}</span>` : "";
          h += `<div class="ar">${this._poster(it.poster, it.posterFull)}<div class="tx"><div class="ti">${esc(it.title)}</div><div class="su">${esc(sub2)}</div></div><div class="rt">${pill}${net}</div></div>`;
        }
      }
      return [sub, `<div class="rows">${h}</div>`];
    }
  }

  const CSS = `
    /* flow-root stops the heading's -16px collapsing through the block, so it straddles the block's edge */
    :host { display: flow-root; }
    /* margin-bottom matches the space a Bubble section_heading separator leaves */
    .heading { display: flex; align-items: center; gap: 8px; height: 32px; margin: -16px 0 6px; min-width: 0; }
    .heading .name { margin: 0; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .heading .hl { flex: 1; }
    .heading .hsub { font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }
    .heading .hsub.live { color: #e7a94a; }
    [hidden] { display: none !important; }
    .msg { font-size: 12.5px; color: var(--secondary-text-color); padding: 8px 0; }
    .ti { font-size: 14px; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .su { font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .why { font-size: 12.5px; color: var(--secondary-text-color); line-height: 1.45; margin-top: 4px; }
    .tm { font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
    .tx { min-width: 0; }

    /* the sensor_small button-card template, as CPU busy / Mem used in Systems */
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ssm { background: var(--popupBG, var(--secondary-background-color)); border-radius: 32px; height: 64px; font-size: 14px; min-width: 0;
           display: grid; grid-template-columns: minmax(0, 1fr) 70px; grid-template-areas: "l i" "n i"; grid-template-rows: 1fr min-content; }
    .ssm .l { grid-area: l; align-self: end; font-size: 1.3em; font-weight: 300; line-height: 1; padding-left: 24px; color: var(--primary-text-color); }
    .ssm .n { grid-area: n; align-self: start; font-size: 12px; font-weight: 600; opacity: 0.6; padding: 0 0 12px 24px;
              color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ssm .ic { grid-area: i; justify-self: end; align-self: start; margin: 6px; width: 52px; height: 52px; border-radius: 50%;
               background: rgba(var(--highlight, 127, 127, 127, 0.1)); display: grid; place-items: center; color: var(--primary-text-color); }
    .ssm .ic ha-icon { --mdc-icon-size: 24px; opacity: 0.7; }
    .ssm.alert .ic { background: rgb(201, 126, 11); }
    .ssm.alert .ic ha-icon { opacity: 1; }

    .rows { display: grid; gap: 8px; }
    .day { font-size: 12.5px; font-weight: 600; color: var(--secondary-text-color); padding: 8px 8px 0; display: flex; justify-content: space-between; }
    .day:first-child { padding-top: 0; }
    .day span:last-child { font-weight: 500; }
    .ar { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 16px; align-items: center;
          background: var(--popupBG, var(--secondary-background-color)); border-radius: 16px; padding: 8px 16px 8px 8px; min-height: 56px; }
    .ar img, .ar .noimg { width: 40px; height: 60px; border-radius: 8px; object-fit: cover; display: block; background: var(--gray100, rgba(127, 127, 127, 0.2)); }
    .ar .dsc { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
               background: rgba(var(--highlight, 127, 127, 127, 0.1)); color: var(--primary-text-color); }
    .ar .dsc ha-icon { --mdc-icon-size: 20px; }
    .ar .dsc.on { background: rgb(201, 126, 11); }
    .ar .rt { display: grid; justify-items: end; gap: 4px; }
    .pill { font-size: 11px; font-weight: 600; border-radius: 12px; padding: 2px 8px; white-space: nowrap; display: inline-flex; gap: 4px; align-items: center; }
    .pill svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .pill.have { background: color-mix(in srgb, #75985d 24%, var(--popupBG, #28282a)); color: #a9c895; }
    .pill.due { background: var(--gray100, rgba(127, 127, 127, 0.2)); color: var(--secondary-text-color); }
    .pill.amb { background: color-mix(in srgb, rgb(201, 126, 11) 24%, var(--popupBG, #28282a)); color: #e7a94a; }
    .pill.err { background: color-mix(in srgb, #c0392b 28%, var(--popupBG, #28282a)); color: #f08a7e; }
    .bar { height: 4px; border-radius: 2px; background: var(--gray100, rgba(127, 127, 127, 0.2)); overflow: hidden; margin-top: 8px; }
    .bar i { display: block; height: 100%; background: var(--primary-text-color); border-radius: 2px; }
    .bar.amb i { background: rgb(201, 126, 11); }
  `;

  // For tests.
  ExpressiveLibraryCard._model = {
    episodeItems, filmItems, agendaItems, unwatched, problemRows, downloadRows, streamRows, timeLeft, thumb, showName, store,
  };

  if (!customElements.get("expressive-library-card")) {
    console.info(`%c EXPRESSIVE-LIBRARY-CARD %c ${VERSION} `, "background:#c97e0b;color:#fff;font-weight:600", "background:#28282a;color:#fff");
    customElements.define("expressive-library-card", ExpressiveLibraryCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "expressive-library-card",
      name: "Expressive library",
      description: "What's on the media server and what's coming, from Sonarr, Radarr, Plex and Tautulli",
    });
  }
})();
