// ==UserScript==
// @name         Gmail To/From Field Search
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Make "to" and "from" email addresses clickable for Gmail search
// @author       You
// @match        https://mail.google.com/*
// @grant        none
// ==/UserScript==

;(function () {
  "use strict"

  /**
   * Create a Gmail search URL.
   */
  function createSearchUrl(type, email) {
    return (
      `https://mail.google.com/mail/u/0/#search/` +
      `${type}%3A${encodeURIComponent(email)}`
    )
  }

  /**
   * Convert one span[email] element.
   *
   * This function is intentionally limited to ONE element rather
   * than repeatedly searching the entire Gmail document.
   */
  function convertEmailSpan(span) {
    // Ignore elements we've already processed.
    if (!(span instanceof Element)) return
    if (!span.matches("span[email]")) return
    if (span.dataset.searchConverted === "true") return

    const email = span.getAttribute("email")

    if (!email) return

    // Mark it immediately so mutations caused by our own changes
    // don't cause it to be processed again.
    span.dataset.searchConverted = "true"

    /**
     * Gmail uses a handful of different DOM structures depending
     * on whether we're looking at a message list, expanded header,
     * sender details, etc.
     */
    const isFromField =
      !!span.closest("span.qu") ||
      span.classList.contains("gD") ||
      span.classList.contains("yP") ||
      !!span.closest("div.yW")

    const type = isFromField ? "from" : "to"
    const searchUrl = createSearchUrl(type, email)

    /**
     * Expanded message headers have something roughly like:
     *
     * span.qu
     *   span[email]
     *   span.go    <-- displayed email text
     *
     * The visible text isn't necessarily the element carrying
     * the `email` attribute.
     */
    if (isFromField) {
      const emailTextSpan = span
        .closest("span.qu")
        ?.querySelector("span.go")

      if (
        emailTextSpan &&
        emailTextSpan.dataset.searchConverted !== "true"
      ) {
        emailTextSpan.dataset.searchConverted = "true"

        makeLink(emailTextSpan, searchUrl)
      }

      return
    }

    // Direct "to" address.
    makeLink(span, searchUrl)
  }

  /**
   * Replace the visible contents of an element with a search link.
   */
  function makeLink(container, href) {
    // Don't wrap an existing link.
    if (container.querySelector(":scope > a")) return

    const text = container.textContent

    const link = document.createElement("a")

    link.href = href
    link.textContent = text

    // Use a class instead of attaching mouseenter/mouseleave
    // listeners to every single email address.
    link.className = "gmail-email-search-link"

    // replaceChildren() causes fewer DOM operations than repeatedly
    // removing firstChild.
    container.replaceChildren(link)
  }

  /**
   * Find email spans ONLY inside a newly-added piece of DOM.
   */
  function processNode(node) {
    if (!(node instanceof Element)) return

    // The added node itself might be the email span.
    if (node.matches("span[email]")) {
      convertEmailSpan(node)
    }

    // Or it may contain email spans.
    node
      .querySelectorAll("span[email]")
      .forEach(convertEmailSpan)
  }

  /**
   * Add styling once globally instead of adding hover event
   * listeners to every generated link.
   */
  const style = document.createElement("style")

  style.textContent = `
    .gmail-email-search-link {
      color: #1a73e8 !important;
      text-decoration: underline !important;
      cursor: pointer !important;
    }

    .gmail-email-search-link:hover {
      color: #1557b0 !important;
    }
  `

  document.head.appendChild(style)

  /**
   * Initial scan.
   *
   * This is the ONE time we're intentionally scanning the
   * entire document.
   */
  document
    .querySelectorAll("span[email]")
    .forEach(convertEmailSpan)

  /**
   * Gmail dynamically inserts messages and headers.
   *
   * Instead of:
   *
   *   mutation happens
   *        ↓
   *   scan entire document
   *
   * we now do:
   *
   *   mutation happens
   *        ↓
   *   inspect ONLY added nodes
   */
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        processNode(node)
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
})()
