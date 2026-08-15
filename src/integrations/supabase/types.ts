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
      repair_orders: {
        Row: {
          client_id: string | null
          client_remarks: string | null
          created_at: string
          delivery_at: string | null
          entry_at: string | null
          id: string
          mileage_in: number | null
          or_date: string | null
          or_number: string | null
          requested_work: string | null
          status: string
          vehicle_id: string
        }
        Insert: {
          client_id?: string | null
          client_remarks?: string | null
          created_at?: string
          delivery_at?: string | null
          entry_at?: string | null
          id?: string
          mileage_in?: number | null
          or_date?: string | null
          or_number?: string | null
          requested_work?: string | null
          status?: string
          vehicle_id: string
        }
        Update: {
          client_id?: string | null
          client_remarks?: string | null
          created_at?: string
          delivery_at?: string | null
          entry_at?: string | null
          id?: string
          mileage_in?: number | null
          or_date?: string | null
          or_number?: string | null
          requested_work?: string | null
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
            foreignKeyName: "repair_orders_vehicle_id_fkey"
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
          current_zone_index: number
          id: string
          inspection_type: string
          last_sent_at: string | null
          last_sent_to: string | null
          mileage: number | null
          repair_order_id: string
          share_token: string
          started_at: string
          status: string
          vehicle_id: string
        }
        Insert: {
          client_content_updated_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_zone_index?: number
          id?: string
          inspection_type: string
          last_sent_at?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          repair_order_id: string
          share_token?: string
          started_at?: string
          status?: string
          vehicle_id: string
        }
        Update: {
          client_content_updated_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_zone_index?: number
          id?: string
          inspection_type?: string
          last_sent_at?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          repair_order_id?: string
          share_token?: string
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
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
