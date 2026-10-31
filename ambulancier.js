/*
 * Écran de la check-list ambulancier : choix du véhicule puis questions du modèle
 * (VML, UMH ou F00) décrit dans checklists.js.
 * Les réponses sont gardées en brouillon sur l'appareil jusqu'à l'enregistrement :
 * un départ en intervention au milieu de la vérification ne fait rien perdre.
 */
const Ambulancier = (() => {
  const CLE_BROUILLONS = 'smur_brouillons_ambulancier';
  const CLE_RELEVES = 'smur_derniers_releves';
  const etat = { vehicule: null, reponses: {} };
  let zoneVehicules;
  let zoneQuestions;
  let titre;

  const aujourdhui = () => new Date().toLocaleDateString('fr-CA'); // AAAA-MM-JJ, heure locale
  const km = (n) => `${Number(n).toLocaleString('fr-FR')} km`;

  function lireStockage(cle) {
    try { return JSON.parse(localStorage.getItem(cle)) || {}; } catch (e) { return {}; }
  }
  function ecrireStockage(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* mémoire pleine */ }
  }

  // ---------- Brouillons (un par véhicule, valables le jour même) ----------
  const brouillons = {
    lire(vehicule) {
      const b = lireStockage(CLE_BROUILLONS)[vehicule];
      return b && b.date === aujourdhui() ? b.reponses : {};
    },
    ecrire(vehicule, reponses) {
      const tous = lireStockage(CLE_BROUILLONS);
      tous[vehicule] = { date: aujourdhui(), reponses };
      ecrireStockage(CLE_BROUILLONS, tous);
    },
    effacer(vehicule) {
      const tous = lireStockage(CLE_BROUILLONS);
      delete tous[vehicule];
      ecrireStockage(CLE_BROUILLONS, tous);
    },
  };

  // ---------- Derniers kilométrages (envoyés par le serveur, gardés pour le hors ligne) ----------
  const releves = {
    lire: (vehicule) => lireStockage(CLE_RELEVES)[vehicule] || null,
    /** Ne garde que le relevé le plus récent de chaque véhicule. */
    fusionner(nouveaux) {
      const tous = lireStockage(CLE_RELEVES);
      Object.entries(nouveaux || {}).forEach(([v, r]) => {
        if (!r || !(r.km > 0)) return;
        if (!tous[v] || new Date(r.date) >= new Date(tous[v].date)) tous[v] = r;
      });
      ecrireStockage(CLE_RELEVES, tous);
    },
  };

  // ---------- Modèle courant ----------
  const vehicule = () => VEHICULES.find((v) => v.id === etat.vehicule);
  const questionBascule = () => MODELES.UMH.questions.find((q) => q.basculeF00);

  /** Une UMH qui fait office de F00 se vérifie avec la check-list F00. */
  function modeleCourant() {
    const v = vehicule();
    if (!v) return null;
    if (v.modele === 'UMH' && etat.reponses[questionBascule().libelle] === 'OUI') return 'F00';
    return v.modele;
  }

  function questionsCourantes() {
    const modele = modeleCourant();
    if (!modele) return [];
    const questions = MODELES[modele].questions;
    // On garde la question « fait office de F00 » en tête pour pouvoir revenir en arrière.
    return vehicule().modele === 'UMH' && modele === 'F00' ? [questionBascule(), ...questions] : questions;
  }

  /** La question concerne-t-elle ce véhicule ? */
  const concerne = (q) => (!q.seulementPour || q.seulementPour.includes(etat.vehicule))
    && (!q.exclusPour || !q.exclusPour.includes(etat.vehicule));
  const visible = (q) => q.type !== 'cache' && concerne(q) && (!q.si || etat.reponses[q.si.question] === q.si.valeur);
  const elementsDuGroupe = (g) => g.items.map((i) => (typeof i === 'string' ? { libelle: i } : i));
  const cleElement = (g, i) => i.colonne || `${g.titre} [${i.libelle}]`;

  /** Libellés dont la réponse change les questions affichées. */
  function dependances() {
    const cles = new Set([questionBascule().libelle]);
    Object.values(MODELES).forEach((m) => m.questions.forEach((q) => { if (q.si) cles.add(q.si.question); }));
    return cles;
  }

  // ---------- Éléments d'interface ----------
  const SVG = 'http://www.w3.org/2000/svg';
  function el(balise, attributs = {}, ...enfants) {
    const n = balise.startsWith('svg:') ? document.createElementNS(SVG, balise.slice(4)) : document.createElement(balise);
    Object.entries(attributs).forEach(([k, v]) => {
      if (k === 'texte') n.textContent = v;
      else if (k === 'classe') n.setAttribute('class', v);
      else n.setAttribute(k, v);
    });
    n.append(...enfants);
    return n;
  }

  let compteur = 0;
  const nouvelId = () => `q${(compteur += 1)}`;

  function puces(cle, options, legende) {
    const nom = nouvelId();
    const groupe = el('div', { classe: 'puces' });
    options.forEach((option) => {
      const id = nouvelId();
      const radio = el('input', { type: 'radio', name: nom, id, value: String(option), 'data-cle': cle });
      if (String(etat.reponses[cle]) === String(option)) radio.checked = true;
      groupe.append(radio, el('label', { for: id, texte: String(option) }));
    });
    return el('fieldset', { classe: 'question' }, el('legend', { texte: legende }), groupe);
  }

  function caseACocher(cle, libelle, valeurCochee) {
    const caseEl = el('input', { type: 'checkbox', 'data-cle': cle, 'data-valeur': valeurCochee });
    caseEl.checked = etat.reponses[cle] === valeurCochee;
    return el('li', {}, el('label', {}, caseEl, el('span', { texte: libelle })));
  }

  /**
   * Curseur (input range) : tant qu'il n'a pas été touché, la question n'a pas de réponse.
   * `dessiner(bloc, valeur)` met à jour le visuel (bouteille ou jauge).
   */
  function curseur(cle, max, visuel, dessiner, texteValeur, aide) {
    const id = nouvelId();
    const valeur = etat.reponses[cle];
    const vide = valeur === undefined || valeur === '';
    const entree = el('input', {
      type: 'range', id, min: '0', max: String(max), step: '1', 'data-cle': cle, 'data-curseur': '',
      'aria-valuetext': vide ? 'non renseigné' : texteValeur(Number(valeur)),
    });
    entree.value = vide ? String(Math.round(max / 2)) : String(valeur);
    const affichage = el('p', { classe: 'valeur-curseur', 'aria-hidden': 'true' });
    const bloc = el('fieldset', { classe: 'question curseur' },
      el('legend', {}, el('label', { for: id, texte: cle })), visuel, entree, affichage);
    if (aide) bloc.insertBefore(el('p', { classe: 'aide-question', texte: aide }), visuel);
    bloc.majCurseur = (v, estVide) => {
      bloc.toggleAttribute('data-vide', estVide);
      affichage.textContent = estVide ? 'Faites glisser le curseur' : texteValeur(v);
      entree.setAttribute('aria-valuetext', estVide ? 'non renseigné' : texteValeur(v));
      dessiner(bloc, estVide ? 0 : v);
    };
    bloc.majCurseur(Number(entree.value), vide);
    return bloc;
  }

  /** Obus : bouteille couchée qui se remplit, curseur posé dessus. */
  function niveau(q) {
    const bouteille = el('div', { classe: 'bouteille', 'aria-hidden': 'true' },
      el('div', { classe: 'remplissage' }), el('div', { classe: 'graduations' }));
    const bloc = curseur(q.libelle, 10, bouteille,
      (b, v) => {
        b.style.setProperty('--niveau', v / 10);
        b.dataset.alerte = v <= 3 ? 'bas' : (v <= 5 ? 'moyen' : 'ok');
      },
      (v) => `${v}/10 · ${v * 20} bars`, '10 = plein (200 bars)');
    bloc.classList.add('niveau');
    return bloc;
  }

  /** Carburant : jauge à aiguille de 0 à 8. */
  function jauge(q) {
    const cx = 100;
    const cy = 100;
    const point = (angle, r) => [cx + r * Math.cos((angle * Math.PI) / 180), cy - r * Math.sin((angle * Math.PI) / 180)];
    const svg = el('svg:svg', { viewBox: '0 0 200 122', classe: 'jauge', 'aria-hidden': 'true' });
    const [rx1, ry1] = point(180, 80);
    const [rx2, ry2] = point(180 - 22.5, 80);
    svg.append(
      el('svg:path', { d: `M20 100 A80 80 0 0 1 180 100`, classe: 'jauge-arc' }),
      el('svg:path', { d: `M${rx1} ${ry1} A80 80 0 0 1 ${rx2.toFixed(1)} ${ry2.toFixed(1)}`, classe: 'jauge-reserve' }),
    );
    for (let i = 0; i <= 8; i += 1) {
      const angle = 180 - i * 22.5;
      const [x1, y1] = point(angle, i % 4 === 0 ? 62 : 68);
      const [x2, y2] = point(angle, 76);
      svg.append(el('svg:line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), classe: 'jauge-trait' }));
    }
    [['0', 0], ['½', 4], ['1', 8]].forEach(([texte, i]) => {
      const [x, y] = point(180 - i * 22.5, 50);
      svg.append(el('svg:text', { x: x.toFixed(1), y: (y + 5).toFixed(1), classe: 'jauge-texte', texte }));
    });
    // Pompe à essence
    svg.append(el('svg:path', {
      classe: 'jauge-pompe',
      d: 'M91 72h12v20h-12z M93 75h8v5h-8z M103 76l5 4v10a2 2 0 0 0 4 0v-12l-4-4',
    }));
    const aiguille = el('svg:g', { classe: 'jauge-aiguille' },
      el('svg:line', { x1: '100', y1: '100', x2: '30', y2: '100' }), el('svg:circle', { cx: '100', cy: '100', r: '7' }));
    svg.append(aiguille);
    return curseur(q.libelle, 8, svg,
      (b, v) => {
        aiguille.setAttribute('transform', `rotate(${v * 22.5} 100 100)`);
        b.dataset.alerte = v <= 1 ? 'bas' : 'ok';
      },
      (v) => `${v}/8${v === 0 ? ' · vide' : ''}${v === 8 ? ' · plein' : ''}`);
  }

  function kilometrage(q) {
    const id = nouvelId();
    const precedent = releves.lire(etat.vehicule);
    const champ = el('input', { id, inputmode: 'numeric', autocomplete: 'off', 'data-cle': q.libelle, classe: 'saisie-km' });
    champ.value = etat.reponses[q.libelle] || '';
    const info = precedent
      ? `Dernier relevé : ${km(precedent.km)}, le ${new Date(precedent.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Aucun relevé connu pour ce véhicule.';
    const bloc = el('div', { classe: 'champ question' },
      el('label', { for: id, texte: q.libelle }), el('p', { classe: 'aide-question', texte: info }), champ,
      el('p', { classe: 'erreur-champ', 'aria-live': 'polite' }));
    verifierKm(bloc, champ.value);
    return bloc;
  }

  function erreurKm(valeur) {
    const precedent = releves.lire(etat.vehicule);
    if (!valeur || !precedent || Number(valeur) >= precedent.km) return '';
    return `Inférieur au dernier relevé (${km(precedent.km)}).`;
  }

  function verifierKm(bloc, valeur) {
    const message = erreurKm(valeur);
    bloc.querySelector('.erreur-champ').textContent = message;
    bloc.querySelector('input').setAttribute('aria-invalid', String(Boolean(message)));
  }

  function rendreQuestion(q) {
    switch (q.type) {
      case 'niveau':
        return niveau(q);
      case 'carburant':
        return jauge(q);
      case 'kilometrage':
        return kilometrage(q);
      case 'choix':
        return puces(q.libelle, q.options, q.libelle);
      case 'groupe': {
        const tout = el('button', { type: 'button', classe: 'lien tout-cocher', texte: 'Tout cocher' });
        const liste = el('ul', { classe: 'items' });
        elementsDuGroupe(q).forEach((i) => liste.append(caseACocher(cleElement(q, i), i.libelle, 'OK')));
        tout.addEventListener('click', () => {
          liste.querySelectorAll('input').forEach((c) => { c.checked = true; enregistrerChamp(c); });
          signalerChangement();
        });
        return el('fieldset', { classe: 'question groupe' },
          el('legend', {}, el('span', { texte: q.titre }), tout), liste);
      }
      case 'fait':
        return el('fieldset', { classe: 'question' }, el('legend', { classe: 'invisible', texte: q.libelle }),
          el('ul', { classe: 'items' }, caseACocher(q.libelle, `${q.libelle} fait`, 'Fait')));
      case 'texte': {
        const id = nouvelId();
        const zone = el('textarea', { id, rows: '3', 'data-cle': q.libelle, maxlength: '1000' });
        zone.value = etat.reponses[q.libelle] || '';
        return el('div', { classe: 'champ question' }, el('label', { for: id, texte: q.libelle }), zone);
      }
      default:
        return document.createTextNode('');
    }
  }

  function rendreVehicules() {
    zoneVehicules.innerHTML = '';
    const nom = nouvelId();
    VEHICULES.forEach((v) => {
      const id = nouvelId();
      const radio = el('input', { type: 'radio', name: nom, id, value: v.id });
      if (etat.vehicule === v.id) radio.checked = true;
      radio.addEventListener('change', () => choisirVehicule(v.id));
      const enCours = Object.keys(brouillons.lire(v.id)).length > 0;
      const etiquette = el('label', { for: id }, el('strong', { texte: v.id }), el('small', { texte: v.modele === 'F00' ? 'HELICO' : v.modele }));
      if (enCours) etiquette.append(el('small', { classe: 'en-cours', texte: 'en cours' }));
      zoneVehicules.append(radio, etiquette);
    });
  }

  function rendreQuestions() {
    zoneQuestions.innerHTML = '';
    const v = vehicule();
    if (!v) {
      titre.textContent = '';
      return;
    }
    const modele = modeleCourant();
    titre.textContent = v.modele === 'UMH' && modele === 'F00'
      ? `${v.id} · fait office de F00`
      : `${v.id} · ${MODELES[modele].titre}`;
    questionsCourantes().filter(visible).forEach((q) => zoneQuestions.append(rendreQuestion(q)));
  }

  function choisirVehicule(id) {
    etat.vehicule = id;
    etat.reponses = brouillons.lire(id);
    rendreQuestions();
    signalerChangement();
    titre.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function enregistrerChamp(champ) {
    const cle = champ.dataset.cle;
    if (!cle) return;
    if (champ.type === 'checkbox') {
      if (champ.checked) etat.reponses[cle] = champ.dataset.valeur;
      else delete etat.reponses[cle];
    } else if (champ.type === 'radio') {
      if (champ.checked) etat.reponses[cle] = champ.value;
    } else if (champ.type === 'range') {
      etat.reponses[cle] = Number(champ.value);
      champ.closest('.curseur').majCurseur(Number(champ.value), false);
    } else {
      const valeur = champ.classList.contains('saisie-km') ? champ.value.replace(/\D/g, '').slice(0, 7) : champ.value;
      if (champ.value !== valeur) champ.value = valeur;
      if (valeur) etat.reponses[cle] = valeur;
      else delete etat.reponses[cle];
      if (champ.classList.contains('saisie-km')) verifierKm(champ.closest('.question'), valeur);
    }
    brouillons.ecrire(etat.vehicule, etat.reponses);
  }

  // Prévient app.js qu'une réponse a changé (pour annuler une demande de confirmation).
  const signalerChangement = () => zoneQuestions.dispatchEvent(new CustomEvent('reponse', { bubbles: true }));

  // ---------- Lecture pour l'envoi ----------

  /**
   * Réponses dans l'ordre des questions.
   * Éléments : « OK » ou « Manquant ». Obus et kilométrage : nombres. Carburant : « 6/8 ».
   */
  function lire() {
    const v = vehicule();
    if (!v) return { erreurs: ['véhicule vérifié'], manquants: [] };
    const reponses = {};
    const erreurs = [];
    const manquants = [];
    questionsCourantes().forEach((q) => {
      if (q.type === 'cache') {
        reponses[q.libelle] = (q.valeurs && q.valeurs[v.id]) || q.defaut || '';
        return;
      }
      if (!concerne(q)) {
        if (q.sinon !== undefined) reponses[q.libelle] = q.sinon;
        return;
      }
      if (!visible(q)) return;
      if (q.type === 'groupe') {
        elementsDuGroupe(q).forEach((i) => {
          const cle = cleElement(q, i);
          const ok = etat.reponses[cle] === 'OK';
          reponses[cle] = ok ? 'OK' : 'Manquant';
          if (!ok) manquants.push(`${q.titre} : ${i.libelle}`);
        });
        return;
      }
      const brute = etat.reponses[q.libelle];
      const vide = brute === undefined || brute === '';
      if (vide && (q.requis || q.type === 'niveau')) erreurs.push(q.libelle);
      if (q.type === 'kilometrage' && erreurKm(brute)) erreurs.push(`kilométrage ${erreurKm(brute).toLowerCase().replace(/\.$/, '')}`);
      if (q.type === 'fait') reponses[q.libelle] = brute === 'Fait' ? 'Fait' : '';
      else if (q.type === 'niveau' || q.type === 'kilometrage') reponses[q.libelle] = vide ? '' : Number(brute);
      else if (q.type === 'carburant') reponses[q.libelle] = vide ? '' : `${brute}/8`;
      else reponses[q.libelle] = vide ? '' : String(brute).trim();
    });
    return { vehicule: v.id, modele: modeleCourant(), reponses, erreurs, manquants };
  }

  /** Après un enregistrement réussi sur l'appareil : on efface le brouillon et on repart à zéro. */
  function terminer(saisie) {
    if (saisie && saisie.reponses.Kilométrage) {
      releves.fusionner({ [saisie.vehicule]: { km: saisie.reponses.Kilométrage, date: new Date().toISOString() } });
    }
    if (etat.vehicule) brouillons.effacer(etat.vehicule);
    etat.vehicule = null;
    etat.reponses = {};
    rendreVehicules();
    rendreQuestions();
  }

  /** Derniers kilométrages reçus du serveur. */
  function majReleves(nouveaux) {
    releves.fusionner(nouveaux);
    const champ = zoneQuestions && zoneQuestions.querySelector('.saisie-km');
    if (champ && document.activeElement !== champ) rendreQuestions();
  }

  function initialiser() {
    zoneVehicules = document.getElementById('vehicules');
    zoneQuestions = document.getElementById('questions');
    titre = document.getElementById('titre-vehicule');
    const cles = dependances();

    zoneQuestions.addEventListener('change', (e) => {
      enregistrerChamp(e.target);
      if (cles.has(e.target.dataset.cle)) rendreQuestions();
      signalerChangement();
    });
    zoneQuestions.addEventListener('input', (e) => {
      if (e.target.matches('input[type=range], input[inputmode], textarea')) {
        enregistrerChamp(e.target);
        signalerChangement();
      }
    });
    // Un simple appui sur le curseur, sans le déplacer, vaut aussi réponse.
    zoneQuestions.addEventListener('pointerup', (e) => {
      if (e.target.matches('input[type=range]')) enregistrerChamp(e.target);
    });
    rendreVehicules();
    rendreQuestions();
  }

  return { initialiser, afficher: () => { rendreVehicules(); rendreQuestions(); }, lire, terminer, majReleves };
})();
