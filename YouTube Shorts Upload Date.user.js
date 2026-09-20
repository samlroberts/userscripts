// ==UserScript==
// @name         YouTube Shorts Upload Date
// @namespace    https://github.com/samlroberts/userscripts
// @version      1.0.4
// @description  Show upload dates and freshness indicators on YouTube Shorts and Shorts thumbnails.
// @author       You
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/samlroberts/userscripts/main/YouTube%20Shorts%20Upload%20Date.user.js
// @downloadURL  https://raw.githubusercontent.com/samlroberts/userscripts/main/YouTube%20Shorts%20Upload%20Date.user.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.youtube.com
// @connect      m.youtube.com
// ==/UserScript==

(function () {
  "use strict"

  const VERSION = "1.0.4"
  const DAY_MS = 86_400_000
  const FAILURE_RETRY_MS = 60_000
  const DEFAULT_THRESHOLDS = { greenDays: 1, yellowDays: 7 }
  const PILL_CLASS = "yt-short-date-pill"
  const OVERLAY_CLASS = "yt-short-date-overlay"
  const PROCESSED_ATTRIBUTE = "data-yt-short-date-processed"
  const cache = new Map()
  const failedAt = new Map()
  const inflight = new Map()

  let thresholds = loadThresholds()

  GM_addStyle(`
    .${PILL_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      max-width: 100%;
      margin: 0 0 8px;
      padding: 5px 10px 5px 9px;
      z-index: 1;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 999px;
      background: rgba(15, 15, 15, 0.78);
      color: #fff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      backdrop-filter: blur(14px) saturate(140%);
      font: 600 13px/1.2 "YouTube Sans", Roboto, system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
      pointer-events: none;
    }

    .${OVERLAY_CLASS} {
      position: absolute;
      bottom: 8px;
      left: 8px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      z-index: 2;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      background: linear-gradient(135deg, rgba(15, 15, 18, 0.86), rgba(40, 40, 48, 0.72));
      color: #fff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      backdrop-filter: blur(10px) saturate(140%);
      font: 600 12px/1.2 "YouTube Sans", Roboto, system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
      pointer-events: none;
      white-space: nowrap;
    }

    .yt-short-date-dot {
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 8px #ef4444, 0 0 0 3px rgba(239, 68, 68, 0.18);
    }

    .yt-short-date-dot.is-fresh {
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e, 0 0 0 3px rgba(34, 197, 94, 0.18);
    }

    .yt-short-date-dot.is-recent {
      background: #f2b100;
      box-shadow: 0 0 8px #f2b100, 0 0 0 3px rgba(242, 177, 0, 0.2);
    }

    ytm-shorts-lockup-view-model a[href*="/shorts/"],
    ytm-shorts-lockup-view-model-v2 a[href*="/shorts/"],
    ytd-reel-item-renderer a[href*="/shorts/"],
    ytd-rich-item-renderer a[href*="/shorts/"] {
      position: relative;
    }
  `)

  GM_registerMenuCommand("Configure freshness thresholds…", configureThresholds)
  GM_registerMenuCommand("Reset freshness thresholds", resetThresholds)
  GM_registerMenuCommand("Show diagnostics", showDiagnostics)

  function loadThresholds() {
    return normalizeThresholds(
      GM_getValue("greenDays", DEFAULT_THRESHOLDS.greenDays),
      GM_getValue("yellowDays", DEFAULT_THRESHOLDS.yellowDays),
    )
  }

  function normalizeThresholds(greenValue, yellowValue) {
    const greenDays = clampInteger(greenValue, 0, 3650, DEFAULT_THRESHOLDS.greenDays)
    const yellowDays = Math.max(
      greenDays,
      clampInteger(yellowValue, 0, 3650, DEFAULT_THRESHOLDS.yellowDays),
    )

    return { greenDays, yellowDays }
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const number = Number.parseInt(String(value), 10)
    if (!Number.isFinite(number)) return fallback
    return Math.min(maximum, Math.max(minimum, number))
  }

  function configureThresholds() {
    const greenInput = prompt(
      "Show a green dot for Shorts no older than this many days (0–3650):",
      String(thresholds.greenDays),
    )
    if (greenInput === null) return

    const yellowInput = prompt(
      "Show a yellow dot through this many days (0–3650):",
      String(thresholds.yellowDays),
    )
    if (yellowInput === null) return

    const next = normalizeThresholds(greenInput, yellowInput)
    saveThresholds(next)

    const requestedYellowDays = Number.parseInt(yellowInput, 10)
    if (Number.isFinite(requestedYellowDays) && requestedYellowDays < next.greenDays) {
      alert(`The yellow limit was set to ${next.yellowDays} days so it is not below the green limit.`)
    }
  }

  function resetThresholds() {
    saveThresholds(DEFAULT_THRESHOLDS)
  }

  function saveThresholds(next) {
    thresholds = { ...next }
    GM_setValue("greenDays", thresholds.greenDays)
    GM_setValue("yellowDays", thresholds.yellowDays)
    refreshDotColors()
  }

  function currentShortId() {
    return location.pathname.match(/^\/shorts\/([\w-]{6,})/)?.[1] ?? null
  }

  function extractShortId(anchor) {
    return anchor.getAttribute("href")?.match(/\/shorts\/([\w-]{6,})/)?.[1] ?? null
  }

  function formatDate(isoDate) {
    const date = new Date(isoDate)
    if (Number.isNaN(date.getTime())) return ""

    const ageHours = Math.max(0, Date.now() - date.getTime()) / 3_600_000
    if (ageHours < 1) return "Less than an hour ago"
    if (ageHours < 24) {
      const hours = Math.floor(ageHours)
      return `${hours} hour${hours === 1 ? "" : "s"} ago`
    }
    if (ageHours < 48) return "Yesterday"

    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  }

  function ageClass(isoDate) {
    const time = new Date(isoDate).getTime()
    if (Number.isNaN(time)) return "is-old"

    const ageDays = Math.max(0, Date.now() - time) / DAY_MS
    if (ageDays <= thresholds.greenDays) return "is-fresh"
    if (ageDays <= thresholds.yellowDays) return "is-recent"
    return "is-old"
  }

  function makeDot(isoDate) {
    const dot = document.createElement("span")
    dot.className = `yt-short-date-dot ${ageClass(isoDate)}`
    dot.setAttribute("aria-hidden", "true")
    return dot
  }

  function refreshDotColors() {
    document.querySelectorAll(`.${PILL_CLASS}, .${OVERLAY_CLASS}`).forEach((host) => {
      const dot = host.querySelector(".yt-short-date-dot")
      if (host.dataset.isoDate && dot) {
        dot.className = `yt-short-date-dot ${ageClass(host.dataset.isoDate)}`
      }
    })
  }

  function readPlayerDate(videoId) {
    try {
      const response = unsafeWindow.ytInitialPlayerResponse
      const responseVideoId = response?.videoDetails?.videoId
      const microformat = response?.microformat?.playerMicroformatRenderer
      const isoDate = microformat?.publishDate ?? microformat?.uploadDate

      if (isoDate && (!responseVideoId || responseVideoId === videoId)) return isoDate
    } catch {
      // The same-origin fetch below is the reliable fallback.
    }

    return null
  }

  function requestShortPage(videoId) {
    return new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url: new URL(`/shorts/${encodeURIComponent(videoId)}`, location.origin).href,
          anonymous: true,
          timeout: 10_000,
          headers: { Accept: "text/html" },
          onload(response) {
            resolve({
              error: null,
              status: response.status,
              text: response.responseText ?? "",
            })
          },
          onerror(response) {
            resolve({ error: response?.error ?? "request error", status: response?.status ?? 0, text: "" })
          },
          ontimeout() {
            resolve({ error: "request timed out", status: 0, text: "" })
          },
        })
      } catch (error) {
        resolve({ error: String(error), status: 0, text: "" })
      }
    })
  }

  function parseUploadDate(html) {
    return (
      html.match(/itemprop="datePublished"\s+content="([^"]+)"/)?.[1] ??
      html.match(/"publishDate":"([^"]+)"/)?.[1] ??
      html.match(/"uploadDate":"([^"]+)"/)?.[1] ??
      html.match(/"publishDate":\{"simpleText":"([^"]+)"\}/)?.[1] ??
      html.match(/"uploadDate":\{"simpleText":"([^"]+)"\}/)?.[1] ??
      null
    )
  }

  async function fetchShortPage(videoId) {
    const response = await requestShortPage(videoId)
    return response.status >= 200 && response.status < 300 ? response.text : null
  }

  async function getUploadDate(videoId) {
    if (cache.has(videoId)) return cache.get(videoId)
    if (inflight.has(videoId)) return inflight.get(videoId)
    if (Date.now() - (failedAt.get(videoId) ?? 0) < FAILURE_RETRY_MS) return null

    const playerDate = readPlayerDate(videoId)
    if (playerDate) {
      failedAt.delete(videoId)
      cache.set(videoId, playerDate)
      return playerDate
    }

    const request = (async () => {
      try {
        const html = await fetchShortPage(videoId)
        if (!html) {
          failedAt.set(videoId, Date.now())
          return null
        }

        const isoDate = parseUploadDate(html)

        if (isoDate) {
          failedAt.delete(videoId)
          cache.set(videoId, isoDate)
        } else {
          failedAt.set(videoId, Date.now())
        }
        return isoDate
      } catch (error) {
        failedAt.set(videoId, Date.now())
        console.debug(`[${PILL_CLASS}] Could not read the upload date for ${videoId}.`, error)
        return null
      } finally {
        inflight.delete(videoId)
      }
    })()

    inflight.set(videoId, request)
    return request
  }

  function findActiveRenderer() {
    return (
      document.querySelector("ytd-reel-video-renderer[is-active]") ??
      document.querySelector("ytd-reel-video-renderer:not([hidden])") ??
      document.querySelector("ytd-reel-video-renderer") ??
      document.querySelector("ytd-watch-flexy")
    )
  }

  function findTitle(renderer) {
    const selectors = [
      "yt-shorts-video-title-view-model",
      "ytd-watch-metadata h1",
      "#title h1",
      "h2.title",
      "yt-formatted-string.title",
      'h2[class*="title"]',
      "#video-title",
      "yt-shorts-video-title-renderer",
      "ytd-reel-player-header-renderer #title",
      "reel-player-header-view-model",
    ]

    for (const selector of selectors) {
      const title = renderer.querySelector(selector)
      if (title) return title
    }

    return null
  }

  async function annotateWatchPage() {
    const videoId = currentShortId()
    const renderer = findActiveRenderer()
    if (!videoId || !renderer) return

    const existing = renderer.querySelector(`.${PILL_CLASS}`)
    if (existing?.dataset.videoId === videoId) return

    const isoDate = await getUploadDate(videoId)
    if (!isoDate || currentShortId() !== videoId) return

    const currentRenderer = findActiveRenderer()
    const title = currentRenderer && findTitle(currentRenderer)
    if (!currentRenderer || !title?.parentElement) return

    currentRenderer.querySelectorAll(`.${PILL_CLASS}`).forEach((pill) => pill.remove())

    const pill = document.createElement("div")
    pill.className = PILL_CLASS
    pill.dataset.videoId = videoId
    pill.dataset.isoDate = isoDate
    pill.title = new Date(isoDate).toLocaleString()
    pill.append(makeDot(isoDate), document.createTextNode(formatDate(isoDate)))
    title.parentElement.insertBefore(pill, title)
  }

  const TILE_SELECTOR = [
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    "ytd-reel-item-renderer",
    "ytd-rich-item-renderer",
  ].join(",")

  async function annotateTile(tile) {
    const anchor = tile.querySelector('a[href*="/shorts/"]')
    const videoId = anchor && extractShortId(anchor)
    if (!anchor || !videoId) return

    const processedVideoId = tile.getAttribute(PROCESSED_ATTRIBUTE)
    if (processedVideoId === videoId && anchor.querySelector(`.${OVERLAY_CLASS}`)) return
    if (processedVideoId && processedVideoId !== videoId) {
      tile.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((overlay) => overlay.remove())
    }

    tile.setAttribute(PROCESSED_ATTRIBUTE, videoId)
    const isoDate = await getUploadDate(videoId)

    if (!isoDate) {
      tile.removeAttribute(PROCESSED_ATTRIBUTE)
      return
    }

    if (tile.getAttribute(PROCESSED_ATTRIBUTE) !== videoId) return
    if (anchor.querySelector(`.${OVERLAY_CLASS}`)) return

    const overlay = document.createElement("div")
    overlay.className = OVERLAY_CLASS
    overlay.dataset.isoDate = isoDate
    overlay.title = new Date(isoDate).toLocaleString()
    overlay.append(makeDot(isoDate), document.createTextNode(formatDate(isoDate)))
    anchor.appendChild(overlay)
  }

  function scanTiles(root) {
    if (root instanceof Element) {
      const tile = root.matches(TILE_SELECTOR) ? root : root.closest(TILE_SELECTOR)
      if (tile) annotateTile(tile)
    }
    root.querySelectorAll?.(TILE_SELECTOR).forEach(annotateTile)
  }

  const pendingRoots = new Set()
  let scanTimer = null

  function scheduleScan(root = document) {
    if (root === document) {
      pendingRoots.clear()
      pendingRoots.add(document)
    } else if (!pendingRoots.has(document)) {
      for (const pendingRoot of pendingRoots) {
        if (pendingRoot.contains(root)) return
        if (root.contains(pendingRoot)) pendingRoots.delete(pendingRoot)
      }
      pendingRoots.add(root)
    }

    if (scanTimer !== null) return
    scanTimer = window.setTimeout(() => {
      scanTimer = null
      const roots = [...pendingRoots]
      pendingRoots.clear()
      annotateWatchPage()
      roots.forEach(scanTiles)
    }, 100)
  }

  async function showDiagnostics() {
    const link = document.querySelector('a[href*="/shorts/"]')
    const videoId = currentShortId() ?? (link && extractShortId(link))
    const renderer = findActiveRenderer()
    const title = renderer && findTitle(renderer)
    const response = videoId
      ? await requestShortPage(videoId)
      : { error: "no Shorts video ID found", status: 0, text: "" }
    const diagnostics = {
      version: VERSION,
      path: location.pathname,
      videoId,
      shortLinks: document.querySelectorAll('a[href*="/shorts/"]').length,
      tiles: document.querySelectorAll(TILE_SELECTOR).length,
      renderer: renderer?.tagName ?? null,
      title: title?.tagName ?? null,
      annotations: document.querySelectorAll(`.${PILL_CLASS}, .${OVERLAY_CLASS}`).length,
      requestStatus: response.status,
      responseLength: response.text.length,
      requestError: response.error,
      parsedDate: parseUploadDate(response.text),
      cachedDates: cache.size,
      failedDates: failedAt.size,
    }
    prompt("YouTube Shorts Upload Date diagnostics — copy this text:", JSON.stringify(diagnostics))
  }

  function start() {
    document.documentElement.dataset.ytShortDateVersion = VERSION

    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          scheduleScan(mutation.target)
          continue
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scheduleScan(node)
        }
      }
    }).observe(document.documentElement, {
      attributeFilter: ["href", "is-active"],
      attributes: true,
      childList: true,
      subtree: true,
    })

    document.addEventListener("yt-navigate-finish", () => scheduleScan())
    document.addEventListener("yt-page-data-updated", () => scheduleScan())

    let previousPath = location.pathname
    window.setInterval(() => {
      if (location.pathname !== previousPath) {
        previousPath = location.pathname
        scheduleScan()
      }
    }, 250)

    scheduleScan()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true })
  } else {
    start()
  }
})()
