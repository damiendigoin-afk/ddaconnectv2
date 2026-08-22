/** Structures partagées de l'analyse pneumatique (client et serveur). */

export type TireWheelAi = {
  brand: string | null;
  model: string | null;
  size: string | null;
  load_index: string | null;
  speed_index: string | null;
  season: string | null;
  dot: string | null;
  depth_mm: number | null;
  depth_kind: "mesure" | "estimation" | null;
  wear: "reguliere" | "irreguliere" | null;
  wear_zone: string | null;
  cracks: boolean;
  cuts: boolean;
  bulges: boolean;
  foreign_objects: boolean;
  sidewall_damage: boolean;
  rim_damage: boolean;
  photo_quality: "bonne" | "moyenne" | "insuffisante";
  confidence: Record<string, string>;
  observations: string[];
  client_comment: string | null;
  unreadable: string[];
  model_used: string;
};

export type TireLabelAi = {
  size_front: string | null;
  size_rear: string | null;
  load_index_front: string | null;
  speed_index_front: string | null;
  load_index_rear: string | null;
  speed_index_rear: string | null;
  pressure_front: number | null;
  pressure_rear: number | null;
  pressure_front_loaded: number | null;
  pressure_rear_loaded: number | null;
  spare_size: string | null;
  spare_pressure: number | null;
  readable: boolean;
  unreadable: string[];
  model_used: string;
};
