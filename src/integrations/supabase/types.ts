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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_imports: {
        Row: {
          anomalies: Json
          created_at: string
          file_name: string | null
          id: string
          imported_by: string | null
          imported_by_name: string | null
          months_count: number
          site_code: string
          values_count: number
        }
        Insert: {
          anomalies?: Json
          created_at?: string
          file_name?: string | null
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          months_count?: number
          site_code: string
          values_count?: number
        }
        Update: {
          anomalies?: Json
          created_at?: string
          file_name?: string | null
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          months_count?: number
          site_code?: string
          values_count?: number
        }
        Relationships: []
      }
      activity_months: {
        Row: {
          created_at: string
          id: string
          import_id: string | null
          period_start: string
          sheet_name: string | null
          site_code: string
          status: string
          status_manual: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          import_id?: string | null
          period_start: string
          sheet_name?: string | null
          site_code: string
          status?: string
          status_manual?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          import_id?: string | null
          period_start?: string
          sheet_name?: string | null
          site_code?: string
          status?: string
          status_manual?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_months_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "activity_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_values: {
        Row: {
          indicator_key: string
          month_id: string
          value: number | null
        }
        Insert: {
          indicator_key: string
          month_id: string
          value?: number | null
        }
        Update: {
          indicator_key?: string
          month_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_values_month_id_fkey"
            columns: ["month_id"]
            isOneToOne: false
            referencedRelation: "activity_months"
            referencedColumns: ["id"]
          },
        ]
      }
      agreements: {
        Row: {
          active: boolean
          commission_rate: number | null
          created_at: string
          discount_rate: number | null
          erd: string | null
          glue_kit: string | null
          id: string
          igp_n: number | null
          igp_o: number | null
          igp_v: number | null
          insurer_id: string | null
          name: string
          network: string | null
          notes: string | null
          paint_rate: number | null
          replacement_vehicle: string | null
          site_id: string | null
          special_rules: string | null
          t1: number | null
          t2: number | null
          t3: number | null
          tx_peint: number | null
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          commission_rate?: number | null
          created_at?: string
          discount_rate?: number | null
          erd?: string | null
          glue_kit?: string | null
          id?: string
          igp_n?: number | null
          igp_o?: number | null
          igp_v?: number | null
          insurer_id?: string | null
          name: string
          network?: string | null
          notes?: string | null
          paint_rate?: number | null
          replacement_vehicle?: string | null
          site_id?: string | null
          special_rules?: string | null
          t1?: number | null
          t2?: number | null
          t3?: number | null
          tx_peint?: number | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          commission_rate?: number | null
          created_at?: string
          discount_rate?: number | null
          erd?: string | null
          glue_kit?: string | null
          id?: string
          igp_n?: number | null
          igp_o?: number | null
          igp_v?: number | null
          insurer_id?: string | null
          name?: string
          network?: string | null
          notes?: string | null
          paint_rate?: number | null
          replacement_vehicle?: string | null
          site_id?: string | null
          special_rules?: string | null
          t1?: number | null
          t2?: number | null
          t3?: number | null
          tx_peint?: number | null
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreements_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_budget_settings: {
        Row: {
          daily_credits: number
          fallback_ai_enabled: boolean
          id: string
          max_credits_per_operation: number
          monthly_credits: number
          updated_at: string
        }
        Insert: {
          daily_credits?: number
          fallback_ai_enabled?: boolean
          id?: string
          max_credits_per_operation?: number
          monthly_credits?: number
          updated_at?: string
        }
        Update: {
          daily_credits?: number
          fallback_ai_enabled?: boolean
          id?: string
          max_credits_per_operation?: number
          monthly_credits?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_cache: {
        Row: {
          content: string
          created_at: string
          feature: string
          fingerprint: string
          hits: number
          last_used_at: string
          model: string
        }
        Insert: {
          content: string
          created_at?: string
          feature: string
          fingerprint: string
          hits?: number
          last_used_at?: string
          model: string
        }
        Update: {
          content?: string
          created_at?: string
          feature?: string
          fingerprint?: string
          hits?: number
          last_used_at?: string
          model?: string
        }
        Relationships: []
      }
      ai_corrections: {
        Row: {
          ai_confidence: string | null
          ai_result: Json | null
          context: string | null
          corrected: boolean
          created_at: string
          final_result: Json | null
          human_result: Json | null
          id: string
          media_id: string | null
          module: string
          plate: string | null
          ref_vehicle_id: string | null
          source_id: string | null
          subject: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_result?: Json | null
          context?: string | null
          corrected?: boolean
          created_at?: string
          final_result?: Json | null
          human_result?: Json | null
          id?: string
          media_id?: string | null
          module: string
          plate?: string | null
          ref_vehicle_id?: string | null
          source_id?: string | null
          subject: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_result?: Json | null
          context?: string | null
          corrected?: boolean
          created_at?: string
          final_result?: Json | null
          human_result?: Json | null
          id?: string
          media_id?: string | null
          module?: string
          plate?: string | null
          ref_vehicle_id?: string | null
          source_id?: string | null
          subject?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          blocked_reason: string | null
          cache_hit: boolean
          calls: number
          created_at: string
          duration_ms: number | null
          entity: string | null
          estimated_credits: number
          feature: string
          fingerprint: string | null
          http_status: number | null
          id: string
          model: string | null
          provider: string
          retries: number
          site_id: string | null
          success: boolean
          tokens_in: number | null
          tokens_out: number | null
          user_id: string | null
        }
        Insert: {
          blocked_reason?: string | null
          cache_hit?: boolean
          calls?: number
          created_at?: string
          duration_ms?: number | null
          entity?: string | null
          estimated_credits?: number
          feature: string
          fingerprint?: string | null
          http_status?: number | null
          id?: string
          model?: string | null
          provider?: string
          retries?: number
          site_id?: string | null
          success?: boolean
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Update: {
          blocked_reason?: string | null
          cache_hit?: boolean
          calls?: number
          created_at?: string
          duration_ms?: number | null
          entity?: string | null
          estimated_credits?: number
          feature?: string
          fingerprint?: string | null
          http_status?: number | null
          id?: string
          model?: string | null
          provider?: string
          retries?: number
          site_id?: string | null
          success?: boolean
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      automation_jobs: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          job_key: string
          label: string
          last_message: string | null
          last_run_at: string | null
          last_status: string | null
          schedule: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          job_key: string
          label: string
          last_message?: string | null
          last_run_at?: string | null
          last_status?: string | null
          schedule?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          job_key?: string
          label?: string
          last_message?: string | null
          last_run_at?: string | null
          last_status?: string | null
          schedule?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          created_at: string
          details: Json | null
          finished_at: string | null
          id: string
          job_id: string | null
          message: string | null
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          finished_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          finished_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "automation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_cases: {
        Row: {
          agreement_id: string | null
          amount_depreciation_expected: number | null
          amount_depreciation_received: number | null
          amount_franchise_expected: number | null
          amount_franchise_received: number | null
          amount_insurer_expected: number | null
          amount_insurer_received: number | null
          amount_other_expected: number | null
          amount_other_received: number | null
          amount_total_ht: number | null
          amount_total_ttc: number | null
          amount_vat_expected: number | null
          amount_vat_received: number | null
          appointment_at: string | null
          blocker: string | null
          case_state: string
          claim_number: string | null
          client_id: string | null
          closed_at: string | null
          comments: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          depreciation: number | null
          entry_at: string | null
          expected_return_at: string | null
          expert_firm_id: string | null
          expert_id: string | null
          franchise: number | null
          id: string
          insurer_id: string | null
          is_hail: boolean
          is_vge: boolean
          mission_date: string
          mission_number: string | null
          mission_origin: string
          next_action: string | null
          or_number: string | null
          payer: string | null
          physical_state: string
          plate: string | null
          ref_vehicle_id: string | null
          repair_order_id: string | null
          site_id: string | null
          subcontract_expected_at: string | null
          subcontract_notes: string | null
          subcontract_returned_at: string | null
          subcontract_sent_at: string | null
          subcontractor: string | null
          updated_at: string
          vat_rate: number | null
          vehicle_id: string | null
          vehicle_label: string | null
          vin: string | null
          work_location: string
        }
        Insert: {
          agreement_id?: string | null
          amount_depreciation_expected?: number | null
          amount_depreciation_received?: number | null
          amount_franchise_expected?: number | null
          amount_franchise_received?: number | null
          amount_insurer_expected?: number | null
          amount_insurer_received?: number | null
          amount_other_expected?: number | null
          amount_other_received?: number | null
          amount_total_ht?: number | null
          amount_total_ttc?: number | null
          amount_vat_expected?: number | null
          amount_vat_received?: number | null
          appointment_at?: string | null
          blocker?: string | null
          case_state?: string
          claim_number?: string | null
          client_id?: string | null
          closed_at?: string | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          depreciation?: number | null
          entry_at?: string | null
          expected_return_at?: string | null
          expert_firm_id?: string | null
          expert_id?: string | null
          franchise?: number | null
          id?: string
          insurer_id?: string | null
          is_hail?: boolean
          is_vge?: boolean
          mission_date?: string
          mission_number?: string | null
          mission_origin?: string
          next_action?: string | null
          or_number?: string | null
          payer?: string | null
          physical_state?: string
          plate?: string | null
          ref_vehicle_id?: string | null
          repair_order_id?: string | null
          site_id?: string | null
          subcontract_expected_at?: string | null
          subcontract_notes?: string | null
          subcontract_returned_at?: string | null
          subcontract_sent_at?: string | null
          subcontractor?: string | null
          updated_at?: string
          vat_rate?: number | null
          vehicle_id?: string | null
          vehicle_label?: string | null
          vin?: string | null
          work_location?: string
        }
        Update: {
          agreement_id?: string | null
          amount_depreciation_expected?: number | null
          amount_depreciation_received?: number | null
          amount_franchise_expected?: number | null
          amount_franchise_received?: number | null
          amount_insurer_expected?: number | null
          amount_insurer_received?: number | null
          amount_other_expected?: number | null
          amount_other_received?: number | null
          amount_total_ht?: number | null
          amount_total_ttc?: number | null
          amount_vat_expected?: number | null
          amount_vat_received?: number | null
          appointment_at?: string | null
          blocker?: string | null
          case_state?: string
          claim_number?: string | null
          client_id?: string | null
          closed_at?: string | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          depreciation?: number | null
          entry_at?: string | null
          expected_return_at?: string | null
          expert_firm_id?: string | null
          expert_id?: string | null
          franchise?: number | null
          id?: string
          insurer_id?: string | null
          is_hail?: boolean
          is_vge?: boolean
          mission_date?: string
          mission_number?: string | null
          mission_origin?: string
          next_action?: string | null
          or_number?: string | null
          payer?: string | null
          physical_state?: string
          plate?: string | null
          ref_vehicle_id?: string | null
          repair_order_id?: string | null
          site_id?: string | null
          subcontract_expected_at?: string | null
          subcontract_notes?: string | null
          subcontract_returned_at?: string | null
          subcontract_sent_at?: string | null
          subcontractor?: string | null
          updated_at?: string
          vat_rate?: number | null
          vehicle_id?: string | null
          vehicle_label?: string | null
          vin?: string | null
          work_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_cases_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_expert_firm_id_fkey"
            columns: ["expert_firm_id"]
            isOneToOne: false
            referencedRelation: "expert_firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_ref_vehicle_id_fkey"
            columns: ["ref_vehicle_id"]
            isOneToOne: false
            referencedRelation: "ref_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_cases_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_communications: {
        Row: {
          body: string | null
          case_id: string
          channel: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          error_message: string | null
          id: string
          recipient: string | null
          sent_at: string | null
          status: string
          subject: string | null
          template_key: string | null
        }
        Insert: {
          body?: string | null
          case_id: string
          channel?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          error_message?: string | null
          id?: string
          recipient?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_key?: string | null
        }
        Update: {
          body?: string | null
          case_id?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          error_message?: string | null
          id?: string
          recipient?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_communications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_documents: {
        Row: {
          analysis: Json | null
          analysis_status: string
          case_id: string
          category: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          doc_type: string
          file_name: string | null
          file_size: number | null
          id: string
          label: string | null
          mime_type: string | null
          origin: string | null
          storage_path: string
        }
        Insert: {
          analysis?: Json | null
          analysis_status?: string
          case_id: string
          category?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          doc_type?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          label?: string | null
          mime_type?: string | null
          origin?: string | null
          storage_path: string
        }
        Update: {
          analysis?: Json | null
          analysis_status?: string
          case_id?: string
          category?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          doc_type?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          label?: string | null
          mime_type?: string | null
          origin?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_events: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          detail: string | null
          id: string
          kind: string
          label: string
          occurred_at: string
          source: string
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          detail?: string | null
          id?: string
          kind: string
          label: string
          occurred_at?: string
          source?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          detail?: string | null
          id?: string
          kind?: string
          label?: string
          occurred_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_parts: {
        Row: {
          case_id: string
          created_at: string
          id: string
          is_deposit: boolean
          label: string
          notes: string | null
          ordered_at: string | null
          quantity: number
          received_at: string | null
          reference: string | null
          status: string
          supplier_id: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          is_deposit?: boolean
          label: string
          notes?: string | null
          ordered_at?: string | null
          quantity?: number
          received_at?: string | null
          reference?: string | null
          status?: string
          supplier_id?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          is_deposit?: boolean
          label?: string
          notes?: string | null
          ordered_at?: string | null
          quantity?: number
          received_at?: string | null
          reference?: string | null
          status?: string
          supplier_id?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_parts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodyshop_parts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_payments: {
        Row: {
          amount: number
          case_id: string
          created_at: string
          id: string
          kind: string
          notes: string | null
          received_at: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          case_id: string
          created_at?: string
          id?: string
          kind: string
          notes?: string | null
          received_at?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          case_id?: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          received_at?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_payments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_supplements: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          delay_impact_days: number | null
          description: string | null
          id: string
          photos: string[]
          responded_at: string | null
          response: string | null
          sent_at: string | null
          sent_to: string | null
          status: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delay_impact_days?: number | null
          description?: string | null
          id?: string
          photos?: string[]
          responded_at?: string | null
          response?: string | null
          sent_at?: string | null
          sent_to?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delay_impact_days?: number | null
          description?: string | null
          id?: string
          photos?: string[]
          responded_at?: string | null
          response?: string | null
          sent_at?: string | null
          sent_to?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_supplements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      bodyshop_tasks: {
        Row: {
          case_id: string
          created_at: string
          detail: string | null
          done: boolean
          done_at: string | null
          done_by: string | null
          due_date: string | null
          id: string
          label: string
          origin: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          detail?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          id?: string
          label: string
          origin?: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          detail?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          id?: string
          label?: string
          origin?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodyshop_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
        ]
      }
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
      commercial_settings: {
        Row: {
          ai_severity_level: string
          id: string
          margin_pct: number
          min_margin_ht: number
          tire_depth_good_mm: number
          tire_depth_legal_mm: number
          tire_depth_soon_mm: number
          tire_provider_last_ok_at: string | null
          tire_provider_message: string | null
          tire_provider_status: string | null
          tire_supplier: string
          tire_supplier_configured: boolean
          updated_at: string
        }
        Insert: {
          ai_severity_level?: string
          id?: string
          margin_pct?: number
          min_margin_ht?: number
          tire_depth_good_mm?: number
          tire_depth_legal_mm?: number
          tire_depth_soon_mm?: number
          tire_provider_last_ok_at?: string | null
          tire_provider_message?: string | null
          tire_provider_status?: string | null
          tire_supplier?: string
          tire_supplier_configured?: boolean
          updated_at?: string
        }
        Update: {
          ai_severity_level?: string
          id?: string
          margin_pct?: number
          min_margin_ht?: number
          tire_depth_good_mm?: number
          tire_depth_legal_mm?: number
          tire_depth_soon_mm?: number
          tire_provider_last_ok_at?: string | null
          tire_provider_message?: string | null
          tire_provider_status?: string | null
          tire_supplier?: string
          tire_supplier_configured?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      credit_note_lines: {
        Row: {
          amount: number | null
          created_at: string
          credit_note_id: string
          id: string
          label: string | null
          matched: boolean
          quantity: number | null
          reference: string | null
          return_line_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          credit_note_id: string
          id?: string
          label?: string | null
          matched?: boolean
          quantity?: number | null
          reference?: string | null
          return_line_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          credit_note_id?: string
          id?: string
          label?: string | null
          matched?: boolean
          quantity?: number | null
          reference?: string | null
          return_line_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_lines_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_lines_return_line_id_fkey"
            columns: ["return_line_id"]
            isOneToOne: false
            referencedRelation: "part_return_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          analysis: Json | null
          created_at: string
          created_by: string | null
          credit_date: string | null
          id: string
          number: string | null
          status: string
          storage_path: string | null
          supplier_id: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          analysis?: Json | null
          created_at?: string
          created_by?: string | null
          credit_date?: string | null
          id?: string
          number?: string | null
          status?: string
          storage_path?: string | null
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          analysis?: Json | null
          created_at?: string
          created_by?: string | null
          credit_date?: string | null
          id?: string
          number?: string | null
          status?: string
          storage_path?: string | null
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_request_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          id: string
          kind: string
          message: string | null
          request_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          kind: string
          message?: string | null
          request_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          kind?: string
          message?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "crm_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_requests: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          body: string | null
          channel: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          due_at: string | null
          escalation_level: number
          id: string
          last_action_at: string
          outcome: string | null
          outcome_note: string | null
          plate: string | null
          priority: string
          reference: string | null
          site_id: string | null
          status: string
          subject: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          assignee_id?: string | null
          assignee_name?: string | null
          body?: string | null
          channel?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          due_at?: string | null
          escalation_level?: number
          id?: string
          last_action_at?: string
          outcome?: string | null
          outcome_note?: string | null
          plate?: string | null
          priority?: string
          reference?: string | null
          site_id?: string | null
          status?: string
          subject: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          assignee_id?: string | null
          assignee_name?: string | null
          body?: string | null
          channel?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          due_at?: string | null
          escalation_level?: number
          id?: string
          last_action_at?: string
          outcome?: string | null
          outcome_note?: string | null
          plate?: string | null
          priority?: string
          reference?: string | null
          site_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_requests_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          active: boolean
          address_line_1: string | null
          address_line_2: string | null
          address_line_3: string | null
          city: string | null
          country: string | null
          created_at: string
          customer_id: string
          id: string
          postal_code: string | null
          source: string
          source_import_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          customer_id: string
          id?: string
          postal_code?: string | null
          source?: string
          source_import_id?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          postal_code?: string | null
          source?: string
          source_import_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consents: {
        Row: {
          allowed: boolean | null
          channel: string
          created_at: string
          customer_id: string
          id: string
          raw_value: string | null
          source: string
          source_import_id: string | null
          updated_at: string
        }
        Insert: {
          allowed?: boolean | null
          channel: string
          created_at?: string
          customer_id: string
          id?: string
          raw_value?: string | null
          source?: string
          source_import_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed?: boolean | null
          channel?: string
          created_at?: string
          customer_id?: string
          id?: string
          raw_value?: string | null
          source?: string
          source_import_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consents_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          active: boolean
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          normalized_value: string | null
          source: string
          source_import_id: string | null
          type: string
          updated_at: string
          value: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          normalized_value?: string | null
          source?: string
          source_import_id?: string | null
          type: string
          updated_at?: string
          value: string
        }
        Update: {
          active?: boolean
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          normalized_value?: string | null
          source?: string
          source_import_id?: string | null
          type?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_contacts_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_vehicle_relations: {
        Row: {
          active: boolean
          created_at: string
          customer_id: string
          end_date: string | null
          id: string
          import_id: string | null
          relationship_type: string
          source: string
          start_date: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          customer_id: string
          end_date?: string | null
          id?: string
          import_id?: string | null
          relationship_type?: string
          source?: string
          start_date?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          customer_id?: string
          end_date?: string | null
          id?: string
          import_id?: string | null
          relationship_type?: string
          source?: string
          start_date?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_vehicle_relations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_vehicle_relations_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_vehicle_relations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "ref_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          civility: string | null
          company_name: string | null
          company_normalized: string | null
          created_at: string
          customer_type: string
          first_name: string | null
          first_name_normalized: string | null
          id: string
          import_id: string | null
          last_name: string | null
          last_name_normalized: string | null
          notes: string | null
          siren: string | null
          siret: string | null
          site_id: string | null
          source_customer_id: string | null
          source_system: string
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          civility?: string | null
          company_name?: string | null
          company_normalized?: string | null
          created_at?: string
          customer_type?: string
          first_name?: string | null
          first_name_normalized?: string | null
          id?: string
          import_id?: string | null
          last_name?: string | null
          last_name_normalized?: string | null
          notes?: string | null
          siren?: string | null
          siret?: string | null
          site_id?: string | null
          source_customer_id?: string | null
          source_system?: string
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          civility?: string | null
          company_name?: string | null
          company_normalized?: string | null
          created_at?: string
          customer_type?: string
          first_name?: string | null
          first_name_normalized?: string | null
          id?: string
          import_id?: string | null
          last_name?: string | null
          last_name_normalized?: string | null
          notes?: string | null
          siren?: string | null
          siret?: string | null
          site_id?: string | null
          source_customer_id?: string | null
          source_system?: string
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      darva_flows: {
        Row: {
          amount: number | null
          case_id: string | null
          claim_ref: string | null
          created_at: string
          created_by: string | null
          direction: string
          id: string
          insurer: string | null
          message_type: string
          notes: string | null
          occurred_at: string
          plate: string | null
          reference: string | null
          site_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          case_id?: string | null
          claim_ref?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          insurer?: string | null
          message_type?: string
          notes?: string | null
          occurred_at?: string
          plate?: string | null
          reference?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          case_id?: string | null
          claim_ref?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          insurer?: string | null
          message_type?: string
          notes?: string | null
          occurred_at?: string
          plate?: string | null
          reference?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "darva_flows_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "darva_flows_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
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
      email_accounts: {
        Row: {
          address: string
          backfill_complete: boolean
          backfill_page_token: string | null
          created_at: string
          gmail_connected: boolean
          history_id: string | null
          id: string
          label: string | null
          last_error: string | null
          last_message_at: string | null
          last_sync_at: string | null
          last_sync_count: number
          provider: string
          site_id: string | null
          status: string
          sync_cursor: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address: string
          backfill_complete?: boolean
          backfill_page_token?: string | null
          created_at?: string
          gmail_connected?: boolean
          history_id?: string | null
          id?: string
          label?: string | null
          last_error?: string | null
          last_message_at?: string | null
          last_sync_at?: string | null
          last_sync_count?: number
          provider?: string
          site_id?: string | null
          status?: string
          sync_cursor?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string
          backfill_complete?: boolean
          backfill_page_token?: string | null
          created_at?: string
          gmail_connected?: boolean
          history_id?: string | null
          id?: string
          label?: string | null
          last_error?: string | null
          last_message_at?: string | null
          last_sync_at?: string | null
          last_sync_count?: number
          provider?: string
          site_id?: string | null
          status?: string
          sync_cursor?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      email_attachments: {
        Row: {
          created_at: string
          email_id: string
          filename: string
          gmail_attachment_id: string | null
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          email_id: string
          filename: string
          gmail_attachment_id?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          email_id?: string
          filename?: string
          gmail_attachment_id?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
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
      email_oauth_tokens: {
        Row: {
          access_token: string | null
          account_id: string
          created_at: string
          expires_at: string | null
          id: string
          provider: string
          refresh_token: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          account_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          account_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_oauth_tokens_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_receipts: {
        Row: {
          account_id: string | null
          created_at: string
          email_id: string
          gmail_message_id: string | null
          id: string
          mailbox_address: string
          person_name: string | null
          received_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          email_id: string
          gmail_message_id?: string | null
          id?: string
          mailbox_address: string
          person_name?: string | null
          received_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          email_id?: string
          gmail_message_id?: string | null
          id?: string
          mailbox_address?: string
          person_name?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_receipts_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_rules: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          match_type: string
          match_value: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          match_type: string
          match_value: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          match_type?: string
          match_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      emails: {
        Row: {
          action_required: boolean
          body_html: string | null
          body_text: string | null
          category: string
          category_confidence: number
          category_source: string
          cc_addresses: string[]
          client_id: string | null
          created_at: string
          detected_plate: string | null
          due_at: string | null
          expires_at: string | null
          fingerprint: string
          from_address: string
          from_name: string | null
          gmail_thread_id: string | null
          has_attachments: boolean
          human_required: boolean
          id: string
          importance: string
          kind: string
          link_status: string
          rfc_message_id: string | null
          sent_at: string
          services: string[]
          site_id: string | null
          snippet: string | null
          subject: string | null
          thread_key: string | null
          to_addresses: string[]
          triage_confidence: string
          triage_reason: string | null
          triage_status: string
          updated_at: string
          urgency: string
          vehicle_id: string | null
        }
        Insert: {
          action_required?: boolean
          body_html?: string | null
          body_text?: string | null
          category?: string
          category_confidence?: number
          category_source?: string
          cc_addresses?: string[]
          client_id?: string | null
          created_at?: string
          detected_plate?: string | null
          due_at?: string | null
          expires_at?: string | null
          fingerprint: string
          from_address: string
          from_name?: string | null
          gmail_thread_id?: string | null
          has_attachments?: boolean
          human_required?: boolean
          id?: string
          importance?: string
          kind?: string
          link_status?: string
          rfc_message_id?: string | null
          sent_at: string
          services?: string[]
          site_id?: string | null
          snippet?: string | null
          subject?: string | null
          thread_key?: string | null
          to_addresses?: string[]
          triage_confidence?: string
          triage_reason?: string | null
          triage_status?: string
          updated_at?: string
          urgency?: string
          vehicle_id?: string | null
        }
        Update: {
          action_required?: boolean
          body_html?: string | null
          body_text?: string | null
          category?: string
          category_confidence?: number
          category_source?: string
          cc_addresses?: string[]
          client_id?: string | null
          created_at?: string
          detected_plate?: string | null
          due_at?: string | null
          expires_at?: string | null
          fingerprint?: string
          from_address?: string
          from_name?: string | null
          gmail_thread_id?: string | null
          has_attachments?: boolean
          human_required?: boolean
          id?: string
          importance?: string
          kind?: string
          link_status?: string
          rfc_message_id?: string | null
          sent_at?: string
          services?: string[]
          site_id?: string | null
          snippet?: string | null
          subject?: string | null
          thread_key?: string | null
          to_addresses?: string[]
          triage_confidence?: string
          triage_reason?: string | null
          triage_status?: string
          updated_at?: string
          urgency?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_notes: {
        Row: {
          amount_ttc: number
          category: string
          created_at: string
          id: string
          merchant: string | null
          notes: string | null
          receipt_path: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          site_id: string | null
          spent_on: string
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
          user_name: string | null
          vat_amount: number | null
        }
        Insert: {
          amount_ttc?: number
          category?: string
          created_at?: string
          id?: string
          merchant?: string | null
          notes?: string | null
          receipt_path?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          site_id?: string | null
          spent_on?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
          user_name?: string | null
          vat_amount?: number | null
        }
        Update: {
          amount_ttc?: number
          category?: string
          created_at?: string
          id?: string
          merchant?: string | null
          notes?: string | null
          receipt_path?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          site_id?: string | null
          spent_on?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
          user_name?: string | null
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_notes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_firms: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          ead_email: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          ead_email?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          ead_email?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
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
          element_size: string | null
          estimated_cost: number | null
          expertise_id: string
          id: string
          intervention: string | null
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
          element_size?: string | null
          estimated_cost?: number | null
          expertise_id: string
          id?: string
          intervention?: string | null
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
          element_size?: string | null
          estimated_cost?: number | null
          expertise_id?: string
          id?: string
          intervention?: string | null
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
      experts: {
        Row: {
          active: boolean
          created_at: string
          ead_email: string | null
          email: string | null
          firm_id: string | null
          first_name: string | null
          id: string
          last_name: string | null
          mobile: string | null
          notes: string | null
          phone: string | null
          supplement_email: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          ead_email?: string | null
          email?: string | null
          firm_id?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          supplement_email?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          ead_email?: string | null
          email?: string | null
          firm_id?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          supplement_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experts_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "expert_firms"
            referencedColumns: ["id"]
          },
        ]
      }
      external_refs: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          entity_id: string
          entity_type: string
          external_id: string
          id: string
          import_id: string | null
          match_criteria: Json
          match_score: number | null
          match_status: string
          system: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          external_id: string
          id?: string
          import_id?: string | null
          match_criteria?: Json
          match_score?: number | null
          match_status?: string
          system?: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          external_id?: string
          id?: string
          import_id?: string | null
          match_criteria?: Json
          match_score?: number | null
          match_status?: string
          system?: string
          updated_at?: string
        }
        Relationships: []
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
      field_provenance: {
        Row: {
          changed_by: string | null
          created_at: string
          entity_id: string
          entity_type: string
          field: string
          id: string
          import_id: string | null
          source: string
          source_date: string | null
          updated_at: string
          value: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          field: string
          id?: string
          import_id?: string | null
          source: string
          source_date?: string | null
          updated_at?: string
          value?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          field?: string
          id?: string
          import_id?: string | null
          source?: string
          source_date?: string | null
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_provenance_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          file_fingerprint: string | null
          file_name: string
          file_size: number | null
          id: string
          job_key: string
          kind: string
          state: Json
          status: string
          total_pages: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          file_fingerprint?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          job_key: string
          kind: string
          state?: Json
          status?: string
          total_pages?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          file_fingerprint?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          job_key?: string
          kind?: string
          state?: Json
          status?: string
          total_pages?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      import_rows: {
        Row: {
          corrected_data: Json | null
          created_at: string
          id: string
          import_id: string
          processing_errors: string[] | null
          processing_status: string
          raw_data: Json
          resolved_at: string | null
          resolved_by: string | null
          row_number: number
          source_customer_id: string | null
          source_vehicle_id: string | null
        }
        Insert: {
          corrected_data?: Json | null
          created_at?: string
          id?: string
          import_id: string
          processing_errors?: string[] | null
          processing_status?: string
          raw_data: Json
          resolved_at?: string | null
          resolved_by?: string | null
          row_number: number
          source_customer_id?: string | null
          source_vehicle_id?: string | null
        }
        Update: {
          corrected_data?: Json | null
          created_at?: string
          id?: string
          import_id?: string
          processing_errors?: string[] | null
          processing_status?: string
          raw_data?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          row_number?: number
          source_customer_id?: string | null
          source_vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          addresses_imported: number
          analysis: Json | null
          anomalies: number
          completed_at: string | null
          contacts_imported: number
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customers_created: number
          customers_updated: number
          duplicates_avoided: number
          file_name: string
          file_size: number | null
          id: string
          mileages_imported: number
          processed_rows: number
          relations_created: number
          site_id: string | null
          source_system: string
          status: string
          total_columns: number
          total_rows: number
          updated_at: string
          vehicles_created: number
          vehicles_updated: number
        }
        Insert: {
          addresses_imported?: number
          analysis?: Json | null
          anomalies?: number
          completed_at?: string | null
          contacts_imported?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customers_created?: number
          customers_updated?: number
          duplicates_avoided?: number
          file_name: string
          file_size?: number | null
          id?: string
          mileages_imported?: number
          processed_rows?: number
          relations_created?: number
          site_id?: string | null
          source_system?: string
          status?: string
          total_columns?: number
          total_rows?: number
          updated_at?: string
          vehicles_created?: number
          vehicles_updated?: number
        }
        Update: {
          addresses_imported?: number
          analysis?: Json | null
          anomalies?: number
          completed_at?: string | null
          contacts_imported?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customers_created?: number
          customers_updated?: number
          duplicates_avoided?: number
          file_name?: string
          file_size?: number | null
          id?: string
          mileages_imported?: number
          processed_rows?: number
          relations_created?: number
          site_id?: string | null
          source_system?: string
          status?: string
          total_columns?: number
          total_rows?: number
          updated_at?: string
          vehicles_created?: number
          vehicles_updated?: number
        }
        Relationships: [
          {
            foreignKeyName: "imports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_documents: {
        Row: {
          classified_at: string | null
          classified_by: string | null
          classified_by_name: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_name: string | null
          doc_type: string | null
          extracted: Json
          file_name: string
          file_size: number | null
          id: string
          linked_id: string | null
          linked_kind: string | null
          mime_type: string | null
          note: string | null
          plate: string | null
          site_id: string | null
          status: string
          storage_path: string
        }
        Insert: {
          classified_at?: string | null
          classified_by?: string | null
          classified_by_name?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_name?: string | null
          doc_type?: string | null
          extracted?: Json
          file_name: string
          file_size?: number | null
          id?: string
          linked_id?: string | null
          linked_kind?: string | null
          mime_type?: string | null
          note?: string | null
          plate?: string | null
          site_id?: string | null
          status?: string
          storage_path: string
        }
        Update: {
          classified_at?: string | null
          classified_by?: string | null
          classified_by_name?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_name?: string | null
          doc_type?: string | null
          extracted?: Json
          file_name?: string
          file_size?: number | null
          id?: string
          linked_id?: string | null
          linked_kind?: string | null
          mime_type?: string | null
          note?: string | null
          plate?: string | null
          site_id?: string | null
          status?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_documents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_points: {
        Row: {
          ai_confidence: string | null
          battery_media_id: string | null
          battery_test: Json | null
          client_comment: string | null
          comment: string | null
          created_at: string
          ct_due_date: string | null
          ct_manually_corrected: boolean
          ct_read_at: string | null
          ct_source: string | null
          id: string
          inspection_id: string
          measure_unit: string | null
          measure_value: string | null
          photo_quality: string | null
          point_key: string
          point_label: string
          pollution_due_date: string | null
          status: string
          tire_analysis: Json | null
          tire_label: Json | null
          tire_sidewall: Json | null
          updated_at: string
          zone_index: number
          zone_key: string
          zone_label: string
        }
        Insert: {
          ai_confidence?: string | null
          battery_media_id?: string | null
          battery_test?: Json | null
          client_comment?: string | null
          comment?: string | null
          created_at?: string
          ct_due_date?: string | null
          ct_manually_corrected?: boolean
          ct_read_at?: string | null
          ct_source?: string | null
          id?: string
          inspection_id: string
          measure_unit?: string | null
          measure_value?: string | null
          photo_quality?: string | null
          point_key: string
          point_label: string
          pollution_due_date?: string | null
          status?: string
          tire_analysis?: Json | null
          tire_label?: Json | null
          tire_sidewall?: Json | null
          updated_at?: string
          zone_index: number
          zone_key: string
          zone_label: string
        }
        Update: {
          ai_confidence?: string | null
          battery_media_id?: string | null
          battery_test?: Json | null
          client_comment?: string | null
          comment?: string | null
          created_at?: string
          ct_due_date?: string | null
          ct_manually_corrected?: boolean
          ct_read_at?: string | null
          ct_source?: string | null
          id?: string
          inspection_id?: string
          measure_unit?: string | null
          measure_value?: string | null
          photo_quality?: string | null
          point_key?: string
          point_label?: string
          pollution_due_date?: string | null
          status?: string
          tire_analysis?: Json | null
          tire_label?: Json | null
          tire_sidewall?: Json | null
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
      insurers: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      integration_credentials: {
        Row: {
          created_at: string
          password_enc: string
          provider: string
          updated_at: string
          updated_by: string | null
          username_enc: string
        }
        Insert: {
          created_at?: string
          password_enc: string
          provider: string
          updated_at?: string
          updated_by?: string | null
          username_enc: string
        }
        Update: {
          created_at?: string
          password_enc?: string
          provider?: string
          updated_at?: string
          updated_by?: string | null
          username_enc?: string
        }
        Relationships: []
      }
      intervention_tasks: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          description: string | null
          due_at: string | null
          id: string
          intervention_id: string
          label: string
          position: number
          priority: string
          status: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignee_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          intervention_id: string
          label: string
          position?: number
          priority?: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignee_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          intervention_id?: string
          label?: string
          position?: number
          priority?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_tasks_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          category: string
          created_at: string
          id: string
          pinned: boolean
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          category?: string
          created_at?: string
          id?: string
          pinned?: boolean
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          category?: string
          created_at?: string
          id?: string
          pinned?: boolean
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_alerts: {
        Row: {
          alert_type: string
          created_at: string
          customer_name: string | null
          due_date: string | null
          due_km: number | null
          id: string
          km_per_month: number | null
          last_km: number | null
          last_seen_at: string | null
          notes: string | null
          plate: string | null
          ref_vehicle_id: string | null
          risk: string
          site_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          alert_type?: string
          created_at?: string
          customer_name?: string | null
          due_date?: string | null
          due_km?: number | null
          id?: string
          km_per_month?: number | null
          last_km?: number | null
          last_seen_at?: string | null
          notes?: string | null
          plate?: string | null
          ref_vehicle_id?: string | null
          risk?: string
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          customer_name?: string | null
          due_date?: string | null
          due_km?: number | null
          id?: string
          km_per_month?: number | null
          last_km?: number | null
          last_seen_at?: string | null
          notes?: string | null
          plate?: string | null
          ref_vehicle_id?: string | null
          risk?: string
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_alerts_ref_vehicle_id_fkey"
            columns: ["ref_vehicle_id"]
            isOneToOne: false
            referencedRelation: "ref_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
          thumb_path: string | null
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
          thumb_path?: string | null
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
          thumb_path?: string | null
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
      merge_log: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          details: Json
          entity_kind: string
          id: string
          kept_id: string
          merged_id: string
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json
          entity_kind: string
          id?: string
          kept_id: string
          merged_id: string
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json
          entity_kind?: string
          id?: string
          kept_id?: string
          merged_id?: string
          reason?: string | null
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          key: string
          label: string
          subject: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          key: string
          label: string
          subject?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      metric_thresholds: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_value: number | null
          metric_key: string
          min_value: number | null
          site_id: string | null
          target_value: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_value?: number | null
          metric_key: string
          min_value?: number | null
          site_id?: string | null
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_value?: number | null
          metric_key?: string
          min_value?: number | null
          site_id?: string | null
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_thresholds_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
      paint_element_rules: {
        Row: {
          active: boolean
          created_at: string
          dr_operations: Json
          element_key: string
          element_size: string
          id: string
          label: string
          paint_hours: number
          repair_hours_default: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          dr_operations?: Json
          element_key: string
          element_size: string
          id?: string
          label: string
          paint_hours: number
          repair_hours_default?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          dr_operations?: Json
          element_key?: string
          element_size?: string
          id?: string
          label?: string
          paint_hours?: number
          repair_hours_default?: number
          updated_at?: string
        }
        Relationships: []
      }
      part_return_lines: {
        Row: {
          annotation_hint: string | null
          bodyshop_part_id: string | null
          confidence: string | null
          created_at: string
          credited_amount: number | null
          credited_quantity: number
          deposit_amount: number | null
          discount: number | null
          id: string
          item_type: string
          label: string | null
          line_total: number | null
          notes: string | null
          photo_path: string | null
          quantity: number
          reference: string | null
          return_id: string
          status: string
          suggested: boolean
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          annotation_hint?: string | null
          bodyshop_part_id?: string | null
          confidence?: string | null
          created_at?: string
          credited_amount?: number | null
          credited_quantity?: number
          deposit_amount?: number | null
          discount?: number | null
          id?: string
          item_type?: string
          label?: string | null
          line_total?: number | null
          notes?: string | null
          photo_path?: string | null
          quantity?: number
          reference?: string | null
          return_id: string
          status?: string
          suggested?: boolean
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          annotation_hint?: string | null
          bodyshop_part_id?: string | null
          confidence?: string | null
          created_at?: string
          credited_amount?: number | null
          credited_quantity?: number
          deposit_amount?: number | null
          discount?: number | null
          id?: string
          item_type?: string
          label?: string | null
          line_total?: number | null
          notes?: string | null
          photo_path?: string | null
          quantity?: number
          reference?: string | null
          return_id?: string
          status?: string
          suggested?: boolean
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_return_lines_bodyshop_part_id_fkey"
            columns: ["bodyshop_part_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "part_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      part_returns: {
        Row: {
          accord_comment: string | null
          accord_refusal_reason: string | null
          accord_requested_at: string | null
          accord_response_at: string | null
          accord_status: string | null
          analysis: Json | null
          bl_number: string | null
          carrier: string | null
          case_id: string | null
          closed_at: string | null
          closed_by_name: string | null
          closure_comment: string | null
          closure_reason: string | null
          comments: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          credited_amount: number | null
          deadline_date: string | null
          deposit_amount: number
          document_date: string | null
          document_kind: string | null
          document_path: string | null
          escalated_at: string | null
          escalated_reason: string | null
          expected_amount: number | null
          handover_at: string | null
          handover_company: string | null
          handover_mode: string | null
          handover_note: string | null
          handover_person: string | null
          handover_place: string | null
          id: string
          invoice_number: string | null
          last_reminder_at: string | null
          notice_sent_at: string | null
          or_number: string | null
          photos: string[]
          plate: string | null
          reason: string | null
          reception_comment: string | null
          reception_confirmed_at: string | null
          reception_requested_at: string | null
          reception_status: string | null
          ref_vehicle_id: string | null
          reference: string
          reminder_count: number
          repair_order_id: string | null
          return_type: string
          share_enabled: boolean
          share_token: string | null
          shipment_mail_sent_at: string | null
          shipment_note: string | null
          shipment_photo: string | null
          shipped_at: string | null
          shipped_by: string | null
          site_id: string | null
          status: string
          supplier_id: string | null
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          accord_comment?: string | null
          accord_refusal_reason?: string | null
          accord_requested_at?: string | null
          accord_response_at?: string | null
          accord_status?: string | null
          analysis?: Json | null
          bl_number?: string | null
          carrier?: string | null
          case_id?: string | null
          closed_at?: string | null
          closed_by_name?: string | null
          closure_comment?: string | null
          closure_reason?: string | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          credited_amount?: number | null
          deadline_date?: string | null
          deposit_amount?: number
          document_date?: string | null
          document_kind?: string | null
          document_path?: string | null
          escalated_at?: string | null
          escalated_reason?: string | null
          expected_amount?: number | null
          handover_at?: string | null
          handover_company?: string | null
          handover_mode?: string | null
          handover_note?: string | null
          handover_person?: string | null
          handover_place?: string | null
          id?: string
          invoice_number?: string | null
          last_reminder_at?: string | null
          notice_sent_at?: string | null
          or_number?: string | null
          photos?: string[]
          plate?: string | null
          reason?: string | null
          reception_comment?: string | null
          reception_confirmed_at?: string | null
          reception_requested_at?: string | null
          reception_status?: string | null
          ref_vehicle_id?: string | null
          reference?: string
          reminder_count?: number
          repair_order_id?: string | null
          return_type?: string
          share_enabled?: boolean
          share_token?: string | null
          shipment_mail_sent_at?: string | null
          shipment_note?: string | null
          shipment_photo?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          site_id?: string | null
          status?: string
          supplier_id?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          accord_comment?: string | null
          accord_refusal_reason?: string | null
          accord_requested_at?: string | null
          accord_response_at?: string | null
          accord_status?: string | null
          analysis?: Json | null
          bl_number?: string | null
          carrier?: string | null
          case_id?: string | null
          closed_at?: string | null
          closed_by_name?: string | null
          closure_comment?: string | null
          closure_reason?: string | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          credited_amount?: number | null
          deadline_date?: string | null
          deposit_amount?: number
          document_date?: string | null
          document_kind?: string | null
          document_path?: string | null
          escalated_at?: string | null
          escalated_reason?: string | null
          expected_amount?: number | null
          handover_at?: string | null
          handover_company?: string | null
          handover_mode?: string | null
          handover_note?: string | null
          handover_person?: string | null
          handover_place?: string | null
          id?: string
          invoice_number?: string | null
          last_reminder_at?: string | null
          notice_sent_at?: string | null
          or_number?: string | null
          photos?: string[]
          plate?: string | null
          reason?: string | null
          reception_comment?: string | null
          reception_confirmed_at?: string | null
          reception_requested_at?: string | null
          reception_status?: string | null
          ref_vehicle_id?: string | null
          reference?: string
          reminder_count?: number
          repair_order_id?: string | null
          return_type?: string
          share_enabled?: boolean
          share_token?: string | null
          shipment_mail_sent_at?: string | null
          shipment_note?: string | null
          shipment_photo?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          site_id?: string | null
          status?: string
          supplier_id?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_returns_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "bodyshop_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_returns_ref_vehicle_id_fkey"
            columns: ["ref_vehicle_id"]
            isOneToOne: false
            referencedRelation: "ref_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_returns_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_returns_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_returns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_grids: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pricing_quote_lines: {
        Row: {
          block: string
          client_comment: string | null
          client_response: string
          computation: Json | null
          confidence: string
          created_at: string
          detail: string | null
          hours: number | null
          id: string
          label: string
          media_id: string | null
          needs_contact: boolean
          origin_point_key: string | null
          price_source: string
          priority: string
          quantity: number
          quote_id: string
          responded_at: string | null
          sort_order: number
          total_ht: number
          total_ttc: number
          unit_ht: number | null
          updated_at: string
        }
        Insert: {
          block?: string
          client_comment?: string | null
          client_response?: string
          computation?: Json | null
          confidence?: string
          created_at?: string
          detail?: string | null
          hours?: number | null
          id?: string
          label: string
          media_id?: string | null
          needs_contact?: boolean
          origin_point_key?: string | null
          price_source?: string
          priority?: string
          quantity?: number
          quote_id: string
          responded_at?: string | null
          sort_order?: number
          total_ht?: number
          total_ttc?: number
          unit_ht?: number | null
          updated_at?: string
        }
        Update: {
          block?: string
          client_comment?: string | null
          client_response?: string
          computation?: Json | null
          confidence?: string
          created_at?: string
          detail?: string | null
          hours?: number | null
          id?: string
          label?: string
          media_id?: string | null
          needs_contact?: boolean
          origin_point_key?: string | null
          price_source?: string
          priority?: string
          quantity?: number
          quote_id?: string
          responded_at?: string | null
          sort_order?: number
          total_ht?: number
          total_ttc?: number
          unit_ht?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_quote_lines_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "pricing_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_quotes: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          plate: string | null
          rates_snapshot: Json | null
          ref_vehicle_id: string | null
          repair_order_id: string | null
          sent_at: string | null
          share_token: string
          site_id: string | null
          source_id: string | null
          source_module: string
          status: string
          total_ht: number
          total_ttc: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          plate?: string | null
          rates_snapshot?: Json | null
          ref_vehicle_id?: string | null
          repair_order_id?: string | null
          sent_at?: string | null
          share_token?: string
          site_id?: string | null
          source_id?: string | null
          source_module: string
          status?: string
          total_ht?: number
          total_ttc?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          plate?: string | null
          rates_snapshot?: Json | null
          ref_vehicle_id?: string | null
          repair_order_id?: string | null
          sent_at?: string | null
          share_token?: string
          site_id?: string | null
          source_id?: string | null
          source_module?: string
          status?: string
          total_ht?: number
          total_ttc?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_rates: {
        Row: {
          amount_ht: number | null
          amount_ttc: number | null
          category: string
          code: string
          created_at: string
          grid_id: string
          id: string
          label: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          amount_ht?: number | null
          amount_ttc?: number | null
          category: string
          code: string
          created_at?: string
          grid_id: string
          id?: string
          label: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          amount_ht?: number | null
          amount_ttc?: number | null
          category?: string
          code?: string
          created_at?: string
          grid_id?: string
          id?: string
          label?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rates_grid_id_fkey"
            columns: ["grid_id"]
            isOneToOne: false
            referencedRelation: "pricing_grids"
            referencedColumns: ["id"]
          },
        ]
      }
      productivity_entries: {
        Row: {
          created_at: string
          hours_billed: number | null
          hours_purchased: number | null
          hours_spent: number | null
          id: string
          import_id: string
          period_end: string
          period_start: string
          productivity_ratio: number | null
          profitability_ratio: number | null
          site_id: string | null
          updated_at: string
          user_id: string | null
          winmotor_name: string
        }
        Insert: {
          created_at?: string
          hours_billed?: number | null
          hours_purchased?: number | null
          hours_spent?: number | null
          id?: string
          import_id: string
          period_end: string
          period_start: string
          productivity_ratio?: number | null
          profitability_ratio?: number | null
          site_id?: string | null
          updated_at?: string
          user_id?: string | null
          winmotor_name: string
        }
        Update: {
          created_at?: string
          hours_billed?: number | null
          hours_purchased?: number | null
          hours_spent?: number | null
          id?: string
          import_id?: string
          period_end?: string
          period_start?: string
          productivity_ratio?: number | null
          profitability_ratio?: number | null
          site_id?: string | null
          updated_at?: string
          user_id?: string | null
          winmotor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "productivity_entries_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "productivity_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productivity_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      productivity_imports: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          imported_by: string | null
          imported_by_name: string | null
          kind: string
          period_end: string
          period_start: string
          replaced_by: string | null
          site_id: string | null
          site_label: string | null
          status: string
          storage_path: string | null
          totals: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          kind?: string
          period_end: string
          period_start: string
          replaced_by?: string | null
          site_id?: string | null
          site_label?: string | null
          status?: string
          storage_path?: string | null
          totals?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          kind?: string
          period_end?: string
          period_start?: string
          replaced_by?: string | null
          site_id?: string | null
          site_label?: string | null
          status?: string
          storage_path?: string | null
          totals?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "productivity_imports_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "productivity_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productivity_imports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
          gmail_allowed: boolean
          id: string
          last_name: string | null
          site_id: string | null
          site_scope: string
          status: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          gmail_allowed?: boolean
          id: string
          last_name?: string | null
          site_id?: string | null
          site_scope?: string
          status?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          gmail_allowed?: boolean
          id?: string
          last_name?: string | null
          site_id?: string | null
          site_scope?: string
          status?: string
          updated_at?: string
          username?: string | null
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
      ref_vehicles: {
        Row: {
          body_type: string | null
          brand: string | null
          cnit: string | null
          co2_g_km: number | null
          color: string | null
          created_at: string
          ct_due_date: string | null
          ct_manually_corrected: boolean
          ct_photo_media_id: string | null
          ct_read_at: string | null
          ct_source: string | null
          curb_weight_kg: number | null
          d2_code: string | null
          delivery_date: string | null
          doors: number | null
          energy: string | null
          engine_code: string | null
          engine_size: string | null
          first_registration_date: string | null
          fiscal_power: number | null
          gearbox: string | null
          gearbox_code: string | null
          gvw_kg: number | null
          homologated_tire_size: string | null
          id: string
          import_id: string | null
          last_ct_date: string | null
          last_mileage: number | null
          last_mileage_at: string | null
          last_visit_at: string | null
          legacy_vehicle_id: string | null
          model: string | null
          next_ct_date: string | null
          next_service_at: string | null
          pollution_due_date: string | null
          power_hp: string | null
          power_kw: string | null
          previous_registration: string | null
          purchase_date: string | null
          range_name: string | null
          registration_display: string | null
          registration_normalized: string | null
          sale_date: string | null
          seats: number | null
          segment: string | null
          site_id: string | null
          source_raw: Json | null
          source_system: string
          source_vehicle_id: string | null
          tire_size_source: string | null
          trim_level: string | null
          tvv: string | null
          type_mine: string | null
          updated_at: string
          variant: string | null
          vehicle_type: string | null
          version: string | null
          vin: string | null
          vin_normalized: string | null
          weight_kg: number | null
        }
        Insert: {
          body_type?: string | null
          brand?: string | null
          cnit?: string | null
          co2_g_km?: number | null
          color?: string | null
          created_at?: string
          ct_due_date?: string | null
          ct_manually_corrected?: boolean
          ct_photo_media_id?: string | null
          ct_read_at?: string | null
          ct_source?: string | null
          curb_weight_kg?: number | null
          d2_code?: string | null
          delivery_date?: string | null
          doors?: number | null
          energy?: string | null
          engine_code?: string | null
          engine_size?: string | null
          first_registration_date?: string | null
          fiscal_power?: number | null
          gearbox?: string | null
          gearbox_code?: string | null
          gvw_kg?: number | null
          homologated_tire_size?: string | null
          id?: string
          import_id?: string | null
          last_ct_date?: string | null
          last_mileage?: number | null
          last_mileage_at?: string | null
          last_visit_at?: string | null
          legacy_vehicle_id?: string | null
          model?: string | null
          next_ct_date?: string | null
          next_service_at?: string | null
          pollution_due_date?: string | null
          power_hp?: string | null
          power_kw?: string | null
          previous_registration?: string | null
          purchase_date?: string | null
          range_name?: string | null
          registration_display?: string | null
          registration_normalized?: string | null
          sale_date?: string | null
          seats?: number | null
          segment?: string | null
          site_id?: string | null
          source_raw?: Json | null
          source_system?: string
          source_vehicle_id?: string | null
          tire_size_source?: string | null
          trim_level?: string | null
          tvv?: string | null
          type_mine?: string | null
          updated_at?: string
          variant?: string | null
          vehicle_type?: string | null
          version?: string | null
          vin?: string | null
          vin_normalized?: string | null
          weight_kg?: number | null
        }
        Update: {
          body_type?: string | null
          brand?: string | null
          cnit?: string | null
          co2_g_km?: number | null
          color?: string | null
          created_at?: string
          ct_due_date?: string | null
          ct_manually_corrected?: boolean
          ct_photo_media_id?: string | null
          ct_read_at?: string | null
          ct_source?: string | null
          curb_weight_kg?: number | null
          d2_code?: string | null
          delivery_date?: string | null
          doors?: number | null
          energy?: string | null
          engine_code?: string | null
          engine_size?: string | null
          first_registration_date?: string | null
          fiscal_power?: number | null
          gearbox?: string | null
          gearbox_code?: string | null
          gvw_kg?: number | null
          homologated_tire_size?: string | null
          id?: string
          import_id?: string | null
          last_ct_date?: string | null
          last_mileage?: number | null
          last_mileage_at?: string | null
          last_visit_at?: string | null
          legacy_vehicle_id?: string | null
          model?: string | null
          next_ct_date?: string | null
          next_service_at?: string | null
          pollution_due_date?: string | null
          power_hp?: string | null
          power_kw?: string | null
          previous_registration?: string | null
          purchase_date?: string | null
          range_name?: string | null
          registration_display?: string | null
          registration_normalized?: string | null
          sale_date?: string | null
          seats?: number | null
          segment?: string | null
          site_id?: string | null
          source_raw?: Json | null
          source_system?: string
          source_vehicle_id?: string | null
          tire_size_source?: string | null
          trim_level?: string | null
          tvv?: string | null
          type_mine?: string | null
          updated_at?: string
          variant?: string | null
          vehicle_type?: string | null
          version?: string | null
          vin?: string | null
          vin_normalized?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ref_vehicles_ct_photo_media_id_fkey"
            columns: ["ct_photo_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ref_vehicles_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ref_vehicles_legacy_vehicle_id_fkey"
            columns: ["legacy_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ref_vehicles_site_id_fkey"
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
          internal_ref: string | null
          mileage_in: number | null
          or_date: string | null
          or_linked_at: string | null
          or_number: string | null
          or_source: string | null
          or_status: string
          record_type: string
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
          internal_ref?: string | null
          mileage_in?: number | null
          or_date?: string | null
          or_linked_at?: string | null
          or_number?: string | null
          or_source?: string | null
          or_status?: string
          record_type?: string
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
          internal_ref?: string | null
          mileage_in?: number | null
          or_date?: string | null
          or_linked_at?: string | null
          or_number?: string | null
          or_source?: string | null
          or_status?: string
          record_type?: string
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
          element_size: string | null
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
          element_size?: string | null
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
          element_size?: string | null
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
      return_documents: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          kind: string
          meta: Json | null
          mime_type: string | null
          return_id: string
          size_bytes: number | null
          source: string
          storage_path: string
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          mime_type?: string | null
          return_id: string
          size_bytes?: number | null
          source?: string
          storage_path: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          mime_type?: string | null
          return_id?: string
          size_bytes?: number | null
          source?: string
          storage_path?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_documents_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "part_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      return_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          detail: string | null
          id: string
          kind: string
          payload: Json | null
          return_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          payload?: Json | null
          return_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          payload?: Json | null
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_events_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "part_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      return_reminders: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          level: number
          recipient: string | null
          return_ids: string[]
          sent_at: string
          status: string
          subject: string | null
          supplier_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          level?: number
          recipient?: string | null
          return_ids?: string[]
          sent_at?: string
          status?: string
          subject?: string | null
          supplier_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          level?: number
          recipient?: string | null
          return_ids?: string[]
          sent_at?: string
          status?: string
          subject?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_reminders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      service_package_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          dedupe_key: string | null
          id: string
          import_id: string | null
          package_id: string | null
          previous: Json
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          dedupe_key?: string | null
          id?: string
          import_id?: string | null
          package_id?: string | null
          previous: Json
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          dedupe_key?: string | null
          id?: string
          import_id?: string | null
          package_id?: string | null
          previous?: Json
        }
        Relationships: [
          {
            foreignKeyName: "service_package_history_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "service_package_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_package_history_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "service_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      service_package_imports: {
        Row: {
          created_at: string
          file_name: string
          id: string
          imported_by: string | null
          imported_by_name: string | null
          lines_detected: number
          lines_imported: number
          lines_updated: number
          source_kind: string
          updated_at: string
          version_label: string | null
          warnings: Json
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          lines_detected?: number
          lines_imported?: number
          lines_updated?: number
          source_kind: string
          updated_at?: string
          version_label?: string | null
          warnings?: Json
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          imported_by?: string | null
          imported_by_name?: string | null
          lines_detected?: number
          lines_imported?: number
          lines_updated?: number
          source_kind?: string
          updated_at?: string
          version_label?: string | null
          warnings?: Json
        }
        Relationships: []
      }
      service_packages: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          dedupe_key: string | null
          energies: string[]
          hours: number | null
          id: string
          imported_at: string | null
          imported_by: string | null
          label: string
          model: string | null
          notes: string | null
          operation_code: string
          parts_ht: number | null
          price_basis: string
          price_ht: number | null
          price_ttc: number | null
          rate_code: string
          segment: string | null
          source_file_name: string | null
          source_kind: string | null
          source_page: number | null
          source_version: string | null
          updated_at: string
          year_from: number | null
          year_to: number | null
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          dedupe_key?: string | null
          energies?: string[]
          hours?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          label: string
          model?: string | null
          notes?: string | null
          operation_code: string
          parts_ht?: number | null
          price_basis?: string
          price_ht?: number | null
          price_ttc?: number | null
          rate_code?: string
          segment?: string | null
          source_file_name?: string | null
          source_kind?: string | null
          source_page?: number | null
          source_version?: string | null
          updated_at?: string
          year_from?: number | null
          year_to?: number | null
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          dedupe_key?: string | null
          energies?: string[]
          hours?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          label?: string
          model?: string | null
          notes?: string | null
          operation_code?: string
          parts_ht?: number | null
          price_basis?: string
          price_ht?: number | null
          price_ttc?: number | null
          rate_code?: string
          segment?: string | null
          source_file_name?: string | null
          source_kind?: string | null
          source_page?: number | null
          source_version?: string | null
          updated_at?: string
          year_from?: number | null
          year_to?: number | null
        }
        Relationships: []
      }
      sites: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          code: string | null
          created_at: string
          email_from_address: string
          email_from_name: string
          id: string
          is_default: boolean
          legal_name: string | null
          logo_url: string | null
          name: string
          phone: string | null
          postal_code: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          email_from_address?: string
          email_from_name?: string
          id?: string
          is_default?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          email_from_address?: string
          email_from_name?: string
          id?: string
          is_default?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_contacts: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_primary: boolean
          last_name: string | null
          mobile: string | null
          notes: string | null
          phone: string | null
          role_title: string | null
          service: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_primary?: boolean
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          role_title?: string | null
          service?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_primary?: boolean
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          role_title?: string | null
          service?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contacts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          avg_credit_days: number | null
          brands: string | null
          category: string | null
          city: string | null
          created_at: string
          default_carrier: string | null
          email: string | null
          escalation_email: string | null
          first_reminder_days: number
          group_name: string | null
          id: string
          max_reminders: number
          max_return_days: number | null
          name: string
          notes: string | null
          parts_contact: string | null
          phone: string | null
          postal_code: string | null
          reception_confirm_days: number
          reminder_interval_days: number
          reminders_enabled: boolean
          returns_contact: string | null
          returns_email: string | null
          sales_contact: string | null
          site_ids: string[]
          trade_name: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          avg_credit_days?: number | null
          brands?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          default_carrier?: string | null
          email?: string | null
          escalation_email?: string | null
          first_reminder_days?: number
          group_name?: string | null
          id?: string
          max_reminders?: number
          max_return_days?: number | null
          name: string
          notes?: string | null
          parts_contact?: string | null
          phone?: string | null
          postal_code?: string | null
          reception_confirm_days?: number
          reminder_interval_days?: number
          reminders_enabled?: boolean
          returns_contact?: string | null
          returns_email?: string | null
          sales_contact?: string | null
          site_ids?: string[]
          trade_name?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          avg_credit_days?: number | null
          brands?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          default_carrier?: string | null
          email?: string | null
          escalation_email?: string | null
          first_reminder_days?: number
          group_name?: string | null
          id?: string
          max_reminders?: number
          max_return_days?: number | null
          name?: string
          notes?: string | null
          parts_contact?: string | null
          phone?: string | null
          postal_code?: string | null
          reception_confirm_days?: number
          reminder_interval_days?: number
          reminders_enabled?: boolean
          returns_contact?: string | null
          returns_email?: string | null
          sales_contact?: string | null
          site_ids?: string[]
          trade_name?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      tire_brand_tiers: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          id: string
          is_default: boolean
          site_id: string | null
          sort_order: number
          tier: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          id?: string
          is_default?: boolean
          site_id?: string | null
          sort_order?: number
          tier: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          id?: string
          is_default?: boolean
          site_id?: string | null
          sort_order?: number
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tire_brand_tiers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      tire_offers: {
        Row: {
          active: boolean
          availability: string | null
          brand: string
          created_at: string
          id: string
          load_index: string | null
          model: string
          mount_price_ttc: number
          price_date: string
          price_kind: string
          purchase_price_ht: number
          season: string
          size: string | null
          source: string
          source_url: string | null
          speed_index: string | null
          supplier_key: string | null
          supplier_ref: string | null
          tier: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          availability?: string | null
          brand: string
          created_at?: string
          id?: string
          load_index?: string | null
          model: string
          mount_price_ttc?: number
          price_date?: string
          price_kind?: string
          purchase_price_ht: number
          season: string
          size?: string | null
          source?: string
          source_url?: string | null
          speed_index?: string | null
          supplier_key?: string | null
          supplier_ref?: string | null
          tier: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          availability?: string | null
          brand?: string
          created_at?: string
          id?: string
          load_index?: string | null
          model?: string
          mount_price_ttc?: number
          price_date?: string
          price_kind?: string
          purchase_price_ht?: number
          season?: string
          size?: string | null
          source?: string
          source_url?: string | null
          speed_index?: string | null
          supplier_key?: string | null
          supplier_ref?: string | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      tire_quote_offers: {
        Row: {
          availability: string | null
          brand: string | null
          compatibility: string | null
          consulted_at: string
          created_at: string
          final_payload: Json | null
          id: string
          initial_payload: Json | null
          inspection_id: string | null
          inspection_point_id: string | null
          kind: string
          load_index: string | null
          margin_ht: number | null
          model: string | null
          mount_package: string | null
          mount_total_ttc: number | null
          quantity: number
          season: string | null
          selected: boolean
          sell_price_ht: number | null
          size: string | null
          source_price_ht: number | null
          source_price_ttc: number | null
          speed_index: string | null
          supplier: string | null
          supplier_ref: string | null
          tier: string | null
          total_ht: number | null
          total_ttc: number | null
          total_vat: number | null
          updated_at: string
          wheel_code: string | null
        }
        Insert: {
          availability?: string | null
          brand?: string | null
          compatibility?: string | null
          consulted_at?: string
          created_at?: string
          final_payload?: Json | null
          id?: string
          initial_payload?: Json | null
          inspection_id?: string | null
          inspection_point_id?: string | null
          kind: string
          load_index?: string | null
          margin_ht?: number | null
          model?: string | null
          mount_package?: string | null
          mount_total_ttc?: number | null
          quantity?: number
          season?: string | null
          selected?: boolean
          sell_price_ht?: number | null
          size?: string | null
          source_price_ht?: number | null
          source_price_ttc?: number | null
          speed_index?: string | null
          supplier?: string | null
          supplier_ref?: string | null
          tier?: string | null
          total_ht?: number | null
          total_ttc?: number | null
          total_vat?: number | null
          updated_at?: string
          wheel_code?: string | null
        }
        Update: {
          availability?: string | null
          brand?: string | null
          compatibility?: string | null
          consulted_at?: string
          created_at?: string
          final_payload?: Json | null
          id?: string
          initial_payload?: Json | null
          inspection_id?: string | null
          inspection_point_id?: string | null
          kind?: string
          load_index?: string | null
          margin_ht?: number | null
          model?: string | null
          mount_package?: string | null
          mount_total_ttc?: number | null
          quantity?: number
          season?: string | null
          selected?: boolean
          sell_price_ht?: number | null
          size?: string | null
          source_price_ht?: number | null
          source_price_ttc?: number | null
          speed_index?: string | null
          supplier?: string | null
          supplier_ref?: string | null
          tier?: string | null
          total_ht?: number | null
          total_ttc?: number | null
          total_vat?: number | null
          updated_at?: string
          wheel_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tire_quote_offers_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tire_quote_offers_inspection_point_id_fkey"
            columns: ["inspection_point_id"]
            isOneToOne: false
            referencedRelation: "inspection_points"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_notification_recipients: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          label: string | null
          site_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          label?: string | null
          site_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          label?: string | null
          site_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_notification_recipients_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_notifications: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          inspection_id: string
          photo_count: number
          recipients: string[]
          sent_at: string | null
          status: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          inspection_id: string
          photo_count?: number
          recipients?: string[]
          sent_at?: string | null
          status?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          inspection_id?: string
          photo_count?: number
          recipients?: string[]
          sent_at?: string | null
          status?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_notifications_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      user_module_access: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          module_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          module_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          module_key?: string
          updated_at?: string
          user_id?: string
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
          buyback_value: number | null
          client_id: string | null
          color: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_id: string | null
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
          market_value: number | null
          mileage: number | null
          model: string | null
          owner_name: string | null
          plate: string | null
          pricing_grid_id: string | null
          pricing_snapshot: Json | null
          ref_vehicle_id: string | null
          registration_doc: string
          repair_order_id: string | null
          share_token: string
          site_id: string | null
          status: string
          step: string
          updated_at: string
          valuation_comment: string | null
          vehicle_id: string | null
          version: string | null
          vin: string | null
        }
        Insert: {
          brand?: string | null
          buyback_value?: number | null
          client_id?: string | null
          color?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string | null
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
          market_value?: number | null
          mileage?: number | null
          model?: string | null
          owner_name?: string | null
          plate?: string | null
          pricing_grid_id?: string | null
          pricing_snapshot?: Json | null
          ref_vehicle_id?: string | null
          registration_doc?: string
          repair_order_id?: string | null
          share_token?: string
          site_id?: string | null
          status?: string
          step?: string
          updated_at?: string
          valuation_comment?: string | null
          vehicle_id?: string | null
          version?: string | null
          vin?: string | null
        }
        Update: {
          brand?: string | null
          buyback_value?: number | null
          client_id?: string | null
          color?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string | null
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
          market_value?: number | null
          mileage?: number | null
          model?: string | null
          owner_name?: string | null
          plate?: string | null
          pricing_grid_id?: string | null
          pricing_snapshot?: Json | null
          ref_vehicle_id?: string | null
          registration_doc?: string
          repair_order_id?: string | null
          share_token?: string
          site_id?: string | null
          status?: string
          step?: string
          updated_at?: string
          valuation_comment?: string | null
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
            foreignKeyName: "vehicle_expertises_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expertises_pricing_grid_id_fkey"
            columns: ["pricing_grid_id"]
            isOneToOne: false
            referencedRelation: "pricing_grids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expertises_ref_vehicle_id_fkey"
            columns: ["ref_vehicle_id"]
            isOneToOne: false
            referencedRelation: "ref_vehicles"
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
      vehicle_handovers: {
        Row: {
          address: string | null
          checklist: Json
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          done_at: string | null
          id: string
          kind: string
          model: string | null
          notes: string | null
          plate: string | null
          scheduled_at: string | null
          site_id: string | null
          status: string
          updated_at: string
          vin: string | null
        }
        Insert: {
          address?: string | null
          checklist?: Json
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          done_at?: string | null
          id?: string
          kind?: string
          model?: string | null
          notes?: string | null
          plate?: string | null
          scheduled_at?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
          vin?: string | null
        }
        Update: {
          address?: string | null
          checklist?: Json
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          done_at?: string | null
          id?: string
          kind?: string
          model?: string | null
          notes?: string | null
          plate?: string | null
          scheduled_at?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_handovers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_inspections: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          archived_by_name: string | null
          client_content_updated_at: string | null
          close_source: string | null
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          control_type: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          creation_source: string | null
          current_zone_index: number
          duration_seconds: number | null
          finished_at: string | null
          id: string
          inspection_type: string
          last_modified_at: string | null
          last_modified_by: string | null
          last_modified_by_name: string | null
          last_sent_at: string | null
          last_sent_by: string | null
          last_sent_by_name: string | null
          last_sent_to: string | null
          mileage: number | null
          repair_order_id: string
          share_token: string
          site_id: string | null
          started_at: string | null
          started_by: string | null
          started_by_name: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          archived_by_name?: string | null
          client_content_updated_at?: string | null
          close_source?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          control_type?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          creation_source?: string | null
          current_zone_index?: number
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          inspection_type: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          last_modified_by_name?: string | null
          last_sent_at?: string | null
          last_sent_by?: string | null
          last_sent_by_name?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          repair_order_id: string
          share_token?: string
          site_id?: string | null
          started_at?: string | null
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          archived_by_name?: string | null
          client_content_updated_at?: string | null
          close_source?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          control_type?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          creation_source?: string | null
          current_zone_index?: number
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          inspection_type?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          last_modified_by_name?: string | null
          last_sent_at?: string | null
          last_sent_by?: string | null
          last_sent_by_name?: string | null
          last_sent_to?: string | null
          mileage?: number | null
          repair_order_id?: string
          share_token?: string
          site_id?: string | null
          started_at?: string | null
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          updated_at?: string
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
      vehicle_mileage_history: {
        Row: {
          created_at: string
          created_by: string | null
          expertise_id: string | null
          id: string
          import_id: string | null
          inspection_id: string | null
          measured_at: string | null
          media_id: string | null
          mileage: number
          source: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expertise_id?: string | null
          id?: string
          import_id?: string | null
          inspection_id?: string | null
          measured_at?: string | null
          media_id?: string | null
          mileage: number
          source?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expertise_id?: string | null
          id?: string
          import_id?: string | null
          inspection_id?: string | null
          measured_at?: string | null
          media_id?: string | null
          mileage?: number
          source?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_mileage_history_expertise_id_fkey"
            columns: ["expertise_id"]
            isOneToOne: false
            referencedRelation: "vehicle_expertises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_mileage_history_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_mileage_history_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "vehicle_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_mileage_history_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_mileage_history_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "ref_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string | null
          client_id: string | null
          created_at: string
          ct_due_date: string | null
          ct_manually_corrected: boolean
          ct_photo_media_id: string | null
          ct_read_at: string | null
          ct_source: string | null
          first_registration: string | null
          id: string
          last_mileage: number | null
          last_mileage_at: string | null
          model: string | null
          plate: string
          plate_normalized: string
          pollution_due_date: string | null
          tire_size_confirmed_at: string | null
          tire_size_front: string | null
          tire_size_rear: string | null
          vin: string | null
        }
        Insert: {
          brand?: string | null
          client_id?: string | null
          created_at?: string
          ct_due_date?: string | null
          ct_manually_corrected?: boolean
          ct_photo_media_id?: string | null
          ct_read_at?: string | null
          ct_source?: string | null
          first_registration?: string | null
          id?: string
          last_mileage?: number | null
          last_mileage_at?: string | null
          model?: string | null
          plate: string
          plate_normalized: string
          pollution_due_date?: string | null
          tire_size_confirmed_at?: string | null
          tire_size_front?: string | null
          tire_size_rear?: string | null
          vin?: string | null
        }
        Update: {
          brand?: string | null
          client_id?: string | null
          created_at?: string
          ct_due_date?: string | null
          ct_manually_corrected?: boolean
          ct_photo_media_id?: string | null
          ct_read_at?: string | null
          ct_source?: string | null
          first_registration?: string | null
          id?: string
          last_mileage?: number | null
          last_mileage_at?: string | null
          model?: string | null
          plate?: string
          plate_normalized?: string
          pollution_due_date?: string | null
          tire_size_confirmed_at?: string | null
          tire_size_front?: string | null
          tire_size_rear?: string | null
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
          {
            foreignKeyName: "vehicles_ct_photo_media_id_fkey"
            columns: ["ct_photo_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      winmotor_operators: {
        Row: {
          alias: string
          created_at: string
          id: string
          normalized: string | null
          site_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          normalized?: string | null
          site_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          normalized?: string | null
          site_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "winmotor_operators_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      finish_vehicle_inspection: {
        Args: { _inspection_id: string; _user_id: string; _user_name: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_by_name: string | null
          client_content_updated_at: string | null
          close_source: string | null
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          control_type: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          creation_source: string | null
          current_zone_index: number
          duration_seconds: number | null
          finished_at: string | null
          id: string
          inspection_type: string
          last_modified_at: string | null
          last_modified_by: string | null
          last_modified_by_name: string | null
          last_sent_at: string | null
          last_sent_by: string | null
          last_sent_by_name: string | null
          last_sent_to: string | null
          mileage: number | null
          repair_order_id: string
          share_token: string
          site_id: string | null
          started_at: string | null
          started_by: string | null
          started_by_name: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vehicle_inspections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      next_dda_order_ref: { Args: never; Returns: string }
      next_part_return_ref: { Args: never; Returns: string }
      norm_person: { Args: { _v: string }; Returns: string }
      norm_text: { Args: { _v: string }; Returns: string }
      platform_storage_stats: {
        Args: never
        Returns: {
          bucket_bytes: number
          bucket_files: number
          db_bytes: number
        }[]
      }
      purge_stale_drafts: {
        Args: { _days?: number }
        Returns: {
          inspections_deleted: number
          returns_deleted: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_vehicle_inspection: {
        Args: { _inspection_id: string; _user_id: string; _user_name: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          archived_by_name: string | null
          client_content_updated_at: string | null
          close_source: string | null
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          control_type: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          creation_source: string | null
          current_zone_index: number
          duration_seconds: number | null
          finished_at: string | null
          id: string
          inspection_type: string
          last_modified_at: string | null
          last_modified_by: string | null
          last_modified_by_name: string | null
          last_sent_at: string | null
          last_sent_by: string | null
          last_sent_by_name: string | null
          last_sent_to: string | null
          mileage: number | null
          repair_order_id: string
          share_token: string
          site_id: string | null
          started_at: string | null
          started_by: string | null
          started_by_name: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vehicle_inspections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      storage_object_owned: {
        Args: { _name: string; _user_id: string }
        Returns: boolean
      }
      unaccent: { Args: { "": string }; Returns: string }
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
