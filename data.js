'use strict';
/* Programme et données initiales.
   Les valeurs modifiées dans l'app (Réglages) sont stockées sur l'iPhone
   et ne sont jamais écrasées par ce fichier lors d'une mise à jour. */

const APP_VERSION = '1.0.0';

// Ordre du cycle (index 0 à 6) — jour 1 = Push … jour 7 = Repos
const CYCLE = ['push', 'pull', 'legs', 'rest', 'upper', 'lower', 'rest'];
// Référence obligatoire : dimanche 18 octobre 2026 = Upper (jour 5 → index 4)
const CYCLE_DEFAULT = { refDate: '2026-10-18', refIndex: 4 };

const SESSION_NAMES = { push: 'Push', pull: 'Pull', legs: 'Legs', rest: 'Repos', upper: 'Upper', lower: 'Lower' };
const SESSION_SUBTITLES = {
  push: 'Pectoraux · épaules · triceps',
  pull: 'Dos · biceps · arrière d’épaules',
  legs: 'Jambes / fessiers — séance principale',
  upper: 'Haut du corps',
  lower: 'Jambes / fessiers — séance secondaire, plus légère',
  rest: 'Récupération'
};

/* equip : machine | haltere (charge par haltère) | poulie | barre (charge totale) | pdc (poids du corps)
   refStatus : provisoire | estimation | indicatif | proposee | validee | inconnue
   technique : ok | a_revoir (=> aucune augmentation proposée tant que non validée) */
const INITIAL_EXERCISES = {
  chest_press: {
    name: 'Chest press à la machine', equip: 'machine', increment: 2.5,
    refLoad: 45, refStatus: 'provisoire', technique: 'ok',
    refNote: 'Prochaine cible : 45 kg pour 3 × 8, si la technique reste propre.',
    lastKnown: '45 kg — référence provisoire',
    tips: ['Omoplates serrées et basses contre le dossier.', 'Poignées à hauteur du milieu des pectoraux.', 'Pousse sans verrouiller brutalement les coudes, retour contrôlé (2 s).']
  },
  incline_press: {
    name: 'Développé incliné à la machine', equip: 'machine', increment: 2.5,
    refLoad: 12.5, refStatus: 'provisoire', technique: 'ok',
    refNote: 'Référence provisoire 12,5 kg (en Upper : point de départ indicatif si la machine est identique).',
    lastKnown: '12,5 kg — référence provisoire',
    tips: ['Règle le siège : poignées à hauteur du haut des pectoraux.', 'Omoplates serrées, poitrine sortie.', 'Descente contrôlée, pas de rebond.']
  },
  pec_deck: {
    name: 'Pec deck', equip: 'machine', increment: 2.5,
    refLoad: 32, refStatus: 'provisoire', technique: 'ok',
    refNote: 'Prochaine cible : 32 kg pour 2 × 12.', lastKnown: '32 kg — référence provisoire',
    tips: ['Coudes légèrement fléchis et fixes.', 'Rapproche les bras en pensant « serrer les pectoraux ».', 'Retour lent sans laisser les charges se toucher.']
  },
  lateral_raise: {
    name: 'Élévations latérales avec haltères', equip: 'haltere', increment: 1,
    refLoad: 4, refStatus: 'provisoire', technique: 'ok',
    refNote: '4 kg par main, environ 2 répétitions en réserve, bonnes sensations.',
    lastKnown: '4 kg/main × 12, ~2 RIR, bonnes sensations aux épaules',
    tips: ['Monte jusqu’à hauteur d’épaules, pas plus haut.', 'Évite de hausser les épaules : cou long, trapèzes relâchés.', 'Coudes légèrement fléchis, mouvement lent, sans élan.']
  },
  triceps_pushdown: {
    name: 'Extension triceps à la poulie', equip: 'poulie', increment: 2.3,
    refLoad: 6.8, refStatus: 'proposee', technique: 'ok',
    refNote: 'Commencer à 6,8 kg pour établir une référence propre.',
    lastKnown: 'Essais : 6,8 kg × 12 puis 9,1 kg × 10 (nombre de séries non confirmé)',
    tips: ['Coudes collés au corps et immobiles.', 'Extension complète en bas, contracte 1 s.', 'Remonte lentement sans laisser les coudes avancer.']
  },
  shoulder_press: {
    name: 'Shoulder press à la machine', equip: 'machine', increment: 2.5,
    refLoad: null, refStatus: 'inconnue', technique: 'ok',
    lastKnown: 'Non effectué', tips: ['Dos plaqué contre le dossier.', 'Poignées à hauteur du menton au départ.', 'Pousse sans cambrer ni verrouiller brutalement.']
  },
  crunch_machine: {
    name: 'Crunch à la machine', equip: 'machine', increment: 2.5,
    refLoad: null, refStatus: 'inconnue', technique: 'ok', lastKnown: '',
    tips: ['Enroule la colonne : rapproche les côtes du bassin.', 'Ne tire pas avec les bras.', 'Expire en contractant, retour contrôlé.']
  },
  dead_bug: {
    name: 'Dead bug', equip: 'pdc', perSide: true, increment: 0,
    refLoad: null, refStatus: 'inconnue', technique: 'ok', lastKnown: 'Poids du corps',
    tips: ['Bas du dos plaqué au sol pendant tout le mouvement.', 'Tends lentement bras et jambe opposés en expirant.', 'Arrête la série si le dos se cambre.']
  },
  lat_pulldown: {
    name: 'Tirage vertical à la poulie', equip: 'poulie', increment: 2.5,
    refLoad: null, refStatus: 'inconnue', technique: 'ok', lastKnown: 'Non effectué lors de la première séance connue',
    tips: ['Prise un peu plus large que les épaules.', 'Tire les coudes vers les hanches, poitrine vers la barre.', 'Pas d’élan avec le buste ; remontée contrôlée.']
  },
  row_machine: {
    name: 'Rowing à la machine divergente', equip: 'machine', increment: 2.5,
    refLoad: null, refStatus: 'inconnue', technique: 'ok', lastKnown: '',
    tips: ['Poitrine contre l’appui si la machine en a un.', 'Tire avec les coudes et serre les omoplates en fin de mouvement.', 'Ne hausse pas les épaules.']
  },
  hammer_curl: {
    name: 'Curl marteau avec haltères', equip: 'haltere', increment: 1,
    refLoad: 8, refStatus: 'provisoire', technique: 'ok',
    refNote: 'Premier essai : 8 kg par haltère × 10 (référence provisoire).', lastKnown: '8 kg/haltère × 10 (premier essai)',
    tips: ['Prise neutre (pouces vers le haut).', 'Coudes fixes le long du corps.', 'Descente complète et contrôlée.']
  },
  bayesian_curl: {
    name: 'Curl Bayesian à la poulie', equip: 'poulie', perSide: true, increment: 1.25,
    refLoad: 2.8, refStatus: 'provisoire', technique: 'a_revoir',
    refNote: 'Premier essai 2,8 kg : technique et amplitude à corriger avant d’augmenter.',
    lastKnown: '2,8 kg (premier essai) — technique et amplitude à corriger',
    tips: ['Dos à la poulie, bras tiré légèrement en arrière du corps.', 'Amplitude complète : bras tendu en bas.', 'Coude fixe ; corrige l’amplitude avant d’augmenter.']
  },
  ez_curl: {
    name: 'Curl à la barre EZ', equip: 'barre', increment: 2.5,
    refLoad: 10, refStatus: 'provisoire', technique: 'ok',
    refNote: 'Premier essai : 10 kg × 10 (référence provisoire).', lastKnown: '10 kg × 10 (premier essai)',
    tips: ['Coudes fixes, pas de balancement du buste.', 'Monte sans avancer les coudes.', 'Descente lente jusqu’à extension quasi complète.']
  },
  reverse_pec_deck: {
    name: 'Reverse pec deck', equip: 'machine', increment: 2.5,
    refLoad: 18, refStatus: 'provisoire', technique: 'ok',
    refNote: 'Premier essai : 18 kg × 15 (référence provisoire).', lastKnown: '18 kg × 15 (premier essai)',
    tips: ['Poitrine contre le dossier, bras presque tendus.', 'Ouvre les bras en pensant à l’arrière des épaules.', 'Ne hausse pas les épaules, retour lent.']
  },
  hip_thrust: {
    name: 'Hip thrust à la machine', equip: 'machine', increment: 2.5,
    refLoad: 42, refStatus: 'provisoire', technique: 'a_revoir',
    suggestedLoad: 27.5,
    suggestedReason: 'Technique à revoir (quadriceps et ischios fatiguent avant les fessiers) : essaie plus léger, 25 à 30 kg si la machine le permet. Pas d’augmentation avant de maîtriser le placement des pieds.',
    lastKnown: '42 kg — 8/8/8, technique à revoir',
    tips: ['Placement des pieds : tibias verticaux en haut du mouvement.', 'Bassin en rétroversion (menton rentré, côtes basses), pousse avec les talons.', 'Contracte les fessiers 1 s en haut ; si quadriceps ou ischios dominent, ajuste les pieds et allège.']
  },
  rdl: {
    name: 'Soulevé de terre roumain (RDL)', equip: 'barre', increment: 2.5,
    refLoad: 30, refStatus: 'provisoire', technique: 'a_revoir',
    suggestedLoad: 30,
    suggestedReason: 'Conserver 30 kg uniquement si l’exécution est propre ; sinon réduire. Technique à revoir.',
    lastKnown: '30 kg — 8/8/8, technique à revoir',
    tips: ['Genoux légèrement fléchis et fixes.', 'Pousse les hanches vers l’arrière, barre près des jambes, dos neutre.', 'Descends tant que le dos reste plat, remonte en serrant les fessiers.']
  },
  cable_kickback: {
    name: 'Kickback à la poulie', equip: 'poulie', perSide: true, increment: 1.25,
    refLoad: null, refStatus: 'inconnue', technique: 'ok', lastKnown: 'Non effectué (pas de sangle de cheville)',
    tips: ['Sangle de cheville nécessaire.', 'Buste légèrement penché, bassin stable.', 'Pousse la jambe vers l’arrière avec le fessier, sans cambrer le bas du dos.']
  },
  abduction: {
    name: 'Abduction à la machine', equip: 'machine', increment: 2.5,
    refLoad: 40, refStatus: 'estimation', technique: 'ok',
    refNote: 'Environ 40 kg (affichage difficile à lire) : valeur à confirmer.',
    lastKnown: '≈ 40 kg — 12/12/12, bonnes sensations dans les fessiers',
    tips: ['Buste légèrement penché en avant pour mieux cibler les fessiers.', 'Ouvre en contrôle, marque 1 s en position ouverte.', 'Retour lent sans laisser les charges claquer.']
  }
};

/* sets = séries prévues, minSets = minimum acceptable, min/max = fourchette de répétitions */
const PROGRAM = {
  push: [
    { ex: 'chest_press', sets: 3, min: 8, max: 8 },
    { ex: 'incline_press', sets: 3, min: 8, max: 8 },
    { ex: 'pec_deck', sets: 2, min: 12, max: 12 },
    { ex: 'lateral_raise', sets: 3, min: 12, max: 12, note: 'Environ 2 répétitions en réserve. Évite de hausser les épaules.' },
    { ex: 'triceps_pushdown', sets: 3, minSets: 2, min: 10, max: 12, note: '2 à 3 séries : la 3e est facultative.' },
    { ex: 'shoulder_press', sets: 3, min: 8, max: 12, conditional: 'shoulderPress' },
    { ex: 'crunch_machine', sets: 3, min: 10, max: 15 },
    { ex: 'dead_bug', sets: 2, min: 8, max: 12 }
  ],
  pull: [
    { ex: 'lat_pulldown', sets: 3, min: 8, max: 12 },
    { ex: 'row_machine', sets: 3, min: 8, max: 12 },
    { ex: 'hammer_curl', sets: 2, min: 10, max: 12 },
    { ex: 'bayesian_curl', sets: 2, min: 10, max: 15 },
    { ex: 'ez_curl', sets: 2, min: 10, max: 12 },
    { ex: 'reverse_pec_deck', sets: 2, min: 12, max: 15 }
  ],
  legs: [
    { ex: 'hip_thrust', sets: 3, min: 8, max: 8 },
    { ex: 'rdl', sets: 3, min: 8, max: 8 },
    { ex: 'cable_kickback', sets: 3, min: 12, max: 12, note: 'Nécessite une sangle de cheville.' },
    { ex: 'abduction', sets: 3, min: 12, max: 12 }
  ],
  upper: [
    { ex: 'incline_press', sets: 2, min: 8, max: 12 },
    { ex: 'lat_pulldown', sets: 3, min: 8, max: 12 },
    { ex: 'row_machine', sets: 2, min: 8, max: 12 },
    { ex: 'lateral_raise', sets: 2, min: 12, max: 15 },
    { ex: 'ez_curl', sets: 2, min: 10, max: 12 },
    { ex: 'triceps_pushdown', sets: 2, min: 10, max: 12 },
    { ex: 'crunch_machine', sets: 3, min: 10, max: 15 },
    { ex: 'dead_bug', sets: 2, min: 8, max: 12 }
  ],
  lower: [
    { ex: 'hip_thrust', sets: 2, min: 10, max: 10, note: 'Séance plus légère que Legs : commence léger si nécessaire.' },
    { ex: 'rdl', sets: 2, min: 10, max: 10, note: 'Priorité à la technique.' },
    { ex: 'cable_kickback', sets: 2, min: 12, max: 12 },
    { ex: 'abduction', sets: 2, min: 15, max: 15 }
  ]
};
