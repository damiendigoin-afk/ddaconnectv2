export type PointDef = {
  key: string;
  label: string;
  measure?: { unit: string; label: string };
  special?: "mileage";
};

export type ZoneDef = {
  key: string;
  label: string;
  hint: string;
  points: PointDef[];
};

const wheel = (side: string, code: string): PointDef[] => [
  {
    key: `pneu_${code}`,
    label: `Pneu ${side}`,
    measure: { unit: "mm", label: "Profondeur" },
  },
  { key: `jante_${code}`, label: `Jante / enjoliveur ${side}` },
  {
    key: `frein_${code}`,
    label: `Frein ${side}`,
    measure: { unit: "mm", label: "Épaisseur plaquette" },
  },
  { key: `visible_${code}`, label: `Éléments visibles ${side}` },
];

export const GUIDED_ZONES: ZoneDef[] = [
  {
    key: "habitacle",
    label: "Habitacle",
    hint: "Installez-vous au poste de conduite.",
    points: [
      { key: "kilometrage", label: "Kilométrage compteur", special: "mileage" },
      { key: "voyants", label: "Voyants au tableau de bord" },
      { key: "frein_parking", label: "Frein de parking" },
      { key: "climatisation", label: "Climatisation / chauffage" },
      { key: "filtre_habitacle", label: "Filtre habitacle" },
      { key: "ceintures", label: "Ceintures de sécurité" },
      { key: "avertisseur", label: "Avertisseur sonore" },
      { key: "proprete_int", label: "Propreté intérieure" },
    ],
  },
  {
    key: "depart",
    label: "Départ côté conducteur",
    hint: "Placez-vous côté conducteur, portière fermée.",
    points: [
      { key: "aspect_general", label: "Aspect général du véhicule" },
      { key: "porte_avg", label: "Portière conducteur / serrure" },
      { key: "retroviseur_g", label: "Rétroviseur gauche" },
      { key: "proprete", label: "Propreté / état extérieur" },
    ],
  },
  {
    key: "avant_gauche",
    label: "Avant gauche",
    hint: "Passez maintenant à l'angle avant gauche.",
    points: wheel("AVG", "avg"),
  },
  {
    key: "face_avant",
    label: "Face avant",
    hint: "Placez-vous devant le véhicule.",
    points: [
      { key: "optique_avg", label: "Optique avant gauche" },
      { key: "optique_avd", label: "Optique avant droit" },
      { key: "feux_avant", label: "Feux de croisement / route" },
      { key: "pare_choc_avant", label: "Pare-chocs / calandre" },
      { key: "pare_brise", label: "Pare-brise" },
      { key: "essuie_glaces", label: "Balais essuie-glaces" },
    ],
  },
  {
    key: "avant_droit",
    label: "Avant droit",
    hint: "Contournez par l'angle avant droit.",
    points: wheel("AVD", "avd"),
  },
  {
    key: "cote_droit",
    label: "Côté droit",
    hint: "Longez le côté droit du véhicule.",
    points: [
      { key: "carrosserie_d", label: "Carrosserie côté droit" },
      { key: "portes_d", label: "Portières droites" },
      { key: "retroviseur_d", label: "Rétroviseur droit" },
      { key: "vitrage_d", label: "Vitrage côté droit" },
      { key: "bas_caisse_d", label: "Bas de caisse droit" },
    ],
  },
  {
    key: "arriere_droit",
    label: "Arrière droit",
    hint: "Placez-vous à l'angle arrière droit.",
    points: wheel("ARD", "ard"),
  },
  {
    key: "arriere",
    label: "Arrière du véhicule",
    hint: "Placez-vous derrière le véhicule.",
    points: [
      { key: "feux_arriere", label: "Feux arrière / stop" },
      { key: "pare_choc_arriere", label: "Pare-chocs arrière" },
      { key: "lunette_arriere", label: "Lunette arrière / essuie-glace" },
      { key: "hayon", label: "Hayon / coffre" },
      { key: "plaque_arriere", label: "Plaque / éclairage plaque" },
      { key: "roue_secours", label: "Roue de secours / kit" },
    ],
  },
  {
    key: "arriere_gauche",
    label: "Arrière gauche",
    hint: "Contournez par l'angle arrière gauche.",
    points: wheel("ARG", "arg"),
  },
  {
    key: "cote_gauche",
    label: "Côté gauche",
    hint: "Remontez le long du côté gauche.",
    points: [
      { key: "carrosserie_g", label: "Carrosserie côté gauche" },
      { key: "portes_g", label: "Portières gauches" },
      { key: "vitrage_g", label: "Vitrage côté gauche" },
      { key: "bas_caisse_g", label: "Bas de caisse gauche" },
      { key: "trappe_carburant", label: "Trappe à carburant" },
    ],
  },
  {
    key: "sous_capot",
    label: "Sous capot",
    hint: "Ouvrez le capot moteur.",
    points: [
      { key: "huile_moteur", label: "Niveau huile moteur" },
      { key: "liquide_refroidissement", label: "Liquide de refroidissement" },
      { key: "liquide_frein", label: "Liquide de frein", measure: { unit: "%", label: "Teneur eau" } },
      { key: "lave_glace", label: "Lave-glace" },
      { key: "batterie", label: "Batterie", measure: { unit: "V", label: "Tension" } },
      { key: "courroies", label: "Courroies / accessoires" },
      { key: "fuites_moteur", label: "Fuites visibles" },
      { key: "filtre_air", label: "Filtre à air" },
      { key: "etat_general_moteur", label: "État général compartiment" },
    ],
  },
  {
    key: "sous_vehicule",
    label: "Sous véhicule / sur pont",
    hint: "Levez le véhicule sur le pont.",
    points: [
      { key: "soufflets", label: "Soufflets de transmission" },
      { key: "flexibles", label: "Flexibles de frein" },
      { key: "fuites_dessous", label: "Fuites sous véhicule" },
      { key: "echappement", label: "Ligne d'échappement" },
      { key: "trains_roulants", label: "Trains roulants / rotules" },
      { key: "suspension", label: "Suspension / amortisseurs" },
      { key: "direction", label: "Direction" },
      { key: "freinage_accessible", label: "Éléments de freinage accessibles" },
      { key: "sous_caisse", label: "Sous caisse / corrosion" },
    ],
  },
];

export const FREE_CATEGORIES: Record<string, string[]> = {
  "Pneus / roues": [
    "Pneu avant gauche",
    "Pneu avant droit",
    "Pneu arrière gauche",
    "Pneu arrière droit",
    "Jante / enjoliveur",
    "Roue de secours",
  ],
  Freinage: [
    "Plaquettes avant",
    "Plaquettes arrière",
    "Disques avant",
    "Disques arrière",
    "Flexibles",
    "Frein de parking",
  ],
  "Éclairage": [
    "Optique avant gauche",
    "Optique avant droit",
    "Feu arrière gauche",
    "Feu arrière droit",
    "Éclairage plaque",
    "Clignotants",
  ],
  "Pare-brise / vitrage": ["Pare-brise", "Lunette arrière", "Vitre latérale", "Rétroviseur"],
  "Essuie-glaces": ["Balai avant gauche", "Balai avant droit", "Balai arrière"],
  Batterie: ["Batterie", "Cosses", "Charge / alternateur"],
  Niveaux: [
    "Huile moteur",
    "Liquide de refroidissement",
    "Liquide de frein",
    "Lave-glace",
    "AdBlue",
  ],
  "Mécanique": [
    "Courroie accessoires",
    "Échappement",
    "Suspension",
    "Direction",
    "Transmission",
    "Fuite moteur",
  ],
  Carrosserie: ["Pare-chocs", "Portière", "Aile", "Capot", "Hayon", "Bas de caisse"],
  Autre: ["Autre élément"],
};

export const STATUS_LABELS: Record<string, string> = {
  unset: "Non renseigné",
  ok: "OK",
  watch: "À surveiller",
  defect: "Défaut",
};