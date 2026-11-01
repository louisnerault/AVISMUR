// Migration (une seule fois) : les clés de stockage local passent du préfixe générique
// « smur_ » au préfixe propre à l'app « avismur_ », pour ne jamais entrer en conflit
// avec une autre application hébergée sur louisnerault.github.io.
(function migrerStockage() {
  [window.localStorage, window.sessionStorage].forEach((st) => {
    try {
      for (let i = st.length - 1; i >= 0; i--) {
        const k = st.key(i);
        if (k && k.indexOf('smur_') === 0) {
          const neuve = 'avismur_' + k.slice(5);
          if (st.getItem(neuve) === null) st.setItem(neuve, st.getItem(k));
          st.removeItem(k);
        }
      }
    } catch (e) { /* stockage indisponible */ }
  });
})();

// URL de déploiement de l'Apps Script (Déployer > Application Web).
// Elle est publique : la sécurité repose sur la connexion CRI + SMS + mot de passe.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby2PP7rq3WqLjAJgGDuwTGlkd3H4ZXocPa7fON26NxC6XNOzuoVG6o86aQxD6ZIgQR1/exec',
};
