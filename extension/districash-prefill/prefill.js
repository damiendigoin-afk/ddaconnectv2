/*
 * DDA Connect (facultatif) : page panier Districash ouverte depuis DDA avec
 * #dda-ref=OR%3A+78546&dda-immat=EE111EE → remplit UNIQUEMENT « Référence de commande »
 * (input id command-reference-<panier>) et « Immatriculation » (command-immatriculation-<panier>).
 * N'envoie rien, ne clique sur rien, n'écrase jamais une saisie existante.
 * Le panier peut être rendu tardivement (ajax) : surveillance du DOM pendant 30 s max.
 */
(function () {
  var PREFIXES = [["command-reference-", "ref"], ["command-immatriculation-", "immat"]];

  /** Lit le fragment ('+' = espace, %xx décodés par URLSearchParams). */
  function readHash(hash) {
    var h = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    var ref = (h.get("dda-ref") || "").trim().slice(0, 60);
    var immat = (h.get("dda-immat") || "").trim().slice(0, 60);
    return ref || immat ? { ref: ref, immat: immat } : null;
  }

  /** Remplit les champs présents (tous les paniers affichés). Renvoie le nombre de champs remplis. */
  function fillOnce(doc, win, values, done) {
    var n = 0;
    for (var p = 0; p < PREFIXES.length; p++) {
      var value = values[PREFIXES[p][1]];
      if (!value) continue;
      var els = doc.querySelectorAll('input[id^="' + PREFIXES[p][0] + '"], textarea[id^="' + PREFIXES[p][0] + '"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (done[el.id]) continue;
        done[el.id] = 1;
        if (el.value && el.value !== value) continue; // saisie existante conservée
        if (el.value === value) continue;
        el.focus && el.focus();
        el.value = value;
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        el.dispatchEvent(new win.Event("change", { bubbles: true }));
        el.dispatchEvent(new win.Event("blur", { bubbles: true }));
        n++;
      }
    }
    return n;
  }

  /** Remplit maintenant puis à chaque rendu tardif, jusqu'à timeoutMs. Promesse du total rempli. */
  function ddaPrefill(win, values, timeoutMs) {
    var doc = win.document;
    if (!values) return Promise.resolve({ filled: 0 });
    var done = {};
    var total = fillOnce(doc, win, values, done);
    if (!win.MutationObserver) return Promise.resolve({ filled: total });
    return new Promise(function (resolve) {
      var obs = new win.MutationObserver(function () { total += fillOnce(doc, win, values, done); });
      obs.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
      win.setTimeout(function () { obs.disconnect(); resolve({ filled: total }); }, timeoutMs == null ? 30000 : timeoutMs);
    });
  }

  function main(win) {
    var values = readHash(win.location.hash);
    if (!values) return;
    // Fragment retiré de la barre d'adresse (valeurs gardées en mémoire pour le rendu tardif).
    try { win.history.replaceState(null, "", win.location.pathname + win.location.search); } catch (e) {}
    ddaPrefill(win, values);
  }

  var api = { readHash: readHash, ddaPrefill: ddaPrefill };
  if (typeof module !== "undefined") module.exports = api;
  else main(window);
})();
