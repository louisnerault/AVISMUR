# AVISMUR — front (PWA)

Check-lists du SMUR d'Avignon, servies par GitHub Pages. Fonctionne hors ligne : les check-lists sont gardées sur l'appareil puis envoyées au retour du réseau.

- `checklists.js` : véhicules et questions de la check-list ambulancier. **C'est ce fichier qu'on modifie** pour ajouter un véhicule ou un élément à vérifier.
- `ambulancier.js` : écran de la check-list ambulancier (brouillon gardé sur l'appareil jusqu'à l'envoi).
- `parc.js` : tableau de bord du parc (ordinateur, écran ≥ 1100 px) : menu « Véhicules » → cases empilées à gauche, tableau de tous les éléments des check-lists du jour au centre ; clic sur un véhicule → fiche (5 dernières vérifications, cartographie des impacts, pleins, garage). Historique gardé sur l'appareil pour le hors ligne.
- `app.js` : connexion, file d'attente hors ligne, envoi.
- `config.js` : URL de l'Apps Script (dépôt `AVISMUR-backend`).

À chaque mise à jour : incrémenter les `?v=` dans `index.html` et `CACHE` dans `sw.js` (mêmes valeurs dans la liste `FICHIERS`).

## Navigation

Menu principal (barre basse, une fois connecté) : **Aujourd'hui** (check-list du jour), **Véhicules** (ambulanciers et encadrement ; tableau de bord du parc sur ordinateur), **Plus** (configuration pour les admins, déconnexion). Les entrées ne sont ajoutées que pour les fonctionnalités réellement disponibles. Chaque vue est gérée par `ouvrirVue()` dans `app.js`.

Règle pour toute nouvelle fonctionnalité :
1. Lui créer une entrée : dans la barre basse si elle est utilisée tous les jours, sinon dans « Plus ».
2. Ajouter au moins un lien depuis une fonctionnalité connexe, pour qu'on puisse y arriver sans passer par le menu.
3. Prévoir le retour : la vue doit permettre de revenir à « Aujourd'hui » ou à la vue d'origine.
4. Masquer l'entrée selon le rôle (l'IADE n'a pas de véhicule, la configuration est réservée aux admins).

Liens connexes à prévoir (fonctionnalités non encore développées) :

| Fonctionnalité | Liens depuis / vers |
|---|---|
| Fiche véhicule (tiroirs, sacs, carrosserie) | Véhicules ↔ Check-list du véhicule ; Matériel |
| Matériel et sacs (inventaire, péremptions, à récupérer) | Fiche véhicule ; Aujourd'hui (alerte de péremption) ; GeoTraceSMUR (localisation) |
| Carburant (plein, AdBlue, ticket) | Fiche véhicule ; compteur kilométrique de la check-list |
| Stupéfiants | Matériel ; Plus (accès restreint et journalisé) |
| Maintenance | Fiche véhicule ; Matériel ; Aujourd'hui (échéances) |
| Pilotage (cadre, chef d'unité) | Plus ; historiques par véhicule et par agent |
