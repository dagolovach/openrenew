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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          contract_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          contract_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          contract_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          contract_id: string
          created_at: string
          failure_reason: string | null
          id: string
          scheduled_for: string
          sent_at: string | null
          status: string
          target_date: string
          user_id: string
        }
        Insert: {
          alert_type: string
          contract_id: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          scheduled_for: string
          sent_at?: string | null
          status?: string
          target_date: string
          user_id: string
        }
        Update: {
          alert_type?: string
          contract_id?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          target_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_analysis: {
        Row: {
          analysis_version: number
          contract_id: string
          created_at: string
          findings: Json
          id: string
          model: string
          raw_text_used: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_version?: number
          contract_id: string
          created_at?: string
          findings?: Json
          id?: string
          model?: string
          raw_text_used?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_version?: number
          contract_id?: string
          created_at?: string
          findings?: Json
          id?: string
          model?: string
          raw_text_used?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_analysis_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_analysis_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_comparisons: {
        Row: {
          clause_changes: Json
          contract_id: string
          created_at: string
          field_changes: Json
          id: string
          model: string
          parent_contract_id: string
          summary: string | null
          user_id: string
        }
        Insert: {
          clause_changes?: Json
          contract_id: string
          created_at?: string
          field_changes?: Json
          id?: string
          model?: string
          parent_contract_id: string
          summary?: string | null
          user_id: string
        }
        Update: {
          clause_changes?: Json
          contract_id?: string
          created_at?: string
          field_changes?: Json
          id?: string
          model?: string
          parent_contract_id?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_comparisons_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_comparisons_parent_contract_id_fkey"
            columns: ["parent_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_comparisons_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_extractions: {
        Row: {
          confidence: number | null
          confirmed_value: string | null
          contract_id: string
          created_at: string
          extracted_value: string | null
          field_name: string
          id: string
          was_edited: boolean
        }
        Insert: {
          confidence?: number | null
          confirmed_value?: string | null
          contract_id: string
          created_at?: string
          extracted_value?: string | null
          field_name: string
          id?: string
          was_edited?: boolean
        }
        Update: {
          confidence?: number | null
          confirmed_value?: string | null
          contract_id?: string
          created_at?: string
          extracted_value?: string | null
          field_name?: string
          id?: string
          was_edited?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contract_extractions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          auto_renew: boolean | null
          category: string
          contract_value: string | null
          contract_version: number
          created_at: string
          effective_date: string | null
          expiry_date: string | null
          extraction_confidence: number | null
          extraction_status: string
          file_name: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          name: string
          notice_period_days: number | null
          notice_period_text: string | null
          parent_contract_id: string | null
          party_a: string | null
          party_b: string | null
          renewal_date: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_renew?: boolean | null
          category: string
          contract_value?: string | null
          contract_version?: number
          created_at?: string
          effective_date?: string | null
          expiry_date?: string | null
          extraction_confidence?: number | null
          extraction_status?: string
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          name: string
          notice_period_days?: number | null
          notice_period_text?: string | null
          parent_contract_id?: string | null
          party_a?: string | null
          party_b?: string | null
          renewal_date?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_renew?: boolean | null
          category?: string
          contract_value?: string | null
          contract_version?: number
          created_at?: string
          effective_date?: string | null
          expiry_date?: string | null
          extraction_confidence?: number | null
          extraction_status?: string
          file_name?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          name?: string
          notice_period_days?: number | null
          notice_period_text?: string | null
          parent_contract_id?: string | null
          party_a?: string | null
          party_b?: string | null
          renewal_date?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          onboarding_completed: boolean
          plan: string
          slack_webhook_url: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          onboarding_completed?: boolean
          plan?: string
          slack_webhook_url?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          onboarding_completed?: boolean
          plan?: string
          slack_webhook_url?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          confirmed: boolean
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          source: string | null
        }
        Insert: {
          confirmed?: boolean
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          source?: string | null
        }
        Update: {
          confirmed?: boolean
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          source?: string | null
        }
        Relationships: []
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
