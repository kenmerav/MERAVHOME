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
      material_items: {
        Row: {
          cad_label: string | null
          category: string | null
          color: string | null
          created_at: string
          id: string
          is_required: boolean
          item_label: string
          not_needed: boolean
          notes: string | null
          product_id: string | null
          product_url: string | null
          project_id: string
          quantity: number | null
          room_id: string
          scrape_error: string | null
          scrape_status: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          cad_label?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          item_label: string
          not_needed?: boolean
          notes?: string | null
          product_id?: string | null
          product_url?: string | null
          project_id: string
          quantity?: number | null
          room_id: string
          scrape_error?: string | null
          scrape_status?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          cad_label?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          item_label?: string
          not_needed?: boolean
          notes?: string | null
          product_id?: string | null
          product_url?: string | null
          project_id?: string
          quantity?: number | null
          room_id?: string
          scrape_error?: string | null
          scrape_status?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_items_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          category: Database["public"]["Enums"]["material_category"]
          created_at: string
          id: string
          image_url: string | null
          name: string
          notes: string | null
          product_url: string | null
          room_id: string
          sku: string | null
          sort_order: number
          vendor: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["material_category"]
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          notes?: string | null
          product_url?: string | null
          room_id: string
          sku?: string | null
          sort_order?: number
          vendor?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["material_category"]
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          notes?: string | null
          product_url?: string | null
          room_id?: string
          sku?: string | null
          sort_order?: number
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_items: {
        Row: {
          id: string
          installed: boolean
          notes: string | null
          ordered: boolean
          received: boolean
          room_product_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          installed?: boolean
          notes?: string | null
          ordered?: boolean
          received?: boolean
          room_product_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          installed?: boolean
          notes?: string | null
          ordered?: boolean
          received?: boolean
          room_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_items_room_product_id_fkey"
            columns: ["room_product_id"]
            isOneToOne: true
            referencedRelation: "room_products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: Database["public"]["Enums"]["product_category"]
          created_at: string
          description: string | null
          dimensions: string | null
          finish: string | null
          id: string
          image_url: string | null
          name: string
          notes: string | null
          price: string | null
          product_url: string | null
          sku: string | null
          subcategory: string | null
          unit_cost: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["product_category"]
          created_at?: string
          description?: string | null
          dimensions?: string | null
          finish?: string | null
          id?: string
          image_url?: string | null
          name: string
          notes?: string | null
          price?: string | null
          product_url?: string | null
          sku?: string | null
          subcategory?: string | null
          unit_cost?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["product_category"]
          created_at?: string
          description?: string | null
          dimensions?: string | null
          finish?: string | null
          id?: string
          image_url?: string | null
          name?: string
          notes?: string | null
          price?: string | null
          product_url?: string | null
          sku?: string | null
          subcategory?: string | null
          unit_cost?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_name: string
          cover_image_url: string | null
          created_at: string
          design_concept: string | null
          design_notes: string | null
          id: string
          key_design_elements: string | null
          name: string
          project_summary: string | null
          project_type: Database["public"]["Enums"]["project_type"]
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          client_name: string
          cover_image_url?: string | null
          created_at?: string
          design_concept?: string | null
          design_notes?: string | null
          id?: string
          key_design_elements?: string | null
          name: string
          project_summary?: string | null
          project_type: Database["public"]["Enums"]["project_type"]
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          client_name?: string
          cover_image_url?: string | null
          created_at?: string
          design_concept?: string | null
          design_notes?: string | null
          id?: string
          key_design_elements?: string | null
          name?: string
          project_summary?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      room_images: {
        Row: {
          caption: string | null
          created_at: string
          error_message: string | null
          id: string
          is_approved: boolean
          is_favorite: boolean
          kind: Database["public"]["Enums"]["image_kind"]
          linked_sketchup_id: string | null
          role: string | null
          room_id: string
          sort_order: number
          status: string
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_approved?: boolean
          is_favorite?: boolean
          kind: Database["public"]["Enums"]["image_kind"]
          linked_sketchup_id?: string | null
          role?: string | null
          room_id: string
          sort_order?: number
          status?: string
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_approved?: boolean
          is_favorite?: boolean
          kind?: Database["public"]["Enums"]["image_kind"]
          linked_sketchup_id?: string | null
          role?: string | null
          room_id?: string
          sort_order?: number
          status?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_images_linked_sketchup_id_fkey"
            columns: ["linked_sketchup_id"]
            isOneToOne: false
            referencedRelation: "room_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_images_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_products: {
        Row: {
          approved: boolean
          created_at: string
          id: string
          is_key_selection: boolean
          product_id: string
          room_id: string
          room_notes: string | null
          sort_order: number
        }
        Insert: {
          approved?: boolean
          created_at?: string
          id?: string
          is_key_selection?: boolean
          product_id: string
          room_id: string
          room_notes?: string | null
          sort_order?: number
        }
        Update: {
          approved?: boolean
          created_at?: string
          id?: string
          is_key_selection?: boolean
          product_id?: string
          room_id?: string
          room_notes?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_products_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          design_concept: string | null
          design_notes: string | null
          id: string
          name: string
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          design_concept?: string | null
          design_notes?: string | null
          id?: string
          name: string
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          design_concept?: string | null
          design_notes?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      image_kind: "sketchup" | "rendering"
      material_category:
        | "Cabinet Finish"
        | "Countertop"
        | "Flooring"
        | "Tile"
        | "Fabric"
        | "Paint"
      procurement_status: "pending" | "ordered" | "received" | "installed"
      product_category:
        | "Lighting"
        | "Plumbing"
        | "Hardware"
        | "Appliances"
        | "Flooring"
        | "Tile"
        | "Paint"
        | "Furniture"
        | "Decor"
      project_status:
        | "Design"
        | "Presentation"
        | "Approved"
        | "Procurement"
        | "Complete"
      project_type:
        | "Kitchen"
        | "Bathroom"
        | "Whole Home"
        | "New Build"
        | "Furnishings"
        | "Commercial"
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
      image_kind: ["sketchup", "rendering"],
      material_category: [
        "Cabinet Finish",
        "Countertop",
        "Flooring",
        "Tile",
        "Fabric",
        "Paint",
      ],
      procurement_status: ["pending", "ordered", "received", "installed"],
      product_category: [
        "Lighting",
        "Plumbing",
        "Hardware",
        "Appliances",
        "Flooring",
        "Tile",
        "Paint",
        "Furniture",
        "Decor",
      ],
      project_status: [
        "Design",
        "Presentation",
        "Approved",
        "Procurement",
        "Complete",
      ],
      project_type: [
        "Kitchen",
        "Bathroom",
        "Whole Home",
        "New Build",
        "Furnishings",
        "Commercial",
      ],
    },
  },
} as const
