// Items fictifs pour le prototype IADE. La check-list ambulancier est dans checklists.js.
const ITEMS_FICTIFS = {
  iade: ['Exemple : température frigo relevée', 'Exemple : chariot d\'urgence scellé'],
};

const ECRANS = ['ecran-connexion', 'ecran-sms', 'ecran-code', 'ecran-mdp', 'ecran-checklist'];
const $ = (id) => document.getElementById(id);
const ERREUR_RESEAU = 'Le serveur ne répond pas. Vérifiez la connexion internet puis réessayez. Si le problème continue, prévenez l\'administrateur.';

// État du parcours de première connexion (en mémoire uniquement).
const parcours = { cri: '', jetonCreation: '' };

// Session courte : vit le temps de l'onglet. Fermer l'application = se reconnecter,
// sauf si « Rester connecté sur ce téléphone » a été coché (jeton d'appareil ci-dessous).
const session = {
  lire() {
    try { return JSON.parse(sessionStorage.getItem('smur_session')); } catch (e) { return null; }
  },
  ecrire(valeur) {
    try { sessionStorage.setItem('smur_session', JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ }
  },
  effacer() {
    try { sessionStorage.removeItem('smur_session'); } catch (e) { /* stockage indisponible */ }
  },
};

// « Rester connecté » : jeton d'appareil durable, gardé sur le téléphone (30 jours sans utilisation).
const CLE_APPAREIL = 'avismur_appareil';
const appareil = {
  lire() {
    try { return JSON.parse(localStorage.getItem(CLE_APPAREIL)); } catch (e) { return null; }
  },
  ecrire(valeur) {
    try { localStorage.setItem(CLE_APPAREIL, JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ }
  },
  effacer() {
    try { localStorage.removeItem(CLE_APPAREIL); } catch (e) { /* stockage indisponible */ }
  },
};

async function requete(action, charge) {
  // text/plain évite la requête de pré-vérification CORS, non supportée par Apps Script.
  const actuelle = session.lire();
  const r = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, jeton: actuelle && actuelle.jeton, ...charge }),
  });
  return r.json();
}

/** Ouvre une nouvelle session à partir du jeton d'appareil. Lève une erreur si le réseau manque. */
async function reprendreSession() {
  const enregistre = appareil.lire();
  if (!enregistre) return false;
  const rep = await requete('reprendre', { jetonAppareil: enregistre.jetonAppareil });
  if (rep.ok) {
    session.ecrire({ jeton: rep.jeton, identifiant: rep.identifiant, role: rep.role });
    appareil.ecrire({ ...enregistre, identifiant: rep.identifiant, role: rep.role });
    return true;
  }
  if (rep.oublierAppareil) appareil.effacer();
  return false;
}

async function appeler(action, charge = {}) {
  let rep = await requete(action, charge);
  // Session courte expirée : on la renouvelle avec le jeton d'appareil, puis on rejoue la requête.
  if (rep.reconnecter && await reprendreSession()) rep = await requete(action, charge);
  if (rep.reconnecter) {
    session.effacer();
    afficher('ecran-connexion', 'Session expirée, reconnectez-vous.');
  }
  return rep;
}

/** Après une connexion réussie : garde ou oublie l'appareil selon la case cochée. */
function memoriserAppareil(rep, resterConnecte) {
  if (resterConnecte && rep.jetonAppareil) {
    appareil.ecrire({ jetonAppareil: rep.jetonAppareil, identifiant: rep.identifiant, role: rep.role });
  } else {
    appareil.effacer();
  }
}

/** Affiche un écran et, éventuellement, un message d'erreur dans cet écran. */
function afficher(idEcran, erreur = '') {
  ECRANS.forEach((id) => { $(id).hidden = id !== idEcran; });
  const connecte = idEcran === 'ecran-checklist';
  $('utilisateur').hidden = !connecte;
  $('menu').hidden = !connecte;
  document.body.classList.toggle('connecte', connecte);
  const zone = $(idEcran).querySelector('.erreur');
  if (zone) zone.textContent = erreur;
  const champ = $(idEcran).querySelector('input');
  if (champ) champ.focus();
}

function message(idEcran, texte) {
  $(idEcran).querySelector('.erreur').textContent = texte;
}

function afficherApplication(infos) {
  const jeton = infos.jeton || (session.lire() || {}).jeton;
  if (jeton) session.ecrire({ jeton, identifiant: infos.identifiant, role: infos.role });
  afficher('ecran-checklist');
  $('nom-utilisateur').textContent = `${infos.identifiant} (${infos.role})`;
  roleCourant = infos.role;
  // Véhicules : réservé aux ambulanciers et à l'encadrement (l'IADE n'a pas de véhicule).
  $('menu-vehicules').hidden = infos.role === 'iade';
  // Écran de configuration des véhicules et des check-lists : administrateurs seulement.
  $('option-config').hidden = infos.role !== 'admin';
  $('option-config').disabled = infos.role !== 'admin';
  if ($('liste').value === 'config' && infos.role !== 'admin') $('liste').value = 'ambulancier';
  ouvrirVue('aujourdhui');
  envoyerFileAttente();
  chargerConfig();
  chargerReleves();
}

/** Configuration des véhicules et des questions, si un administrateur l'a modifiée. */
async function chargerConfig() {
  const fin = chargement.debut('Chargement de la configuration…');
  try {
    const rep = await appeler('lireConfig');
    if (!rep.ok) return;
    majConfig(rep.configuration ? rep.configuration.config : null);
  } catch (err) { /* hors ligne : on garde la configuration enregistrée sur l'appareil */ } finally {
    fin();
  }
}

function majConfig(config) {
  const nouvelle = config ? JSON.stringify(config) : null;
  if (nouvelle === localStorage.getItem(CLE_CONFIG)) return;
  try {
    if (nouvelle) localStorage.setItem(CLE_CONFIG, nouvelle);
    else localStorage.removeItem(CLE_CONFIG);
  } catch (e) { /* stockage plein : la configuration s'applique quand même pour cette session */ }
  appliquerConfig(config);
  if ($('liste').value === 'ambulancier') Ambulancier.afficher();
}

/** Derniers kilométrages et état du parc du jour, gardés sur l'appareil pour le hors ligne. */
async function chargerReleves() {
  const fin = chargement.debut('Chargement des véhicules et des check-lists du jour…');
  try {
    const rep = await appeler('derniersReleves');
    if (rep.ok) Ambulancier.majReleves(rep.releves, rep.parc, rep.statuts, fileAttente.lire());
  } catch (err) { /* hors ligne : on garde les derniers relevés connus */ } finally {
    fin();
    Ambulancier.finChargement();
  }
}

/**
 * Animation de chargement (tracé ECG) pendant les échanges avec le serveur.
 * Plusieurs chargements peuvent se chevaucher : on affiche le message du plus récent
 * et on cache l'animation quand tous sont terminés.
 */
const chargement = (() => {
  const enCours = [];
  const afficher = () => {
    const zone = $('chargement');
    zone.hidden = enCours.length === 0;
    if (enCours.length) $('chargement-texte').textContent = enCours[enCours.length - 1].texte;
  };
  return {
    debut(texte) {
      const tache = { texte };
      enCours.push(tache);
      afficher();
      let termine = false;
      return () => {
        if (termine) return;
        termine = true;
        enCours.splice(enCours.indexOf(tache), 1);
        afficher();
      };
    },
  };
})();

// ---------- File d'attente hors ligne ----------
// Chaque check-list est d'abord gardée sur l'appareil, puis envoyée au serveur.
// Une entrée n'est retirée qu'après une réponse « ok » du serveur.
const CLE_FILE = 'smur_file_attente';
let envoiEnCours = false;

const fileAttente = {
  lire() {
    try { return JSON.parse(localStorage.getItem(CLE_FILE)) || []; } catch (e) { return []; }
  },
  ecrire(elements) {
    localStorage.setItem(CLE_FILE, JSON.stringify(elements));
  },
};

function identifiantUnique() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Envoie les check-lists en attente, dans l'ordre de saisie. Relancée à chaque reconnexion. */
async function envoyerFileAttente() {
  if (envoiEnCours) return;
  envoiEnCours = true;
  const nb = fileAttente.lire().length;
  const fin = nb ? chargement.debut(nb > 1 ? `Envoi de ${nb} check-lists…` : 'Envoi de la check-list…') : () => {};
  let envoyees = 0;
  let erreurServeur = '';
  let avertissement = '';
  const refusees = new Set();
  try {
    let suivante;
    while ((suivante = fileAttente.lire().find((e) => !refusees.has(e.id)))) {
      let rep;
      try {
        rep = await appeler('saveChecklist', {
          liste: suivante.liste,
          items: suivante.items,
          vehicule: suivante.vehicule,
          modele: suivante.modele,
          modeleBase: suivante.base,
          anomalies: suivante.anomalies,
          idSaisie: suivante.id,
          dateSaisie: suivante.date,
        });
      } catch (err) {
        marquerReseau(false);
        break; // réseau coupé : on garde tout et on réessaiera au retour du réseau
      }
      marquerReseau(true);
      if (rep.reconnecter) break; // session expirée : les entrées restent, envoyées après reconnexion
      if (rep.ok) {
        fileAttente.ecrire(fileAttente.lire().filter((e) => e.id !== suivante.id));
        envoyees += 1;
        if (rep.avertissement) avertissement = rep.avertissement;
      } else {
        refusees.add(suivante.id);
        erreurServeur = rep.erreur || 'refus du serveur';
      }
    }
  } finally {
    envoiEnCours = false;
    fin();
  }
  if (envoyees) chargerReleves();
  bilanEnvoi({ envoyees, restantes: fileAttente.lire().length, erreurServeur, avertissement });
}

function bilanEnvoi({ envoyees, restantes, erreurServeur, avertissement }) {
  const pieces = [];
  if (envoyees) pieces.push(`${envoyees} check-list(s) envoyée(s) au serveur.`);
  if (restantes) pieces.push(`${restantes} check-list(s) gardée(s) sur cet appareil, en attente d'envoi.`);
  if (erreurServeur) pieces.push(`Refusée par le serveur : ${erreurServeur}`);
  // Check-list bien enregistrée, mais l'ancien Sheet n'a pas suivi : à signaler à l'administrateur.
  if (avertissement) pieces.push(`Attention : ${avertissement}.`);
  if (!pieces.length) return;
  $('statut').textContent = pieces.join(' ');
  $('statut').className = erreurServeur || avertissement ? 'message erreur' : (restantes ? 'message' : 'message succes');
}

/** Envoie une requête depuis un formulaire en gérant l'attente et les erreurs réseau. */
async function soumettre(idEcran, action, charge) {
  const bouton = $(idEcran).querySelector('button[type="submit"]');
  bouton.disabled = true;
  message(idEcran, 'Patientez…');
  try {
    const rep = await appeler(action, charge);
    message(idEcran, rep.ok ? '' : rep.erreur);
    return rep;
  } catch (err) {
    message(idEcran, ERREUR_RESEAU);
    return { ok: false };
  } finally {
    bouton.disabled = false;
  }
}

// Liens de navigation entre les écrans de connexion.
document.querySelectorAll('[data-aller]').forEach((lien) => {
  lien.addEventListener('click', () => {
    if (lien.dataset.aller === 'ecran-sms' && /^\d{6}$/.test($('cri').value || parcours.cri)) {
      $('cri-sms').value = parcours.cri || $('cri').value;
    }
    afficher(lien.dataset.aller);
  });
});

// Connexion habituelle : CRI + mot de passe.
$('ecran-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resterConnecte = $('rester-connecte').checked;
  const rep = await soumettre('ecran-connexion', 'login', { cri: $('cri').value.trim(), motDePasse: $('mdp').value, resterConnecte });
  $('mdp').value = '';
  if (!rep.ok) return;
  memoriserAppareil(rep, resterConnecte);
  afficherApplication(rep);
});

// Étape 1 : demande du SMS.
$('ecran-sms').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cri = $('cri-sms').value.trim();
  const rep = await soumettre('ecran-sms', 'demanderCode', { cri });
  if (!rep.ok) return;
  parcours.cri = cri;
  afficher('ecran-code');
  $('ecran-code').querySelector('.info').textContent = rep.message;
});

// Étape 2 : vérification du code SMS.
$('ecran-code').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rep = await soumettre('ecran-code', 'verifierCode', { cri: parcours.cri, code: $('code-sms').value.trim() });
  $('code-sms').value = '';
  if (!rep.ok) return;
  parcours.jetonCreation = rep.jetonCreation;
  afficher('ecran-mdp');
});

// Étape 3 : création du mot de passe.
$('ecran-mdp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mdp = $('nouveau-mdp').value;
  if (mdp !== $('confirmation-mdp').value) {
    message('ecran-mdp', 'Les deux mots de passe ne correspondent pas.');
    return;
  }
  const resterConnecte = $('rester-connecte-mdp').checked;
  const rep = await soumettre('ecran-mdp', 'definirMotDePasse', { jetonCreation: parcours.jetonCreation, motDePasse: mdp, resterConnecte });
  if (rep.recommencer) {
    afficher('ecran-sms', rep.erreur);
    return;
  }
  if (!rep.ok) return;
  $('nouveau-mdp').value = '';
  $('confirmation-mdp').value = '';
  parcours.cri = '';
  parcours.jetonCreation = '';
  memoriserAppareil(rep, resterConnecte);
  afficherApplication(rep);
});

// Champs numériques : on ne garde que les chiffres.
document.querySelectorAll('.saisie-chiffres').forEach((champ) => {
  champ.addEventListener('input', () => {
    const chiffres = champ.value.replace(/\D/g, '').slice(0, 6);
    if (champ.value !== chiffres) champ.value = chiffres;
  });
});

// Le code SMS est validé dès que les 6 chiffres sont saisis.
$('code-sms').addEventListener('input', () => {
  if ($('code-sms').value.length === 6) $('ecran-code').requestSubmit();
});

// Boutons « Afficher / Masquer » des mots de passe.
document.querySelectorAll('.voir').forEach((bouton) => {
  bouton.addEventListener('click', () => {
    const champ = $(bouton.dataset.cible);
    const visible = champ.type === 'password';
    champ.type = visible ? 'text' : 'password';
    bouton.textContent = visible ? 'Masquer' : 'Afficher';
    bouton.setAttribute('aria-pressed', String(visible));
    champ.focus();
  });
});

$('deconnexion').addEventListener('click', async () => {
  const enregistre = appareil.lire();
  try {
    await requete('logout', { jetonAppareil: enregistre && enregistre.jetonAppareil });
  } catch (err) { /* déconnexion locale quand même */ }
  session.effacer();
  appareil.effacer();
  afficher('ecran-connexion');
});

// ---------- Check-lists ----------

function afficherListe(liste) {
  const config = liste === 'config';
  $('zone-ambulancier').hidden = liste !== 'ambulancier';
  $('items').hidden = liste === 'ambulancier' || config;
  $('zone-config').hidden = !config;
  document.querySelector('.envoi').hidden = config;
  if (config) ConfigAdmin.ouvrir();
  else if (liste === 'ambulancier') Ambulancier.afficher();
  else afficherItems(liste);
  annulerConfirmation();
}

function afficherItems(liste) {
  const ul = $('items');
  ul.innerHTML = '';
  ITEMS_FICTIFS[liste].forEach((texte) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const caseACocher = document.createElement('input');
    caseACocher.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = texte;
    label.append(caseACocher, span);
    li.appendChild(label);
    ul.appendChild(li);
  });
}

function lireCoches() {
  return [...document.querySelectorAll('#items input')].map((c) => c.checked);
}

function statut(texte, classe = '') {
  $('statut').textContent = texte;
  $('statut').className = `message ${classe}`.trim();
}

// Éléments non cochés : on demande une confirmation avant d'envoyer.
let confirmationDemandee = false;
function annulerConfirmation() {
  if (!confirmationDemandee) return;
  confirmationDemandee = false;
  $('enregistrer').textContent = 'Enregistrer la check-list';
  statut('');
}

/** Garde la check-list sur l'appareil puis lance l'envoi. */
function mettreEnFile(saisie) {
  try {
    const elements = fileAttente.lire();
    elements.push({ id: identifiantUnique(), date: new Date().toISOString(), ...saisie });
    fileAttente.ecrire(elements);
  } catch (err) {
    statut('Check-list non enregistrée : la mémoire de l\'appareil est pleine.', 'erreur');
    return false;
  }
  statut('Enregistrement…');
  envoyerFileAttente();
  return true;
}

function enregistrerAmbulancier() {
  const saisie = Ambulancier.lire();
  if (saisie.erreurs.length) {
    statut(`À compléter : ${saisie.erreurs.join(', ')}.`, 'erreur');
    return;
  }
  if (saisie.manquants.length && !confirmationDemandee) {
    confirmationDemandee = true;
    statut(`Non coché (sera noté manquant) : ${saisie.manquants.join(' ; ')}. Cochez-les ou appuyez de nouveau pour envoyer quand même.`, 'erreur');
    $('enregistrer').textContent = 'Envoyer quand même';
    return;
  }
  const ok = mettreEnFile({
    liste: 'ambulancier', vehicule: saisie.vehicule, modele: saisie.modele, base: saisie.base, items: saisie.reponses, anomalies: saisie.anomalies,
    agent: (session.lire() || {}).identifiant,
  });
  if (!ok) return;
  confirmationDemandee = false;
  $('enregistrer').textContent = 'Enregistrer la check-list';
  Ambulancier.terminer(saisie, (session.lire() || {}).identifiant);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Menu principal ----------
// Une vue par entrée du menu. « Aujourd'hui » : check-list du jour (liste choisie selon le rôle).
// « Véhicules » : même écran, avec l'ambulancier forcé et le choix de véhicule en tête.
// « Plus » : configuration (admin) et déconnexion. Pour une nouvelle fonctionnalité, voir README.md.
let roleCourant = '';

function ouvrirVue(vue) {
  if (vue === 'vehicules' && roleCourant === 'iade') vue = 'aujourdhui';
  document.querySelectorAll('[data-vue]').forEach((bouton) => {
    if (bouton.dataset.vue === vue) bouton.setAttribute('aria-current', 'page');
    else bouton.removeAttribute('aria-current');
  });
  const metier = roleCourant === 'ambulancier' || roleCourant === 'iade';
  const plus = vue === 'plus';
  $('vue-plus').hidden = !plus;
  if (plus) {
    $('lien-configuration').hidden = roleCourant !== 'admin';
    ['zone-ambulancier', 'zone-config', 'items', 'choix-liste'].forEach((id) => { $(id).hidden = true; });
    document.querySelector('.envoi').hidden = true;
    return;
  }
  $('choix-liste').hidden = metier || vue === 'vehicules';
  if (vue === 'vehicules') $('liste').value = 'ambulancier';
  else if (metier) $('liste').value = roleCourant;
  afficherListe($('liste').value);
  if (vue === 'vehicules') $('vehicules').scrollIntoView({ block: 'start' });
}

document.querySelectorAll('[data-vue]').forEach((bouton) => {
  bouton.addEventListener('click', () => ouvrirVue(bouton.dataset.vue));
});

$('vue-plus').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'configuration') {
    ouvrirVue('aujourdhui');
    $('liste').value = 'config';
    afficherListe('config');
  }
  if (action.dataset.action === 'deconnexion') $('deconnexion').click();
});

$('liste').addEventListener('change', (e) => afficherListe(e.target.value));
$('zone-ambulancier').addEventListener('reponse', annulerConfirmation);
Ambulancier.initialiser();
ConfigAdmin.initialiser({ appeler, surEnregistrement: majConfig });

$('enregistrer').addEventListener('click', () => {
  if ($('liste').value === 'ambulancier') {
    enregistrerAmbulancier();
    return;
  }
  mettreEnFile({ liste: $('liste').value, items: lireCoches() });
});

// ---------- Indicateur hors ligne ----------
// Affiché tant que le réseau (Wi-Fi ou GSM) n'est pas disponible. navigator.onLine peut rester
// vrai sans accès réel : un échec d'envoi passe aussi l'indicateur en « hors ligne ».
function marquerReseau(disponible) {
  $('hors-ligne').hidden = disponible;
}

marquerReseau(navigator.onLine);
window.addEventListener('online', () => { marquerReseau(true); envoyerFileAttente(); });
window.addEventListener('offline', () => marquerReseau(false));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* PWA hors ligne indisponible */ });
}

// Au chargement : reprendre la session si elle est encore valide, sinon le jeton d'appareil
// (« rester connecté »). Hors ligne, on reprend l'utilisateur connu ; la saisie reste possible.
(async () => {
  const actuelle = session.lire() || appareil.lire();
  if (!actuelle) return afficher('ecran-connexion');
  try {
    const rep = await appeler('ping');
    marquerReseau(true);
    if (rep.ok) afficherApplication(rep);
  } catch (err) {
    marquerReseau(false);
    afficherApplication(actuelle);
    $('statut').textContent = 'Mode hors ligne : les check-lists seront envoyées au retour du réseau.';
    $('statut').className = 'message';
  }
})();
