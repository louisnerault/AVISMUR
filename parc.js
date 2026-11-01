/*
 * Tableau de bord du parc, sur ordinateur (menu « Véhicules », écran large).
 *  - à gauche : les cases véhicules empilées (mêmes couleurs et pictogrammes que la check-list) ;
 *  - au centre : par défaut, le tableau de tous les éléments des check-lists du jour, un véhicule par
 *    colonne (comme le Sheet « Check-list journalière véhicules SMUR ») ;
 *  - au clic sur un véhicule : sa fiche (5 dernières vérifications, cartographie des impacts et rayures,
 *    derniers pleins, dernières visites au garage).
 * Les données viennent d'Ambulancier (check-lists du jour, infos par véhicule) et de l'historique du
 * véhicule, gardé sur l'appareil pour rester consultable hors ligne.
 */
const Parc = (() => {
  const CLE_HISTO = 'smur_histo_vehicules';
  const NB = 5; // vérifications, pleins et passages au garage affichés dans la fiche
  let racine;
  let colonne;
  let centre;
  let appeler;
  let choisi = null; // identifiant du véhicule dont on voit la fiche ; null = tableau d'ensemble
  let histo = null; // historique du véhicule choisi : { id, entrees, date, etat }
  let jetonHisto = 0; // ignore la réponse d'un historique si l'on a changé de véhicule entre-temps

  // ---------- Utilitaires ----------
  const SVG = 'http://www.w3.org/2000/svg';
  function el(balise, attributs = {}, ...enfants) {
    const n = balise.startsWith('svg:') ? document.createElementNS(SVG, balise.slice(4)) : document.createElement(balise);
    Object.entries(attributs).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'texte') n.textContent = v;
      else if (k === 'classe') n.setAttribute('class', v);
      else if (k.startsWith('sur')) n.addEventListener(k.slice(3), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    n.append(...enfants.filter((e) => e !== null && e !== undefined && e !== false));
    return n;
  }

  const date = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const jour = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const km = (n) => `${Number(n).toLocaleString('fr-FR')} km`;
  const normaliser = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vehiculesActifs = () => VEHICULES.filter((v) => !v.inactif);
  const nomDe = (v) => v.nom || v.id;
  const typeDe = (v) => (v.type !== undefined ? v.type : (v.modele === 'F00' ? 'UMH' : v.modele));

  // ---------- Historique du véhicule (gardé pour le hors ligne) ----------
  function lireHistoriques() {
    try { return JSON.parse(localStorage.getItem(CLE_HISTO)) || {}; } catch (e) { return {}; }
  }

  /** Ne garde que ce que la fiche affiche (NB de chaque sorte) pour ne pas encombrer la mémoire de l'appareil. */
  function memoriserHistorique(id, entrees) {
    const compte = {};
    const garde = entrees.filter((e) => {
      compte[e.type] = (compte[e.type] || 0) + 1;
      return compte[e.type] <= NB;
    });
    const tous = lireHistoriques();
    tous[id] = { date: new Date().toISOString(), entrees: garde };
    try { localStorage.setItem(CLE_HISTO, JSON.stringify(tous)); } catch (e) { /* mémoire pleine : tant pis */ }
  }

  async function chargerHistorique(id) {
    jetonHisto += 1;
    const jeton = jetonHisto;
    const memoire = lireHistoriques()[id];
    histo = { id, entrees: memoire ? memoire.entrees : null, date: memoire ? memoire.date : null, etat: 'chargement' };
    rendreCentre();
    try {
      const rep = await appeler('historiqueVehicule', { vehicule: id });
      if (jeton !== jetonHisto) return;
      if (rep.ok && Array.isArray(rep.historique)) {
        histo = { id, entrees: rep.historique, date: new Date().toISOString(), etat: 'ok' };
        memoriserHistorique(id, rep.historique);
      } else {
        histo.etat = 'erreur';
      }
    } catch (e) {
      if (jeton !== jetonHisto) return;
      histo.etat = 'hors-ligne';
    }
    rendreCentre();
  }

  // ---------- Sélection ----------
  function selectionner(id) {
    if (choisi === id) { // un second clic sur le véhicule choisi revient au tableau d'ensemble
      retourEnsemble();
      return;
    }
    choisi = id;
    rendreColonne();
    chargerHistorique(id);
    centre.focus({ preventScroll: true });
  }

  function retourEnsemble() {
    choisi = null;
    histo = null;
    jetonHisto += 1;
    rendre();
  }

  // ---------- Colonne de gauche ----------
  function rendreColonne() {
    colonne.innerHTML = '';
    vehiculesActifs().forEach((v) => colonne.append(Ambulancier.creerCarte(v, {
      compacte: true, choisi: choisi === v.id, surClic: () => selectionner(v.id),
    })));
  }

  // ---------- Tableau d'ensemble ----------
  /** Questions qui ne sont pas des éléments à vérifier (réponses déduites ou techniques). */
  function clesIgnorees() {
    const ignorees = new Set();
    Object.values(MODELES).forEach((m) => m.questions.forEach((q) => {
      if (q.type === 'cache' || q.basculeF00) ignorees.add(normaliser(q.libelle));
    }));
    return ignorees;
  }

  /**
   * Lignes du tableau : tous les éléments rencontrés dans les check-lists du jour, dans l'ordre des
   * véhicules, regroupés par rubrique (« Poste de conduite [GPS] » → rubrique + élément).
   */
  function lignesTableau(vehicules) {
    const ignorees = clesIgnorees();
    const vus = new Set();
    const entrees = [];
    vehicules.forEach((v) => {
      const statut = Ambulancier.infosVehicule(v.id).statut;
      Object.keys((statut && statut.reponses) || {}).forEach((cle) => {
        const id = normaliser(cle);
        if (vus.has(id) || ignorees.has(id) || cle.startsWith('Position (')) return;
        vus.add(id);
        const m = /^(.*?)\s*\[(.*)\]$/.exec(cle);
        entrees.push({ id, section: m ? (m[1] || 'Équipement') : '', libelle: m ? m[2] : cle });
      });
    });
    // Les éléments d'une même rubrique se suivent, à la place de leur première apparition.
    const placees = new Set();
    const lignes = [];
    entrees.forEach((e) => {
      if (!e.section) { lignes.push(e); return; }
      if (placees.has(e.section)) return;
      placees.add(e.section);
      entrees.filter((x) => x.section === e.section).forEach((x) => lignes.push(x));
    });
    return lignes;
  }

  /** Contenu et style d'une cellule du tableau (OK, manquant, niveau bas, valeur…). */
  function cellule(libelle, valeur) {
    if (valeur === undefined) return { texte: '—', classe: 'na', titre: 'Non concerné' };
    if (valeur === '' || valeur === null) return { texte: '', classe: 'vide' };
    if (valeur === 'OK' || valeur === 'Fait') return { texte: '✓', classe: 'ok', titre: valeur };
    if (valeur === 'Manquant') return { texte: '✗', classe: 'mauvais', titre: 'Manquant' };
    if (typeof valeur === 'number') {
      if (/kilom/i.test(libelle)) return { texte: Number(valeur).toLocaleString('fr-FR'), classe: '', titre: km(valeur) };
      return { texte: `${valeur}/10`, classe: valeur <= SEUILS_ANOMALIE.obus ? 'mauvais' : '', titre: `${valeur * 20} bars` };
    }
    const texte = String(valeur);
    if (/^\d+\/8$/.test(texte)) return { texte, classe: parseInt(texte, 10) <= SEUILS_ANOMALIE.carburant ? 'mauvais' : '', titre: `Carburant ${texte}` };
    if (/non concern/i.test(texte)) return { texte: '—', classe: 'na', titre: texte };
    if (/ad-?blue/i.test(libelle)) return { texte: 'À compléter', classe: 'attention', titre: texte };
    return { texte: texte.length > 24 ? `${texte.slice(0, 22)}…` : texte, classe: /remarque/i.test(libelle) ? 'attention' : '', titre: texte };
  }

  function enteteVehicule(v, etatV) {
    let position = [];
    if (etatV.classe === 'indispo') position = ['Indisponible'];
    else if (Ambulancier.estDZ(etatV.position)) position = [Ambulancier.helico(), 'DZ'];
    else if (etatV.position && etatV.position.position) position = [etatV.position.position];
    const bouton = el('button', {
      type: 'button', classe: `parc-th-bouton ${etatV.classe}`, surclick: () => selectionner(v.id),
      title: `${nomDe(v)} : ${etatV.texte}. Afficher la fiche.`,
    }, el('strong', { texte: nomDe(v) }), el('small', { texte: typeDe(v) || ' ' }),
    el('span', { classe: 'parc-th-position' }, ...position));
    return el('th', { scope: 'col' }, bouton);
  }

  function rendreTableau() {
    const vehicules = vehiculesActifs();
    centre.innerHTML = '';
    if (!vehicules.length) {
      centre.append(el('p', { texte: 'Aucun véhicule configuré.' }));
      return;
    }
    const infos = vehicules.map((v) => ({ v, info: Ambulancier.infosVehicule(v.id), etatV: Ambulancier.etatVehicule(v) }));
    const classeColonne = (x) => (x.etatV.classe === 'indispo' ? ' col-indispo' : (x.info.statut ? '' : ' col-afaire'));
    const lignes = lignesTableau(vehicules);
    const colonnes = vehicules.length + 1;

    const tete = el('tr', {}, el('th', { classe: 'parc-libelle', scope: 'col', texte: 'Check-list du jour' }),
      ...infos.map((x) => enteteVehicule(x.v, x.etatV)));
    const corps = el('tbody');
    const ligne = (libelle, cellules, classe = '') => el('tr', { classe },
      el('th', { classe: 'parc-libelle', scope: 'row', texte: libelle }), ...cellules);
    const section = (titre) => el('tr', { classe: 'parc-section' }, el('th', { colspan: String(colonnes), scope: 'colgroup', texte: titre }));

    // Anomalies du jour
    corps.append(ligne('Anomalies du jour', infos.map((x) => {
      const liste = x.info.statut ? x.info.statut.anomalies : null;
      if (!liste) return el('td', { classe: `vide${classeColonne(x)}` });
      return liste.length
        ? el('td', { classe: `attention${classeColonne(x)}`, title: liste.join('\n'), texte: String(liste.length) })
        : el('td', { classe: `ok${classeColonne(x)}`, texte: '✓', title: 'Aucune anomalie' });
    }), 'parc-synthese'));

    // Éléments des check-lists
    let rubrique = null;
    lignes.forEach((l) => {
      if (l.section !== rubrique) {
        rubrique = l.section;
        corps.append(section(l.section || 'Général'));
      }
      corps.append(ligne(l.libelle, infos.map((x) => {
        const reponses = x.info.statut && x.info.statut.reponses;
        if (!reponses) return el('td', { classe: `vide${classeColonne(x)}` });
        const cle = Object.keys(reponses).find((k) => normaliser(k) === l.id);
        const c = cellule(l.libelle, cle === undefined ? undefined : reponses[cle]);
        return el('td', { classe: `${c.classe}${classeColonne(x)}`, title: c.titre, texte: c.texte });
      })));
    });
    if (!lignes.length) {
      corps.append(el('tr', {}, el('td', { colspan: String(colonnes), classe: 'parc-vide', texte: 'Aucune check-list faite aujourd\'hui pour l\'instant.' })));
    }

    // Suivi des véhicules
    corps.append(section('Suivi'));
    corps.append(ligne('Dernier plein', infos.map((x) => {
      const p = x.info.dernierPlein;
      return el('td', { classe: classeColonne(x).trim(), texte: x.v.sansPlein ? '—' : (p ? jour(p.date) : 'jamais'), title: p ? `${date(p.date)} · ${p.agent}` : '' });
    })));
    corps.append(ligne('Dernier garage', infos.map((x) => {
      const g = x.info.dernierGarage;
      return el('td', { classe: classeColonne(x).trim(), texte: x.v.sansGarage ? '—' : (g ? jour(g.date) : 'jamais'), title: g ? `${date(g.date)}${g.motif ? ` · ${g.motif}` : ''}` : '' });
    })));
    corps.append(ligne('Défauts de carrosserie connus', infos.map((x) => {
      const n = x.info.defauts.length;
      return el('td', { classe: `${n ? 'attention' : ''}${classeColonne(x)}`.trim(), texte: x.v.sansExterieur ? '—' : String(n) });
    })));

    centre.append(
      el('div', { classe: 'parc-tableau-zone', tabindex: '0', role: 'region', 'aria-label': 'Tableau des check-lists du jour' },
        el('table', { classe: 'parc-tableau' }, el('thead', {}, tete), corps)),
      el('p', { classe: 'aide-question parc-note', texte: 'Cliquez sur un véhicule (à gauche ou en tête de colonne) pour voir sa fiche.' }));
  }

  // ---------- Fiche d'un véhicule ----------
  /** Ajoute en tête l'enregistrement le plus récent connu de l'appareil s'il manque à l'historique. */
  function avecRecent(liste, candidat) {
    if (candidat && (!liste.length || new Date(candidat.date) - new Date(liste[0].date) > 60000)) return [candidat, ...liste];
    return liste;
  }

  function reponsesDe(cl) {
    const liste = el('dl', { classe: 'reponses' });
    Object.entries(cl.reponses || {}).forEach(([cle, valeur]) => {
      if (valeur === '' || valeur === null || cle.startsWith('Position (')) return;
      const manquant = valeur === 'Manquant';
      liste.append(el('div', { classe: `reponse${manquant ? ' manquant' : ''}` }, el('dt', { texte: cle }),
        el('dd', { texte: typeof valeur === 'number' && /obus|bouteille/i.test(cle) ? `${valeur}/10` : String(valeur) })));
    });
    return liste;
  }

  function blocVerifications(listeCL) {
    const bloc = el('section', { classe: 'parc-bloc' }, el('h2', { texte: `${NB} dernières vérifications` }));
    if (!listeCL.length) {
      bloc.append(el('p', { texte: 'Aucune check-list enregistrée pour ce véhicule.' }));
      return bloc;
    }
    const ul = el('ul', { classe: 'parc-verifs' });
    listeCL.slice(0, NB).forEach((cl, i) => {
      const r = cl.reponses || {};
      const anomalies = cl.anomalies || [];
      const resume = [r.Kilométrage ? km(r.Kilométrage) : '', r.Carburant ? `carburant ${r.Carburant}` : ''].filter(Boolean).join(' · ');
      const corps = [];
      if (anomalies.length) corps.push(el('div', { classe: 'note-parc anomalie' }, el('p', { texte: 'Anomalies :' }), el('ul', {}, ...anomalies.map((a) => el('li', { texte: a })))));
      corps.push(reponsesDe(cl));
      ul.append(el('li', {}, el('details', { open: i === 0 },
        el('summary', {},
          el('span', { classe: `pastille-etat ${anomalies.length ? 'anomalie' : 'fait'}`, 'aria-hidden': 'true' }),
          el('strong', { texte: date(cl.date) }), el('span', { texte: cl.agent || '' }),
          el('span', { classe: 'parc-resume', texte: resume }),
          el('span', { classe: anomalies.length ? 'parc-badge attention' : 'parc-badge ok', texte: anomalies.length ? `${anomalies.length} anomalie${anomalies.length > 1 ? 's' : ''}` : 'sans anomalie' })),
        ...corps)));
    });
    bloc.append(ul);
    return bloc;
  }

  /** Cartographie des défauts connus (non réparés), face par face. */
  function blocImpacts(v, info) {
    const bloc = el('section', { classe: 'parc-bloc' }, el('h2', { texte: 'Cartographie des impacts et rayures extérieurs' }));
    if (v.sansExterieur) {
      bloc.append(el('p', { texte: 'Ce véhicule n\'a pas de vérification extérieure.' }));
      return bloc;
    }
    const verif = info.derniereVerifExterieure;
    bloc.append(el('p', { classe: 'aide-question', texte: verif
      ? `Dernière vérification extérieure : ${date(verif.date)}${verif.agent ? ` par ${verif.agent}` : ''}. ${info.defauts.length ? `${info.defauts.length} défaut${info.defauts.length > 1 ? 's' : ''} connu${info.defauts.length > 1 ? 's' : ''}.` : 'Aucun défaut connu.'}`
      : 'Aucune vérification extérieure enregistrée.' }));
    const grille = el('div', { classe: 'parc-faces' });
    Object.entries(Actions.FACES).forEach(([face, libelle]) => {
      const defauts = info.defauts.filter((d) => d.face === face);
      const cote = face === 'gauche' || face === 'droite';
      const schema = el('div', { classe: `schema schema-${cote ? 'cote' : 'face'} parc-schema` }, Actions.silhouette(face));
      defauts.forEach((d, i) => schema.append(el('span', {
        classe: 'marque connu', style: `left:${d.x * 100}%;top:${d.y * 100}%`, title: d.commentaire || 'Sans description', texte: String(i + 1),
      })));
      const liste = el('ol', { classe: 'parc-defauts' });
      defauts.forEach((d) => {
        const photo = el('div', { classe: 'photo-defaut' });
        const item = el('li', {}, el('span', { texte: `${d.commentaire || 'Sans description'} — ${jour(d.date)}${d.agent ? `, ${d.agent}` : ''}` }));
        if (d.photoLocale) photo.append(el('img', { classe: 'photo-apercu', alt: 'Photo du défaut', src: d.photoLocale }));
        else if (d.photo) item.append(' ', el('button', { type: 'button', classe: 'lien', texte: 'Voir la photo', surclick: () => Actions.afficherPhotoServeur(photo, d.photo) }));
        item.append(photo);
        liste.append(item);
      });
      grille.append(el('figure', { classe: 'parc-face' }, el('figcaption', { texte: defauts.length ? `${libelle} (${defauts.length})` : libelle }), schema,
        defauts.length ? liste : el('p', { classe: 'aide-question', texte: 'Rien à signaler.' })));
    });
    bloc.append(grille);
    return bloc;
  }

  function blocEvenements(titre, icone, liste, vide, resume) {
    const bloc = el('section', { classe: 'parc-bloc' }, el('h2', { texte: titre }));
    if (!liste.length) {
      bloc.append(el('p', { texte: vide }));
      return bloc;
    }
    const ul = el('ul', { classe: 'historique' });
    liste.slice(0, NB).forEach((e) => ul.append(el('li', { classe: 'entree' },
      el('span', { classe: 'entree-titre' }, el('strong', { texte: `${icone} ${date(e.date)}` }), el('span', { texte: e.agent || '' })),
      el('span', { classe: 'entree-resume', texte: resume(e.detail || {}) }))));
    bloc.append(ul);
    return bloc;
  }

  function avisHistorique() {
    if (!histo) return null;
    const quand = histo.date ? date(histo.date) : '';
    if (histo.etat === 'chargement') return histo.entrees ? `Mise à jour de l'historique… (dernière copie : ${quand})` : 'Chargement de l\'historique…';
    if (histo.etat === 'hors-ligne' || histo.etat === 'erreur') {
      return histo.entrees
        ? `Hors ligne : historique de l'appareil, mis à jour le ${quand}.`
        : 'Hors ligne : historique complet indisponible, seuls les derniers éléments connus de cet appareil sont affichés.';
    }
    return null;
  }

  function rendreDetail() {
    const v = vehiculesActifs().find((x) => x.id === choisi);
    if (!v) {
      retourEnsemble();
      return;
    }
    const info = Ambulancier.infosVehicule(v.id);
    const etatV = Ambulancier.etatVehicule(v);
    const entrees = (histo && histo.entrees) || [];
    const dePlein = (p) => (p ? { date: p.date, agent: p.agent, detail: { carburant: p.carburant, km: p.km, adblue: p.adblue } } : null);
    const deGarage = (g) => (g ? { date: g.date, agent: g.agent, detail: { motif: g.motif, commentaire: g.commentaire } } : null);

    const verifs = avecRecent(entrees.filter((e) => e.type === 'checklist'), info.derniereCL);
    const pleins = avecRecent(entrees.filter((e) => e.type === 'plein'), dePlein(info.dernierPlein));
    const garages = avecRecent(entrees.filter((e) => e.type === 'garage'), deGarage(info.dernierGarage));

    centre.innerHTML = '';
    const resumeEtat = [etatV.texte, etatV.classe !== 'indispo' && etatV.position && etatV.position.position ? `position du jour : ${etatV.position.position}` : ''].filter(Boolean).join(' · ');
    centre.append(el('div', { classe: 'parc-entete' },
      el('div', {}, el('h2', { classe: 'parc-titre' }, nomDe(v), el('small', { texte: typeDe(v) })),
        el('p', { classe: `parc-etat ${etatV.classe}`, texte: resumeEtat })),
      el('div', { classe: 'parc-boutons' },
        el('button', { type: 'button', classe: 'cfg-bouton', texte: '← Vue d\'ensemble', surclick: retourEnsemble }),
        el('button', { type: 'button', classe: 'cfg-bouton', texte: 'Actions du véhicule…', 'aria-haspopup': 'dialog', surclick: () => Actions.ouvrir(v, info, etatV) }))));
    const avis = avisHistorique();
    if (avis) centre.append(el('p', { classe: 'avis-parc', role: 'status', texte: avis }));
    centre.append(
      blocVerifications(verifs),
      blocImpacts(v, info),
      v.sansPlein ? null : blocEvenements('Derniers pleins', '⛽', pleins, 'Aucun plein enregistré pour ce véhicule.',
        (d) => [d.km ? km(d.km) : '', d.carburant !== undefined && d.carburant !== '' ? `carburant ${d.carburant}/8` : '', d.adblue ? 'AdBlue complété' : '', d.commentaire].filter(Boolean).join(' · ')),
      v.sansGarage ? null : blocEvenements('Dernières visites au garage', '🔧', garages, 'Aucun passage au garage enregistré pour ce véhicule.',
        (d) => [d.motif, d.commentaire].filter(Boolean).join(' · ')));
  }

  // ---------- Affichage ----------
  function rendreCentre() {
    if (!racine || racine.hidden) return;
    if (choisi) rendreDetail();
    else rendreTableau();
  }

  function rendre() {
    if (!racine || racine.hidden) return;
    rendreColonne();
    rendreCentre();
  }

  function afficher() {
    racine.hidden = false;
    rendre();
    if (choisi) chargerHistorique(choisi);
  }

  function masquer() {
    if (racine) racine.hidden = true;
  }

  function initialiser(options) {
    appeler = options.appeler;
    racine = document.getElementById('vue-parc');
    colonne = document.getElementById('parc-liste');
    centre = document.getElementById('parc-centre');
    // Check-lists, pleins, garage… : les données ont changé, on redessine sans toucher à l'historique.
    document.addEventListener('parc-maj', rendre);
  }

  return { initialiser, afficher, masquer };
})();
