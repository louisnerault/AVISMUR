# AVISMUR — front (PWA)

Check-lists du SMUR d'Avignon, servies par GitHub Pages. Fonctionne hors ligne : les check-lists sont gardées sur l'appareil puis envoyées au retour du réseau.

- `checklists.js` : véhicules et questions de la check-list ambulancier. **C'est ce fichier qu'on modifie** pour ajouter un véhicule ou un élément à vérifier.
- `ambulancier.js` : écran de la check-list ambulancier (brouillon gardé sur l'appareil jusqu'à l'envoi).
- `app.js` : connexion, file d'attente hors ligne, envoi.
- `config.js` : URL de l'Apps Script (dépôt `AVISMUR-backend`).

À chaque mise à jour : incrémenter les `?v=` dans `index.html` et `CACHE` dans `sw.js` (mêmes valeurs dans la liste `FICHIERS`).
