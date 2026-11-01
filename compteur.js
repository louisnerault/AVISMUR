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

  /** Niveaux de gris du cadre de visée, agrandis à une hauteur fixe. */
  function grisDuCadre(video, cadre) {
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

    const hauteur = 160;
    const largeur = Math.round((sw / sh) * hauteur);
    const canvas = document.createElement('canvas');
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, largeur, hauteur);
    const px = ctx.getImageData(0, 0, largeur, hauteur).data;
    const gris = new Uint8ClampedArray(largeur * hauteur);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
      gris[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const tries = Uint8ClampedArray.from(gris).sort();
    return { gris, tries, largeur, hauteur };
  }

  /**
   * Image noir sur blanc pour le moteur. Les chiffres d'un compteur sont les pixels
   * les plus clairs (ou les plus sombres) de la zone : on garde ceux au-delà d'un rang
   * donné (`part`), quelle que soit la lumière. Marge blanche autour, comme sur une page.
   */
  function imageSeuil({ gris, tries, largeur, hauteur }, chiffresClairs, part) {
    const seuil = tries[Math.floor(part * (tries.length - 1))];
    const marge = 20;
    const canvas = document.createElement('canvas');
    canvas.width = largeur + 2 * marge;
    canvas.height = hauteur + 2 * marge;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = ctx.createImageData(largeur, hauteur);
    for (let j = 0; j < gris.length; j += 1) {
      const chiffre = chiffresClairs ? gris[j] > seuil : gris[j] < seuil;
      const v = chiffre ? 0 : 255;
      const i = j * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, marge, marge);
    return canvas;
  }

  // Essais successifs : chiffres clairs (cas le plus courant), puis chiffres sombres.
  const ESSAIS = [[true, 0.85], [true, 0.80], [true, 0.92], [false, 0.15], [false, 0.20]];

  /**
   * Nombre le plus vraisemblable dans le texte lu. Un compteur affiche 4 à 7 chiffres ;
   * le moteur ajoute parfois un chiffre parasite (le « k » de « km » lu comme un 1) :
   * on essaie aussi les débuts de chaque suite de chiffres et on retient celui qui suit
   * le dernier relevé.
   */
  function choisirValeur(texte, precedent) {
    const suites = String(texte).replace(/[^\d\n]/g, '').split('\n').filter((x) => x.length >= 4);
    if (!suites.length) return null;
    if (precedent) {
      let meilleur = null;
      suites.forEach((suite) => {
        for (let n = 4; n <= Math.min(7, suite.length); n += 1) {
          const v = Number(suite.slice(0, n));
          if (v >= precedent && v - precedent <= ECART_MAX_KM && (meilleur === null || v - precedent < meilleur - precedent)) meilleur = v;
        }
      });
      if (meilleur !== null) return meilleur;
    }
    const longue = suites.sort((a, b) => b.length - a.length)[0];
    return Number(longue.slice(0, 7));
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
      const zoom = el('button', { type: 'button', classe: 'camera-option', hidden: '', 'aria-label': 'Zoom' });
      const lampe = el('button', { type: 'button', classe: 'camera-option', hidden: '', 'aria-pressed': 'false', texte: '🔦 Lampe' });
      const vue = el('div', { classe: 'camera-vue' }, video, cadre,
        el('div', { classe: 'camera-options' }, zoom, lampe),
        el('p', { classe: 'consigne-camera', texte: 'Approchez : les chiffres du kilométrage doivent remplir le cadre' }));
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
          const zone = grisDuCadre(video, cadre);
          const w = await preparerMoteur();
          let valeur = null;
          let image = imageSeuil(zone, ESSAIS[0][0], ESSAIS[0][1]);
          for (const [clairs, part] of ESSAIS) {
            if (fini) return;
            const essai = imageSeuil(zone, clairs, part);
            const v = choisirValeur((await w.recognize(essai)).data.text, precedent);
            if (v !== null && (valeur === null || plausible(v, precedent))) { valeur = v; image = essai; }
            if (plausible(valeur, precedent)) break;
          }
          if (fini) return;
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

      /** Zoom et lampe, si le téléphone les propose (Chrome sur Android, le plus souvent). */
      function reglagesCamera(piste) {
        const capacites = piste && piste.getCapabilities ? piste.getCapabilities() : {};
        if (capacites.zoom && capacites.zoom.max > capacites.zoom.min) {
          const niveaux = [1, 2, 3].map((n) => Math.min(Math.max(n, capacites.zoom.min), capacites.zoom.max))
            .filter((n, i, t) => t.indexOf(n) === i);
          let rang = niveaux.length > 1 ? 1 : 0; // zoom ×2 d'emblée : on vise mieux les petits chiffres
          const appliquer = () => {
            piste.applyConstraints({ advanced: [{ zoom: niveaux[rang] }] }).catch(() => {});
            zoom.textContent = `🔍 ×${niveaux[rang]}`;
          };
          zoom.hidden = false;
          zoom.addEventListener('click', () => { rang = (rang + 1) % niveaux.length; appliquer(); });
          appliquer();
        }
        if (capacites.torch) {
          let allumee = false;
          lampe.hidden = false;
          lampe.addEventListener('click', () => {
            allumee = !allumee;
            piste.applyConstraints({ advanced: [{ torch: allumee }] }).catch(() => {});
            lampe.setAttribute('aria-pressed', String(allumee));
          });
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
        reglagesCamera(f.getVideoTracks()[0]);
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
