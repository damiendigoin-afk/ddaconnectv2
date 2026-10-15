/* DDA Connect : lit #dda-ref=…&dda-immat=… (ouvert depuis DDA), remplit les deux champs, n'envoie rien, ne clique sur rien. */
(function () {
  function ddaPrefill(win) {
    var doc = win.document;
    var h = new URLSearchParams((win.location.hash || "").replace(/^#/, ""));
    var ref = h.get("dda-ref"), immat = h.get("dda-immat");
    if (!ref && !immat) return { filled: 0 };
    var n = 0;
    function set(prefix, value) {
      if (!value) return;
      var els = doc.querySelectorAll('input[id^="' + prefix + '"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.value && el.value !== value) continue; // ne jamais écraser une saisie existante
        el.value = String(value).slice(0, 60);
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        el.dispatchEvent(new win.Event("change", { bubbles: true }));
        n++;
      }
    }
    set("command-reference-", ref);
    set("command-immatriculation-", immat);
    try { win.history.replaceState(null, "", win.location.pathname + win.location.search); } catch (e) {}
    return { filled: n };
  }
  if (typeof module !== "undefined") module.exports = ddaPrefill;
  else ddaPrefill(window);
})();
