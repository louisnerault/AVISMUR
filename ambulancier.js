/*
 * Écran de la check-list ambulancier : choix du véhicule puis questions du modèle
 * (VML, UMH ou F00) décrit dans checklists.js.
 * Les réponses sont gardées en brouillon sur l'appareil jusqu'à l'enregistrement :
 * un départ en intervention au milieu de la vérification ne fait rien perdre.
 */
const Ambulancier = (() => {
  const CLE_BROUILLONS = 'smur_brouillons_ambulancier';
  const etat = { vehicule: null, reponses: {} };
  let zoneVehicules;
  let zoneQuestions;
  let titre;

  const aujourdhui = () => new Date().toLocaleDateString('fr-CA'); // AAAA-MM-JJ, heure locale

  // ---------- Brouillons (un par véhicule, valables le jour même) ----------
  const brouillons = {
    tous() {
      try { return JSON.parse(localStorage.getItem(CLE_BROUILLONS)) || {}; } catch (e) { return {}; }
    },
    lire(vehicule) {
      const b = this.tous()[vehicule];
      return b && b.date === aujourdhui() ? b.reponses : {};
    },
    ecrire(vehicule, reponses) {
      const tous = this.tous();
      tous[vehicule] = { date: aujourdhui(), reponses };
      try { localStorage.setItem(CLE_BROUILLONS, JSON.stringify(tous)); } catch (e) { /* mémoire pleine : tant pis pour le brouillon */ }
    },
    effacer(vehicule) {
      const tous = this.tous();
      delete tous[vehicule];
      try { localStorage.setItem(CLE_BROUILLONS, JSON.stringify(tous)); } catch (e) { /* idem */ }
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

  const visible = (q) => !q.si || etat.reponses[q.si.question] === q.si.valeur;
  const elementsDuGroupe = (g) => g.items.map((i) => (typeof i === 'string' ? { libelle: i } : i));
  const cleElement = (g, i) => i.colonne || `${g.titre} [${i.libelle}]`;

  /** Libellés dont la réponse change les questions affichées. */
  function dependances() {
    const cles = new Set([questionBascule().libelle]);
    Object.values(MODELES).forEach((m) => m.questions.forEach((q) => { if (q.si) cles.add(q.si.question); }));
    return cles;
  }

  // ---------- Affichage ----------
  function el(balise, attributs = {}, ...enfants) {
    const n = document.createElement(balise);
    Object.entries(attributs).forEach(([k, v]) => {
      if (k === 'texte') n.textContent = v;
      else if (k === 'classe') n.className = v;
      else n.setAttribute(k, v);
    });
    n.append(...enfants);
    return n;
  }

  let compteur = 0;
  const nouvelId = () => `q${(compteur += 1)}`;

  function puces(cle, options, legende, aide) {
    const nom = nouvelId();
    const fs = el('fieldset', { classe: 'question' }, el('legend', { texte: legende }));
    if (aide) fs.append(el('p', { classe: 'aide-question', texte: aide }));
    const groupe = el('div', { classe: 'puces' });
    options.forEach((option) => {
      const id = nouvelId();
      const radio = el('input', { type: 'radio', name: nom, id, value: String(option), 'data-cle': cle });
      if (String(etat.reponses[cle]) === String(option)) radio.checked = true;
      groupe.append(radio, el('label', { for: id, texte: String(option) }));
    });
    fs.append(groupe);
    return fs;
  }

  function caseACocher(cle, libelle, valeurCochee) {
    const caseEl = el('input', { type: 'checkbox', 'data-cle': cle, 'data-valeur': valeurCochee });
    caseEl.checked = etat.reponses[cle] === valeurCochee;
    return el('li', {}, el('label', {}, caseEl, el('span', { texte: libelle })));
  }

  function rendreQuestion(q) {
    switch (q.type) {
      case 'niveau':
        return puces(q.libelle, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], q.libelle, '10 = plein (200 bars)');
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
      case 'nombre': {
        const id = nouvelId();
        const champ = el('input', { id, inputmode: 'numeric', autocomplete: 'off', 'data-cle': q.libelle, classe: 'saisie-km' });
        champ.value = etat.reponses[q.libelle] || '';
        return el('div', { classe: 'champ question' }, el('label', { for: id, texte: q.libelle }), champ);
      }
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
    } else {
      const valeur = champ.classList.contains('saisie-km') ? champ.value.replace(/\D/g, '').slice(0, 7) : champ.value;
      if (champ.value !== valeur) champ.value = valeur;
      if (valeur) etat.reponses[cle] = valeur;
      else delete etat.reponses[cle];
    }
    brouillons.ecrire(etat.vehicule, etat.reponses);
  }

  // Prévient app.js qu'une réponse a changé (pour annuler une demande de confirmation).
  const signalerChangement = () => zoneQuestions.dispatchEvent(new CustomEvent('reponse', { bubbles: true }));

  // ---------- Lecture pour l'envoi ----------

  /**
   * Réponses dans l'ordre des questions affichées.
   * Éléments : « OK » ou « Manquant ». Niveaux et kilométrage : nombres.
   */
  function lire() {
    const v = vehicule();
    if (!v) return { erreurs: ['véhicule vérifié'], manquants: [] };
    const reponses = {};
    const erreurs = [];
    const manquants = [];
    questionsCourantes().filter(visible).forEach((q) => {
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
      if (q.type === 'fait') reponses[q.libelle] = brute === 'Fait' ? 'Fait' : '';
      else if (q.type === 'niveau' || q.type === 'nombre') reponses[q.libelle] = vide ? '' : Number(brute);
      else reponses[q.libelle] = vide ? '' : String(brute).trim();
    });
    return { vehicule: v.id, modele: modeleCourant(), reponses, erreurs, manquants };
  }

  /** Après un enregistrement réussi sur l'appareil : on efface le brouillon et on repart à zéro. */
  function terminer() {
    if (etat.vehicule) brouillons.effacer(etat.vehicule);
    etat.vehicule = null;
    etat.reponses = {};
    rendreVehicules();
    rendreQuestions();
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
      if (e.target.matches('input:not([type]), input[inputmode], textarea')) {
        enregistrerChamp(e.target);
        signalerChangement();
      }
    });
    rendreVehicules();
    rendreQuestions();
  }

  return { initialiser, afficher: () => { rendreVehicules(); rendreQuestions(); }, lire, terminer };
})();
