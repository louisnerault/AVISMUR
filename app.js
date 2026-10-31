// Items fictifs pour le prototype : les vrais items viendront de la feuille Checklists.
const ITEMS_FICTIFS = {
  ambulancier: ['Exemple : niveau carburant', 'Exemple : kit oxygène présent', 'Exemple : batterie vérifiée'],
  iade: ['Exemple : température frigo relevée', 'Exemple : chariot d\'urgence scellé'],
};

const $ = (id) => document.getElementById(id);

// Le jeton vit le temps de l'onglet : fermer l'application = se reconnecter.
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
    afficherConnexion('Session expirée, reconnectez-vous.');
  }
  return rep;
}

function afficherConnexion(message = '') {
  $('ecran-connexion').hidden = false;
  $('ecran-checklist').hidden = true;
  $('utilisateur').hidden = true;
  $('erreur-connexion').textContent = message;
}

function afficherApplication(infos) {
  $('ecran-connexion').hidden = true;
  $('ecran-checklist').hidden = false;
  $('utilisateur').hidden = false;
  $('nom-utilisateur').textContent = `${infos.identifiant} (${infos.role})`;
  if (infos.role === 'ambulancier' || infos.role === 'iade') {
    $('liste').value = infos.role;
  }
  afficherItems($('liste').value);
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

$('ecran-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('erreur-connexion').textContent = 'Connexion…';
  try {
    const rep = await appeler('login', { identifiant: $('identifiant').value, code: $('code').value });
    $('code').value = '';
    if (!rep.ok) {
      $('erreur-connexion').textContent = rep.erreur;
      return;
    }
    session.ecrire({ jeton: rep.jeton, identifiant: rep.identifiant, role: rep.role });
    afficherApplication(rep);
  } catch (err) {
    $('erreur-connexion').textContent = 'Connexion impossible (réseau ?).';
  }
});

$('deconnexion').addEventListener('click', async () => {
  try { await appeler('logout'); } catch (err) { /* déconnexion locale quand même */ }
  session.effacer();
  afficherConnexion();
});

$('liste').addEventListener('change', (e) => afficherItems(e.target.value));

$('enregistrer').addEventListener('click', async () => {
  const liste = $('liste').value;
  $('statut').textContent = 'Envoi…';
  try {
    const rep = await appeler('saveChecklist', { liste, items: lireCoches() });
    if (rep.reconnecter) return;
    $('statut').textContent = rep.ok ? 'Enregistré.' : `Erreur : ${rep.erreur}`;
  } catch (err) {
    $('statut').textContent = 'Envoi impossible (réseau ?). Rien n\'a été enregistré.';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* PWA hors ligne indisponible */ });
}

// Au chargement : reprendre la session si elle est encore valide.
(async () => {
  const actuelle = session.lire();
  if (!actuelle) return afficherConnexion();
  try {
    const rep = await appeler('ping');
    if (rep.ok) afficherApplication(rep);
  } catch (err) {
    afficherConnexion('Connexion impossible (réseau ?).');
  }
})();
