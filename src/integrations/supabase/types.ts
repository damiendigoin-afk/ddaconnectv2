export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          account_number: string | null
          address: string | null
          address_extra: string | null
          city: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          mobile: string | null
          phone: string | null
          postal_code: string | null
        }
        Insert: {
          account_number?: string | null
          address?: string | null
          address_extra?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          phone?: string | null
          postal_code?: string | null
        }
        Update: {
          account_number?: string | null
          address?: string | null
          address_extra?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          phone?: string | null
          postal_code?: string | null
        }
        Relationships: []
      }
      dms_update_proposals: {
        Row: {
          created_at: string
          field: string
          id: string
          inspection_id: string | null
          new_value: string | null
          old_value: string | null
          status: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          inspection_id?: string | null
          new_value?: string | null
          old_value?: string | null
          status?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          inspection_id?: string | null
          new_value?: string | null
          old_value?: string | null
          status?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dms_update_proposals_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dms_update_proposals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          inspection_id: string | null
          kind: string
          provider_id: string | null
          recipient: string
          status: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          inspection_id?: string | null
          kind?: string
          provider_id?: string | null
          recipient: string
          status?: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          inspection_id?: string | null
          kind?: string
          provider_id?: string | null
          recipient?: string
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      expertise_damages: {
        Row: {
          ai_suggestion: Json | null
          annotation_data: Json | null
          comment: string | null
          cost_pending: boolean
          created_at: string
          created_by: string | null
          damage_number: number
          damage_type: string | null
          estimated_cost: number | null
          expertise_id: string
          id: string
          photo_id: string | null
          recommended_action: string | null
          updated_at: string
          vehicle_zone: string | null
        }
        Insert: {
          ai_suggestion?: Json | null
          annotation_data?: Json | null
          comment?: string | null
          cost_pending?: boolean
          created_at?: string
          created_by?: string | null
          damage_number?: number
          damage_type?: string | null
          estimated_cost?: number | null
          expertise_id: string
          id?: string
          photo_id?: string | null
          recommended_action?: string | null
          updated_at?: string
          vehicle_zone?: string | null
        }
        Update: {
          ai_suggestion?: Json | null
          annotation_data?: Json | null
          comment?: string | null
          cost_pending?: boolean
          created_at?: string
          created_by?: string | null
          damage_number?: number
          damage_type?: string | null
          estimated_cost?: number | null
          expertise_id?: string
          id?: string
          photo_id?: string | null
          recommended_action?: string | null
          updated_at?: string
          vehicle_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expertise_damages_expertise_id_fkey"
            columns: ["expertise_id"]
            isOneToOne: false
            referencedRelation: "vehicle_expertises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expertise_damages_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "expertise_photos"
            referencedColumns: ["id"]
          },
        ]
      }
      expertise_photos: {
        Row: {
          category: string
          created_at: string
          expertise_id: string
          id: string
          label: string | null
          photo_type: string
          report_path: string | null
          required: boolean
          sequence: number
          storage_path: string
        }
        Insert: {
          category?: string
          created_at?: string
          expertise_id: string
          id?: string
          label?: string | null
          photo_type: string
          report_path?: string | null
          required?: boolean
          sequence?: number
          storage_path: string
        }
        Update: {
          category?: string
          created_at?: string
          expertise_id?: string
          id?: string
          label?: string | null
          photo_type?: string
          report_path?: string | null
          required?: boolean
          sequence?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "expertise_photos_expertise_id_fkey"
            columns: ["expertise_id"]
            isOneToOne: false
            referencedRelation: "vehicle_expertises"
            referencedColumns: ["id"]
          },
        ]
      }
      field_changes: {
        Row: {
          changed_by: string | null
          changed_by_name: string | null
          created_at: string
          entity_id: string
          entity_type: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      inspection_points: {
        Row: {
          client_comment: string | null
          comment: string | null
          created_at: string
          id: string
          inspection_id: string
          measure_unit: string | null
          measure_value: string | null
          point_key: string
          point_label: string
          status: string
          updated_at: string
          zone_index: number
          zone_key: string
          zone_label: string
        }
        Insert: {
          client_comment?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          inspection_id: string
          measure_unit?: string | null
          measure_value?: string | null
          point_key: string
          point_label: string
          status?: string
          updated_at?: string
          zone_index: number
          zone_key: string
          zone_label: string
        }
        Update: {
          client_comment?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          inspection_id?: string
          measure_unit?: string | null
          measure_value?: string | null
          point_key?: string
          point_label?: string
          status?: string
          updated_at?: string
          zone_index?: number
          zone_key?: string
          zone_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_points_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          created_at: string
          id: string
          inspection_id: string | null
          inspection_point_id: string | null
          label: string | null
          media_type: string
          observation_id: string | null
          repair_order_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          inspection_id?: string | null
          inspection_point_id?: string | null
          label?: string | null
          media_type?: string
          observation_id?: string | null
          repair_order_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          inspection_id?: string | null
          inspection_point_id?: string | null
          label?: string | null
          media_type?: string
          observation_id?: string | null
          repair_order_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_inspection_point_id_fkey"
            columns: ["inspection_point_id"]
            isOneToOne: false
            referencedRelation: "inspection_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_history: {
        Row: {
          created_at: string
          id: string
          inspection_id: string | null
          media_id: string | null
          mileage: number
          source: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inspection_id?: string | null
          media_id?: string | null
          mileage: number
          source?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inspection_id?: string | null
          media_id?: string | null
          mileage?: number
          source?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_history_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          category: string
          client_comment: string | null
          comment: string | null
          created_at: string
          element: string
          id: string
          inspection_id: string
          measure_unit: string | null
          measure_value: string | null
          status: string
        }
        Insert: {
          category: string
          client_comment?: string | null
          comment?: string | null
          created_at?: string
          element: string
          id?: string
          inspection_id: string
          measure_unit?: string | null
          measure_value?: string | null
          status?: string
        }
        Update: {
          category?: string
          client_comment?: string | null
          comment?: string | null
          created_at?: string
          element?: string
          id?: string
          inspection_id?: string
          measure_unit?: string | null
          measure_value?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "observations_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          site_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_orders: {
        Row: {
          client_id: string | null
          client_remarks: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          delivery_at: string | null
          entry_at: string | null
          id: string
          mileage_in: number | null
          or_date: string | null
          or_number: string | null
          requested_work: string | null
          site_id: string | null
          status: string
          vehicle_id: string
        }
        Insert: {
          client_id?: string | null
          client_remarks?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delivery_at?: string | null
          entry_at?: string | null
          id?: string
          mileage_in?: number | null
          or_date?: string | null
          or_number?: string | null
          requested_work?: string | null
          site_id?: string | null
          status?: string
          vehicle_id: string
        }
        Update: {
          client_id?: string | null
          client_remarks?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delivery_at?: string | null
          entry_at?: string | null
          id?: string
          mileage_in?: number | null
          or_date?: string | null
          or_number?: string | null
          requested_work?: string | null
          site_id?: string | null
          status?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_price_rules: {
        Row: {
          action: string
          active: boolean
          amount: number | null
          created_at: string
          damage_type: string | null
          id: string
          label: string
          manual_only: boolean
          site_id: string | null
          updated_at: string
        }
        Insert: {
          action: string
          active?: boolean
          amount?: number | null
          created_at?: string
          damage_type?: string | null
          id?: string
          label: string
          manual_only?: boolean
          site_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          active?: boolean
          amount?: number | null
          created_at?: string
          damage_type?: string | null
          id?: string
          label?: string
          manual_only?: boolean
          site_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_price_rules_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          created_at: string
          email_from_address: string
          email_from_name: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_from_address?: string
          email_from_name?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_from_address?: string
          email_from_name?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_expertises: {
        Row: {
          brand: string | null
          client_id: string | null
          color: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          energy: string | null
          expertise_type: string
          exterior_condition: string | null
          first_registration: string | null
          general_comment: string | null
          id: string
          interior_condition: string | null
          keys_count: string | null
          last_sent_at: string | null
          last_sent_to: string | null
          mileage: number | null
          model: string | null
          owner_name: string | null
          plate: string | null
          registration_doc: string
          repair_order_id: string | null
          share_token: string
          site_id: string | null
          status: string
          step: string
          updated_at: string
          vehicle_id: string | null
          version: string | null
          vin: string | null
        }
        Insert: {
          brand?: string | null
          client_id?: string | null
          color?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          energy?: string | null
          expertise_type?: string
          exterior_condition?: string | null
          first_registration?: string | null
          general_comment?: string | null
          id?: string
          interior_condition?: string | null
          keys_count?: string | null
          last_sent_at?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          model?: string | null
          owner_name?: string | null
          plate?: string | null
          registration_doc?: string
          repair_order_id?: string | null
          share_token?: string
          site_id?: string | null
          status?: string
          step?: string
          updated_at?: string
          vehicle_id?: string | null
          version?: string | null
          vin?: string | null
        }
        Update: {
          brand?: string | null
          client_id?: string | null
          color?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          energy?: string | null
          expertise_type?: string
          exterior_condition?: string | null
          first_registration?: string | null
          general_comment?: string | null
          id?: string
          interior_condition?: string | null
          keys_count?: string | null
          last_sent_at?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          model?: string | null
          owner_name?: string | null
          plate?: string | null
          registration_doc?: string
          repair_order_id?: string | null
          share_token?: string
          site_id?: string | null
          status?: string
          step?: string
          updated_at?: string
          vehicle_id?: string | null
          version?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_expertises_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expertises_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expertises_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expertises_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_inspections: {
        Row: {
          client_content_updated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          current_zone_index: number
          id: string
          inspection_type: string
          last_sent_at: string | null
          last_sent_by: string | null
          last_sent_by_name: string | null
          last_sent_to: string | null
          mileage: number | null
          repair_order_id: string
          share_token: string
          site_id: string | null
          started_at: string
          status: string
          vehicle_id: string
        }
        Insert: {
          client_content_updated_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          current_zone_index?: number
          id?: string
          inspection_type: string
          last_sent_at?: string | null
          last_sent_by?: string | null
          last_sent_by_name?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          repair_order_id: string
          share_token?: string
          site_id?: string | null
          started_at?: string
          status?: string
          vehicle_id: string
        }
        Update: {
          client_content_updated_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          current_zone_index?: number
          id?: string
          inspection_type?: string
          last_sent_at?: string | null
          last_sent_by?: string | null
          last_sent_by_name?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          repair_order_id?: string
          share_token?: string
          site_id?: string | null
          started_at?: string
          status?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_inspections_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_inspections_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string | null
          client_id: string | null
          created_at: string
          first_registration: string | null
          id: string
          last_mileage: number | null
          last_mileage_at: string | null
          model: string | null
          plate: string
          plate_normalized: string
          vin: string | null
        }
        Insert: {
          brand?: string | null
          client_id?: string | null
          created_at?: string
          first_registration?: string | null
          id?: string
          last_mileage?: number | null
          last_mileage_at?: string | null
          model?: string | null
          plate: string
          plate_normalized: string
          vin?: string | null
        }
        Update: {
          brand?: string | null
          client_id?: string | null
          created_at?: string
          first_registration?: string | null
          id?: string
          last_mileage?: number | null
          last_mileage_at?: string | null
          model?: string | null
          plate?: string
          plate_normalized?: string
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "manager" | "salarie" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["manager", "salarie", "client"],
    },
  },
} as const
