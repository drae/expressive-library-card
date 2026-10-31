/*
 * expressive-library-card
 * Copyright (c) 2026 Paul Owen
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * What's on the media server and what's coming, from Sonarr, Radarr, Tautulli and SABnzbd.
 * Two views of one shared data set, each drawing its own block heading:
 *
 *   type: custom:expressive-library-card
 *   show: glance                        # glance: counts, streams, downloads, disk, plays | agenda: by day
 *   name: Server                        # block heading; default "Server" / "Coming up"
 *   days: 7                             # how far ahead the agenda looks (yesterday is always included)
 *   films: true                         # include Radarr releases in the agenda
 *   disk_path: /mnt/media               # Sonarr disk path for the disk bar
 *   services:                           # rest_commands returning the raw APIs (see media_library.yaml)
 *     sonarr: rest_command.sonarr_calendar
 *     radarr: rest_command.radarr_calendar
 *     recently_added: rest_command.tautulli_recently_added
 *     plays: rest_command.tautulli_plays
 *     libraries: rest_command.tautulli_libraries
 *     activity: rest_command.tautulli_activity
 *   entities:                           # integration entities for live state
 *     watching: sensor.tautulli_watching
 *     sonarr_queue: sensor.sonarr_queue
 *     radarr_queue: sensor.radarr_queue
 *     download_speed: sensor.sabnzbd_speed
 *   styles:                             # one block per element; CSS names, bare numbers become px
 *     row:
 *       padding: 8
 *
 * Elements: heading, name, sub, card, stats, stat, row, poster, title, subtitle, pill, day, bar, spark.
 * Data is fetched only while a card is on screen, and refreshed every few minutes.
 */

(() => {
  const VERSION = "0.1.0";
  const DAY_MS = 86400000;
  const REFRESH_MS = 5 * 60000;
  const ACTIVITY_MS = 30000;

  const SERVICES = {
    sonarr: "rest_command.sonarr_calendar",
    radarr: "rest_command.radarr_calendar",
    recently_added: "rest_command.tautulli_recently_added",
    plays: "rest_command.tautulli_plays",
    libraries: "rest_command.tautulli_libraries",
    activity: "rest_command.tautulli_activity",
  };
  const ENTITIES = {
    watching: "sensor.tautulli_watching",
    sonarr_queue: "sensor.sonarr_queue",
    radarr_queue: "sensor.radarr_queue",
    download_speed: "sensor.sabnzbd_speed",
  };

  const TARGETS = {
    heading: ".heading", name: ".heading .name", sub: ".heading .hsub", card: ".card", stats: ".stats", stat: ".stat",
    row: ".ar, .ac", poster: ".ar img", title: ".ti", subtitle: ".su", pill: ".pill", day: ".day", bar: ".bar", spark: ".spark",
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
  const shortDay = (tz, t) => fmt(tz, t, { weekday: "short", day: "numeric", month: "short" });

  // Show names without Sonarr's disambiguation: "Heartland (2007) (CA)" → "Heartland".
  const showName = (t) => String(t ?? "").replace(/\s*\((\d{4}|[A-Z]{2})\)/g, "").trim();
  const network = (n) => String(n ?? "").replace(/\s*\(.*?\)/g, "").replace(/\s+Television$/, "").trim();
  const runtime = (m) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : "");
  const span = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    const contiguous = s.every((n, i) => i === 0 || n === s[i - 1] + 1);
    return s.length === 1 ? `E${s[0]}` : contiguous ? `E${s[0]}–${s.at(-1)}` : s.map((n) => `E${n}`).join(", ");
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

  // Plex recently added in the last week, one per show or film; music and live TV left out.
  const newThisWeek = (recent, now) => {
    const seen = new Set();
    for (const r of recent ?? []) {
      if (!["movie", "show", "season", "episode"].includes(r.media_type)) continue;
      if (now - num(r.added_at) * 1000 > 7 * DAY_MS) continue;
      seen.add(r.media_type === "movie" ? `m:${r.title}` : `s:${r.grandparent_title || r.parent_title || r.title}`);
    }
    return seen.size;
  };

  // Plays per day for the last seven days, TV and films only.
  const playsByDay = (plays) => {
    const cats = plays?.categories ?? [];
    const series = (plays?.series ?? []).filter((s) => s.name === "TV" || s.name === "Movies");
    const days = cats.map((c, i) => ({ day: c, n: series.reduce((a, s) => a + num(s.data?.[i]), 0) }));
    return days.slice(-7);
  };

  const libraryCounts = (libs) => {
    const of = (type) => (libs ?? []).filter((l) => l.section_type === type).reduce((a, l) => a + num(l.count), 0);
    return { films: of("movie"), shows: of("show") };
  };

  const streamRows = (sessions) =>
    (sessions ?? []).map((s) => {
      const tv = s.media_type === "episode";
      const left = Math.max(0, Math.round((num(s.duration) - num(s.view_offset)) / 60000));
      const how = s.transcode_decision === "transcode" ? "transcode" : s.transcode_decision === "copy" ? "direct stream" : "direct play";
      return {
        title: tv ? `${s.grandparent_title} · S${s.parent_media_index} E${s.media_index}` : s.title,
        sub: [s.player || s.product, how, left ? `${left} min left` : ""].filter(Boolean).join(" · "),
        pct: num(s.progress_percent),
      };
    });

  // Integration queue replies are keyed by download title.
  const queueRows = (sonarrQ, radarrQ, speed) => {
    const gb = (b) => `${(num(b) / 1e9).toFixed(1)}`;
    const row = (q, title) => {
      const size = num(q.size), left = num(q.size_left);
      const pct = size ? ((size - left) / size) * 100 : num(q.progress);
      const parts = [q.download_client, size ? `${gb(size - left)} of ${gb(size)} GB` : "", speed ? `${speed} MB/s` : ""];
      return { title, sub: parts.filter(Boolean).join(" · "), pct };
    };
    const tv = Object.values(sonarrQ ?? {}).map((q) =>
      row(q, `${showName(q.title)} · S${q.season_number} E${q.episode_number}`));
    const films = Object.values(radarrQ ?? {}).map((q) => row(q, q.title));
    return tv.concat(films);
  };

  /* ---------- shared store: one fetch serves every card on the page ---------- */

  const store = {
    cards: new Set(),
    data: {},
    errors: {},
    loading: null,
    at: 0,
    activityAt: 0,
    hass: null,
  };

  const call = async (hass, svc, data = {}) => {
    const [domain, service] = svc.split(".");
    return hass.callWS({ type: "call_service", domain, service, service_data: data, return_response: true });
  };

  const entryId = async (hass, domain) => {
    store.entries ??= {};
    if (!(domain in store.entries)) {
      try {
        const list = await hass.callWS({ type: "config_entries/get", domain });
        store.entries[domain] = list?.find((e) => e.state === "loaded")?.entry_id ?? null;
      } catch (_) {
        store.entries[domain] = null;
      }
    }
    return store.entries[domain];
  };

  const notify = () => store.cards.forEach((c) => c._render());

  const visibleCards = () => [...store.cards].filter((c) => c._visible);

  async function loadAll(force = false) {
    const cards = visibleCards();
    if (!cards.length || !store.hass) return;
    if (store.loading) return store.loading;
    if (!force && Date.now() - store.at < REFRESH_MS) return;
    const hass = store.hass;
    const cfg = cards[0]._config;
    const days = Math.max(...cards.map((c) => c._config.days));
    const get = async (key, fn) => {
      try {
        store.data[key] = await fn();
        delete store.errors[key];
      } catch (e) {
        store.errors[key] = String(e?.message ?? e);
      }
    };
    const svc = cfg.services;
    store.loading = Promise.all([
      get("sonarr", async () => content(await call(hass, svc.sonarr, { days }))),
      get("radarr", async () => content(await call(hass, svc.radarr, { days }))),
      get("recent", async () => content(await call(hass, svc.recently_added))?.response?.data?.recently_added ?? []),
      get("plays", async () => content(await call(hass, svc.plays))?.response?.data ?? null),
      get("libraries", async () => content(await call(hass, svc.libraries))?.response?.data ?? []),
      get("disk", async () => {
        const id = await entryId(hass, "sonarr");
        if (!id) throw new Error("no Sonarr integration");
        const r = await call(hass, "sonarr.get_diskspace", { entry_id: id });
        return Object.values(r?.response?.disks ?? {});
      }),
      loadLive(true),
    ]).finally(() => {
      store.loading = null;
      store.at = Date.now();
      notify();
    });
    return store.loading;
  }

  // Streams and downloads: fetched only while the sensors say something is happening.
  async function loadLive(force = false) {
    const hass = store.hass;
    const cards = visibleCards();
    if (!hass || !cards.length) return;
    if (!force && Date.now() - store.activityAt < ACTIVITY_MS) return;
    store.activityAt = Date.now();
    const e = cards[0]._config.entities;
    const n = (id) => num(hass.states[id]?.state);
    const jobs = [];
    if (n(e.watching) > 0) {
      jobs.push(call(hass, cards[0]._config.services.activity)
        .then((r) => { store.data.sessions = content(r)?.response?.data?.sessions ?? []; })
        .catch(() => { store.data.sessions = []; }));
    } else store.data.sessions = [];
    for (const [key, domain] of [["sonarr_queue", "sonarr"], ["radarr_queue", "radarr"]]) {
      if (n(e[key]) > 0) {
        jobs.push(entryId(hass, domain)
          .then((id) => (id ? call(hass, `${domain}.get_queue`, { entry_id: id }) : null))
          .then((r) => { store.data[key] = r?.response?.[domain === "sonarr" ? "shows" : "movies"] ?? {}; })
          .catch(() => { store.data[key] = {}; }));
      } else store.data[key] = {};
    }
    await Promise.all(jobs);
    notify();
  }

  let timer = null;
  const startTimer = () => {
    if (timer) return;
    timer = setInterval(() => {
      loadAll();
      const e = visibleCards()[0]?._config.entities;
      const h = store.hass;
      if (e && h && [e.watching, e.sonarr_queue, e.radarr_queue].some((id) => num(h.states[id]?.state) > 0)) loadLive();
    }, ACTIVITY_MS);
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
      if (!["glance", "agenda"].includes(show)) throw new Error("show must be glance or agenda");
      this._config = {
        show,
        name: show === "glance" ? "Server" : "Coming up",
        days: 7,
        films: true,
        disk_path: "/mnt/media",
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
      const changed = !prev || [e.watching, e.sonarr_queue, e.radarr_queue].some((id) => prev.states[id]?.state !== hass.states[id]?.state);
      if (changed && this._visible) loadLive(true);
      if (changed || !prev || prev.states[e.download_speed] !== hass.states[e.download_speed]) this._render();
    }

    getCardSize() {
      return this._config?.show === "agenda" ? 6 : 4;
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
        loadAll();
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
      const [sub, html] = this._config.show === "glance" ? this._glance() : this._agenda();
      root.querySelector(".hsub").textContent = sub;
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

    _items() {
      return agendaItems(store.data, this._config, this._tz(), Date.now());
    }

    _agenda() {
      const tz = this._tz();
      const now = Date.now();
      const cfg = this._config;
      if (!store.data.sonarr && !store.data.radarr) {
        const msg = store.errors.sonarr ? "Couldn’t reach Sonarr" : "Loading…";
        return ["", `<div class="msg">${esc(msg)}</div>`];
      }
      const items = this._items();
      const due = items.filter((i) => !i.have).length;
      const sub = `${due} due · ${cfg.days} days`;
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
          const img = it.poster
            ? `<img src="${esc(it.poster)}" data-full="${esc(it.posterFull ?? "")}" alt="" loading="lazy">`
            : `<span class="noimg"></span>`;
          h += `<div class="ar">${img}<div class="tx"><div class="ti">${esc(it.title)}</div><div class="su">${esc(sub2)}</div></div><div class="rt">${pill}${net}</div></div>`;
        }
      }
      return [sub, `<div class="agenda">${h}</div>`];
    }

    _glance() {
      const d = store.data;
      const now = Date.now();
      const e = this._config.entities;
      const st = this._hass.states;
      const watching = Math.round(num(st[e.watching]?.state));
      const items = d.sonarr || d.radarr ? this._items() : null;
      const due = items ? items.filter((i) => !i.have).length : "–";
      const fresh = d.recent ? newThisWeek(d.recent, now) : "–";
      const speed = num(st[e.download_speed]?.state);
      const rows = streamRows(watching > 0 ? d.sessions : [])
        .map((r) => ({ ...r, icon: "tv" }))
        .concat(queueRows(d.sonarr_queue, d.radarr_queue, speed ? speed.toFixed(0) : "").map((r) => ({ ...r, icon: "down" })));
      const act = rows.length
        ? `<div class="act">${rows.map((r) => `<div class="ac"><span class="ic on ${r.icon}"></span><div class="tx"><div class="ti">${esc(r.title)}</div><div class="su">${esc(r.sub)}</div><div class="bar thin ${r.icon === "down" ? "amb" : ""}"><i style="width:${Math.min(100, Math.max(0, r.pct)).toFixed(0)}%"></i></div></div></div>`).join("")}</div>`
        : `<div class="quiet"><span class="ic rest"></span>Nothing streaming or downloading</div>`;
      let disk = "";
      const p = (d.disk ?? []).find((x) => x.path === this._config.disk_path);
      if (p && num(p.total_space) > 0) {
        const used = 1 - num(p.free_space) / num(p.total_space);
        disk = `<div><div class="bar"><i style="width:${(used * 100).toFixed(1)}%"></i></div>
          <div class="lr"><span class="tm">Media disk · ${(num(p.free_space) / 1e12).toFixed(1)} TB free of ${(num(p.total_space) / 1e12).toFixed(1)}</span><span class="tm">${Math.round(used * 100)}% used</span></div></div>`;
      }
      let spark = "";
      if (d.plays) {
        const days = playsByDay(d.plays);
        const max = Math.max(1, ...days.map((x) => x.n));
        const total = days.reduce((a, x) => a + x.n, 0);
        const lib = libraryCounts(d.libraries);
        const libTxt = lib.films || lib.shows ? `${lib.films} films · ${lib.shows} shows` : "";
        spark = `<div><div class="spark" role="img" aria-label="Plays per day, last 7 days">${days.map((x, i) =>
          `<i class="${i === days.length - 1 ? "today" : ""}" style="height:${Math.max(2, Math.round((x.n / max) * 32))}px" title="${esc(x.day)}: ${x.n}"></i>`).join("")}</div>
          <div class="lr"><span class="tm">${total} plays this week, not counting live TV</span><span class="tm">${esc(libTxt)}</span></div></div>`;
      }
      const html = `<div class="card">
        <div class="stats">
          <div class="stat"><b>${fresh}</b><span>new this week</span></div>
          <div class="stat"><b>${due}</b><span>due in ${this._config.days} days</span></div>
          <div class="stat"><b>${watching}</b><span>streaming</span></div>
        </div>${act}${disk}${spark}</div>`;
      return ["Plex · Sonarr · Radarr", html];
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
    [hidden] { display: none !important; }
    .msg, .quiet { font-size: 12.5px; color: var(--secondary-text-color); }
    .msg { padding: 8px 0; }
    .ti { font-size: 14px; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .su { font-size: 12.5px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .tm { font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
    .tx { min-width: 0; }

    .agenda { display: grid; gap: 8px; }
    .day { font-size: 12.5px; font-weight: 600; color: var(--secondary-text-color); padding: 8px 8px 0; display: flex; justify-content: space-between; }
    .day:first-child { padding-top: 0; }
    .day span:last-child { font-weight: 500; }
    .ar { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 16px; align-items: center;
          background: var(--popupBG, var(--secondary-background-color)); border-radius: 16px; padding: 8px 16px 8px 8px; }
    .ar img, .ar .noimg { width: 40px; height: 60px; border-radius: 8px; object-fit: cover; display: block; background: var(--gray100, rgba(127, 127, 127, 0.2)); }
    .ar .rt { display: grid; justify-items: end; gap: 4px; }
    .pill { font-size: 11px; font-weight: 600; border-radius: 12px; padding: 2px 8px; white-space: nowrap; display: inline-flex; gap: 4px; align-items: center; }
    .pill svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .pill.have { background: color-mix(in srgb, #75985d 24%, var(--popupBG, #28282a)); color: #a9c895; }
    .pill.due { background: var(--gray100, rgba(127, 127, 127, 0.2)); color: var(--secondary-text-color); }
    .pill.amb { background: color-mix(in srgb, rgb(201, 126, 11) 24%, var(--popupBG, #28282a)); color: #e7a94a; }

    .card { background: var(--popupBG, var(--secondary-background-color)); border-radius: 16px; padding: 16px; display: grid; gap: 16px; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .stat { display: grid; gap: 2px; }
    .stat b { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--primary-text-color); }
    .stat span { font-size: 11px; color: var(--secondary-text-color); }
    .bar { height: 8px; border-radius: 4px; background: var(--gray100, rgba(127, 127, 127, 0.2)); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--primary-text-color); border-radius: 4px; }
    .bar.amb i { background: rgb(201, 126, 11); }
    .bar.thin { height: 4px; margin-top: 4px; }
    .lr { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
    .spark { display: flex; align-items: end; gap: 4px; height: 32px; }
    .spark i { flex: 1; background: var(--gray200, rgba(127, 127, 127, 0.35)); border-radius: 2px; min-height: 2px; }
    .spark i.today { background: var(--primary-text-color); }
    .act { display: grid; gap: 8px; }
    .ac { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 16px; align-items: center; }
    .ac .ti { font-size: 12.5px; }
    .quiet { display: flex; gap: 8px; align-items: center; }
    .ic { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none;
          background: var(--gray100, rgba(127, 127, 127, 0.2)); color: var(--secondary-text-color); }
    .quiet .ic { width: 16px; height: 16px; background: none; }
    .ic.on { background: rgb(201, 126, 11); color: var(--primary-text-color); }
    .ic::before { content: ""; width: 16px; height: 16px; background: currentColor; -webkit-mask: var(--m) center / contain no-repeat; mask: var(--m) center / contain no-repeat; }
    .ic.tv { --m: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Crect x='3' y='5' width='18' height='12' rx='2'/%3E%3Cpath d='M8 20h8'/%3E%3C/svg%3E"); }
    .ic.down { --m: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 4v12M6.5 11l5.5 5.5 5.5-5.5M5 20h14'/%3E%3C/svg%3E"); }
    .ic.rest { --m: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='8'/%3E%3Cpath d='M12 8v4l2.5 2'/%3E%3C/svg%3E"); }
  `;

  // For tests.
  ExpressiveLibraryCard._model = { episodeItems, filmItems, agendaItems, newThisWeek, playsByDay, libraryCounts, streamRows, queueRows, thumb, showName, store };

  if (!customElements.get("expressive-library-card")) {
    console.info(`%c EXPRESSIVE-LIBRARY-CARD %c ${VERSION} `, "background:#c97e0b;color:#fff;font-weight:600", "background:#28282a;color:#fff");
    customElements.define("expressive-library-card", ExpressiveLibraryCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "expressive-library-card",
      name: "Expressive library",
      description: "What's on the media server and what's coming, from Sonarr, Radarr and Tautulli",
    });
  }
})();
