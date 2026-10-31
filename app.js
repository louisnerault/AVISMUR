// Données fictives pour le prototype : les vrais items viendront de la feuille Checklists.
const ITEMS_FICTIFS = {
  ambulancier: ['Exemple : niveau carburant', 'Exemple : kit oxygène présent', 'Exemple : batterie vérifiée'],
  iade: ['Exemple : température frigo relevée', 'Exemple : chariot d\'urgence scellé'],
};

const $ = (id) => document.getElementById(id);

async function appeler(action, charge) {
  // text/plain évite la requête de pré-vérification CORS, non supportée par Apps Script.
  const r = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...charge }),
  });
  return r.json();
}

function afficherItems(liste) {
  const ul = $('items');
  ul.innerHTML = '';
  ITEMS_FICTIFS[liste].forEach((texte, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<label><input type="checkbox" data-i="${i}"> <span></span></label>`;
    li.querySelector('span').textContent = texte;
    ul.appendChild(li);
  });
}

function lireCoches() {
  return [...document.querySelectorAll('#items input')].map((c) => c.checked);
}

$('liste').addEventListener('change', (e) => afficherItems(e.target.value));

$('enregistrer').addEventListener('click', async () => {
  const liste = $('liste').value;
  $('statut').textContent = 'Envoi…';
  try {
    const rep = await appeler('saveChecklist', { liste, items: lireCoches() });
    $('statut').textContent = rep.ok ? 'Enregistré.' : `Erreur : ${rep.erreur}`;
  } catch (err) {
    $('statut').textContent = 'Connexion impossible (mode hors ligne ?).';
  }
});

afficherItems($('liste').value);
