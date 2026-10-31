// Items fictifs pour le prototype IADE. La check-list ambulancier est dans checklists.js.
const ITEMS_FICTIFS = {
  iade: ['Exemple : température frigo relevée', 'Exemple : chariot d\'urgence scellé'],
};

const ECRANS = ['ecran-connexion', 'ecran-sms', 'ecran-code', 'ecran-mdp', 'ecran-checklist'];
const $ = (id) => document.getElementById(id);
const ERREUR_RESEAU = 'Le serveur ne répond pas. Vérifiez la connexion internet puis réessayez. Si le problème continue, prévenez l\'administrateur.';

// État du parcours de première connexion (en mémoire uniquement).
const parcours = { cri: '', jetonCreation: '' };

// Le jeton de session vit le temps de l'onglet : fermer l'application = se reconnecter.
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

async function appeler(action, charge = {}) {
  // text/plain évite la requête de pré-vérification CORS, non supportée par Apps Script.
  const actuelle = session.lire();
  const r = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, jeton: actuelle && actuelle.jeton, ...charge }),
  });
  const rep = await r.json();
  if (rep.reconnecter) {
    session.effacer();
    afficher('ecran-connexion', 'Session expirée, reconnectez-vous.');
  }
  return rep;
}

/** Affiche un écran et, éventuellement, un message d'erreur dans cet écran. */
function afficher(idEcran, erreur = '') {
  ECRANS.forEach((id) => { $(id).hidden = id !== idEcran; });
  const connecte = idEcran === 'ecran-checklist';
  $('utilisateur').hidden = !connecte;
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
  session.ecrire({ jeton: infos.jeton || session.lire().jeton, identifiant: infos.identifiant, role: infos.role });
  afficher('ecran-checklist');
  $('nom-utilisateur').textContent = `${infos.identifiant} (${infos.role})`;
  // Ambulanciers et IADE ne voient que leur check-list ; l'encadrement et les admins choisissent.
  const metier = infos.role === 'ambulancier' || infos.role === 'iade';
  if (metier) $('liste').value = infos.role;
  $('choix-liste').hidden = metier;
  afficherListe($('liste').value);
  envoyerFileAttente();
  chargerReleves();
}

/** Derniers kilométrages et état du parc du jour, gardés sur l'appareil pour le hors ligne. */
async function chargerReleves() {
  try {
    const rep = await appeler('derniersReleves');
    if (rep.ok) Ambulancier.majReleves(rep.releves, rep.parc);
  } catch (err) { /* hors ligne : on garde les derniers relevés connus */ }
}

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
  let envoyees = 0;
  let erreurServeur = '';
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
          idSaisie: suivante.id,
          dateSaisie: suivante.date,
        });
      } catch (err) {
        break; // réseau coupé : on garde tout et on réessaiera au retour du réseau
      }
      if (rep.reconnecter) break; // session expirée : les entrées restent, envoyées après reconnexion
      if (rep.ok) {
        fileAttente.ecrire(fileAttente.lire().filter((e) => e.id !== suivante.id));
        envoyees += 1;
      } else {
        refusees.add(suivante.id);
        erreurServeur = rep.erreur || 'refus du serveur';
      }
    }
  } finally {
    envoiEnCours = false;
  }
  if (envoyees) chargerReleves();
  bilanEnvoi({ envoyees, restantes: fileAttente.lire().length, erreurServeur });
}

function bilanEnvoi({ envoyees, restantes, erreurServeur }) {
  const pieces = [];
  if (envoyees) pieces.push(`${envoyees} check-list(s) envoyée(s) au serveur.`);
  if (restantes) pieces.push(`${restantes} check-list(s) gardée(s) sur cet appareil, en attente d'envoi.`);
  if (erreurServeur) pieces.push(`Refusée par le serveur : ${erreurServeur}`);
  if (!pieces.length) return;
  $('statut').textContent = pieces.join(' ');
  $('statut').className = erreurServeur ? 'message erreur' : (restantes ? 'message' : 'message succes');
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
  const rep = await soumettre('ecran-connexion', 'login', { cri: $('cri').value.trim(), motDePasse: $('mdp').value });
  $('mdp').value = '';
  if (rep.ok) afficherApplication(rep);
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
  const rep = await soumettre('ecran-mdp', 'definirMotDePasse', { jetonCreation: parcours.jetonCreation, motDePasse: mdp });
  if (rep.recommencer) {
    afficher('ecran-sms', rep.erreur);
    return;
  }
  if (!rep.ok) return;
  $('nouveau-mdp').value = '';
  $('confirmation-mdp').value = '';
  parcours.cri = '';
  parcours.jetonCreation = '';
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
  try { await appeler('logout'); } catch (err) { /* déconnexion locale quand même */ }
  session.effacer();
  afficher('ecran-connexion');
});

// ---------- Check-lists ----------

function afficherListe(liste) {
  $('zone-ambulancier').hidden = liste !== 'ambulancier';
  $('items').hidden = liste === 'ambulancier';
  if (liste === 'ambulancier') Ambulancier.afficher();
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
    liste: 'ambulancier', vehicule: saisie.vehicule, modele: saisie.modele, items: saisie.reponses,
  });
  if (!ok) return;
  confirmationDemandee = false;
  $('enregistrer').textContent = 'Enregistrer la check-list';
  Ambulancier.terminer(saisie);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('liste').addEventListener('change', (e) => afficherListe(e.target.value));
$('zone-ambulancier').addEventListener('reponse', annulerConfirmation);
Ambulancier.initialiser();

$('enregistrer').addEventListener('click', () => {
  if ($('liste').value === 'ambulancier') {
    enregistrerAmbulancier();
    return;
  }
  mettreEnFile({ liste: $('liste').value, items: lireCoches() });
});

window.addEventListener('online', () => envoyerFileAttente());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* PWA hors ligne indisponible */ });
}

// Au chargement : reprendre la session si elle est encore valide.
// Hors ligne, on reprend la session enregistrée sur l'appareil ; la saisie reste possible.
(async () => {
  const actuelle = session.lire();
  if (!actuelle) return afficher('ecran-connexion');
  try {
    const rep = await appeler('ping');
    if (rep.ok) afficherApplication(rep);
  } catch (err) {
    afficherApplication(actuelle);
    $('statut').textContent = 'Mode hors ligne : les check-lists seront envoyées au retour du réseau.';
    $('statut').className = 'message';
  }
})();
