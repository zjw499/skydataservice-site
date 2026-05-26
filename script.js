(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var trackedScroll = { 50: false, 90: false };

  function trackEvent(name, payload) {
    var eventPayload = Object.assign(
      {
        event: name,
        page: window.location.pathname,
        timestamp: new Date().toISOString()
      },
      payload || {}
    );

    window.__sdsAnalytics = window.__sdsAnalytics || [];
    window.__sdsAnalytics.push(eventPayload);

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push(eventPayload);
    }
  }

  function bindTrackedClicks() {
    var tracked = document.querySelectorAll("[data-track]");
    tracked.forEach(function (node) {
      node.addEventListener("click", function () {
        trackEvent(node.getAttribute("data-track"), {
          label: node.getAttribute("data-label") || node.textContent.trim()
        });
      });
    });
  }

  function initMobileNav() {
    var toggle = document.querySelector("[data-menu-toggle]");
    var closeEls = document.querySelectorAll("[data-menu-close]");
    if (!toggle) return;

    function setMenuState(open) {
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      var menu = document.getElementById(toggle.getAttribute("aria-controls"));
      if (menu) {
        menu.setAttribute("aria-hidden", String(!open));
      }
    }

    toggle.addEventListener("click", function () {
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      setMenuState(!expanded);
    });

    closeEls.forEach(function (node) {
      node.addEventListener("click", function () {
        setMenuState(false);
      });
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 960) setMenuState(false);
    });
  }

  function initReveal() {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length || reducedMotion) {
      targets.forEach(function (el) {
        el.classList.add("is-visible");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    targets.forEach(function (el) {
      observer.observe(el);
    });
  }

  function initParallaxLite() {
    if (reducedMotion) return;

    var meshes = document.querySelectorAll(".mesh");
    if (!meshes.length) return;

    var ticking = false;

    function update() {
      var y = Math.min(8, window.scrollY * 0.02);
      meshes.forEach(function (mesh) {
        mesh.style.setProperty("--parallax-y", y.toFixed(2) + "px");
      });
      ticking = false;
    }

    window.addEventListener("scroll", function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    });
  }

  function initScrollDepthTracking() {
    function onScroll() {
      var doc = document.documentElement;
      var scrollTop = window.scrollY || doc.scrollTop;
      var height = doc.scrollHeight - doc.clientHeight;
      if (height <= 0) return;
      var percent = Math.round((scrollTop / height) * 100);

      if (percent >= 50 && !trackedScroll[50]) {
        trackedScroll[50] = true;
        trackEvent("scroll_depth_50");
      }

      if (percent >= 90 && !trackedScroll[90]) {
        trackedScroll[90] = true;
        trackEvent("scroll_depth_90");
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function initFaqAccordions() {
    var items = document.querySelectorAll(".accordion-item");
    if (!items.length) return;

    items.forEach(function (item) {
      var trigger = item.querySelector(".accordion-trigger");
      if (!trigger) return;

      trigger.addEventListener("click", function () {
        var isOpen = item.hasAttribute("open");

        items.forEach(function (other) {
          other.removeAttribute("open");
          var otherTrigger = other.querySelector(".accordion-trigger");
          if (otherTrigger) otherTrigger.setAttribute("aria-expanded", "false");
        });

        if (!isOpen) {
          item.setAttribute("open", "");
          trigger.setAttribute("aria-expanded", "true");
          trackEvent("faq_expand", {
            question: trigger.textContent.trim()
          });
        }
      });
    });
  }

  function initTestimonialCarousel() {
    var carousels = document.querySelectorAll("[data-carousel]");
    if (!carousels.length) return;

    carousels.forEach(function (carousel) {
      var track = carousel.querySelector(".carousel-track");
      var slides = carousel.querySelectorAll(".carousel-slide");
      var prev = carousel.querySelector("[data-carousel-prev]");
      var next = carousel.querySelector("[data-carousel-next]");
      if (!track || slides.length < 2) return;

      var index = 0;

      function render() {
        track.style.transform = "translateX(" + index * -100 + "%)";
      }

      function goTo(i) {
        index = (i + slides.length) % slides.length;
        render();
      }

      if (prev) {
        prev.addEventListener("click", function () {
          goTo(index - 1);
        });
      }

      if (next) {
        next.addEventListener("click", function () {
          goTo(index + 1);
        });
      }
    });
  }

  function initCaseFilters() {
    var filterRoot = document.querySelector("[data-case-filters]");
    if (!filterRoot) return;

    var cards = Array.prototype.slice.call(document.querySelectorAll("[data-case-card]"));
    if (!cards.length) return;

    var filters = {
      crm: filterRoot.querySelector("[name='crm']"),
      integration: filterRoot.querySelector("[name='integration']"),
      industry: filterRoot.querySelector("[name='industry']")
    };

    function applyFilters() {
      var active = {
        crm: filters.crm ? filters.crm.value : "all",
        integration: filters.integration ? filters.integration.value : "all",
        industry: filters.industry ? filters.industry.value : "all"
      };

      cards.forEach(function (card) {
        var visible =
          (active.crm === "all" || card.getAttribute("data-crm") === active.crm) &&
          (active.integration === "all" || card.getAttribute("data-integration") === active.integration) &&
          (active.industry === "all" || card.getAttribute("data-industry") === active.industry);

        card.style.display = visible ? "block" : "none";
      });

      trackEvent("case_study_filter_used", active);
    }

    Object.keys(filters).forEach(function (key) {
      if (!filters[key]) return;
      filters[key].addEventListener("change", applyFilters);
    });
  }

  function initMobileStickyCta() {
    var sticky = document.querySelector("[data-mobile-sticky]");
    if (!sticky) return;

    var disable = document.body.getAttribute("data-mobile-cta") === "off";
    if (disable) return;

    function onScroll() {
      if (window.innerWidth > 960) {
        sticky.classList.remove("is-visible");
        return;
      }

      var doc = document.documentElement;
      var scrollTop = window.scrollY || doc.scrollTop;
      var height = doc.scrollHeight - doc.clientHeight;
      var ratio = height > 0 ? scrollTop / height : 0;
      sticky.classList.toggle("is-visible", ratio > 0.35);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  }

  function initForms() {
    var forms = document.querySelectorAll("[data-form-type]");
    if (!forms.length) return;
    var endpoint = document.body.getAttribute("data-form-endpoint") || window.SDS_FORM_ENDPOINT || "";

    function setStatus(node, message, isError) {
      if (!node) return;
      node.textContent = message;
      node.classList.toggle("is-error", Boolean(isError));
      node.classList.add("is-visible");
    }

    function clearStatus(node) {
      if (!node) return;
      node.classList.remove("is-visible", "is-error");
    }

    function setFieldError(field, active) {
      if (!field) return;
      field.setAttribute("aria-invalid", active ? "true" : "false");
      field.classList.toggle("is-invalid", active);
    }

    function validateRequiredFields(form) {
      var required = form.querySelectorAll("input[required], select[required], textarea[required]");
      var hasError = false;

      required.forEach(function (field) {
        var value = String(field.value || "").trim();
        var invalid = !value;
        setFieldError(field, invalid);
        if (invalid) hasError = true;
      });

      return !hasError;
    }

    function toPayload(formData, type) {
      var fields = {};
      formData.forEach(function (value, key) {
        fields[key] = String(value || "").trim();
      });

      return {
        formType: type,
        pageUrl: window.location.href,
        submittedAt: new Date().toISOString(),
        fields: fields
      };
    }

    async function submitToEndpoint(payload) {
      if (!endpoint) return false;
      try {
        var response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        return response.ok;
      } catch (err) {
        return false;
      }
    }

    forms.forEach(function (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var isValid = validateRequiredFields(form);
        var success = form.parentElement.querySelector(".form-success");
        var submitButton = form.querySelector("button[type='submit']");

        clearStatus(success);
        if (!isValid) {
          setStatus(success, "Please complete all required fields before submitting.", true);
          return;
        }

        var formData = new FormData(form);
        var type = form.getAttribute("data-form-type");
        var payload = toPayload(formData, type);
        var subjectPrefix = type === "audit" ? "CRM Integration Audit Request" : "Discovery Call Request";
        var subject = subjectPrefix + " - " + (formData.get("name") || "Unknown");

        var lines = [];
        formData.forEach(function (value, key) {
          lines.push(key + ": " + String(value || "").trim());
        });

        if (submitButton) submitButton.disabled = true;
        var posted = await submitToEndpoint(payload);
        if (submitButton) submitButton.disabled = false;

        if (posted) {
          setStatus(
            success,
            type === "audit"
              ? "Thanks. Your CRM integration audit request was submitted."
              : "Thanks. Your discovery request was submitted.",
            false
          );

          trackEvent(type === "audit" ? "form_submit_audit" : "form_submit_contact", {
            form: type
          });

          form.reset();
          form.querySelectorAll("[aria-invalid='true']").forEach(function (field) {
            setFieldError(field, false);
          });
          return;
        }

        var mailto =
          "mailto:zach@skydataservice.com?subject=" +
          encodeURIComponent(subject) +
          "&body=" +
          encodeURIComponent(lines.join("\n"));

        setStatus(
          success,
          "We could not submit automatically. Your email app will open so you can send the request now.",
          true
        );

        trackEvent(type === "audit" ? "form_submit_audit" : "form_submit_contact", {
          form: type,
          delivery: "mailto_fallback"
        });

        window.location.href = mailto;
      });
    });
  }

  function setYear() {
    var years = document.querySelectorAll("[data-year]");
    years.forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
  }

  bindTrackedClicks();
  initMobileNav();
  initReveal();
  initParallaxLite();
  initScrollDepthTracking();
  initFaqAccordions();
  initTestimonialCarousel();
  initCaseFilters();
  initMobileStickyCta();
  initForms();
  setYear();
})();
