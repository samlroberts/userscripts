// ==UserScript==
// @name         Gmail To/From Field Search
// @namespace    https://github.com/samlroberts/userscripts
// @version      1.3
// @description  Make "to" and "from" email addresses clickable for Gmail search
// @author       You
// @match        https://mail.google.com/*
// @updateURL    https://raw.githubusercontent.com/samlroberts/userscripts/main/Gmail%20To-From%20Field%20Search.user.js
// @downloadURL  https://raw.githubusercontent.com/samlroberts/userscripts/main/Gmail%20To-From%20Field%20Search.user.js
// @grant        none
// ==/UserScript==

;(function () {
  "use strict"

  // Function to create search URL for "to" field
  function createToSearchUrl(email) {
    const encodedEmail = encodeURIComponent(email)
    return `https://mail.google.com/mail/u/0/#search/to%3A${encodedEmail}`
  }

  // Function to create search URL for "from" field
  function createFromSearchUrl(email) {
    const encodedEmail = encodeURIComponent(email)
    return `https://mail.google.com/mail/u/0/#search/from%3A${encodedEmail}`
  }

  // Function to make email addresses clickable
  function makeEmailsClickable() {
    // Find all span elements with email attribute (both "to" and "from" fields)
    const emailSpans = document.querySelectorAll("span[email]")

    emailSpans.forEach((span) => {
      const email = span.getAttribute("email")
      if (email && !span.hasAttribute("data-converted")) {
        // Check if already converted
        // Mark as converted to prevent re-processing
        span.setAttribute("data-converted", "true")

        // Determine if this is a "to" or "from" field based on parent structure
        let searchUrl
        const isFromField =
          span.closest("span.qu") ||
          span.classList.contains("gD") ||
          span.classList.contains("yP") ||
          span.closest("div.yW")

        if (isFromField) {
          searchUrl = createFromSearchUrl(email)
        } else {
          searchUrl = createToSearchUrl(email)
        }

        // Handle "from" fields (span.qu structure)
        if (isFromField) {
          const emailTextSpan = span
            .closest("span.qu")
            ?.querySelector("span.go")

          if (emailTextSpan && !emailTextSpan.hasAttribute("data-converted")) {
            // Mark the email text span as converted
            emailTextSpan.setAttribute("data-converted", "true")

            // Create a link element for the email text
            const link = document.createElement("a")
            link.href = searchUrl
            link.textContent = emailTextSpan.textContent
            link.style.color = "#1a73e8" // Gmail blue color
            link.style.textDecoration = "underline"
            link.style.cursor = "pointer"

            // Add hover effect
            link.addEventListener("mouseenter", function () {
              this.style.color = "#1557b0"
            })
            link.addEventListener("mouseleave", function () {
              this.style.color = "#1a73e8"
            })

            // Clear the email text span and append the link
            while (emailTextSpan.firstChild) {
              emailTextSpan.removeChild(emailTextSpan.firstChild)
            }
            emailTextSpan.appendChild(link)
          }
        } else {
          // Handle "to" fields (direct span structure)
          // Check if span doesn't have a link child yet
          if (!span.querySelector("a")) {
            // Create a link element for the span itself
            const link = document.createElement("a")
            link.href = searchUrl
            link.textContent = span.textContent
            link.style.color = "#1a73e8" // Gmail blue color
            link.style.textDecoration = "underline"
            link.style.cursor = "pointer"

            // Add hover effect
            link.addEventListener("mouseenter", function () {
              this.style.color = "#1557b0"
            })
            link.addEventListener("mouseleave", function () {
              this.style.color = "#1a73e8"
            })

            // Clear the span and append the link
            while (span.firstChild) {
              span.removeChild(span.firstChild)
            }
            span.appendChild(link)
          }
        }
      }
    })
  }

  // Run the function when the page loads
  makeEmailsClickable()

  // Also run when new content is loaded (for dynamic Gmail updates)
  const observer = new MutationObserver(function (mutations) {
    let shouldUpdate = false
    mutations.forEach(function (mutation) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        // Check if any added nodes contain email spans
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) {
            // Element node
            if (node.querySelector && node.querySelector("span[email]")) {
              shouldUpdate = true
            }
          }
        })
      }
    })

    if (shouldUpdate) {
      setTimeout(makeEmailsClickable, 100) // Small delay to ensure DOM is ready
    }
  })

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
})()
