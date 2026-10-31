/*
 * Check-list ambulancier : vérification quotidienne des véhicules.
 * Reprise des Google Forms « Check-list Ambulancier VML », « UMH » et « HELICO » (F00).
 *
 * Pour modifier la check-list, il suffit d'éditer ce fichier (puis d'incrémenter les ?v=
 * dans index.html et CACHE dans sw.js).
 *
 * Le libellé d'une question sert aussi de nom de colonne pour la copie vers l'ancien Sheet
 * « Check-list journalière véhicules SMUR ». La comparaison ignore majuscules, accents et
 * espaces : « Boîte à gants [Boîte à ampoules] » correspond à « Boîte à gants [BOITE A AMPOULES] ».
 * Quand l'en-tête du Sheet est différent (faute de frappe…), on le précise avec `colonne`.
 *
 * Types de questions :
 *   niveau  : obus / bouteille, de 0 à 10 (10 = 200 bars)
 *   groupe  : liste d'éléments à cocher « OK » (non coché = manquant)
 *   fait    : case « Fait »
 *   nombre  : saisie numérique (kilométrage)
 *   choix   : une réponse parmi `options`
 *   texte   : remarques libres
 * `si: { question, valeur }` n'affiche la question que si une autre a cette réponse.
 */

const VEHICULES = [
  { id: 'F21', modele: 'VML' },
  { id: 'F22', modele: 'VML' },
  { id: 'F28', modele: 'VML' },
  { id: 'F23', modele: 'UMH' },
  { id: 'F24', modele: 'UMH' },
  { id: 'F25', modele: 'UMH' },
  { id: 'F26', modele: 'UMH' },
  { id: 'F00', modele: 'F00', libelle: 'F00 · ambulance HELICO' },
];

const CARBURANT = { type: 'choix', libelle: 'Carburant', options: ['1/4', '2/4', '3/4', '4/4'], requis: true };
const ADBLUE = {
  type: 'choix',
  libelle: 'Ad-Blue',
  options: ['OK', 'Niveau à compléter', 'Véhicule non concerné par l\'AdBlue'],
  requis: true,
};
const FIN = [
  { type: 'fait', libelle: 'Entretien quotidien' },
  { type: 'nombre', libelle: 'Kilométrage', requis: true },
  CARBURANT,
  ADBLUE,
  { type: 'texte', libelle: 'Remarques' },
];

const BOITE_A_GANTS = {
  type: 'groupe',
  titre: 'Boîte à gants',
  items: ['Boîte à ampoules', 'Documents véhicule', 'Constat amiable'],
};

const MODELES = {
  VML: {
    titre: 'VML',
    questions: [
      { type: 'niveau', libelle: 'Obus 5 Litres n°1' },
      { type: 'niveau', libelle: 'Obus 5 Litres n°2' },
      {
        type: 'groupe',
        titre: 'Poste de conduite',
        items: [
          'Carte essence', 'GPS', 'Pass zone piétonne Avignon + clés', 'Pass zone piétonne Villeneuve',
          { libelle: 'Clé autoroute', colonne: 'Poste de conduite [CLE AUTORAOUTE]' },
          'Télépéage', 'Feux - gyro - deux tons', 'Lampe torche', 'Extincteur', '5 gilets de sécurité',
          'Triangle', 'Kit roue de secours',
        ],
      },
      BOITE_A_GANTS,
      {
        type: 'groupe',
        titre: 'Hygiène',
        items: ['Gants à usage unique', 'Gants de toilette', 'Détergent / désinfectant', 'Lingettes désinfectantes', 'Solution hydro-alcoolique'],
      },
      ...FIN,
    ],
  },

  UMH: {
    titre: 'UMH',
    questions: [
      {
        type: 'choix',
        libelle: 'Cette UMH fait-elle office de F00 aujourd\'hui (transferts DZ) ?',
        options: ['NON', 'OUI'],
        requis: true,
        basculeF00: true, // OUI : on remplit la check-list F00 avec cette UMH
      },
      { type: 'niveau', libelle: 'Obus 5 Litres n°1' },
      { type: 'niveau', libelle: 'Obus 5 Litres n°2' },
      { type: 'niveau', libelle: 'Obus 15 Litres' },
      { type: 'choix', libelle: 'Y-a-t-il un deuxième obus 15 Litres dans l\'UMH?', options: ['NON', 'OUI'], requis: true },
      {
        type: 'niveau',
        libelle: 'Obus 15 Litres (supplémentaire)',
        si: { question: 'Y-a-t-il un deuxième obus 15 Litres dans l\'UMH?', valeur: 'OUI' },
      },
      {
        type: 'groupe',
        titre: 'Poste de conduite',
        items: [
          'Carte essence', 'GPS', 'Badge CHU Nord', 'Badge CHU Timone', 'Pass zone piétonne Avignon + clés',
          'Pass zone piétonne Villeneuve', 'Clé autoroute', 'Télépéage', 'Feux - gyro - deux tons', 'Lampe torche',
          'Extincteur', '5 gilets de sécurité', 'Triangle', 'Bombe anti-crevaison', 'Kit roue de secours',
        ],
      },
      BOITE_A_GANTS,
      {
        type: 'groupe',
        titre: 'Hygiène',
        items: ['Gants à usage unique', 'Gants de toilette', 'Détergent / désinfectant', 'Solution hydro-alcoolique', 'Lingettes désinfectantes'],
      },
      {
        type: 'groupe',
        titre: 'Cellule',
        items: ['Pied à perfusion', 'Tuyau et coquille', 'Portoir', 'Chaise de transport', 'Tablette', 'Draps / couverture bactériostatique'],
      },
      ...FIN,
    ],
  },

  F00: {
    titre: 'F00 · ambulance HELICO',
    questions: [
      { type: 'niveau', libelle: 'Obus 5 Litres n°1' },
      { type: 'niveau', libelle: 'Obus 5 Litres n°2' },
      { type: 'niveau', libelle: 'Obus 15 Litres' },
      { type: 'niveau', libelle: 'Bouteille oxygène' },
      { type: 'niveau', libelle: 'Bouteille air' },
      {
        type: 'groupe',
        titre: 'Équipement',
        items: [
          { libelle: 'Carte essence', colonne: 'Poste de conduite [CARTE ESSENCE]' },
          { libelle: 'Draps / couverture bactériostatique', colonne: '[DRAPS / COUVERTURE BACTERIOSTATIQUE]' },
        ],
      },
      ...FIN,
    ],
  },
};
