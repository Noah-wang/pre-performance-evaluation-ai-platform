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
      app_errors: {
        Row: {
          created_at: string
          id: string
          message: string
          meta: Json
          route: string | null
          scope: string | null
          stack: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          meta?: Json
          route?: string | null
          scope?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          meta?: Json
          route?: string | null
          scope?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      archived_projects: {
        Row: {
          archive_note: string | null
          archived_at: string
          archived_by: string
          conclusion: string | null
          id: string
          project_id: string
          project_snapshot: Json
          report_id: string | null
        }
        Insert: {
          archive_note?: string | null
          archived_at?: string
          archived_by: string
          conclusion?: string | null
          id?: string
          project_id: string
          project_snapshot: Json
          report_id?: string | null
        }
        Update: {
          archive_note?: string | null
          archived_at?: string
          archived_by?: string
          conclusion?: string | null
          id?: string
          project_id?: string
          project_snapshot?: Json
          report_id?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          changed_fields: string[] | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      doc_templates: {
        Row: {
          category: string
          content: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          notes: string | null
          template_key: string
          updated_at: string
          updated_by: string | null
          variables: string | null
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          notes?: string | null
          template_key: string
          updated_at?: string
          updated_by?: string | null
          variables?: string | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          notes?: string | null
          template_key?: string
          updated_at?: string
          updated_by?: string | null
          variables?: string | null
        }
        Relationships: []
      }
      evaluation_indicators: {
        Row: {
          code: string | null
          created_at: string
          created_by: string
          id: string
          level: number
          name: string
          parent_id: string | null
          required_materials: string | null
          scoring_method: string | null
          sort_order: number
          system_id: string
          weight: number | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by: string
          id?: string
          level?: number
          name: string
          parent_id?: string | null
          required_materials?: string | null
          scoring_method?: string | null
          sort_order?: number
          system_id: string
          weight?: number | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string
          id?: string
          level?: number
          name?: string
          parent_id?: string | null
          required_materials?: string | null
          scoring_method?: string | null
          sort_order?: number
          system_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_indicators_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "evaluation_indicators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_indicators_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "evaluation_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_packages: {
        Row: {
          agent_org: string | null
          code: string | null
          created_at: string
          created_by: string
          fiscal_dept: string | null
          fiscal_year: number
          id: string
          manager: string | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          agent_org?: string | null
          code?: string | null
          created_at?: string
          created_by: string
          fiscal_dept?: string | null
          fiscal_year?: number
          id?: string
          manager?: string | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          agent_org?: string | null
          code?: string | null
          created_at?: string
          created_by?: string
          fiscal_dept?: string | null
          fiscal_year?: number
          id?: string
          manager?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      evaluation_plans: {
        Row: {
          ai_model: string | null
          content: string
          created_at: string
          created_by: string
          group_id: string | null
          id: string
          project_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_model?: string | null
          content: string
          created_at?: string
          created_by: string
          group_id?: string | null
          id?: string
          project_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_model?: string | null
          content?: string
          created_at?: string
          created_by?: string
          group_id?: string | null
          id?: string
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_plans_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "work_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_systems: {
        Row: {
          category: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_template: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_template?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_template?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expert_score_sheets: {
        Row: {
          created_at: string
          created_by: string
          expert_name: string
          expert_type: string | null
          file_name: string | null
          file_path: string
          id: string
          notes: string | null
          parsed_payload: Json | null
          parsed_status: string
          project_id: string
          total_score: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expert_name: string
          expert_type?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          notes?: string | null
          parsed_payload?: Json | null
          parsed_status?: string
          project_id: string
          total_score?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expert_name?: string
          expert_type?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          notes?: string | null
          parsed_payload?: Json | null
          parsed_status?: string
          project_id?: string
          total_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      expert_scores: {
        Row: {
          created_at: string
          created_by: string
          deduct_reason: string | null
          expert_id: string | null
          expert_name: string
          expert_type: string | null
          id: string
          indicator_id: string
          max_score: number
          project_id: string
          score: number
          scored_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deduct_reason?: string | null
          expert_id?: string | null
          expert_name: string
          expert_type?: string | null
          id?: string
          indicator_id: string
          max_score?: number
          project_id: string
          score?: number
          scored_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deduct_reason?: string | null
          expert_id?: string | null
          expert_name?: string
          expert_type?: string | null
          id?: string
          indicator_id?: string
          max_score?: number
          project_id?: string
          score?: number
          scored_at?: string
        }
        Relationships: []
      }
      experts: {
        Row: {
          available: boolean
          avoid_units: string | null
          created_at: string
          created_by: string
          email: string | null
          expert_type: string
          id: string
          name: string
          organization: string | null
          phone: string | null
          specialty: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          available?: boolean
          avoid_units?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          expert_type: string
          id?: string
          name: string
          organization?: string | null
          phone?: string | null
          specialty?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          available?: boolean
          avoid_units?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          expert_type?: string
          id?: string
          name?: string
          organization?: string | null
          phone?: string | null
          specialty?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      field_audios: {
        Row: {
          created_at: string
          created_by: string
          duration_sec: number | null
          file_path: string
          id: string
          parent_audio_id: string | null
          record_id: string
          segment_index: number
          segment_total: number
          transcript: string | null
          transcript_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          duration_sec?: number | null
          file_path: string
          id?: string
          parent_audio_id?: string | null
          record_id: string
          segment_index?: number
          segment_total?: number
          transcript?: string | null
          transcript_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          duration_sec?: number | null
          file_path?: string
          id?: string
          parent_audio_id?: string | null
          record_id?: string
          segment_index?: number
          segment_total?: number
          transcript?: string | null
          transcript_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_audios_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "field_records"
            referencedColumns: ["id"]
          },
        ]
      }
      field_photos: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string
          exif_json: Json | null
          file_path: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          record_id: string
          taken_at: string | null
          watermarked: boolean
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by: string
          exif_json?: Json | null
          file_path: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          record_id: string
          taken_at?: string | null
          watermarked?: boolean
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string
          exif_json?: Json | null
          file_path?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          record_id?: string
          taken_at?: string | null
          watermarked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "field_photos_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "field_records"
            referencedColumns: ["id"]
          },
        ]
      }
      field_records: {
        Row: {
          conclusion: string | null
          created_at: string
          created_by: string
          findings: string | null
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          location: string
          participants: string | null
          project_id: string
          research_date: string
          updated_at: string
        }
        Insert: {
          conclusion?: string | null
          created_at?: string
          created_by: string
          findings?: string | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location: string
          participants?: string | null
          project_id: string
          research_date?: string
          updated_at?: string
        }
        Update: {
          conclusion?: string | null
          created_at?: string
          created_by?: string
          findings?: string | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location?: string
          participants?: string | null
          project_id?: string
          research_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      field_signatures: {
        Row: {
          created_by: string
          expert_name: string
          id: string
          record_id: string
          signature_data: string
          signed_at: string
        }
        Insert: {
          created_by: string
          expert_name: string
          id?: string
          record_id: string
          signature_data: string
          signed_at?: string
        }
        Update: {
          created_by?: string
          expert_name?: string
          id?: string
          record_id?: string
          signature_data?: string
          signed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_signatures_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "field_records"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_library: {
        Row: {
          category: string | null
          code: string | null
          created_at: string
          created_by: string
          id: string
          level: number
          name: string
          notes: string | null
          parent_goal_id: string | null
          required_materials: string | null
          scoring_method: string | null
          source_indicator_id: string | null
          source_system_id: string | null
          updated_at: string
          usage_count: number
          weight: number | null
        }
        Insert: {
          category?: string | null
          code?: string | null
          created_at?: string
          created_by: string
          id?: string
          level?: number
          name: string
          notes?: string | null
          parent_goal_id?: string | null
          required_materials?: string | null
          scoring_method?: string | null
          source_indicator_id?: string | null
          source_system_id?: string | null
          updated_at?: string
          usage_count?: number
          weight?: number | null
        }
        Update: {
          category?: string | null
          code?: string | null
          created_at?: string
          created_by?: string
          id?: string
          level?: number
          name?: string
          notes?: string | null
          parent_goal_id?: string | null
          required_materials?: string | null
          scoring_method?: string | null
          source_indicator_id?: string | null
          source_system_id?: string | null
          updated_at?: string
          usage_count?: number
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_library_parent_goal_id_fkey"
            columns: ["parent_goal_id"]
            isOneToOne: false
            referencedRelation: "goal_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_library_source_indicator_id_fkey"
            columns: ["source_indicator_id"]
            isOneToOne: false
            referencedRelation: "evaluation_indicators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_library_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "evaluation_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      material_indicators: {
        Row: {
          created_at: string
          created_by: string
          id: string
          indicator_id: string
          material_id: string
          relevance: number
          source: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          indicator_id: string
          material_id: string
          relevance?: number
          source?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          indicator_id?: string
          material_id?: string
          relevance?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_indicators_indicator_id_fkey"
            columns: ["indicator_id"]
            isOneToOne: false
            referencedRelation: "evaluation_indicators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_indicators_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          category: string
          created_at: string
          created_by: string
          file_name: string | null
          file_path: string | null
          id: string
          indicator_id: string | null
          name: string
          project_id: string
          required: boolean
          review_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          indicator_id?: string | null
          name: string
          project_id: string
          required?: boolean
          review_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          indicator_id?: string | null
          name?: string
          project_id?: string
          required?: boolean
          review_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_indicator_id_fkey"
            columns: ["indicator_id"]
            isOneToOne: false
            referencedRelation: "evaluation_indicators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_analyses: {
        Row: {
          created_at: string
          created_by: string
          id: string
          minute_id: string
          opinions: Json
          summary: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          minute_id: string
          opinions?: Json
          summary?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          minute_id?: string
          opinions?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_analyses_minute_id_fkey"
            columns: ["minute_id"]
            isOneToOne: false
            referencedRelation: "meeting_minutes"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_files: {
        Row: {
          created_at: string
          created_by: string
          expert_name: string | null
          file_kind: string
          file_name: string
          file_path: string
          id: string
          minute_id: string
          notes: string | null
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expert_name?: string | null
          file_kind?: string
          file_name: string
          file_path: string
          id?: string
          minute_id: string
          notes?: string | null
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expert_name?: string | null
          file_kind?: string
          file_name?: string
          file_path?: string
          id?: string
          minute_id?: string
          notes?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_files_minute_id_fkey"
            columns: ["minute_id"]
            isOneToOne: false
            referencedRelation: "meeting_minutes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_minutes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          meeting_date: string
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id?: string
          meeting_date?: string
          project_id: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          meeting_date?: string
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_minutes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          dedupe_day: string
          dedupe_key: string | null
          id: string
          link: string | null
          read_at: string | null
          ref_id: string | null
          ref_table: string | null
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          dedupe_day?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          ref_id?: string | null
          ref_table?: string | null
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          dedupe_day?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          ref_id?: string | null
          ref_table?: string | null
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          organization: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          organization?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          organization?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          agent_org: string | null
          budget: number
          budget_unit: string | null
          category: string | null
          conclusion: string | null
          created_at: string
          created_by: string
          custom_fields: Json
          description: string | null
          evaluation_system_id: string | null
          expense_dept: string | null
          fee_calculation: Json
          fiscal_year: number
          id: string
          list_attribute: string | null
          manager: string | null
          name: string
          package_id: string | null
          project_attribute: string | null
          status: string
          unit: string
          updated_at: string
        }
        Insert: {
          agent_org?: string | null
          budget?: number
          budget_unit?: string | null
          category?: string | null
          conclusion?: string | null
          created_at?: string
          created_by: string
          custom_fields?: Json
          description?: string | null
          evaluation_system_id?: string | null
          expense_dept?: string | null
          fee_calculation?: Json
          fiscal_year?: number
          id?: string
          list_attribute?: string | null
          manager?: string | null
          name: string
          package_id?: string | null
          project_attribute?: string | null
          status?: string
          unit: string
          updated_at?: string
        }
        Update: {
          agent_org?: string | null
          budget?: number
          budget_unit?: string | null
          category?: string | null
          conclusion?: string | null
          created_at?: string
          created_by?: string
          custom_fields?: Json
          description?: string | null
          evaluation_system_id?: string | null
          expense_dept?: string | null
          fee_calculation?: Json
          fiscal_year?: number
          id?: string
          list_attribute?: string | null
          manager?: string | null
          name?: string
          package_id?: string | null
          project_attribute?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_evaluation_system_id_fkey"
            columns: ["evaluation_system_id"]
            isOneToOne: false
            referencedRelation: "evaluation_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      rectification_tasks: {
        Row: {
          category: string
          completed_at: string | null
          created_at: string
          created_by: string
          detail: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string
          report_id: string | null
          responsible: string | null
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          detail?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id: string
          report_id?: string | null
          responsible?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          detail?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string
          report_id?: string | null
          responsible?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_versions: {
        Row: {
          change_summary: string | null
          content: string | null
          created_at: string
          created_by: string
          id: string
          report_id: string
          source: string
          title: string
          version_no: number
        }
        Insert: {
          change_summary?: string | null
          content?: string | null
          created_at?: string
          created_by: string
          id?: string
          report_id: string
          source?: string
          title: string
          version_no: number
        }
        Update: {
          change_summary?: string | null
          content?: string | null
          created_at?: string
          created_by?: string
          id?: string
          report_id?: string
          source?: string
          title?: string
          version_no?: number
        }
        Relationships: []
      }
      reports: {
        Row: {
          ai_rectification: Json | null
          conclusion: string | null
          content: string | null
          created_at: string
          created_by: string
          evaluation_org: string | null
          id: string
          project_id: string
          rectification: string | null
          summary_remark: string | null
          status: string
          supervising_department: string | null
          supported_budget: number | null
          third_party_org: string | null
          title: string
          unsupported_budget: number | null
          updated_at: string
        }
        Insert: {
          ai_rectification?: Json | null
          conclusion?: string | null
          content?: string | null
          created_at?: string
          created_by: string
          evaluation_org?: string | null
          id?: string
          project_id: string
          rectification?: string | null
          summary_remark?: string | null
          status?: string
          supervising_department?: string | null
          supported_budget?: number | null
          third_party_org?: string | null
          title: string
          unsupported_budget?: number | null
          updated_at?: string
        }
        Update: {
          ai_rectification?: Json | null
          conclusion?: string | null
          content?: string | null
          created_at?: string
          created_by?: string
          evaluation_org?: string | null
          id?: string
          project_id?: string
          rectification?: string | null
          summary_remark?: string | null
          status?: string
          supervising_department?: string | null
          supported_budget?: number | null
          third_party_org?: string | null
          title?: string
          unsupported_budget?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      share_link_views: {
        Row: {
          id: string
          ip: string | null
          reason: string | null
          share_link_id: string
          success: boolean
          user_agent: string | null
          viewed_at: string
        }
        Insert: {
          id?: string
          ip?: string | null
          reason?: string | null
          share_link_id: string
          success?: boolean
          user_agent?: string | null
          viewed_at?: string
        }
        Update: {
          id?: string
          ip?: string | null
          reason?: string | null
          share_link_id?: string
          success?: boolean
          user_agent?: string | null
          viewed_at?: string
        }
        Relationships: []
      }
      share_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_views: number | null
          password_hash: string | null
          report_id: string
          revoked: boolean
          scope: string
          token: string
          view_count: number
          watermark_required: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_views?: number | null
          password_hash?: string | null
          report_id: string
          revoked?: boolean
          scope?: string
          token: string
          view_count?: number
          watermark_required?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_views?: number | null
          password_hash?: string | null
          report_id?: string
          revoked?: boolean
          scope?: string
          token?: string
          view_count?: number
          watermark_required?: boolean
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
      work_group_members: {
        Row: {
          contact: string | null
          created_at: string
          created_by: string
          group_id: string
          id: string
          member_name: string
          member_role: string
          organization: string | null
        }
        Insert: {
          contact?: string | null
          created_at?: string
          created_by: string
          group_id: string
          id?: string
          member_name: string
          member_role?: string
          organization?: string | null
        }
        Update: {
          contact?: string | null
          created_at?: string
          created_by?: string
          group_id?: string
          id?: string
          member_name?: string
          member_role?: string
          organization?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "work_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      work_groups: {
        Row: {
          created_at: string
          created_by: string
          formed_on: string
          id: string
          leader: string | null
          name: string
          notes: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          formed_on?: string
          id?: string
          leader?: string | null
          name: string
          notes?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          formed_on?: string
          id?: string
          leader?: string | null
          name?: string
          notes?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_tasks: {
        Row: {
          assignee: string | null
          completed_on: string | null
          created_at: string
          created_by: string
          end_date: string
          group_id: string
          id: string
          notes: string | null
          start_date: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          completed_on?: string | null
          created_at?: string
          created_by: string
          end_date: string
          group_id: string
          id?: string
          notes?: string | null
          start_date: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          completed_on?: string | null
          created_at?: string
          created_by?: string
          end_date?: string
          group_id?: string
          id?: string
          notes?: string | null
          start_date?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_tasks_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "work_groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      experts_public: {
        Row: {
          available: boolean | null
          created_at: string | null
          expert_type: string | null
          id: string | null
          name: string | null
          organization: string | null
          specialty: string | null
          title: string | null
        }
        Insert: {
          available?: boolean | null
          created_at?: string | null
          expert_type?: string | null
          id?: string | null
          name?: string | null
          organization?: string | null
          specialty?: string | null
          title?: string | null
        }
        Update: {
          available?: boolean | null
          created_at?: string | null
          expert_type?: string | null
          id?: string | null
          name?: string | null
          organization?: string | null
          specialty?: string | null
          title?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_share_link: {
        Args: {
          _expires_at: string
          _max_views: number
          _password: string
          _report_id: string
          _scope: string
          _watermark: boolean
        }
        Returns: Json
      }
      get_expert_participation: {
        Args: { _expert_name: string }
        Returns: {
          avg_score: number
          last_scored_at: string
          project_id: string
          project_name: string
          project_unit: string
          scored_count: number
        }[]
      }
      get_experts_public: {
        Args: never
        Returns: {
          available: boolean
          avoid_units: string
          created_at: string
          expert_type: string
          id: string
          name: string
          organization: string
          specialty: string
          title: string
        }[]
      }
      get_materials_public: {
        Args: { _project_id: string }
        Returns: {
          category: string
          created_at: string
          file_name: string
          file_path: string
          id: string
          name: string
          project_id: string
          required: boolean
          status: string
          updated_at: string
        }[]
      }
      get_profiles_public: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          organization: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      verify_share_link: {
        Args: { _ip?: string; _pwd: string; _token: string; _ua?: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "group_member" | "expert"
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
      app_role: ["admin", "group_member", "expert"],
    },
  },
} as const
