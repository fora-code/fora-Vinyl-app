/* ==================================================================
   Fora Vinyl — library shelf
   Saved albums and playlists from Spotify, shown as records on a shelf
   with their spines facing you. Hover (or scroll to centre, on touch)
   turns one to show its cover; pick it to play from the top.
   Depends on window.FV from app.js.
================================================================== */
(() => {
  "use strict";
  const FV = window.FV;
  if (!FV) return;
  const $ = (id) => document.getElementById(id);

  const el = $("library"), shelf = $("shelf"), row = $("shelf-row");
  const status = $("library-status"), filter = $("library-filter");
  const tabs = [...el.querySelectorAll(".tab")];

  const cache = { albums: null, playlists: null };
  const loading = { albums: false, playlists: false };
  let tab = "albums", isOpen = false, focusIdx = -1;
  const touchLike = window.matchMedia("(hover: none)").matches;

  /* ---------- data ---------- */
  async function fetchAll(path, pick) {
    const out = [];
    let url = path + "?limit=50";
    while (url) {
      const page = await FV.api(url);
      for (const it of page.items || []) { const x = pick(it); if (x) out.push(x); }
      url = page.next ? page.next.replace("https://api.spotify.com/v1", "") : null;
      if (out.length >= 1500) break; // sanity cap for very large libraries
    }
    return out;
  }
  const img = (images, i = 1) => (images && (images[i] || images[0]) && (images[i] || images[0]).url) || "";
  const pickAlbum = (it) => {
    const a = it.album || it;
    if (!a || !a.uri) return null;
    return { id: a.id, uri: a.uri, name: a.name || "", sub: (a.artists || []).map((x) => x.name).join(", "), img: img(a.images, 1), meta: (a.release_date || "").slice(0, 4) };
  };
  const pickPlaylist = (p) => {
    if (!p || !p.uri) return null;
    return { id: p.id, uri: p.uri, name: p.name || "", sub: (p.owner && p.owner.display_name) || "", img: img(p.images, 0), meta: p.tracks && p.tracks.total != null ? p.tracks.total + " tracks" : "" };
  };

  async function load(which, force) {
    if (cache[which] && !force) return cache[which];
    if (loading[which]) return null;
    loading[which] = true;
    setStatus(which === "albums" ? "Pulling your albums off the shelf…" : "Finding your playlists…");
    try {
      cache[which] = which === "albums" ? await fetchAll("/me/albums", pickAlbum) : await fetchAll("/me/playlists", pickPlaylist);
    } catch (e) {
      setStatus("Couldn't load: " + e.message);
      cache[which] = null;
    } finally { loading[which] = false; }
    return cache[which];
  }

  /* ---------- render ---------- */
  const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };

  function render() {
    const items = cache[tab];
    row.innerHTML = "";
    focusIdx = -1;
    if (!items) return;
    const q = filter.value.trim().toLowerCase();
    const list = q ? items.filter((x) => (x.name + " " + x.sub).toLowerCase().includes(q)) : items;
    const frag = document.createDocumentFragment();
    list.forEach((it, i) => {
      const b = document.createElement("button");
      b.className = "sleeve"; b.type = "button";
      b.dataset.uri = it.uri; b.dataset.idx = i;
      b.title = it.name + (it.sub ? " · " + it.sub : "");
      b.style.setProperty("--hue", hueOf(it.name + it.sub));
      b.innerHTML =
        `<div class="sleeve-box">
           <div class="face spine"><span class="spine-title">${esc(it.name)}</span><span class="spine-sub">${esc(it.sub)}</span></div>
           <div class="face front">${it.img ? `<img loading="lazy" decoding="async" alt="" src="${it.img}">` : `<div class="front-blank">${esc(it.name)}</div>`}
             <div class="front-cap"><span class="front-name">${esc(it.name)}</span><span class="front-sub">${esc([it.sub, it.meta].filter(Boolean).join(" · "))}</span></div>
           </div>
         </div>`;
      frag.appendChild(b);
    });
    row.appendChild(frag);
    setStatus(list.length === items.length ? `${items.length} ${tab}` : `${list.length} of ${items.length} ${tab}`);
    if (touchLike) requestAnimationFrame(focusNearestCentre);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function setStatus(t) { status.textContent = t; }

  function setFocus(idx, scrollInto) {
    const kids = row.children;
    if (focusIdx >= 0 && kids[focusIdx]) kids[focusIdx].classList.remove("is-focus");
    focusIdx = idx;
    const k = kids[idx];
    if (!k) return;
    k.classList.add("is-focus");
    if (scrollInto) k.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }
  function focusNearestCentre() {
    const kids = row.children; if (!kids.length) return;
    const mid = shelf.getBoundingClientRect().left + shelf.clientWidth / 2;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best !== focusIdx) setFocus(best, false);
  }

  /* ---------- interaction ---------- */
  async function pick(uri, name) {
    close();
    FV.toast("Putting on " + name);
    await FV.playContext(uri);
  }

  // hover focuses on pointer devices; the centre item focuses on touch
  row.addEventListener("pointerover", (e) => {
    if (touchLike) return;
    const s = e.target.closest(".sleeve"); if (s) setFocus(+s.dataset.idx, false);
  });
  let scrollRaf = 0;
  shelf.addEventListener("scroll", () => {
    if (!touchLike) return;
    cancelAnimationFrame(scrollRaf); scrollRaf = requestAnimationFrame(focusNearestCentre);
  }, { passive: true });

  // wheel scrolls along the shelf; drag scrolls too, and a drag never counts as a pick
  shelf.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { shelf.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  let drag = null;
  shelf.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    drag = { x: e.clientX, left: shelf.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) { drag.moved = true; shelf.classList.add("dragging"); }
    if (drag.moved) shelf.scrollLeft = drag.left - dx;
  });
  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    shelf.classList.remove("dragging");
    if (moved) shelf.dataset.suppressClick = "1"; // eaten by the click handler below
  });
  row.addEventListener("click", (e) => {
    if (shelf.dataset.suppressClick) { delete shelf.dataset.suppressClick; return; }
    const s = e.target.closest(".sleeve"); if (!s) return;
    if (touchLike && !s.classList.contains("is-focus")) { setFocus(+s.dataset.idx, true); return; } // first tap turns it, second plays
    pick(s.dataset.uri, s.querySelector(".spine-title").textContent);
  });

  // keyboard: arrows walk the shelf, Enter plays, Escape closes
  shelf.addEventListener("keydown", (e) => {
    const n = row.children.length; if (!n) return;
    if (e.key === "ArrowRight") { e.preventDefault(); setFocus(Math.min(n - 1, focusIdx + 1), true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setFocus(Math.max(0, focusIdx - 1), true); }
    else if (e.key === "Enter" && focusIdx >= 0) { const s = row.children[focusIdx]; pick(s.dataset.uri, s.querySelector(".spine-title").textContent); }
    else if (e.key === "Home") { e.preventDefault(); setFocus(0, true); }
    else if (e.key === "End") { e.preventDefault(); setFocus(n - 1, true); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen) close(); });

  tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  async function switchTab(which) {
    tab = which;
    tabs.forEach((t) => { const on = t.dataset.tab === which; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", on ? "true" : "false"); });
    render();
    if (!cache[which]) { await load(which); if (tab === which) render(); }
    shelf.scrollLeft = 0;
  }
  filter.addEventListener("input", render);
  $("library-refresh").addEventListener("click", async () => { cache[tab] = null; render(); await load(tab, true); render(); });
  $("library-close").addEventListener("click", close);
  el.addEventListener("click", (e) => e.stopPropagation()); // don't let clicks close the settings popover twice, etc.

  function openLib() {
    if (isOpen) return;
    isOpen = true; el.classList.remove("hidden");
    $("library-btn").setAttribute("aria-expanded", "true");
    switchTab(tab);
    setTimeout(() => shelf.focus({ preventScroll: true }), 50);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; el.classList.add("hidden");
    $("library-btn").setAttribute("aria-expanded", "false");
  }
  function toggle() { isOpen ? close() : openLib(); }

  FV.library = { open: openLib, close, toggle, get isOpen() { return isOpen; },
    // for previews and tests
    __seed(which, items) { cache[which] = items; if (isOpen && tab === which) render(); } };
})();
