// Items fictifs pour le prototype : les vrais items viendront de la feuille Checklists.
const ITEMS_FICTIFS = {
  ambulancier: ['Exemple : niveau carburant', 'Exemple : kit oxygène présent', 'Exemple : batterie vérifiée'],
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
  if (infos.role === 'ambulancier' || infos.role === 'iade') {
    $('liste').value = infos.role;
  }
  afficherItems($('liste').value);
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

$('liste').addEventListener('change', (e) => afficherItems(e.target.value));

$('enregistrer').addEventListener('click', async () => {
  const liste = $('liste').value;
  $('statut').textContent = 'Enregistrement…';
  $('statut').className = 'message';
  try {
    const rep = await appeler('saveChecklist', { liste, items: lireCoches() });
    if (rep.reconnecter) return;
    $('statut').textContent = rep.ok ? 'Check-list enregistrée.' : rep.erreur;
    $('statut').className = rep.ok ? 'message succes' : 'message erreur';
  } catch (err) {
    $('statut').textContent = 'Check-list non enregistrée : le serveur ne répond pas. Vérifiez la connexion puis réessayez.';
    $('statut').className = 'message erreur';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* PWA hors ligne indisponible */ });
}

// Au chargement : reprendre la session si elle est encore valide.
(async () => {
  const actuelle = session.lire();
  if (!actuelle) return afficher('ecran-connexion');
  try {
    const rep = await appeler('ping');
    if (rep.ok) afficherApplication(rep);
  } catch (err) {
    afficher('ecran-connexion', ERREUR_RESEAU);
  }
})();
