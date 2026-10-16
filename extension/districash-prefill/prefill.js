/*
 * DDA Connect — extension volontaire pour la page panier Districash.
 *
 * Lien ouvert depuis DDA : https://districashv2.inoshop.net/cart#dda-ref=…&dda-immat=…
 *   [+ dda-add=/catalog/product/…&dda-code=…&dda-qty=…&dda-pa=…&dda-account=…]
 *
 * 1. Préremplissage : remplit UNIQUEMENT « Référence de commande » et « Immatriculation » (sans écraser).
 * 2. Ajout au panier (si dda-add) : DANS LA SESSION DU NAVIGATEUR (cookies Districash de l'utilisateur),
 *    après consentement explicite dans un encadré. Lit le vrai formulaire de la fiche produit, vérifie
 *    référence / prix / disponibilité J/J+, envoie UNE fois POST /cart/store, puis relit GET /cart.
 *    Succès affiché seulement si l'article est retrouvé dans le panier relu.
 * Jamais : /cart/order, /cart/payment, /order/*, /rest/*, ni clic sur un bouton de validation.
 * Aucune donnée DDA n'est envoyée ailleurs que sur districashv2.inoshop.net.
 */
(function () {
  var HOST = "districashv2.inoshop.net";
  var ACCOUNTS = ["19025", "60669"];
  var FIELDS = ["mode_modal", "origin", "id", "gencode", "c_fourn_cata", "c_fourn", "code_article",
    "code_article_fournisseur", "code_marque", "platform_img", "platform_libdispo", "platform_libdispobtn",
    "prix_achat", "prix_vente", "devise", "consigne", "code_fam", "code_sfam", "code_ean", "code_supplier",
    "libelle_article", "identifiant_administratif", "type_erp", "code_agence", "scenario"];
  var CRITICAL = { id: 1, code_article: 1, prix_achat: 1, type_erp: 1, code_agence: 1 };
  var norm = function (s) { return String(s == null ? "" : s).toUpperCase().replace(/\s+/g, ""); };

  /** Seuls chemins autorisés. */
  function assertPath(path, method) {
    var u = new URL(path, "https://" + HOST);
    if (u.protocol !== "https:" || u.host !== HOST) throw new Error("Hôte non autorisé.");
    if (/(xat2v2|\/rest\/|\/cart\/order|\/cart\/payment|\/order|checkout|payment|validate)/i.test(u.pathname)) throw new Error("Chemin interdit.");
    var ok = (method === "GET" && (u.pathname === "/cart" || /^\/catalog\/product\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(u.pathname))) ||
      (method === "POST" && u.pathname === "/cart/store");
    if (!ok) throw new Error("Chemin non autorisé.");
    return u.pathname;
  }

  function hashParams(win) { return new URLSearchParams((win.location.hash || "").replace(/^#/, "")); }

  /** Demande d'ajout validée depuis le fragment, ou null / { error }. */
  function parseAddRequest(h) {
    if (!h.get("dda-add")) return null;
    var path, qty = Number(h.get("dda-qty")), pa = Number(h.get("dda-pa")), code = h.get("dda-code") || "", account = h.get("dda-account") || "";
    try { path = assertPath(h.get("dda-add"), "GET"); } catch (e) { return { error: "Fiche produit non autorisée." }; }
    if (path === "/cart") return { error: "Fiche produit non autorisée." };
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(code)) return { error: "Référence invalide." };
    if (!(Number.isInteger(qty) && qty >= 1 && qty <= 20)) return { error: "Quantité invalide." };
    if (!(isFinite(pa) && pa > 0)) return { error: "Prix d'achat invalide." };
    if (ACCOUNTS.indexOf(account) < 0) return { error: "Compte Districash inconnu." };
    return { path: path, code: code, qty: qty, pa: pa, account: account, ref: h.get("dda-ref") || "", immat: h.get("dda-immat") || "" };
  }

  function decode(s) { return s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
  function readField(html, name) {
    var esc = name.replace(/[-_]/g, function (c) { return "\\" + c; });
    var input = new RegExp("<input\\b[^>]*\\bname\\s*=\\s*[\"']" + esc + "[\"'][^>]*>", "i").exec(html);
    if (input) {
      var v = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(input[0]);
      return v ? decode(v[1] != null ? v[1] : (v[2] || "")) : "";
    }
    var d = new RegExp("\\bdata-" + esc + "\\s*=\\s*\"([^\"]*)\"", "i").exec(html);
    return d ? decode(d[1]) : null;
  }

  /** Corps POST /cart/store depuis la vraie fiche produit. */
  function buildCartBody(productHtml, csrf, req) {
    if (!csrf) return { ok: false, reason: "Jeton de session Districash absent : êtes-vous connecté ?" };
    var m = /data-dispo-type\s*=\s*"\s*(ag|grp)\s*"/i.exec(productHtml);
    if (!m) return { ok: false, reason: "Disponibilité J/J+ non confirmée sur la fiche." };
    var forms = productHtml.match(/<form\b[\s\S]*?<\/form>/gi) || [];
    var form = productHtml;
    for (var i = 0; i < forms.length; i++) if (/name\s*=\s*"code_article"/i.test(forms[i])) { form = forms[i]; break; }
    var body = new URLSearchParams({ _token: csrf, quantite: String(req.qty) });
    for (var j = 0; j < FIELDS.length; j++) {
      var f = FIELDS[j], v = readField(form, f);
      if (v == null) return { ok: false, reason: "Champ portail introuvable : " + f + "." };
      if (v.trim() === "" && CRITICAL[f]) return { ok: false, reason: "Champ portail vide : " + f + "." };
      body.set(f, v);
    }
    if (norm(body.get("code_article")) !== norm(req.code)) return { ok: false, reason: "Référence article différente de la commande DDA." };
    var pa = Number(String(body.get("prix_achat")).replace(",", "."));
    if (!isFinite(pa) || Math.abs(pa - req.pa) > 0.005) return { ok: false, reason: "Prix d'achat changé (" + body.get("prix_achat") + " au lieu de " + req.pa.toFixed(2) + ") : revérifiez dans DDA." };
    return { ok: true, body: body };
  }

  /** Compte connecté visible sur la page : "match" | "other" | "unknown". */
  function detectAccount(html, expected) {
    var txt = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
    var has = function (a) { return new RegExp("(^|\\D)" + a + "(\\D|$)").test(txt); };
    if (has(expected)) return "match";
    for (var i = 0; i < ACCOUNTS.length; i++) if (ACCOUNTS[i] !== expected && has(ACCOUNTS[i])) return "other";
    return "unknown";
  }

  function cartHas(html, code) { return norm(html.replace(/<script[\s\S]*?<\/script>/gi, " ")).indexOf(norm(code)) >= 0; }

  /**
   * Ajout dans la session du navigateur. `http` = { get(path) → {status,text}, post(path, body, csrf) → {status,text} }.
   * Une seule tentative POST ; succès uniquement si GET /cart relu contient la référence.
   */
  async function runAdd(http, req, csrf) {
    var before = await http.get("/cart");
    if (before.status !== 200) return { status: "refused", message: "Panier illisible (HTTP " + before.status + ") : rien n'a été envoyé." };
    if (cartHas(before.text, req.code)) return { status: "already_in_cart", message: "Cette référence est déjà dans votre panier : rien n'a été ajouté." };
    var prod = await http.get(req.path);
    if (prod.status !== 200) return { status: "refused", message: "Fiche produit inaccessible (HTTP " + prod.status + ") : rien n'a été envoyé." };
    var built = buildCartBody(prod.text, csrf, req);
    if (!built.ok) return { status: "refused", message: built.reason + " Rien n'a été envoyé." };
    var res;
    try { res = await http.post("/cart/store", built.body, csrf); }
    catch (e) { res = null; }
    var after;
    try { after = await http.get("/cart"); } catch (e) { after = null; }
    if (after && after.status === 200 && cartHas(after.text, req.code))
      return { status: "added", message: req.qty + " pneu(s) " + req.code + " ajouté(s) et retrouvé(s) dans votre panier. Vérifiez la quantité ; aucune commande n'est validée." };
    if (res && (res.status === 419 || res.status === 401)) return { status: "refused", message: "Session Districash refusée : reconnectez-vous puis relancez depuis DDA." };
    return { status: "uncertain", message: "Ajout non retrouvé dans le panier relu. Rechargez la page et vérifiez ; ne relancez pas sans avoir vérifié." };
  }

  function ddaPrefill(win, ref, immat) {
    var doc = win.document;
    if (ref == null) { var h = hashParams(win); ref = h.get("dda-ref"); immat = h.get("dda-immat"); }
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
    return { filled: n };
  }

  // ---- Intégration page (navigateur uniquement) -------------------------------------------------
  function browserHttp(win) {
    return {
      get: async function (p) {
        var r = await win.fetch(assertPath(p, "GET"), { credentials: "same-origin", headers: { Accept: "text/html" } });
        return { status: r.status, text: await r.text() };
      },
      post: async function (p, body, csrf) {
        var r = await win.fetch(assertPath(p, "POST"), {
          method: "POST", credentials: "same-origin", body: body,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf },
        });
        return { status: r.status, text: await r.text() };
      },
    };
  }

  function panel(win, req) {
    var doc = win.document;
    var box = doc.createElement("div");
    box.setAttribute("style", "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;background:#fff;color:#111;border:2px solid #111;border-radius:10px;padding:12px;font:13px/1.4 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)");
    function el(tag, text, style) { var e = doc.createElement(tag); if (text) e.textContent = text; if (style) e.setAttribute("style", style); box.appendChild(e); return e; }
    el("div", "DDA Connect — ajout au panier", "font-weight:700;margin-bottom:6px");
    if (req.error) { el("div", req.error + " Rien n'a été envoyé.", "color:#b00"); doc.body.appendChild(box); return; }
    var acc = detectAccount(doc.documentElement.outerHTML, req.account);
    el("div", req.qty + " × " + req.code + " à " + req.pa.toFixed(2).replace(".", ",") + " € HT / pneu");
    el("div", "Compte attendu : " + req.account + (acc === "match" ? " (détecté sur la page)" : acc === "other" ? " — AUTRE COMPTE CONNECTÉ" : " (non détecté sur la page : vérifiez)"),
      acc === "other" ? "color:#b00;font-weight:700" : acc === "match" ? "color:#060" : "color:#a60");
    var msg = el("div", "", "margin-top:6px");
    if (acc === "other") { msg.textContent = "Connectez-vous au compte " + req.account + " puis relancez depuis DDA. Rien n'a été envoyé."; doc.body.appendChild(box); return; }
    var lab = doc.createElement("label"); lab.setAttribute("style", "display:flex;gap:6px;margin-top:6px");
    var cb = doc.createElement("input"); cb.type = "checkbox"; lab.appendChild(cb);
    lab.appendChild(doc.createTextNode("J'autorise l'ajout au panier du compte " + req.account + ". Aucune commande ne sera validée."));
    box.appendChild(lab);
    var btn = el("button", "Ajouter au panier", "margin-top:8px;width:100%;height:36px;font-weight:700;border:1px solid #111;border-radius:8px;background:#111;color:#fff");
    btn.disabled = true; cb.onchange = function () { btn.disabled = !cb.checked; };
    var cancel = el("button", "Annuler", "margin-top:4px;width:100%;height:30px;border:0;background:none;text-decoration:underline");
    cancel.onclick = function () { box.remove(); };
    btn.onclick = async function () {
      btn.disabled = true; cb.disabled = true; cancel.remove(); btn.textContent = "Ajout en cours…";
      var key = "dda-cart-" + req.code + "-" + req.ref;
      if (win.sessionStorage.getItem(key)) { msg.textContent = "Déjà tenté dans cet onglet : vérifiez le panier, sans relancer."; return; }
      win.sessionStorage.setItem(key, "1");
      var meta = doc.querySelector('meta[name="csrf-token"]');
      var r;
      try { r = await runAdd(browserHttp(win), req, meta ? meta.getAttribute("content") : ""); }
      catch (e) { r = { status: "uncertain", message: "Erreur pendant l'ajout : rechargez et vérifiez le panier, sans relancer." }; }
      if (r.status === "refused") win.sessionStorage.removeItem(key);
      msg.textContent = r.message; msg.style.color = r.status === "added" ? "#060" : "#b00";
      btn.textContent = r.status === "added" ? "Recharger le panier" : "Recharger la page";
      btn.disabled = false;
      btn.onclick = function () {
        var h = new URLSearchParams(); if (req.ref) h.set("dda-ref", req.ref); if (req.immat) h.set("dda-immat", req.immat);
        win.location.hash = h.toString(); win.location.reload();
      };
    };
    doc.body.appendChild(box);
  }

  function main(win) {
    var h = hashParams(win);
    var req = parseAddRequest(h);
    var ref = h.get("dda-ref"), immat = h.get("dda-immat");
    // Fragment consommé immédiatement : un rechargement ne relance jamais l'ajout.
    try { win.history.replaceState(null, "", win.location.pathname + win.location.search); } catch (e) {}
    if (req) panel(win, req);
    else ddaPrefill(win, ref, immat);
  }

  var api = { ddaPrefill: ddaPrefill, parseAddRequest: parseAddRequest, buildCartBody: buildCartBody, detectAccount: detectAccount, runAdd: runAdd, assertPath: assertPath };
  if (typeof module !== "undefined") module.exports = api;
  else main(window);
})();
