// AI-ASSISTED: drafted with Claude (Anthropic), reviewed by the human team.
// Static markup for the simulator console and overlays (no logic). Icons are simple inline SVG strokes.

const svg = (d: string, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
export const ICON = {
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  back: svg('<path d="M11 7l-5 5 5 5"/><path d="M18 7l-5 5 5 5"/>', 16),
  fwd: svg('<path d="M6 7l5 5-5 5"/><path d="M13 7l5 5-5 5"/>', 16),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01"/>'),
  expand: svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'),
  shrink: svg('<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 14),
  earth: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z"/>', 14),
  chevron: svg('<path d="M6 9l6 6 6-6"/>', 14),
};

export const SPEEDS = [{ v: 3600, label: '1 h/s' }, { v: 21600, label: '6 h/s' }, { v: 86400, label: '1 d/s' }, { v: 259200, label: '3 d/s' }];
export const CAMS = [{ id: 'lander', label: 'Lander', key: '1' }, { id: 'orbit', label: 'Orbit', key: '2' }, { id: 'globe', label: 'Globe', key: '3' }] as const;

export const OVERLAY_HTML = `
  <div class="sim-id">
    <h2 id="sim-h" class="eyebrow">Mission simulator <span class="sim-mock" hidden>Mock data — synthetic, not results</span></h2>
    <label class="site-pick"><span class="sr-only">Landing site</span><select class="site-select" data-a="site"></select>${ICON.chevron}</label>
    <div class="coords num" data-f="coords"></div>
    <div class="clock"><span class="num" data-f="utc"></span><span class="unit">UTC</span></div>
    <div class="met"><span class="num" data-f="met"></span><span class="sep">·</span><span data-f="stay"></span></div>
  </div>`;

const card = (k: 'power' | 'comm', title: string, icon: string, body: 'Sun' | 'Earth') => `
  <article class="card card-${k}" aria-label="${title}">
    <header><span class="card-k">${icon}${title}</span><span class="card-state" data-f="${k}-state"></span></header>
    <div class="meter" aria-hidden="true"><i data-f="${k}-bar"></i></div>
    <p class="card-cd num" data-f="${k}-cd" title="Against the local terrain horizon, from the simulator time"></p>
    <dl class="trio">
      <div><dt>${body} az</dt><dd class="num" data-f="${k}-az"></dd></div>
      <div><dt>${body} el</dt><dd class="num" data-f="${k}-el"></dd></div>
      <div><dt>Clearance</dt><dd class="num" data-f="${k}-clr"></dd></div>
    </dl>
    <details class="more"><summary>Details</summary><dl data-f="${k}-more"></dl></details>
  </article>`;

export const STATUS_HTML = card('power', 'Power', ICON.sun, 'Sun') + card('comm', 'Comm', ICON.earth, 'Earth');

export const CONSOLE_HTML = `
  <div class="bar bar-transport" role="group" aria-label="Playback">
    <div class="tgroup">
      <button type="button" class="ib ib-play" data-a="play" aria-label="Play" title="Play / pause (Space)"></button>
      <button type="button" class="ib" data-a="back" aria-label="Step back 1 hour" title="Back 1 hour (←)">${ICON.back}<span>1 h</span></button>
      <button type="button" class="ib" data-a="fwd" aria-label="Step forward 1 hour" title="Forward 1 hour (→)"><span>1 h</span>${ICON.fwd}</button>
      <div class="seg seg-speed" role="group" aria-label="Playback speed">${SPEEDS.map((s) => `<button type="button" data-speed="${s.v}" title="Simulated time per second">${s.label}</button>`).join('')}</div>
    </div>
    <div class="tl">
      <div class="tl-ranges" aria-hidden="true"></div>
      <div class="tl-body">
        <div class="tl-labels" aria-hidden="true"><span class="c-sun">Sun</span><span class="c-earth">Earth</span></div>
        <div class="tl-track">
          <canvas class="tl-strip" aria-hidden="true"></canvas>
          <input id="sim-scrub" type="range" min="0" max="1" step="600" aria-label="Simulation time" aria-describedby="sim-scrub-help">
        </div>
      </div>
      <span id="sim-scrub-help" class="sr-only">Coloured strips show when the Sun and Earth are in view above the terrain. Arrow keys move by 10 minutes.</span>
    </div>
    <div class="seg seg-stay" role="group" aria-label="Which stay to play"><button type="button" data-ab="a" title="The landing date as planned">Planned</button><button type="button" data-ab="b">Slipped</button></div>
  </div>
  <div class="bar bar-setup">
    <div class="slip">
      <label for="sim-slip">Launch slip</label>
      <input id="sim-slip" type="range" min="0" max="60" step="1" aria-describedby="sim-slip-u">
      <input id="sim-slip-n" type="number" min="-90" max="90" step="1" inputmode="numeric" aria-label="Launch slip, days">
      <span id="sim-slip-u" class="unit">days</span>
    </div>
    <div class="seg seg-cam" role="group" aria-label="Camera">${CAMS.map((c) => `<button type="button" data-cam="${c.id}" title="${c.label} view (${c.key})">${c.label}</button>`).join('')}</div>
    <div class="look" role="group" aria-label="Point the lander camera">
      <button type="button" class="chip" data-look="sun" title="Turn the lander camera to the Sun">${ICON.sun}Look at Sun</button>
      <button type="button" class="chip" data-look="earth" title="Turn the lander camera to Earth">${ICON.earth}Look at Earth</button>
    </div>
    <div class="tools">
      <button type="button" class="ib" data-pop="about" aria-expanded="false" aria-controls="sim-pop-about" aria-label="About this view" title="About this view">${ICON.info}</button>
      <button type="button" class="ib" data-pop="settings" aria-expanded="false" aria-controls="sim-pop-settings" aria-label="View settings" title="View settings">${ICON.gear}</button>
      <button type="button" class="ib" data-a="fs" aria-label="Full screen" title="Full screen">${ICON.expand}</button>
      <div class="pop" id="sim-pop-settings" role="dialog" aria-label="View settings" hidden>
        <h3>View settings</h3>
        <div class="pop-row"><span id="sim-size-l">Sun and Earth</span>
          <div class="seg" role="group" aria-labelledby="sim-size-l"><button type="button" data-size="1">True size</button><button type="button" data-size="6">Enlarged ×6</button></div></div>
        <div class="pop-row"><span id="sim-cmp-l">Compass strip</span>
          <button type="button" class="switch" role="switch" data-a="compass" aria-labelledby="sim-cmp-l"><i></i></button></div>
        <p class="pop-note" data-f="quality"></p>
      </div>
      <div class="pop pop-about" id="sim-pop-about" role="dialog" aria-label="About this view" hidden>
        <h3>About this view</h3>
        <ul data-f="about"></ul>
        <p class="pop-note">Keys: Space play/pause · ← → step 1 h · 1 2 3 cameras. Lander view: drag to look around.</p>
      </div>
    </div>
  </div>
  <p class="sim-note" data-f="note"></p>`;
