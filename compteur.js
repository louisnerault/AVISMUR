/*
 * Lecture du compteur kilométrique par la caméra.
 * L'écran caméra s'ouvre, on vise le compteur dans le cadre, la valeur est lue
 * automatiquement (ou avec « Capturer »), puis on la confirme ou on la corrige.
 *
 * Reconnaissance des chiffres : Tesseract.js, chargé depuis Internet à la première
 * utilisation (environ 3 Mo). Sans réseau, on saisit le kilométrage à la main.
 * L'image ne quitte pas le téléphone : la lecture se fait dans le navigateur.
 */
const Compteur = (() => {
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const INTERVALLE_MS = 1200;
  const ECART_MAX_KM = 5000; // au-delà du dernier relevé, une lecture est jugée douteuse

  let worker = null;
  let chargement = null;

  const disponible = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function chargerScript(url) {
    return new Promise((ok, echec) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = ok;
      s.onerror = () => echec(new Error('script'));
      document.head.appendChild(s);
    });
  }

  /** Prépare le moteur de lecture une seule fois, chiffres uniquement, une seule ligne. */
  function preparerMoteur() {
    if (worker) return Promise.resolve(worker);
    if (!chargement) {
      chargement = (window.Tesseract ? Promise.resolve() : chargerScript(TESSERACT_URL))
        .then(() => window.Tesseract.createWorker('eng'))
        .then((w) => w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' }).then(() => w))
        .then((w) => { worker = w; return w; })
        .catch((err) => { chargement = null; throw err; });
    }
    return chargement;
  }

  /**
   * Image du cadre de visée, en noir sur blanc et contrastée :
   * les compteurs à cristaux liquides ont souvent des chiffres clairs sur fond sombre.
   */
  function imageDuCadre(video, cadre) {
    const vr = video.getBoundingClientRect();
    const cr = cadre.getBoundingClientRect();
    // La vidéo remplit l'écran en « cover » : on retrouve la zone correspondante dans l'image source.
    const echelle = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight);
    const decalX = (video.videoWidth * echelle - vr.width) / 2;
    const decalY = (video.videoHeight * echelle - vr.height) / 2;
    const sx = (cr.left - vr.left + decalX) / echelle;
    const sy = (cr.top - vr.top + decalY) / echelle;
    const sw = cr.width / echelle;
    const sh = cr.height / echelle;

    const hauteur = 120;
    const largeur = Math.round((sw / sh) * hauteur);
    const canvas = document.createElement('canvas');
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, largeur, hauteur);

    const img = ctx.getImageData(0, 0, largeur, hauteur);
    const px = img.data;
    let somme = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = g;
      somme += g;
    }
    const moyenne = somme / (px.length / 4);
    const inverser = moyenne < 110; // fond sombre : on inverse pour avoir des chiffres noirs
    for (let i = 0; i < px.length; i += 4) {
      let g = px[i];
      if (inverser) g = 255 - g;
      const seuil = inverser ? 255 - moyenne : moyenne;
      const v = g < seuil * 0.85 ? 0 : 255;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Nombre le plus vraisemblable dans le texte lu (4 à 7 chiffres, proche du dernier relevé). */
  function choisirValeur(texte, precedent) {
    const nombres = (String(texte).replace(/\s+/g, '').match(/\d{4,7}/g) || []).map(Number);
    if (!nombres.length) return null;
    if (precedent) {
      const plausibles = nombres.filter((n) => n >= precedent && n - precedent <= ECART_MAX_KM);
      if (plausibles.length) return plausibles[0];
    }
    return nombres.sort((a, b) => String(b).length - String(a).length)[0];
  }

  const plausible = (n, precedent) => n !== null && (!precedent || (n >= precedent && n - precedent <= ECART_MAX_KM));

  function el(balise, attributs = {}, ...enfants) {
    const n = document.createElement(balise);
    Object.entries(attributs).forEach(([k, v]) => {
      if (k === 'texte') n.textContent = v;
      else if (k === 'classe') n.className = v;
      else n.setAttribute(k, v);
    });
    n.append(...enfants);
    return n;
  }

  /**
   * Ouvre l'écran caméra. Renvoie une promesse : le kilométrage confirmé, ou null si annulé.
   * `precedent` : dernier kilométrage connu du véhicule (aide à écarter les lectures fausses).
   */
  function lire({ precedent } = {}) {
    return new Promise((resoudre) => {
      const video = el('video', { playsinline: '', muted: '', autoplay: '' });
      video.muted = true;
      const cadre = el('div', { classe: 'viseur', 'aria-hidden': 'true' });
      const etat = el('p', { classe: 'lecture', role: 'status', texte: 'Ouverture de la caméra…' });
      const annuler = el('button', { type: 'button', classe: 'camera-bouton secondaire', texte: 'Annuler' });
      const capturer = el('button', { type: 'button', classe: 'camera-bouton', texte: 'Capturer' });
      const vue = el('div', { classe: 'camera-vue' }, video, cadre,
        el('p', { classe: 'consigne-camera', texte: 'Visez le compteur kilométrique dans le cadre' }));
      const ecran = el('div', { classe: 'camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Lecture du compteur' },
        vue, etat, el('div', { classe: 'camera-actions' }, annuler, capturer));
      document.body.appendChild(ecran);
      document.body.classList.add('camera-ouverte');

      let flux = null;
      let minuterie = null;
      let occupe = false;
      let derniere = null;
      let fini = false;

      function nettoyer() {
        fini = true;
        clearInterval(minuterie);
        if (flux) flux.getTracks().forEach((t) => t.stop());
        ecran.remove();
        document.body.classList.remove('camera-ouverte');
      }
      function fermer(valeur) {
        if (fini) return;
        nettoyer();
        resoudre(valeur);
      }

      /** Étape de confirmation : image lue, valeur modifiable. */
      function confirmer(valeur, image) {
        clearInterval(minuterie);
        if (flux) flux.getTracks().forEach((t) => t.stop());
        const champ = el('input', { inputmode: 'numeric', classe: 'saisie-km', 'aria-label': 'Kilométrage lu' });
        champ.value = valeur === null ? '' : String(valeur);
        champ.addEventListener('input', () => { champ.value = champ.value.replace(/\D/g, '').slice(0, 7); });
        const ok = el('button', { type: 'button', classe: 'camera-bouton', texte: 'Confirmer' });
        const reprendre = el('button', { type: 'button', classe: 'camera-bouton secondaire', texte: 'Reprendre' });
        const avertissement = valeur === null
          ? 'Lecture impossible : saisissez la valeur ou reprenez la photo.'
          : (plausible(valeur, precedent) ? 'Vérifiez la valeur lue avant de confirmer.'
            : `Valeur inhabituelle${precedent ? ` (dernier relevé : ${precedent.toLocaleString('fr-FR')} km)` : ''} : vérifiez-la.`);
        ecran.innerHTML = '';
        image.classList.add('camera-capture');
        ecran.append(
          el('div', { classe: 'camera-confirmation' },
            el('h2', { texte: 'Kilométrage lu' }), image,
            el('label', { texte: 'Kilométrage' }), champ,
            el('p', { classe: 'lecture', texte: avertissement })),
          el('div', { classe: 'camera-actions' }, reprendre, ok),
        );
        champ.focus();
        ok.addEventListener('click', () => fermer(champ.value ? Number(champ.value) : null));
        reprendre.addEventListener('click', () => { nettoyer(); lire({ precedent }).then(resoudre); });
      }

      async function analyser(manuel) {
        if (occupe || fini || !video.videoWidth) return;
        occupe = true;
        try {
          const image = imageDuCadre(video, cadre);
          const w = await preparerMoteur();
          if (fini) return;
          const { data } = await w.recognize(image);
          const valeur = choisirValeur(data.text, precedent);
          if (manuel) {
            confirmer(valeur, image);
          } else if (plausible(valeur, precedent) && valeur === derniere) {
            confirmer(valeur, image); // même valeur lue deux fois de suite : on la retient
          } else {
            derniere = valeur;
            etat.textContent = valeur === null ? 'Recherche du compteur…' : `Lu : ${valeur.toLocaleString('fr-FR')} km…`;
          }
        } catch (err) {
          console.error('Lecture du compteur :', err);
          if (fini) return;
          clearInterval(minuterie);
          etat.textContent = 'Reconnaissance indisponible (pas de réseau ?). Saisissez le kilométrage à la main.';
          capturer.disabled = true;
        } finally {
          occupe = false;
        }
      }

      annuler.addEventListener('click', () => fermer(null));
      capturer.addEventListener('click', () => analyser(true));
      ecran.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(null); });

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }).then((f) => {
        if (fini) { f.getTracks().forEach((t) => t.stop()); return; }
        flux = f;
        video.srcObject = f;
        etat.textContent = 'Chargement de la reconnaissance…';
        preparerMoteur().then(() => {
          if (fini) return;
          etat.textContent = 'Recherche du compteur…';
          minuterie = setInterval(() => analyser(false), INTERVALLE_MS);
        }).catch(() => {
          etat.textContent = 'Reconnaissance indisponible (pas de réseau ?). Saisissez le kilométrage à la main.';
          capturer.disabled = true;
        });
      }).catch(() => {
        etat.textContent = 'Caméra inaccessible : autorisez la caméra pour cette application, ou saisissez le kilométrage à la main.';
        capturer.disabled = true;
      });
      capturer.focus();
    });
  }

  return { disponible, lire, choisirValeur };
})();
