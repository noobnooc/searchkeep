// Progressive enhancement for searchkeep.dev. Every page is fully usable
// without this file; it only adds the theme toggle, copy buttons, the
// scrolled-nav state and the docs table-of-contents highlight.
(function () {
  'use strict';
  var root = document.documentElement;

  // Theme toggle: cycles to the opposite of the theme currently shown.
  function currentTheme() {
    if (root.dataset.theme) return root.dataset.theme;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (e) {}
    });
  });

  // Copy buttons on code blocks.
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var block = btn.closest('[data-code]');
      var code = block && block.querySelector('code');
      if (!code || !navigator.clipboard) return;
      navigator.clipboard.writeText(code.innerText.replace(/\n$/, '')).then(function () {
        btn.dataset.state = 'copied';
        btn.setAttribute('aria-label', 'Copied');
        setTimeout(function () {
          delete btn.dataset.state;
          btn.setAttribute('aria-label', 'Copy code');
        }, 1600);
      });
    });
  });

  // Glassy nav gets a stronger edge once the page scrolls.
  var header = document.querySelector('[data-header]');
  if (header) {
    var onScroll = function () {
      header.toggleAttribute('data-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Close the mobile menu after following an in-page link.
  document.querySelectorAll('details[data-menu] a').forEach(function (a) {
    a.addEventListener('click', function () {
      var d = a.closest('details');
      if (d) d.open = false;
    });
  });

  // Docs: highlight the section currently in view in the on-page TOC.
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('[data-toc] a[href^="#"]'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) {
      byId[decodeURIComponent(a.getAttribute('href').slice(1))] = a;
    });
    var visible = {};
    var setActive = function () {
      var ids = Object.keys(byId);
      var active = null;
      for (var i = 0; i < ids.length; i++) {
        if (visible[ids[i]]) {
          active = ids[i];
          break;
        }
      }
      if (!active) return;
      tocLinks.forEach(function (a) {
        a.removeAttribute('aria-current');
      });
      byId[active].setAttribute('aria-current', 'true');
    };
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          visible[e.target.id] = e.isIntersecting;
        });
        setActive();
      },
      { rootMargin: '-72px 0px -60% 0px' }
    );
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }
})();
