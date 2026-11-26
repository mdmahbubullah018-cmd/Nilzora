
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "account_emails": {
                  Row: {
                    "attempts": number,"claimed_at": string | null,"created_at": string,"id": string,"kind": string,"last_error": string | null,"sent_at": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"id"?: string,"kind": string,"last_error"?: string | null,"sent_at"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"last_error"?: string | null,"sent_at"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_emails_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"addresses": {
                  Row: {
                    "address_line": string,"area": string,"created_at": string,"district": string,"division": string,"id": string,"is_default": boolean,"label": string | null,"landmark": string | null,"phone": string,"postal_code": string | null,"recipient_name": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line": string,"area": string,"created_at"?: string,"district": string,"division": string,"id"?: string,"is_default"?: boolean,"label"?: string | null,"landmark"?: string | null,"phone": string,"postal_code"?: string | null,"recipient_name": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "address_line"?: string,"area"?: string,"created_at"?: string,"district"?: string,"division"?: string,"id"?: string,"is_default"?: boolean,"label"?: string | null,"landmark"?: string | null,"phone"?: string,"postal_code"?: string | null,"recipient_name"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "addresses_district_division_fkey"
      columns: ["district","division"]
isOneToOne: false
      referencedRelation: "bd_districts"
      referencedColumns: ["name","division"]
    },{
      foreignKeyName: "addresses_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"id": number,"target_id": string | null,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"target_id"?: string | null,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"target_id"?: string | null,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_email_codes": {
                  Row: {
                    "attempts": number,"code_hash": string,"consumed_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"purpose": Database["public"]['Enums']["auth_code_purpose"],"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"code_hash": string,"consumed_at"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"purpose": Database["public"]['Enums']["auth_code_purpose"],"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"code_hash"?: string,"consumed_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"purpose"?: Database["public"]['Enums']["auth_code_purpose"],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "auth_email_codes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_invitations": {
                  Row: {
                    "consumed_at": string | null,"created_at": string,"created_by": string | null,"expires_at": string,"id": string,"token_hash": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"expires_at": string,"id"?: string,"token_hash": string,"user_id": string
                  }
                  Update: {
                    "consumed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"token_hash"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "auth_invitations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "auth_invitations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_mail_log": {
                  Row: {
                    "created_at": string,"email_hash": string,"id": number,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email_hash": string,"id"?: never,"kind": string
                  }
                  Update: {
                    "created_at"?: string,"email_hash"?: string,"id"?: never,"kind"?: string
                  }
                  Relationships: [
                    
                  ]
                },"auth_oauth_accounts": {
                  Row: {
                    "email": string | null,"linked_at": string,"provider": string,"provider_subject": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email"?: string | null,"linked_at"?: string,"provider": string,"provider_subject": string,"user_id": string
                  }
                  Update: {
                    "email"?: string | null,"linked_at"?: string,"provider"?: string,"provider_subject"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "auth_oauth_accounts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_pending_registrations": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"password_hash": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"password_hash": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"password_hash"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"auth_sessions": {
                  Row: {
                    "expires_at": string,"family_id": string,"id": string,"ip": unknown,"issued_at": string,"last_used_at": string | null,"refresh_expires_at": string,"refresh_hash": string,"replaced_by": string | null,"revoked_at": string | null,"secret_hash": string,"user_agent": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "expires_at": string,"family_id": string,"id"?: string,"ip"?: unknown,"issued_at"?: string,"last_used_at"?: string | null,"refresh_expires_at": string,"refresh_hash": string,"replaced_by"?: string | null,"revoked_at"?: string | null,"secret_hash": string,"user_agent"?: string | null,"user_id": string
                  }
                  Update: {
                    "expires_at"?: string,"family_id"?: string,"id"?: string,"ip"?: unknown,"issued_at"?: string,"last_used_at"?: string | null,"refresh_expires_at"?: string,"refresh_hash"?: string,"replaced_by"?: string | null,"revoked_at"?: string | null,"secret_hash"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "auth_sessions_replaced_by_fkey"
      columns: ["replaced_by"]
isOneToOne: false
      referencedRelation: "auth_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "auth_sessions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"banners": {
                  Row: {
                    "category_id": string | null,"created_at": string,"created_by": string | null,"cta_href": string | null,"cta_label": string | null,"ends_at": string | null,"id": string,"image_alt": string | null,"image_key": string | null,"is_active": boolean,"mobile_image_key": string | null,"placement": Database["public"]['Enums']["banner_placement"],"sort_order": number,"starts_at": string | null,"subtitle": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"cta_href"?: string | null,"cta_label"?: string | null,"ends_at"?: string | null,"id"?: string,"image_alt"?: string | null,"image_key"?: string | null,"is_active"?: boolean,"mobile_image_key"?: string | null,"placement": Database["public"]['Enums']["banner_placement"],"sort_order"?: number,"starts_at"?: string | null,"subtitle"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"cta_href"?: string | null,"cta_label"?: string | null,"ends_at"?: string | null,"id"?: string,"image_alt"?: string | null,"image_key"?: string | null,"is_active"?: boolean,"mobile_image_key"?: string | null,"placement"?: Database["public"]['Enums']["banner_placement"],"sort_order"?: number,"starts_at"?: string | null,"subtitle"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "banners_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "banners_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"bd_districts": {
                  Row: {
                    "delivery_zone": Database["public"]['Enums']["delivery_zone"],"division": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "delivery_zone"?: Database["public"]['Enums']["delivery_zone"],"division": string,"name": string
                  }
                  Update: {
                    "delivery_zone"?: Database["public"]['Enums']["delivery_zone"],"division"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"brand_slug_redirects": {
                  Row: {
                    "brand_id": string,"created_at": string,"old_slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_id": string,"created_at"?: string,"old_slug": string
                  }
                  Update: {
                    "brand_id"?: string,"created_at"?: string,"old_slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brand_slug_redirects_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    }
                  ]
                },"brands": {
                  Row: {
                    "banner_key": string | null,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"logo_key": string | null,"name": string,"slug": string,"updated_at": string,"product_count": number | null
                  }
                  ComputedFields: "product_count"
                  Insert: {
                    "banner_key"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"logo_key"?: string | null,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "banner_key"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"logo_key"?: string | null,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"cart_items": {
                  Row: {
                    "added_at": string,"cart_id": string,"id": number,"product_id": string,"quantity": number,"updated_at": string,"variant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"cart_id": string,"id"?: never,"product_id": string,"quantity": number,"updated_at"?: string,"variant_id"?: string | null
                  }
                  Update: {
                    "added_at"?: string,"cart_id"?: string,"id"?: never,"product_id"?: string,"quantity"?: number,"updated_at"?: string,"variant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "cart_items_cart_id_fkey"
      columns: ["cart_id"]
isOneToOne: false
      referencedRelation: "carts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cart_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cart_items_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["id"]
    }
                  ]
                },"carts": {
                  Row: {
                    "converted_order_id": string | null,"created_at": string,"guest_token": string | null,"id": string,"last_activity_at": string,"status": Database["public"]['Enums']["cart_status"],"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "converted_order_id"?: string | null,"created_at"?: string,"guest_token"?: string | null,"id"?: string,"last_activity_at"?: string,"status"?: Database["public"]['Enums']["cart_status"],"user_id"?: string | null
                  }
                  Update: {
                    "converted_order_id"?: string | null,"created_at"?: string,"guest_token"?: string | null,"id"?: string,"last_activity_at"?: string,"status"?: Database["public"]['Enums']["cart_status"],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "carts_converted_order_id_fkey"
      columns: ["converted_order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "carts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "banner_key": string | null,"canonical_path": string | null,"created_at": string,"description": string | null,"id": string,"image_key": string | null,"is_active": boolean,"is_featured": boolean,"name": string,"no_index": boolean,"og_description": string | null,"og_image_key": string | null,"og_title": string | null,"parent_id": string | null,"seo_description": string | null,"seo_title": string | null,"slug": string,"sort_order": number,"updated_at": string,"product_count": number | null
                  }
                  ComputedFields: "product_count"
                  Insert: {
                    "banner_key"?: string | null,"canonical_path"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"image_key"?: string | null,"is_active"?: boolean,"is_featured"?: boolean,"name": string,"no_index"?: boolean,"og_description"?: string | null,"og_image_key"?: string | null,"og_title"?: string | null,"parent_id"?: string | null,"seo_description"?: string | null,"seo_title"?: string | null,"slug": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "banner_key"?: string | null,"canonical_path"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"image_key"?: string | null,"is_active"?: boolean,"is_featured"?: boolean,"name"?: string,"no_index"?: boolean,"og_description"?: string | null,"og_image_key"?: string | null,"og_title"?: string | null,"parent_id"?: string | null,"seo_description"?: string | null,"seo_title"?: string | null,"slug"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"category_shopping_zones": {
                  Row: {
                    "category_id": string,"created_at": string,"zone_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"zone_id": string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"zone_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "category_shopping_zones_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "category_shopping_zones_zone_id_fkey"
      columns: ["zone_id"]
isOneToOne: false
      referencedRelation: "shopping_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_assignments": {
                  Row: {
                    "assigned_by": string | null,"assigned_to": string | null,"conversation_id": string,"created_at": string,"id": number,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_by"?: string | null,"assigned_to"?: string | null,"conversation_id": string,"created_at"?: string,"id"?: never,"note"?: string | null
                  }
                  Update: {
                    "assigned_by"?: string | null,"assigned_to"?: string | null,"conversation_id"?: string,"created_at"?: string,"id"?: never,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_assignments_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_assignments_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_assignments_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_attachments": {
                  Row: {
                    "attached_at": string | null,"byte_size": number,"content_type": string,"conversation_id": string,"created_at": string,"duration_ms": number | null,"file_name": string,"height": number | null,"id": string,"message_id": string | null,"object_key": string,"status": Database["public"]['Enums']["chat_attachment_status"],"uploader_id": string | null,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attached_at"?: string | null,"byte_size": number,"content_type": string,"conversation_id": string,"created_at"?: string,"duration_ms"?: number | null,"file_name": string,"height"?: number | null,"id"?: string,"message_id"?: string | null,"object_key": string,"status"?: Database["public"]['Enums']["chat_attachment_status"],"uploader_id"?: string | null,"width"?: number | null
                  }
                  Update: {
                    "attached_at"?: string | null,"byte_size"?: number,"content_type"?: string,"conversation_id"?: string,"created_at"?: string,"duration_ms"?: number | null,"file_name"?: string,"height"?: number | null,"id"?: string,"message_id"?: string | null,"object_key"?: string,"status"?: Database["public"]['Enums']["chat_attachment_status"],"uploader_id"?: string | null,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_attachments_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_attachments_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_attachments_uploader_id_fkey"
      columns: ["uploader_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_automation_jobs": {
                  Row: {
                    "actions": NonNullable<Json>,"attempts": number,"conversation_id": string,"created_at": string,"dedupe_key": string | null,"id": string,"last_error": string | null,"locked_until": string | null,"rule_id": string | null,"run_at": string,"status": Database["public"]['Enums']["chat_automation_job_status"],"trigger": Database["public"]['Enums']["chat_automation_trigger"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actions"?: NonNullable<Json>,"attempts"?: number,"conversation_id": string,"created_at"?: string,"dedupe_key"?: string | null,"id"?: string,"last_error"?: string | null,"locked_until"?: string | null,"rule_id"?: string | null,"run_at"?: string,"status"?: Database["public"]['Enums']["chat_automation_job_status"],"trigger": Database["public"]['Enums']["chat_automation_trigger"]
                  }
                  Update: {
                    "actions"?: NonNullable<Json>,"attempts"?: number,"conversation_id"?: string,"created_at"?: string,"dedupe_key"?: string | null,"id"?: string,"last_error"?: string | null,"locked_until"?: string | null,"rule_id"?: string | null,"run_at"?: string,"status"?: Database["public"]['Enums']["chat_automation_job_status"],"trigger"?: Database["public"]['Enums']["chat_automation_trigger"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_automation_jobs_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_automation_jobs_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "chat_automation_rules"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_automation_rules": {
                  Row: {
                    "actions": NonNullable<Json>,"conditions": NonNullable<Json>,"cooldown_seconds": number,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"is_active": boolean,"last_run_at": string | null,"name": string,"position": number,"run_count": number,"stop_processing": boolean,"trigger": Database["public"]['Enums']["chat_automation_trigger"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actions"?: NonNullable<Json>,"conditions"?: NonNullable<Json>,"cooldown_seconds"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"last_run_at"?: string | null,"name": string,"position"?: number,"run_count"?: number,"stop_processing"?: boolean,"trigger": Database["public"]['Enums']["chat_automation_trigger"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "actions"?: NonNullable<Json>,"conditions"?: NonNullable<Json>,"cooldown_seconds"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"last_run_at"?: string | null,"name"?: string,"position"?: number,"run_count"?: number,"stop_processing"?: boolean,"trigger"?: Database["public"]['Enums']["chat_automation_trigger"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_automation_rules_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_automation_rules_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_automation_runs": {
                  Row: {
                    "actions_taken": NonNullable<Json>,"conversation_id": string | null,"created_at": string,"dedupe_key": string,"error": string | null,"id": string,"rule_id": string,"status": Database["public"]['Enums']["chat_automation_run_status"],"trigger": Database["public"]['Enums']["chat_automation_trigger"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actions_taken"?: NonNullable<Json>,"conversation_id"?: string | null,"created_at"?: string,"dedupe_key": string,"error"?: string | null,"id"?: string,"rule_id": string,"status": Database["public"]['Enums']["chat_automation_run_status"],"trigger": Database["public"]['Enums']["chat_automation_trigger"]
                  }
                  Update: {
                    "actions_taken"?: NonNullable<Json>,"conversation_id"?: string | null,"created_at"?: string,"dedupe_key"?: string,"error"?: string | null,"id"?: string,"rule_id"?: string,"status"?: Database["public"]['Enums']["chat_automation_run_status"],"trigger"?: Database["public"]['Enums']["chat_automation_trigger"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_automation_runs_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_automation_runs_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "chat_automation_rules"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_conversation_participants": {
                  Row: {
                    "conversation_id": string,"joined_at": string,"last_delivered_seq": number,"last_read_seq": number,"left_at": string | null,"muted": boolean,"role": Database["public"]['Enums']["chat_participant_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"joined_at"?: string,"last_delivered_seq"?: number,"last_read_seq"?: number,"left_at"?: string | null,"muted"?: boolean,"role": Database["public"]['Enums']["chat_participant_role"],"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"joined_at"?: string,"last_delivered_seq"?: number,"last_read_seq"?: number,"left_at"?: string | null,"muted"?: boolean,"role"?: Database["public"]['Enums']["chat_participant_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_conversation_participants_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversation_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_conversation_tags": {
                  Row: {
                    "added_at": string,"added_by": string | null,"conversation_id": string,"tag_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"conversation_id": string,"tag_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"conversation_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_conversation_tags_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversation_tags_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversation_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "chat_tags"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_conversations": {
                  Row: {
                    "assignee_id": string | null,"automation_paused": boolean,"closed_at": string | null,"closed_by": string | null,"created_at": string,"created_by": string | null,"csat_rating": number | null,"customer_id": string | null,"department": string | null,"escalated_at": string | null,"first_response_at": string | null,"id": string,"kind": Database["public"]['Enums']["chat_conversation_type"],"last_customer_message_at": string | null,"last_message_at": string,"last_message_preview": string | null,"last_message_sender_id": string | null,"last_staff_message_at": string | null,"message_count": number,"order_id": string | null,"priority": Database["public"]['Enums']["chat_priority"],"product_id": string | null,"resolved_at": string | null,"status": Database["public"]['Enums']["chat_conversation_status"],"subject": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"automation_paused"?: boolean,"closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"csat_rating"?: number | null,"customer_id"?: string | null,"department"?: string | null,"escalated_at"?: string | null,"first_response_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["chat_conversation_type"],"last_customer_message_at"?: string | null,"last_message_at"?: string,"last_message_preview"?: string | null,"last_message_sender_id"?: string | null,"last_staff_message_at"?: string | null,"message_count"?: number,"order_id"?: string | null,"priority"?: Database["public"]['Enums']["chat_priority"],"product_id"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["chat_conversation_status"],"subject": string,"updated_at"?: string
                  }
                  Update: {
                    "assignee_id"?: string | null,"automation_paused"?: boolean,"closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"csat_rating"?: number | null,"customer_id"?: string | null,"department"?: string | null,"escalated_at"?: string | null,"first_response_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["chat_conversation_type"],"last_customer_message_at"?: string | null,"last_message_at"?: string,"last_message_preview"?: string | null,"last_message_sender_id"?: string | null,"last_staff_message_at"?: string | null,"message_count"?: number,"order_id"?: string | null,"priority"?: Database["public"]['Enums']["chat_priority"],"product_id"?: string | null,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["chat_conversation_status"],"subject"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_conversations_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_last_message_sender_id_fkey"
      columns: ["last_message_sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_csat_responses": {
                  Row: {
                    "comment": string | null,"conversation_id": string,"created_at": string,"customer_id": string | null,"id": string,"rating": number
                  }
                  ComputedFields: never
                  Insert: {
                    "comment"?: string | null,"conversation_id": string,"created_at"?: string,"customer_id"?: string | null,"id"?: string,"rating": number
                  }
                  Update: {
                    "comment"?: string | null,"conversation_id"?: string,"created_at"?: string,"customer_id"?: string | null,"id"?: string,"rating"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_csat_responses_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: true
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_csat_responses_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_internal_notes": {
                  Row: {
                    "author_id": string | null,"body": string,"conversation_id": string,"created_at": string,"id": string,"seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"conversation_id": string,"created_at"?: string,"id"?: string,"seq"?: never
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"seq"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_internal_notes_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_internal_notes_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_message_feedback": {
                  Row: {
                    "comment": string | null,"conversation_id": string,"created_at": string,"customer_id": string,"id": string,"message_id": string,"updated_at": string,"verdict": Database["public"]['Enums']["chat_feedback_verdict"]
                  }
                  ComputedFields: never
                  Insert: {
                    "comment"?: string | null,"conversation_id": string,"created_at"?: string,"customer_id": string,"id"?: string,"message_id": string,"updated_at"?: string,"verdict": Database["public"]['Enums']["chat_feedback_verdict"]
                  }
                  Update: {
                    "comment"?: string | null,"conversation_id"?: string,"created_at"?: string,"customer_id"?: string,"id"?: string,"message_id"?: string,"updated_at"?: string,"verdict"?: Database["public"]['Enums']["chat_feedback_verdict"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_message_feedback_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_feedback_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_feedback_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_message_reactions": {
                  Row: {
                    "created_at": string,"emoji": string,"message_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"emoji": string,"message_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"emoji"?: string,"message_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_message_reactions_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_reactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_message_reports": {
                  Row: {
                    "action_taken": string | null,"conversation_id": string,"created_at": string,"details": string | null,"id": string,"message_id": string,"reason": Database["public"]['Enums']["chat_report_reason"],"reported_by": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": Database["public"]['Enums']["chat_report_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "action_taken"?: string | null,"conversation_id": string,"created_at"?: string,"details"?: string | null,"id"?: string,"message_id": string,"reason": Database["public"]['Enums']["chat_report_reason"],"reported_by"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: Database["public"]['Enums']["chat_report_status"]
                  }
                  Update: {
                    "action_taken"?: string | null,"conversation_id"?: string,"created_at"?: string,"details"?: string | null,"id"?: string,"message_id"?: string,"reason"?: Database["public"]['Enums']["chat_report_reason"],"reported_by"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: Database["public"]['Enums']["chat_report_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_message_reports_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_reports_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_reports_reported_by_fkey"
      columns: ["reported_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_reports_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_message_templates": {
                  Row: {
                    "body": string,"category": Database["public"]['Enums']["chat_template_category"],"created_at": string,"created_by": string | null,"description": string | null,"id": string,"is_active": boolean,"locale": Database["public"]['Enums']["chat_template_locale"],"name": string,"updated_at": string,"updated_by": string | null,"usage_count": number,"variables": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"category"?: Database["public"]['Enums']["chat_template_category"],"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"locale"?: Database["public"]['Enums']["chat_template_locale"],"name": string,"updated_at"?: string,"updated_by"?: string | null,"usage_count"?: number,"variables"?: (string)[]
                  }
                  Update: {
                    "body"?: string,"category"?: Database["public"]['Enums']["chat_template_category"],"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"locale"?: Database["public"]['Enums']["chat_template_locale"],"name"?: string,"updated_at"?: string,"updated_by"?: string | null,"usage_count"?: number,"variables"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_message_templates_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_message_templates_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_messages": {
                  Row: {
                    "body": string | null,"client_message_id": string | null,"conversation_id": string,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"kind": Database["public"]['Enums']["chat_message_kind"],"mentions": (string)[] | null,"metadata": NonNullable<Json>,"pinned_at": string | null,"pinned_by": string | null,"reply_to_id": string | null,"sender_id": string | null,"sender_role": Database["public"]['Enums']["chat_participant_role"],"seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"client_message_id"?: string | null,"conversation_id": string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["chat_message_kind"],"mentions"?: (string)[] | null,"metadata"?: NonNullable<Json>,"pinned_at"?: string | null,"pinned_by"?: string | null,"reply_to_id"?: string | null,"sender_id"?: string | null,"sender_role": Database["public"]['Enums']["chat_participant_role"],"seq"?: never
                  }
                  Update: {
                    "body"?: string | null,"client_message_id"?: string | null,"conversation_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["chat_message_kind"],"mentions"?: (string)[] | null,"metadata"?: NonNullable<Json>,"pinned_at"?: string | null,"pinned_by"?: string | null,"reply_to_id"?: string | null,"sender_id"?: string | null,"sender_role"?: Database["public"]['Enums']["chat_participant_role"],"seq"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_pinned_by_fkey"
      columns: ["pinned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_reply_to_id_fkey"
      columns: ["reply_to_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_saved_replies": {
                  Row: {
                    "body": string,"created_at": string,"id": string,"is_active": boolean,"owner_id": string | null,"shortcut": string | null,"title": string,"updated_at": string,"usage_count": number,"visibility": Database["public"]['Enums']["chat_saved_reply_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"owner_id"?: string | null,"shortcut"?: string | null,"title": string,"updated_at"?: string,"usage_count"?: number,"visibility": Database["public"]['Enums']["chat_saved_reply_visibility"]
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"owner_id"?: string | null,"shortcut"?: string | null,"title"?: string,"updated_at"?: string,"usage_count"?: number,"visibility"?: Database["public"]['Enums']["chat_saved_reply_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_saved_replies_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_tags": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"is_active": boolean,"label": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"label": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"label"?: string,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_tags_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"checkout_recovery_attempts": {
                  Row: {
                    "admin_id": string | null,"channel": string,"created_at": string,"id": number,"note": string | null,"session_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id"?: string | null,"channel": string,"created_at"?: string,"id"?: never,"note"?: string | null,"session_id": string
                  }
                  Update: {
                    "admin_id"?: string | null,"channel"?: string,"created_at"?: string,"id"?: never,"note"?: string | null,"session_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkout_recovery_attempts_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkout_recovery_attempts_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "checkout_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"checkout_recovery_links": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expires_at": string,"id": string,"revoked_at": string | null,"session_id": string,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at": string,"id"?: string,"revoked_at"?: string | null,"session_id": string,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"revoked_at"?: string | null,"session_id"?: string,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkout_recovery_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkout_recovery_links_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "checkout_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"checkout_sessions": {
                  Row: {
                    "abandoned_at": string | null,"address_id": string | null,"cart_id": string,"converted_at": string | null,"converted_order_id": string | null,"coupon_code": string | null,"id": string,"last_activity_at": string,"recovery_state": Database["public"]['Enums']["checkout_recovery_state"],"started_at": string,"status": Database["public"]['Enums']["checkout_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "abandoned_at"?: string | null,"address_id"?: string | null,"cart_id": string,"converted_at"?: string | null,"converted_order_id"?: string | null,"coupon_code"?: string | null,"id"?: string,"last_activity_at"?: string,"recovery_state"?: Database["public"]['Enums']["checkout_recovery_state"],"started_at"?: string,"status"?: Database["public"]['Enums']["checkout_status"],"user_id": string
                  }
                  Update: {
                    "abandoned_at"?: string | null,"address_id"?: string | null,"cart_id"?: string,"converted_at"?: string | null,"converted_order_id"?: string | null,"coupon_code"?: string | null,"id"?: string,"last_activity_at"?: string,"recovery_state"?: Database["public"]['Enums']["checkout_recovery_state"],"started_at"?: string,"status"?: Database["public"]['Enums']["checkout_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkout_sessions_address_id_fkey"
      columns: ["address_id"]
isOneToOne: false
      referencedRelation: "addresses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkout_sessions_cart_id_fkey"
      columns: ["cart_id"]
isOneToOne: false
      referencedRelation: "carts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkout_sessions_converted_order_id_fkey"
      columns: ["converted_order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkout_sessions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"coupon_customers": {
                  Row: {
                    "added_at": string,"added_by": string | null,"coupon_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"coupon_id": string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"coupon_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coupon_customers_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coupon_customers_coupon_id_fkey"
      columns: ["coupon_id"]
isOneToOne: false
      referencedRelation: "coupons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coupon_customers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"coupon_redemptions": {
                  Row: {
                    "coupon_id": string,"discount_minor": number,"id": number,"order_id": string,"redeemed_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "coupon_id": string,"discount_minor": number,"id"?: never,"order_id": string,"redeemed_at"?: string,"user_id": string
                  }
                  Update: {
                    "coupon_id"?: string,"discount_minor"?: number,"id"?: never,"order_id"?: string,"redeemed_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coupon_redemptions_coupon_id_fkey"
      columns: ["coupon_id"]
isOneToOne: false
      referencedRelation: "coupons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coupon_redemptions_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coupon_redemptions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"coupons": {
                  Row: {
                    "audience": string,"category_ids": (string)[],"code": string,"collect_limit": number | null,"created_at": string,"created_by": string | null,"description": string | null,"ends_at": string | null,"id": string,"is_active": boolean,"is_voucher": boolean,"kind": string,"max_discount_minor": number | null,"min_order_minor": number,"per_customer_limit": number,"product_ids": (string)[],"scope": string,"starts_at": string | null,"title": string | null,"total_limit": number | null,"updated_at": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string,"category_ids"?: (string)[],"code": string,"collect_limit"?: number | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"is_voucher"?: boolean,"kind": string,"max_discount_minor"?: number | null,"min_order_minor"?: number,"per_customer_limit"?: number,"product_ids"?: (string)[],"scope"?: string,"starts_at"?: string | null,"title"?: string | null,"total_limit"?: number | null,"updated_at"?: string,"value": number
                  }
                  Update: {
                    "audience"?: string,"category_ids"?: (string)[],"code"?: string,"collect_limit"?: number | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"is_voucher"?: boolean,"kind"?: string,"max_discount_minor"?: number | null,"min_order_minor"?: number,"per_customer_limit"?: number,"product_ids"?: (string)[],"scope"?: string,"starts_at"?: string | null,"title"?: string | null,"total_limit"?: number | null,"updated_at"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "coupons_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_accounts": {
                  Row: {
                    "api_base_url": string | null,"cod_fee_bp": number | null,"display_name": string,"is_enabled": boolean,"last_check_at": string | null,"last_check_message": string | null,"last_check_mode": string | null,"last_check_ok": boolean | null,"live_verified_at": string | null,"live_verified_by": string | null,"provider": string,"return_charge_minor": number | null,"settings": NonNullable<Json>,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "api_base_url"?: string | null,"cod_fee_bp"?: number | null,"display_name": string,"is_enabled"?: boolean,"last_check_at"?: string | null,"last_check_message"?: string | null,"last_check_mode"?: string | null,"last_check_ok"?: boolean | null,"live_verified_at"?: string | null,"live_verified_by"?: string | null,"provider": string,"return_charge_minor"?: number | null,"settings"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "api_base_url"?: string | null,"cod_fee_bp"?: number | null,"display_name"?: string,"is_enabled"?: boolean,"last_check_at"?: string | null,"last_check_message"?: string | null,"last_check_mode"?: string | null,"last_check_ok"?: boolean | null,"live_verified_at"?: string | null,"live_verified_by"?: string | null,"provider"?: string,"return_charge_minor"?: number | null,"settings"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_accounts_live_verified_by_fkey"
      columns: ["live_verified_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_accounts_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_cod_ledger": {
                  Row: {
                    "amount_minor": number,"created_at": string,"created_by": string | null,"dedupe_key": string | null,"entry_type": string,"evidence_ref": string | null,"id": number,"is_mock": boolean,"note": string | null,"order_id": string,"settlement_id": string | null,"shipment_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"created_at"?: string,"created_by"?: string | null,"dedupe_key"?: string | null,"entry_type": string,"evidence_ref"?: string | null,"id"?: never,"is_mock": boolean,"note"?: string | null,"order_id": string,"settlement_id"?: string | null,"shipment_id": string
                  }
                  Update: {
                    "amount_minor"?: number,"created_at"?: string,"created_by"?: string | null,"dedupe_key"?: string | null,"entry_type"?: string,"evidence_ref"?: string | null,"id"?: never,"is_mock"?: boolean,"note"?: string | null,"order_id"?: string,"settlement_id"?: string | null,"shipment_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_cod_ledger_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_cod_ledger_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_cod_ledger_settlement_id_fkey"
      columns: ["settlement_id"]
isOneToOne: false
      referencedRelation: "courier_settlements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_cod_ledger_shipment_id_fkey"
      columns: ["shipment_id"]
isOneToOne: false
      referencedRelation: "shipments"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_credentials": {
                  Row: {
                    "field": string,"provider": string,"secret_id": string,"set_at": string,"set_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "field": string,"provider": string,"secret_id": string,"set_at"?: string,"set_by"?: string | null
                  }
                  Update: {
                    "field"?: string,"provider"?: string,"secret_id"?: string,"set_at"?: string,"set_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_credentials_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "courier_credentials_set_by_fkey"
      columns: ["set_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_location_mappings": {
                  Row: {
                    "area_key": string,"destination": NonNullable<Json>,"district": string,"id": string,"label": string | null,"provider": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "area_key": string,"destination": NonNullable<Json>,"district": string,"id"?: string,"label"?: string | null,"provider": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "area_key"?: string,"destination"?: NonNullable<Json>,"district"?: string,"id"?: string,"label"?: string | null,"provider"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_location_mappings_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "courier_location_mappings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_quotes": {
                  Row: {
                    "available": boolean,"cod_amount_minor": number,"cod_fee_minor": number | null,"delivery_charge_minor": number | null,"details": NonNullable<Json>,"expires_at": string,"id": string,"is_mock": boolean,"kind": string,"order_id": string,"provider": string,"quoted_at": string,"quoted_by": string | null,"return_charge_minor": number | null,"unavailable_reason": string | null,"weight_grams": number,"zone": Database["public"]['Enums']["delivery_zone"]
                  }
                  ComputedFields: never
                  Insert: {
                    "available": boolean,"cod_amount_minor": number,"cod_fee_minor"?: number | null,"delivery_charge_minor"?: number | null,"details"?: NonNullable<Json>,"expires_at": string,"id"?: string,"is_mock"?: boolean,"kind": string,"order_id": string,"provider": string,"quoted_at"?: string,"quoted_by"?: string | null,"return_charge_minor"?: number | null,"unavailable_reason"?: string | null,"weight_grams": number,"zone": Database["public"]['Enums']["delivery_zone"]
                  }
                  Update: {
                    "available"?: boolean,"cod_amount_minor"?: number,"cod_fee_minor"?: number | null,"delivery_charge_minor"?: number | null,"details"?: NonNullable<Json>,"expires_at"?: string,"id"?: string,"is_mock"?: boolean,"kind"?: string,"order_id"?: string,"provider"?: string,"quoted_at"?: string,"quoted_by"?: string | null,"return_charge_minor"?: number | null,"unavailable_reason"?: string | null,"weight_grams"?: number,"zone"?: Database["public"]['Enums']["delivery_zone"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_quotes_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_quotes_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "courier_quotes_quoted_by_fkey"
      columns: ["quoted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_rate_cards": {
                  Row: {
                    "charge_minor": number,"created_at": string,"id": string,"is_active": boolean,"provider": string,"updated_at": string,"updated_by": string | null,"weight_up_to_grams": number,"zone": Database["public"]['Enums']["delivery_zone"]
                  }
                  ComputedFields: never
                  Insert: {
                    "charge_minor": number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"provider": string,"updated_at"?: string,"updated_by"?: string | null,"weight_up_to_grams": number,"zone": Database["public"]['Enums']["delivery_zone"]
                  }
                  Update: {
                    "charge_minor"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"provider"?: string,"updated_at"?: string,"updated_by"?: string | null,"weight_up_to_grams"?: number,"zone"?: Database["public"]['Enums']["delivery_zone"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_rate_cards_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "courier_rate_cards_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_settings": {
                  Row: {
                    "booking_enabled": boolean,"default_parcel_weight_grams": number,"http_timeout_ms": number,"id": boolean,"live_booking_confirmed_at": string | null,"live_booking_confirmed_by": string | null,"min_history_sample": number,"mode": string,"preferred_provider": string | null,"quote_validity_minutes": number,"tracking_sync_enabled": boolean,"tracking_sync_interval_seconds": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_enabled"?: boolean,"default_parcel_weight_grams"?: number,"http_timeout_ms"?: number,"id"?: boolean,"live_booking_confirmed_at"?: string | null,"live_booking_confirmed_by"?: string | null,"min_history_sample"?: number,"mode"?: string,"preferred_provider"?: string | null,"quote_validity_minutes"?: number,"tracking_sync_enabled"?: boolean,"tracking_sync_interval_seconds"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booking_enabled"?: boolean,"default_parcel_weight_grams"?: number,"http_timeout_ms"?: number,"id"?: boolean,"live_booking_confirmed_at"?: string | null,"live_booking_confirmed_by"?: string | null,"min_history_sample"?: number,"mode"?: string,"preferred_provider"?: string | null,"quote_validity_minutes"?: number,"tracking_sync_enabled"?: boolean,"tracking_sync_interval_seconds"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_settings_live_booking_confirmed_by_fkey"
      columns: ["live_booking_confirmed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_settings_preferred_provider_fkey"
      columns: ["preferred_provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "courier_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_settlements": {
                  Row: {
                    "amount_minor": number,"created_at": string,"created_by": string | null,"id": string,"is_mock": boolean,"note": string | null,"provider": string,"received_on": string,"reference": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_mock"?: boolean,"note"?: string | null,"provider": string,"received_on": string,"reference": string
                  }
                  Update: {
                    "amount_minor"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_mock"?: boolean,"note"?: string | null,"provider"?: string,"received_on"?: string,"reference"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_settlements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_settlements_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    }
                  ]
                },"courier_webhook_events": {
                  Row: {
                    "attempts": number,"consignment_id": string | null,"dedupe_key": string,"event_type": string | null,"id": string,"last_error": string | null,"merchant_ref": string | null,"next_attempt_at": string | null,"payload": NonNullable<Json>,"processed_at": string | null,"provider": string,"received_at": string,"shipment_id": string | null,"signature_ok": boolean,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"consignment_id"?: string | null,"dedupe_key": string,"event_type"?: string | null,"id"?: string,"last_error"?: string | null,"merchant_ref"?: string | null,"next_attempt_at"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider": string,"received_at"?: string,"shipment_id"?: string | null,"signature_ok": boolean,"status"?: string
                  }
                  Update: {
                    "attempts"?: number,"consignment_id"?: string | null,"dedupe_key"?: string,"event_type"?: string | null,"id"?: string,"last_error"?: string | null,"merchant_ref"?: string | null,"next_attempt_at"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider"?: string,"received_at"?: string,"shipment_id"?: string | null,"signature_ok"?: boolean,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_webhook_events_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "courier_webhook_events_shipment_id_fkey"
      columns: ["shipment_id"]
isOneToOne: false
      referencedRelation: "shipments"
      referencedColumns: ["id"]
    }
                  ]
                },"customer_notifications": {
                  Row: {
                    "action_path": string | null,"body": string | null,"created_at": string,"dedupe_key": string,"entity_id": string,"entity_type": string,"id": string,"kind": Database["public"]['Enums']["customer_notification_kind"],"read_at": string | null,"title": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_path"?: string | null,"body"?: string | null,"created_at"?: string,"dedupe_key": string,"entity_id": string,"entity_type": string,"id"?: string,"kind": Database["public"]['Enums']["customer_notification_kind"],"read_at"?: string | null,"title": string,"user_id": string
                  }
                  Update: {
                    "action_path"?: string | null,"body"?: string | null,"created_at"?: string,"dedupe_key"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["customer_notification_kind"],"read_at"?: string | null,"title"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_charges": {
                  Row: {
                    "amount_minor": number,"updated_at": string,"zone": Database["public"]['Enums']["delivery_zone"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"updated_at"?: string,"zone": Database["public"]['Enums']["delivery_zone"]
                  }
                  Update: {
                    "amount_minor"?: number,"updated_at"?: string,"zone"?: Database["public"]['Enums']["delivery_zone"]
                  }
                  Relationships: [
                    
                  ]
                },"device_tokens": {
                  Row: {
                    "app_version": string | null,"created_at": string,"id": string,"invalidated_at": string | null,"last_seen_at": string,"platform": Database["public"]['Enums']["device_platform"],"promotional_opt_in": boolean,"session_id": string | null,"token": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_version"?: string | null,"created_at"?: string,"id"?: string,"invalidated_at"?: string | null,"last_seen_at"?: string,"platform": Database["public"]['Enums']["device_platform"],"promotional_opt_in"?: boolean,"session_id"?: string | null,"token": string,"user_id": string
                  }
                  Update: {
                    "app_version"?: string | null,"created_at"?: string,"id"?: string,"invalidated_at"?: string | null,"last_seen_at"?: string,"platform"?: Database["public"]['Enums']["device_platform"],"promotional_opt_in"?: boolean,"session_id"?: string | null,"token"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "device_tokens_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"discount_campaign_brands": {
                  Row: {
                    "brand_id": string,"campaign_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_id": string,"campaign_id": string
                  }
                  Update: {
                    "brand_id"?: string,"campaign_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "discount_campaign_brands_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "discount_campaign_brands_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "discount_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"discount_campaign_categories": {
                  Row: {
                    "campaign_id": string,"category_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"category_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"category_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "discount_campaign_categories_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "discount_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "discount_campaign_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"discount_campaign_products": {
                  Row: {
                    "campaign_id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"product_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "discount_campaign_products_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "discount_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "discount_campaign_products_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"discount_campaigns": {
                  Row: {
                    "banner_image_key": string | null,"coupon_policy": Database["public"]['Enums']["campaign_coupon_policy"],"created_at": string,"created_by": string | null,"customer_title": string,"discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"discount_value": number,"ended_at": string | null,"ends_at": string | null,"id": string,"internal_notes": string | null,"is_visible": boolean,"max_discount_minor": number | null,"name": string,"priority": number,"scope": Database["public"]['Enums']["campaign_scope"],"starts_at": string | null,"status": Database["public"]['Enums']["campaign_status"],"updated_at": string,"updated_by": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "banner_image_key"?: string | null,"coupon_policy"?: Database["public"]['Enums']["campaign_coupon_policy"],"created_at"?: string,"created_by"?: string | null,"customer_title": string,"discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"discount_value": number,"ended_at"?: string | null,"ends_at"?: string | null,"id"?: string,"internal_notes"?: string | null,"is_visible"?: boolean,"max_discount_minor"?: number | null,"name": string,"priority"?: number,"scope": Database["public"]['Enums']["campaign_scope"],"starts_at"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "banner_image_key"?: string | null,"coupon_policy"?: Database["public"]['Enums']["campaign_coupon_policy"],"created_at"?: string,"created_by"?: string | null,"customer_title"?: string,"discount_kind"?: Database["public"]['Enums']["campaign_discount_kind"],"discount_value"?: number,"ended_at"?: string | null,"ends_at"?: string | null,"id"?: string,"internal_notes"?: string | null,"is_visible"?: boolean,"max_discount_minor"?: number | null,"name"?: string,"priority"?: number,"scope"?: Database["public"]['Enums']["campaign_scope"],"starts_at"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "discount_campaigns_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "discount_campaigns_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"email_outbox": {
                  Row: {
                    "attempts": number,"created_at": string,"dedupe_key": string,"event_status": string | null,"id": string,"kind": string,"last_error": string | null,"locked_until": string | null,"next_attempt_at": string,"order_id": string,"order_number": string,"refund_id": string | null,"return_request_id": string | null,"sent_at": string | null,"shipment_id": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"dedupe_key": string,"event_status"?: string | null,"id"?: string,"kind": string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"order_id": string,"order_number": string,"refund_id"?: string | null,"return_request_id"?: string | null,"sent_at"?: string | null,"shipment_id"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"dedupe_key"?: string,"event_status"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"order_id"?: string,"order_number"?: string,"refund_id"?: string | null,"return_request_id"?: string | null,"sent_at"?: string | null,"shipment_id"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_outbox_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_refund_id_fkey"
      columns: ["refund_id"]
isOneToOne: false
      referencedRelation: "refunds"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_return_request_id_fkey"
      columns: ["return_request_id"]
isOneToOne: false
      referencedRelation: "return_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_shipment_id_fkey"
      columns: ["shipment_id"]
isOneToOne: false
      referencedRelation: "shipments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"export_jobs": {
                  Row: {
                    "content_type": string | null,"created_at": string,"created_by": string,"error": string | null,"expires_at": string,"file": string | null,"file_name": string | null,"filters": NonNullable<Json>,"finished_at": string | null,"format": string,"id": string,"kind": string,"progress": number,"row_count": number | null,"started_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_type"?: string | null,"created_at"?: string,"created_by": string,"error"?: string | null,"expires_at"?: string,"file"?: string | null,"file_name"?: string | null,"filters"?: NonNullable<Json>,"finished_at"?: string | null,"format": string,"id"?: string,"kind": string,"progress"?: number,"row_count"?: number | null,"started_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "content_type"?: string | null,"created_at"?: string,"created_by"?: string,"error"?: string | null,"expires_at"?: string,"file"?: string | null,"file_name"?: string | null,"filters"?: NonNullable<Json>,"finished_at"?: string | null,"format"?: string,"id"?: string,"kind"?: string,"progress"?: number,"row_count"?: number | null,"started_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "export_jobs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"homepage_sections": {
                  Row: {
                    "config": NonNullable<Json>,"is_enabled": boolean,"item_limit": number | null,"key": string,"sort_order": number,"title": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"is_enabled"?: boolean,"item_limit"?: number | null,"key": string,"sort_order": number,"title"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"is_enabled"?: boolean,"item_limit"?: number | null,"key"?: string,"sort_order"?: number,"title"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "homepage_sections_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "actor_id": string | null,"change": number,"created_at": string,"id": number,"note": string | null,"order_id": string | null,"product_id": string,"reason": Database["public"]['Enums']["inventory_reason"],"stock_after": number,"variant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"change": number,"created_at"?: string,"id"?: never,"note"?: string | null,"order_id"?: string | null,"product_id": string,"reason": Database["public"]['Enums']["inventory_reason"],"stock_after": number,"variant_id"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"change"?: number,"created_at"?: string,"id"?: never,"note"?: string | null,"order_id"?: string | null,"product_id"?: string,"reason"?: Database["public"]['Enums']["inventory_reason"],"stock_after"?: number,"variant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["id"]
    }
                  ]
                },"media_assets": {
                  Row: {
                    "alt": string | null,"bytes": number,"content_type": string,"created_at": string,"full_key": string,"height": number,"id": string,"original_name": string | null,"thumb_key": string,"uploaded_by": string | null,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "alt"?: string | null,"bytes": number,"content_type"?: string,"created_at"?: string,"full_key": string,"height": number,"id"?: string,"original_name"?: string | null,"thumb_key": string,"uploaded_by"?: string | null,"width": number
                  }
                  Update: {
                    "alt"?: string | null,"bytes"?: number,"content_type"?: string,"created_at"?: string,"full_key"?: string,"height"?: number,"id"?: string,"original_name"?: string | null,"thumb_key"?: string,"uploaded_by"?: string | null,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_assets_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"id": number,"kind": Database["public"]['Enums']["moderation_event_kind"],"note": string | null,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: never,"kind": Database["public"]['Enums']["moderation_event_kind"],"note"?: string | null,"task_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: never,"kind"?: Database["public"]['Enums']["moderation_event_kind"],"note"?: string | null,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_events_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "moderation_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_tasks": {
                  Row: {
                    "assigned_at": string | null,"assigned_by": string | null,"assigned_to": string | null,"content": NonNullable<Json>,"content_editor": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"id": string,"product_id": string,"status": Database["public"]['Enums']["moderation_task_status"],"submitted_at": string,"submitted_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string | null,"assigned_by"?: string | null,"assigned_to"?: string | null,"content": NonNullable<Json>,"content_editor"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"product_id": string,"status"?: Database["public"]['Enums']["moderation_task_status"],"submitted_at"?: string,"submitted_by"?: string | null
                  }
                  Update: {
                    "assigned_at"?: string | null,"assigned_by"?: string | null,"assigned_to"?: string | null,"content"?: NonNullable<Json>,"content_editor"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"product_id"?: string,"status"?: Database["public"]['Enums']["moderation_task_status"],"submitted_at"?: string,"submitted_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_tasks_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_tasks_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_tasks_content_editor_fkey"
      columns: ["content_editor"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_tasks_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_tasks_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_tasks_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_outbox": {
                  Row: {
                    "attempts": number,"created_at": string,"history_id": number | null,"id": string,"kind": string,"last_error": string | null,"locked_until": string | null,"next_attempt_at": string,"order_id": string,"order_number": string,"sent_at": string | null,"shipment_event_id": number | null,"shipment_status": Database["public"]['Enums']["shipment_status"] | null,"status": Database["public"]['Enums']["notification_status"],"to_status": Database["public"]['Enums']["order_status"] | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"history_id"?: number | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"order_id": string,"order_number": string,"sent_at"?: string | null,"shipment_event_id"?: number | null,"shipment_status"?: Database["public"]['Enums']["shipment_status"] | null,"status"?: Database["public"]['Enums']["notification_status"],"to_status"?: Database["public"]['Enums']["order_status"] | null,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"history_id"?: number | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"order_id"?: string,"order_number"?: string,"sent_at"?: string | null,"shipment_event_id"?: number | null,"shipment_status"?: Database["public"]['Enums']["shipment_status"] | null,"status"?: Database["public"]['Enums']["notification_status"],"to_status"?: Database["public"]['Enums']["order_status"] | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_outbox_history_id_fkey"
      columns: ["history_id"]
isOneToOne: true
      referencedRelation: "order_status_history"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_outbox_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_outbox_shipment_event_id_fkey"
      columns: ["shipment_event_id"]
isOneToOne: true
      referencedRelation: "shipment_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_outbox_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "in_app": boolean,"order_updates": boolean,"payment_updates": boolean,"promotions": boolean,"refund_updates": boolean,"return_updates": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "in_app"?: boolean,"order_updates"?: boolean,"payment_updates"?: boolean,"promotions"?: boolean,"refund_updates"?: boolean,"return_updates"?: boolean,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "in_app"?: boolean,"order_updates"?: boolean,"payment_updates"?: boolean,"promotions"?: boolean,"refund_updates"?: boolean,"return_updates"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"onboarding_campaigns": {
                  Row: {
                    "audience": string,"created_at": string,"ends_at": string | null,"frequency": string,"id": string,"internal_name": string,"is_active": boolean,"kind": string,"repeat_days": number | null,"slide_seconds": number,"starts_at": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string,"created_at"?: string,"ends_at"?: string | null,"frequency"?: string,"id"?: string,"internal_name": string,"is_active"?: boolean,"kind"?: string,"repeat_days"?: number | null,"slide_seconds"?: number,"starts_at"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "audience"?: string,"created_at"?: string,"ends_at"?: string | null,"frequency"?: string,"id"?: string,"internal_name"?: string,"is_active"?: boolean,"kind"?: string,"repeat_days"?: number | null,"slide_seconds"?: number,"starts_at"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "onboarding_campaigns_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"onboarding_slides": {
                  Row: {
                    "alt_text": string | null,"campaign_id": string,"created_at": string,"cta_label": string | null,"cta_path": string | null,"description": string,"heading": string,"icon": string | null,"id": string,"image_key": string | null,"internal_name": string,"is_active": boolean,"position": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_text"?: string | null,"campaign_id": string,"created_at"?: string,"cta_label"?: string | null,"cta_path"?: string | null,"description": string,"heading": string,"icon"?: string | null,"id"?: string,"image_key"?: string | null,"internal_name": string,"is_active"?: boolean,"position"?: number,"updated_at"?: string
                  }
                  Update: {
                    "alt_text"?: string | null,"campaign_id"?: string,"created_at"?: string,"cta_label"?: string | null,"cta_path"?: string | null,"description"?: string,"heading"?: string,"icon"?: string | null,"id"?: string,"image_key"?: string | null,"internal_name"?: string,"is_active"?: boolean,"position"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "onboarding_slides_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "onboarding_campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"onboarding_views": {
                  Row: {
                    "campaign_id": string,"completed_at": string | null,"first_viewed_at": string,"last_viewed_at": string,"user_id": string,"view_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"completed_at"?: string | null,"first_viewed_at"?: string,"last_viewed_at"?: string,"user_id": string,"view_count"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"completed_at"?: string | null,"first_viewed_at"?: string,"last_viewed_at"?: string,"user_id"?: string,"view_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "onboarding_views_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "onboarding_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "onboarding_views_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "campaign_discount_minor": number,"campaign_id": string | null,"campaign_title": string | null,"catalog_price_minor": number | null,"id": number,"image_alt": string | null,"image_key": string | null,"line_total_minor": number,"order_id": string,"product_id": string,"product_name": string,"product_slug": string,"quantity": number,"regular_price_minor": number | null,"sku": string,"unit_price_minor": number,"variant_id": string | null,"variant_label": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_discount_minor"?: number,"campaign_id"?: string | null,"campaign_title"?: string | null,"catalog_price_minor"?: number | null,"id"?: never,"image_alt"?: string | null,"image_key"?: string | null,"line_total_minor": number,"order_id": string,"product_id": string,"product_name": string,"product_slug": string,"quantity": number,"regular_price_minor"?: number | null,"sku": string,"unit_price_minor": number,"variant_id"?: string | null,"variant_label"?: string | null
                  }
                  Update: {
                    "campaign_discount_minor"?: number,"campaign_id"?: string | null,"campaign_title"?: string | null,"catalog_price_minor"?: number | null,"id"?: never,"image_alt"?: string | null,"image_key"?: string | null,"line_total_minor"?: number,"order_id"?: string,"product_id"?: string,"product_name"?: string,"product_slug"?: string,"quantity"?: number,"regular_price_minor"?: number | null,"sku"?: string,"unit_price_minor"?: number,"variant_id"?: string | null,"variant_label"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "discount_campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["id"]
    }
                  ]
                },"order_notes": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"id": string,"order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"id"?: string,"order_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_notes_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_notes_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"order_status_history": {
                  Row: {
                    "actor_id": string | null,"actor_kind": Database["public"]['Enums']["order_actor"],"created_at": string,"from_status": Database["public"]['Enums']["order_status"] | null,"id": number,"note": string | null,"order_id": string,"to_status": Database["public"]['Enums']["order_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": Database["public"]['Enums']["order_actor"],"created_at"?: string,"from_status"?: Database["public"]['Enums']["order_status"] | null,"id"?: never,"note"?: string | null,"order_id": string,"to_status": Database["public"]['Enums']["order_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: Database["public"]['Enums']["order_actor"],"created_at"?: string,"from_status"?: Database["public"]['Enums']["order_status"] | null,"id"?: never,"note"?: string | null,"order_id"?: string,"to_status"?: Database["public"]['Enums']["order_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_status_history_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_status_history_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "archive_reason": string | null,"archived_at": string | null,"archived_by": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"currency": string,"customer_note": string | null,"delivery_zone": Database["public"]['Enums']["delivery_zone"],"discount_minor": number,"id": string,"idempotency_key": string,"item_count": number,"order_number": string,"payment_collected_at": string | null,"payment_collected_by": string | null,"payment_method": Database["public"]['Enums']["payment_method"],"payment_status": Database["public"]['Enums']["payment_status"],"placed_at": string,"request_fingerprint": string,"ship_address_line": string,"ship_area": string,"ship_district": string,"ship_division": string,"ship_landmark": string | null,"ship_phone": string,"ship_postal_code": string | null,"ship_recipient_name": string,"shipping_fee_minor": number,"status": Database["public"]['Enums']["order_status"],"subtotal_minor": number,"total_minor": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archive_reason"?: string | null,"archived_at"?: string | null,"archived_by"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"currency"?: string,"customer_note"?: string | null,"delivery_zone": Database["public"]['Enums']["delivery_zone"],"discount_minor"?: number,"id"?: string,"idempotency_key": string,"item_count": number,"order_number"?: string,"payment_collected_at"?: string | null,"payment_collected_by"?: string | null,"payment_method"?: Database["public"]['Enums']["payment_method"],"payment_status"?: Database["public"]['Enums']["payment_status"],"placed_at"?: string,"request_fingerprint": string,"ship_address_line": string,"ship_area": string,"ship_district": string,"ship_division": string,"ship_landmark"?: string | null,"ship_phone": string,"ship_postal_code"?: string | null,"ship_recipient_name": string,"shipping_fee_minor": number,"status"?: Database["public"]['Enums']["order_status"],"subtotal_minor": number,"total_minor": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archive_reason"?: string | null,"archived_at"?: string | null,"archived_by"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"currency"?: string,"customer_note"?: string | null,"delivery_zone"?: Database["public"]['Enums']["delivery_zone"],"discount_minor"?: number,"id"?: string,"idempotency_key"?: string,"item_count"?: number,"order_number"?: string,"payment_collected_at"?: string | null,"payment_collected_by"?: string | null,"payment_method"?: Database["public"]['Enums']["payment_method"],"payment_status"?: Database["public"]['Enums']["payment_status"],"placed_at"?: string,"request_fingerprint"?: string,"ship_address_line"?: string,"ship_area"?: string,"ship_district"?: string,"ship_division"?: string,"ship_landmark"?: string | null,"ship_phone"?: string,"ship_postal_code"?: string | null,"ship_recipient_name"?: string,"shipping_fee_minor"?: number,"status"?: Database["public"]['Enums']["order_status"],"subtotal_minor"?: number,"total_minor"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_archived_by_fkey"
      columns: ["archived_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_payment_collected_by_fkey"
      columns: ["payment_collected_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"permissions": {
                  Row: {
                    "description": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"name": string
                  }
                  Update: {
                    "description"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"popups": {
                  Row: {
                    "button_href": string | null,"button_label": string | null,"created_at": string,"created_by": string | null,"delay_seconds": number,"description": string | null,"display_mode": string,"ends_at": string | null,"frequency": string,"id": string,"image_alt": string | null,"image_bytes": number | null,"image_format": string | null,"image_height": number | null,"image_key": string | null,"image_kind": string | null,"image_width": number | null,"internal_name": string,"is_active": boolean,"starts_at": string | null,"subtitle": string | null,"title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "button_href"?: string | null,"button_label"?: string | null,"created_at"?: string,"created_by"?: string | null,"delay_seconds"?: number,"description"?: string | null,"display_mode"?: string,"ends_at"?: string | null,"frequency"?: string,"id"?: string,"image_alt"?: string | null,"image_bytes"?: number | null,"image_format"?: string | null,"image_height"?: number | null,"image_key"?: string | null,"image_kind"?: string | null,"image_width"?: number | null,"internal_name": string,"is_active"?: boolean,"starts_at"?: string | null,"subtitle"?: string | null,"title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "button_href"?: string | null,"button_label"?: string | null,"created_at"?: string,"created_by"?: string | null,"delay_seconds"?: number,"description"?: string | null,"display_mode"?: string,"ends_at"?: string | null,"frequency"?: string,"id"?: string,"image_alt"?: string | null,"image_bytes"?: number | null,"image_format"?: string | null,"image_height"?: number | null,"image_key"?: string | null,"image_kind"?: string | null,"image_width"?: number | null,"internal_name"?: string,"is_active"?: boolean,"starts_at"?: string | null,"subtitle"?: string | null,"title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "popups_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_announcement_deliveries": {
                  Row: {
                    "announcement_id": string,"attempts": number,"created_at": string,"id": string,"last_error": string | null,"locked_until": string | null,"next_attempt_at": string,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "announcement_id": string,"attempts"?: number,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"user_id": string
                  }
                  Update: {
                    "announcement_id"?: string,"attempts"?: number,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_announcement_deliveries_announcement_id_fkey"
      columns: ["announcement_id"]
isOneToOne: false
      referencedRelation: "product_announcements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_announcement_deliveries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_announcements": {
                  Row: {
                    "body": string | null,"created_at": string,"created_by": string | null,"id": string,"image_key": string | null,"kind": string,"product_id": string | null,"product_name": string,"product_slug": string,"published_at": string,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"image_key"?: string | null,"kind"?: string,"product_id"?: string | null,"product_name": string,"product_slug": string,"published_at": string,"title"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"image_key"?: string | null,"kind"?: string,"product_id"?: string | null,"product_name"?: string,"product_slug"?: string,"published_at"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_announcements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_announcements_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_attribute_values": {
                  Row: {
                    "attribute_id": string,"created_at": string,"id": string,"position": number,"slug": string,"swatch_hex": string | null,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attribute_id": string,"created_at"?: string,"id"?: string,"position"?: number,"slug": string,"swatch_hex"?: string | null,"value": string
                  }
                  Update: {
                    "attribute_id"?: string,"created_at"?: string,"id"?: string,"position"?: number,"slug"?: string,"swatch_hex"?: string | null,"value"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_attribute_values_attribute_id_fkey"
      columns: ["attribute_id"]
isOneToOne: false
      referencedRelation: "product_attributes"
      referencedColumns: ["id"]
    }
                  ]
                },"product_attributes": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"kind": string,"name": string,"position": number,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: string,"name": string,"position"?: number,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: string,"name"?: string,"position"?: number,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"product_images": {
                  Row: {
                    "alt_text": string | null,"bytes": number,"created_at": string,"created_by": string | null,"height": number,"id": string,"position": number,"product_id": string,"storage_key": string,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_text"?: string | null,"bytes": number,"created_at"?: string,"created_by"?: string | null,"height": number,"id"?: string,"position": number,"product_id": string,"storage_key": string,"width": number
                  }
                  Update: {
                    "alt_text"?: string | null,"bytes"?: number,"created_at"?: string,"created_by"?: string | null,"height"?: number,"id"?: string,"position"?: number,"product_id"?: string,"storage_key"?: string,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_images_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_review_images": {
                  Row: {
                    "created_at": string,"height": number,"id": string,"position": number,"review_id": string,"storage_key": string,"user_id": string,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"height": number,"id"?: string,"position": number,"review_id": string,"storage_key": string,"user_id": string,"width": number
                  }
                  Update: {
                    "created_at"?: string,"height"?: number,"id"?: string,"position"?: number,"review_id"?: string,"storage_key"?: string,"user_id"?: string,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_review_images_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "product_reviews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_review_images_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_review_replies": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"review_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"review_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"review_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_review_replies_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_review_replies_review_id_fkey"
      columns: ["review_id"]
isOneToOne: true
      referencedRelation: "product_reviews"
      referencedColumns: ["id"]
    }
                  ]
                },"product_review_votes": {
                  Row: {
                    "created_at": string,"helpful": boolean,"review_id": string,"updated_at": string,"voter_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"helpful": boolean,"review_id": string,"updated_at"?: string,"voter_id": string
                  }
                  Update: {
                    "created_at"?: string,"helpful"?: boolean,"review_id"?: string,"updated_at"?: string,"voter_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_review_votes_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "product_reviews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_review_votes_voter_id_fkey"
      columns: ["voter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_reviews": {
                  Row: {
                    "body": string,"created_at": string,"id": string,"moderated_at": string | null,"moderated_by": string | null,"moderation_note": string | null,"order_id": string,"product_id": string,"published_at": string | null,"rating": number,"status": string,"title": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"id"?: string,"moderated_at"?: string | null,"moderated_by"?: string | null,"moderation_note"?: string | null,"order_id": string,"product_id": string,"published_at"?: string | null,"rating": number,"status"?: string,"title"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"id"?: string,"moderated_at"?: string | null,"moderated_by"?: string | null,"moderation_note"?: string | null,"order_id"?: string,"product_id"?: string,"published_at"?: string | null,"rating"?: number,"status"?: string,"title"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_reviews_moderated_by_fkey"
      columns: ["moderated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_shopping_zones": {
                  Row: {
                    "created_at": string,"product_id": string,"zone_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"product_id": string,"zone_id": string
                  }
                  Update: {
                    "created_at"?: string,"product_id"?: string,"zone_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_shopping_zones_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_shopping_zones_zone_id_fkey"
      columns: ["zone_id"]
isOneToOne: false
      referencedRelation: "shopping_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"product_variant_values": {
                  Row: {
                    "attribute_id": string,"attribute_value_id": string,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attribute_id": string,"attribute_value_id": string,"variant_id": string
                  }
                  Update: {
                    "attribute_id"?: string,"attribute_value_id"?: string,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_variant_values_attribute_value_id_attribute_id_fkey"
      columns: ["attribute_value_id","attribute_id"]
isOneToOne: false
      referencedRelation: "product_attribute_values"
      referencedColumns: ["id","attribute_id"]
    },{
      foreignKeyName: "product_variant_values_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["id"]
    }
                  ]
                },"product_variants": {
                  Row: {
                    "compare_at_price_minor": number | null,"created_at": string,"id": string,"image_url": string | null,"is_active": boolean,"position": number,"price_minor": number | null,"product_id": string,"sku": string,"stock_quantity": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "compare_at_price_minor"?: number | null,"created_at"?: string,"id"?: string,"image_url"?: string | null,"is_active"?: boolean,"position"?: number,"price_minor"?: number | null,"product_id": string,"sku": string,"stock_quantity"?: number,"updated_at"?: string
                  }
                  Update: {
                    "compare_at_price_minor"?: number | null,"created_at"?: string,"id"?: string,"image_url"?: string | null,"is_active"?: boolean,"position"?: number,"price_minor"?: number | null,"product_id"?: string,"sku"?: string,"stock_quantity"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_videos": {
                  Row: {
                    "bytes": number,"content_type": string,"created_at": string,"created_by": string | null,"id": string,"position": number,"product_id": string,"storage_key": string,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes": number,"content_type": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"position": number,"product_id": string,"storage_key": string,"title"?: string | null
                  }
                  Update: {
                    "bytes"?: number,"content_type"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"position"?: number,"product_id"?: string,"storage_key"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_videos_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_videos_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "brand_id": string | null,"canonical_path": string | null,"category_id": string,"compare_at_price_minor": number | null,"content_updated_by": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"is_featured": boolean,"max_order_quantity": number,"moderation_status": Database["public"]['Enums']["moderation_status"],"name": string,"no_index": boolean,"og_description": string | null,"og_image_key": string | null,"og_title": string | null,"price_minor": number,"published_at": string | null,"search": unknown,"seo_description": string | null,"seo_title": string | null,"size_chart": Json | null,"sku": string,"slug": string,"status": Database["public"]['Enums']["product_status"],"stock_quantity": number,"summary": string | null,"tags": (string)[],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_id"?: string | null,"canonical_path"?: string | null,"category_id": string,"compare_at_price_minor"?: number | null,"content_updated_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_featured"?: boolean,"max_order_quantity"?: number,"moderation_status"?: Database["public"]['Enums']["moderation_status"],"name": string,"no_index"?: boolean,"og_description"?: string | null,"og_image_key"?: string | null,"og_title"?: string | null,"price_minor": number,"published_at"?: string | null,"search"?: never,"seo_description"?: string | null,"seo_title"?: string | null,"size_chart"?: Json | null,"sku": string,"slug": string,"status"?: Database["public"]['Enums']["product_status"],"stock_quantity"?: number,"summary"?: string | null,"tags"?: (string)[],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "brand_id"?: string | null,"canonical_path"?: string | null,"category_id"?: string,"compare_at_price_minor"?: number | null,"content_updated_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_featured"?: boolean,"max_order_quantity"?: number,"moderation_status"?: Database["public"]['Enums']["moderation_status"],"name"?: string,"no_index"?: boolean,"og_description"?: string | null,"og_image_key"?: string | null,"og_title"?: string | null,"price_minor"?: number,"published_at"?: string | null,"search"?: never,"seo_description"?: string | null,"seo_title"?: string | null,"size_chart"?: Json | null,"sku"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["product_status"],"stock_quantity"?: number,"summary"?: string | null,"tags"?: (string)[],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_content_updated_by_fkey"
      columns: ["content_updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_key": string | null,"created_at": string,"email": string | null,"email_verified_at": string | null,"failed_login_count": number,"full_name": string | null,"id": string,"locked_until": string | null,"password_hash": string | null,"password_updated_at": string | null,"phone": string | null,"status": Database["public"]['Enums']["profile_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_key"?: string | null,"created_at"?: string,"email"?: string | null,"email_verified_at"?: string | null,"failed_login_count"?: number,"full_name"?: string | null,"id": string,"locked_until"?: string | null,"password_hash"?: string | null,"password_updated_at"?: string | null,"phone"?: string | null,"status"?: Database["public"]['Enums']["profile_status"],"updated_at"?: string
                  }
                  Update: {
                    "avatar_key"?: string | null,"created_at"?: string,"email"?: string | null,"email_verified_at"?: string | null,"failed_login_count"?: number,"full_name"?: string | null,"id"?: string,"locked_until"?: string | null,"password_hash"?: string | null,"password_updated_at"?: string | null,"phone"?: string | null,"status"?: Database["public"]['Enums']["profile_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"refund_status_history": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"from_status": Database["public"]['Enums']["refund_status"] | null,"id": number,"note": string | null,"refund_id": string,"to_status": Database["public"]['Enums']["refund_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["refund_status"] | null,"id"?: never,"note"?: string | null,"refund_id": string,"to_status": Database["public"]['Enums']["refund_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["refund_status"] | null,"id"?: never,"note"?: string | null,"refund_id"?: string,"to_status"?: Database["public"]['Enums']["refund_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "refund_status_history_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refund_status_history_refund_id_fkey"
      columns: ["refund_id"]
isOneToOne: false
      referencedRelation: "refunds"
      referencedColumns: ["id"]
    }
                  ]
                },"refunds": {
                  Row: {
                    "amount_minor": number,"completed_at": string | null,"completed_by": string | null,"decided_at": string | null,"decided_by": string | null,"id": string,"method": Database["public"]['Enums']["refund_method"],"note": string | null,"order_id": string,"reason": string,"reference": string | null,"requested_at": string,"requested_by": string | null,"return_request_id": string | null,"status": Database["public"]['Enums']["refund_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"completed_at"?: string | null,"completed_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"method"?: Database["public"]['Enums']["refund_method"],"note"?: string | null,"order_id": string,"reason": string,"reference"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"return_request_id"?: string | null,"status"?: Database["public"]['Enums']["refund_status"],"updated_at"?: string
                  }
                  Update: {
                    "amount_minor"?: number,"completed_at"?: string | null,"completed_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"method"?: Database["public"]['Enums']["refund_method"],"note"?: string | null,"order_id"?: string,"reason"?: string,"reference"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"return_request_id"?: string | null,"status"?: Database["public"]['Enums']["refund_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_return_request_id_fkey"
      columns: ["return_request_id"]
isOneToOne: false
      referencedRelation: "return_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"return_items": {
                  Row: {
                    "id": number,"line_total_minor": number,"order_item_id": number,"quantity": number,"return_request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"line_total_minor": number,"order_item_id": number,"quantity": number,"return_request_id": string
                  }
                  Update: {
                    "id"?: never,"line_total_minor"?: number,"order_item_id"?: number,"quantity"?: number,"return_request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_items_order_item_id_fkey"
      columns: ["order_item_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "return_items_return_request_id_fkey"
      columns: ["return_request_id"]
isOneToOne: false
      referencedRelation: "return_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"return_requests": {
                  Row: {
                    "decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"description": string | null,"id": string,"item_count": number,"order_id": string,"reason": string,"received_at": string | null,"refundable_minor": number,"requested_at": string,"restocked_at": string | null,"restocked_by": string | null,"status": Database["public"]['Enums']["return_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"description"?: string | null,"id"?: string,"item_count"?: number,"order_id": string,"reason": string,"received_at"?: string | null,"refundable_minor"?: number,"requested_at"?: string,"restocked_at"?: string | null,"restocked_by"?: string | null,"status"?: Database["public"]['Enums']["return_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"description"?: string | null,"id"?: string,"item_count"?: number,"order_id"?: string,"reason"?: string,"received_at"?: string | null,"refundable_minor"?: number,"requested_at"?: string,"restocked_at"?: string | null,"restocked_by"?: string | null,"status"?: Database["public"]['Enums']["return_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "return_requests_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "return_requests_restocked_by_fkey"
      columns: ["restocked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "return_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"return_status_history": {
                  Row: {
                    "actor_id": string | null,"actor_kind": Database["public"]['Enums']["order_actor"],"created_at": string,"from_status": Database["public"]['Enums']["return_status"] | null,"id": number,"note": string | null,"return_request_id": string,"to_status": Database["public"]['Enums']["return_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": Database["public"]['Enums']["order_actor"],"created_at"?: string,"from_status"?: Database["public"]['Enums']["return_status"] | null,"id"?: never,"note"?: string | null,"return_request_id": string,"to_status": Database["public"]['Enums']["return_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: Database["public"]['Enums']["order_actor"],"created_at"?: string,"from_status"?: Database["public"]['Enums']["return_status"] | null,"id"?: never,"note"?: string | null,"return_request_id"?: string,"to_status"?: Database["public"]['Enums']["return_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_status_history_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "return_status_history_return_request_id_fkey"
      columns: ["return_request_id"]
isOneToOne: false
      referencedRelation: "return_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"review_prompt_dismissals": {
                  Row: {
                    "dismissed_at": string,"product_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "dismissed_at"?: string,"product_id": string,"user_id": string
                  }
                  Update: {
                    "dismissed_at"?: string,"product_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_prompt_dismissals_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "review_prompt_dismissals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"role_permissions": {
                  Row: {
                    "permission": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "permission": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  Update: {
                    "permission"?: string,"role"?: Database["public"]['Enums']["app_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_fkey"
      columns: ["permission"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["name"]
    }
                  ]
                },"shipment_events": {
                  Row: {
                    "actor_id": string | null,"applied": boolean,"dedupe_key": string,"id": number,"note": string | null,"occurred_at": string,"provider_status": string | null,"recorded_at": string,"shipment_id": string,"source": string,"status": Database["public"]['Enums']["shipment_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"applied": boolean,"dedupe_key": string,"id"?: never,"note"?: string | null,"occurred_at": string,"provider_status"?: string | null,"recorded_at"?: string,"shipment_id": string,"source": string,"status": Database["public"]['Enums']["shipment_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"applied"?: boolean,"dedupe_key"?: string,"id"?: never,"note"?: string | null,"occurred_at"?: string,"provider_status"?: string | null,"recorded_at"?: string,"shipment_id"?: string,"source"?: string,"status"?: Database["public"]['Enums']["shipment_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "shipment_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shipment_events_shipment_id_fkey"
      columns: ["shipment_id"]
isOneToOne: false
      referencedRelation: "shipments"
      referencedColumns: ["id"]
    }
                  ]
                },"shipments": {
                  Row: {
                    "booked_at": string | null,"booked_by": string | null,"booking_error": string | null,"booking_key": string,"booking_uncertain": boolean,"cancel_reason": string | null,"cancelled_at": string | null,"cod_amount_minor": number,"cod_state": string,"consignment_id": string | null,"created_at": string,"created_by": string | null,"delivered_at": string | null,"delivery_zone": Database["public"]['Enums']["delivery_zone"],"destination": NonNullable<Json>,"expected_charge_minor": number | null,"expected_cod_fee_minor": number | null,"id": string,"is_mock": boolean,"kind": string,"last_event_at": string | null,"merchant_ref": string,"next_sync_at": string | null,"note": string | null,"order_id": string,"parent_shipment_id": string | null,"picked_up_at": string | null,"provider": string,"provider_call_started_at": string | null,"provider_status": string | null,"quote_id": string | null,"recommended_provider": string | null,"return_request_id": string | null,"selection_reason": string | null,"status": Database["public"]['Enums']["shipment_status"],"sync_attempts": number,"sync_error": string | null,"tracking_code": string | null,"tracking_url": string | null,"updated_at": string,"weight_grams": number
                  }
                  ComputedFields: never
                  Insert: {
                    "booked_at"?: string | null,"booked_by"?: string | null,"booking_error"?: string | null,"booking_key": string,"booking_uncertain"?: boolean,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cod_amount_minor": number,"cod_state"?: string,"consignment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_at"?: string | null,"delivery_zone": Database["public"]['Enums']["delivery_zone"],"destination"?: NonNullable<Json>,"expected_charge_minor"?: number | null,"expected_cod_fee_minor"?: number | null,"id"?: string,"is_mock": boolean,"kind"?: string,"last_event_at"?: string | null,"merchant_ref": string,"next_sync_at"?: string | null,"note"?: string | null,"order_id": string,"parent_shipment_id"?: string | null,"picked_up_at"?: string | null,"provider": string,"provider_call_started_at"?: string | null,"provider_status"?: string | null,"quote_id"?: string | null,"recommended_provider"?: string | null,"return_request_id"?: string | null,"selection_reason"?: string | null,"status"?: Database["public"]['Enums']["shipment_status"],"sync_attempts"?: number,"sync_error"?: string | null,"tracking_code"?: string | null,"tracking_url"?: string | null,"updated_at"?: string,"weight_grams": number
                  }
                  Update: {
                    "booked_at"?: string | null,"booked_by"?: string | null,"booking_error"?: string | null,"booking_key"?: string,"booking_uncertain"?: boolean,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cod_amount_minor"?: number,"cod_state"?: string,"consignment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_at"?: string | null,"delivery_zone"?: Database["public"]['Enums']["delivery_zone"],"destination"?: NonNullable<Json>,"expected_charge_minor"?: number | null,"expected_cod_fee_minor"?: number | null,"id"?: string,"is_mock"?: boolean,"kind"?: string,"last_event_at"?: string | null,"merchant_ref"?: string,"next_sync_at"?: string | null,"note"?: string | null,"order_id"?: string,"parent_shipment_id"?: string | null,"picked_up_at"?: string | null,"provider"?: string,"provider_call_started_at"?: string | null,"provider_status"?: string | null,"quote_id"?: string | null,"recommended_provider"?: string | null,"return_request_id"?: string | null,"selection_reason"?: string | null,"status"?: Database["public"]['Enums']["shipment_status"],"sync_attempts"?: number,"sync_error"?: string | null,"tracking_code"?: string | null,"tracking_url"?: string | null,"updated_at"?: string,"weight_grams"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "shipments_booked_by_fkey"
      columns: ["booked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shipments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shipments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shipments_parent_shipment_id_fkey"
      columns: ["parent_shipment_id"]
isOneToOne: false
      referencedRelation: "shipments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shipments_provider_fkey"
      columns: ["provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "shipments_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "courier_quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shipments_recommended_provider_fkey"
      columns: ["recommended_provider"]
isOneToOne: false
      referencedRelation: "courier_accounts"
      referencedColumns: ["provider"]
    },{
      foreignKeyName: "shipments_return_request_id_fkey"
      columns: ["return_request_id"]
isOneToOne: false
      referencedRelation: "return_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"shopping_zones": {
                  Row: {
                    "audience": string | null,"banner_alt": string | null,"banner_key": string | null,"created_at": string,"created_by": string | null,"description": string | null,"display_order": number,"id": string,"is_active": boolean,"mobile_banner_key": string | null,"name": string,"seo_description": string | null,"seo_title": string | null,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string | null,"banner_alt"?: string | null,"banner_key"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"display_order"?: number,"id"?: string,"is_active"?: boolean,"mobile_banner_key"?: string | null,"name": string,"seo_description"?: string | null,"seo_title"?: string | null,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: string | null,"banner_alt"?: string | null,"banner_key"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"display_order"?: number,"id"?: string,"is_active"?: boolean,"mobile_banner_key"?: string | null,"name"?: string,"seo_description"?: string | null,"seo_title"?: string | null,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shopping_zones_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"site_menu_items": {
                  Row: {
                    "created_at": string,"href": string,"id": string,"is_active": boolean,"label": string,"menu": string,"sort_order": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"href": string,"id"?: string,"is_active"?: boolean,"label": string,"menu": string,"sort_order"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"href"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"menu"?: string,"sort_order"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_menu_items_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"site_pages": {
                  Row: {
                    "body": string,"is_published": boolean,"seo_description": string | null,"seo_title": string | null,"slug": string,"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"is_published"?: boolean,"seo_description"?: string | null,"seo_title"?: string | null,"slug": string,"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"is_published"?: boolean,"seo_description"?: string | null,"seo_title"?: string | null,"slug"?: string,"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_pages_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_notifications": {
                  Row: {
                    "action_path": string | null,"audience_permission": string | null,"body": string | null,"created_at": string,"dedupe_key": string,"entity_id": string,"entity_type": string,"id": string,"kind": Database["public"]['Enums']["staff_notification_kind"],"read_at": string | null,"recipient_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_path"?: string | null,"audience_permission"?: string | null,"body"?: string | null,"created_at"?: string,"dedupe_key": string,"entity_id": string,"entity_type": string,"id"?: string,"kind": Database["public"]['Enums']["staff_notification_kind"],"read_at"?: string | null,"recipient_id"?: string | null,"title": string
                  }
                  Update: {
                    "action_path"?: string | null,"audience_permission"?: string | null,"body"?: string | null,"created_at"?: string,"dedupe_key"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["staff_notification_kind"],"read_at"?: string | null,"recipient_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"store_profile": {
                  Row: {
                    "address_area": string | null,"address_district": string | null,"address_line": string | null,"app_store_url": string | null,"business_hours": string | null,"contact_email": string | null,"contact_phone": string | null,"default_seo_description": string | null,"default_seo_title": string | null,"description": string | null,"display_name": string,"id": boolean,"logo_key": string | null,"og_image_key": string | null,"play_store_url": string | null,"social_facebook": string | null,"social_instagram": string | null,"social_tiktok": string | null,"social_x": string | null,"social_youtube": string | null,"support_email": string | null,"support_phone": string | null,"tagline": string | null,"updated_at": string,"updated_by": string | null,"whatsapp_number": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address_area"?: string | null,"address_district"?: string | null,"address_line"?: string | null,"app_store_url"?: string | null,"business_hours"?: string | null,"contact_email"?: string | null,"contact_phone"?: string | null,"default_seo_description"?: string | null,"default_seo_title"?: string | null,"description"?: string | null,"display_name"?: string,"id"?: boolean,"logo_key"?: string | null,"og_image_key"?: string | null,"play_store_url"?: string | null,"social_facebook"?: string | null,"social_instagram"?: string | null,"social_tiktok"?: string | null,"social_x"?: string | null,"social_youtube"?: string | null,"support_email"?: string | null,"support_phone"?: string | null,"tagline"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_number"?: string | null
                  }
                  Update: {
                    "address_area"?: string | null,"address_district"?: string | null,"address_line"?: string | null,"app_store_url"?: string | null,"business_hours"?: string | null,"contact_email"?: string | null,"contact_phone"?: string | null,"default_seo_description"?: string | null,"default_seo_title"?: string | null,"description"?: string | null,"display_name"?: string,"id"?: boolean,"logo_key"?: string | null,"og_image_key"?: string | null,"play_store_url"?: string | null,"social_facebook"?: string | null,"social_instagram"?: string | null,"social_tiktok"?: string | null,"social_x"?: string | null,"social_youtube"?: string | null,"support_email"?: string | null,"support_phone"?: string | null,"tagline"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_number"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_profile_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"store_settings": {
                  Row: {
                    "cart_inactivity_minutes": number,"cod_enabled": boolean,"high_spend_threshold_minor": number,"id": boolean,"inactive_days": number,"monthly_sales_target_minor": number | null,"repeat_order_threshold": number,"return_window_days": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cart_inactivity_minutes"?: number,"cod_enabled"?: boolean,"high_spend_threshold_minor"?: number,"id"?: boolean,"inactive_days"?: number,"monthly_sales_target_minor"?: number | null,"repeat_order_threshold"?: number,"return_window_days"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "cart_inactivity_minutes"?: number,"cod_enabled"?: boolean,"high_spend_threshold_minor"?: number,"id"?: boolean,"inactive_days"?: number,"monthly_sales_target_minor"?: number | null,"repeat_order_threshold"?: number,"return_window_days"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_permissions": {
                  Row: {
                    "created_at": string,"effect": Database["public"]['Enums']["permission_effect"],"granted_by": string | null,"permission": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effect": Database["public"]['Enums']["permission_effect"],"granted_by"?: string | null,"permission": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"effect"?: Database["public"]['Enums']["permission_effect"],"granted_by"?: string | null,"permission"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_permissions_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_permissions_permission_fkey"
      columns: ["permission"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["name"]
    },{
      foreignKeyName: "user_permissions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_roles_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"voucher_collections": {
                  Row: {
                    "collected_at": string,"coupon_id": string,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "collected_at"?: string,"coupon_id": string,"id"?: string,"user_id": string
                  }
                  Update: {
                    "collected_at"?: string,"coupon_id"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "voucher_collections_coupon_id_fkey"
      columns: ["coupon_id"]
isOneToOne: false
      referencedRelation: "coupons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "voucher_collections_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"wishlist_items": {
                  Row: {
                    "created_at": string,"product_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"product_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"product_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "wishlist_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wishlist_items_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "account_emails_due":
{ Args: { "p_user": string }; Returns: string[]
                           },
"add_chat_internal_note":
{ Args: { "p_body": string,"p_conversation_id": string }; Returns: {
              "author_id": string,"author_name": string,"body": string,"created_at": string,"id": string,"seq": number
            }[]
                           },
"add_review_image":
{ Args: { "p_height": number,"p_key": string,"p_review_id": string,"p_width": number }; Returns: Json
                           },
"admin_abandoned_checkout":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"admin_abandoned_checkouts":
{ Args: { "p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_sort"?: string,"p_status"?: string,"p_to"?: string }; Returns: {
              "abandoned_at": string,"attempt_count": number,"cart_value_minor": number,"converted_at": string,"coupon_code": string,"customer_name": string,"customer_phone": string,"id": string,"item_count": number,"last_activity_at": string,"order_number": string,"recovery_state": Database["public"]['Enums']["checkout_recovery_state"],"started_at": string,"status": Database["public"]['Enums']["checkout_status"],"total_count": number
            }[]
                           },
"admin_account_names":
{ Args: { "p_ids": (string)[] }; Returns: {
              "email": string,"full_name": string,"id": string
            }[]
                           },
"admin_add_order_note":
{ Args: { "p_body": string,"p_order_number": string }; Returns: undefined
                           },
"admin_add_product_image":
{ Args: { "p_alt_text"?: string,"p_bytes": number,"p_height": number,"p_image_id": string,"p_product_id": string,"p_width": number }; Returns: number
                           },
"admin_add_product_video":
{ Args: { "p_bytes": number,"p_content_type": string,"p_product_id": string,"p_title"?: string,"p_video_id": string }; Returns: number
                           },
"admin_adjust_stock":
{ Args: { "p_change": number,"p_note": string,"p_product_id": string }; Returns: number
                           },
"admin_adjust_variant_stock":
{ Args: { "p_change": number,"p_note": string,"p_variant_id": string }; Returns: number
                           },
"admin_analytics_overview":
{ Args: { "p_compare"?: boolean,"p_from": string,"p_to": string }; Returns: Json
                           },
"admin_audit_export":
{ Args: { "p_filters": Json,"p_format": string,"p_kind": string,"p_row_count": number }; Returns: undefined
                           },
"admin_audit_log":
{ Args: { "p_action_prefix"?: string,"p_actor"?: string,"p_limit"?: number,"p_offset"?: number }; Returns: {
              "action": string,"actor_email": string,"actor_id": string,"actor_name": string,"created_at": string,"details": Json,"id": number,"target_id": string,"target_type": string,"total_count": number
            }[]
                           },
"admin_audit_log_search":
{ Args: { "p_action_prefix"?: string,"p_actor"?: string,"p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_q"?: string,"p_to"?: string }; Returns: {
              "action": string,"actor_email": string,"actor_id": string,"actor_name": string,"created_at": string,"details": Json,"id": number,"target_id": string,"target_type": string,"total_count": number
            }[]
                           },
"admin_begin_exchange_shipment":
{ Args: { "p_booking_key": string,"p_cod_amount_minor": number,"p_destination": Json,"p_is_mock": boolean,"p_note": string,"p_provider": string,"p_return_id": string,"p_weight_grams": number }; Returns: Json
                           },
"admin_begin_return_pickup":
{ Args: { "p_booking_key": string,"p_destination": Json,"p_is_mock": boolean,"p_note": string,"p_provider": string,"p_return_id": string,"p_weight_grams": number }; Returns: Json
                           },
"admin_begin_shipment_booking":
{ Args: { "p_booking_key": string,"p_destination": Json,"p_is_mock": boolean,"p_note": string,"p_order_number": string,"p_provider": string,"p_quote_id": string,"p_recommended_provider": string,"p_selection_reason": string,"p_weight_grams": number }; Returns: Json
                           },
"admin_campaign_conflicts":
{ Args: { "p_campaign_id": string }; Returns: Json
                           },
"admin_campaign_history":
{ Args: { "p_campaign_id": string,"p_limit"?: number,"p_offset"?: number }; Returns: Json
                           },
"admin_campaign_products":
{ Args: { "p_campaign_id": string,"p_page"?: number,"p_page_size"?: number }; Returns: Json
                           },
"admin_cancel_refund":
{ Args: { "p_note": string,"p_refund_id": string }; Returns: Database["public"]['Enums']["refund_status"]
                           },
"admin_cancel_shipment":
{ Args: { "p_provider_confirmed": boolean,"p_reason": string,"p_shipment_id": string }; Returns: Json
                           },
"admin_category_campaigns":
{ Args: { "p_category_ids"?: (string)[] }; Returns: {
              "campaign_id": string,"category_id": string,"customer_title": string,"discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"discount_value": number,"ends_at": string,"product_count": number,"scope": Database["public"]['Enums']["campaign_scope"],"starts_at": string,"status": Database["public"]['Enums']["campaign_status"]
            }[]
                           },
"admin_category_zones":
{ Args: { "p_category_id": string }; Returns: Json
                           },
"admin_checkout_recovery_metrics":
{ Args: { "p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"admin_clear_category_image":
{ Args: { "p_category_id": string }; Returns: string
                           },
"admin_clear_courier_credential":
{ Args: { "p_field": string,"p_provider": string }; Returns: undefined
                           },
"admin_clear_review_reply":
{ Args: { "p_review_id": string }; Returns: undefined
                           },
"admin_cod_positions":
{ Args: { "p_include_mock": boolean,"p_limit": number,"p_offset": number,"p_provider": string,"p_status": string }; Returns: Json
                           },
"admin_complete_refund":
{ Args: { "p_note"?: string,"p_reference": string,"p_refund_id": string }; Returns: Database["public"]['Enums']["refund_status"]
                           },
"admin_coupon_redemptions":
{ Args: { "p_coupon_id": string,"p_page"?: number,"p_page_size"?: number }; Returns: Json
                           },
"admin_coupon_targeting":
{ Args: { "p_coupon_id": string }; Returns: Json
                           },
"admin_courier_config":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_courier_overview":
{ Args: { "p_include_mock"?: boolean }; Returns: Json
                           },
"admin_courier_provider_stats":
{ Args: { "p_days"?: number }; Returns: Json
                           },
"admin_create_broadcast":
{ Args: { "p_body": string,"p_image_key"?: string,"p_link_path"?: string,"p_product_id"?: string,"p_scheduled_for"?: string,"p_title": string }; Returns: Json
                           },
"admin_get_push_settings":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_save_push_settings":
{ Args: { "p_auto_announce": boolean,"p_body_template": string,"p_title_template": string }; Returns: Json
                           },
"admin_create_export_job":
{ Args: { "p_filters": Json,"p_format": string,"p_kind": string }; Returns: Json
                           },
"admin_create_product":
{ Args: { "p_category_id": string,"p_compare_at_price_minor": number,"p_description": string,"p_initial_stock": number,"p_is_featured": boolean,"p_max_order_quantity": number,"p_name": string,"p_price_minor": number,"p_sku": string,"p_slug": string,"p_summary": string }; Returns: string
                           } |
{ Args: { "p_category_id": string,"p_compare_at_price_minor": number,"p_description": string,"p_initial_stock": number,"p_is_featured": boolean,"p_max_order_quantity": number,"p_name": string,"p_price_minor": number,"p_size_chart": Json,"p_sku": string,"p_slug": string,"p_summary": string,"p_tags": (string)[] }; Returns: string
                           },
"admin_create_recovery_link":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"admin_customer_insights":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_segment"?: string }; Returns: {
              "average_order_minor": number,"completed_orders": number,"eligible_spend_minor": number,"email": string,"first_order_at": string,"full_name": string,"id": string,"last_order_at": string,"orders_count": number,"segments": (string)[],"total_count": number
            }[]
                           },
"admin_decide_refund":
{ Args: { "p_approve": boolean,"p_note"?: string,"p_refund_id": string }; Returns: Database["public"]['Enums']["refund_status"]
                           },
"admin_decide_return":
{ Args: { "p_note"?: string,"p_return_id": string,"p_status": Database["public"]['Enums']["return_status"] }; Returns: Database["public"]['Enums']["return_status"]
                           },
"admin_delete_banner":
{ Args: { "p_banner_id": string }; Returns: string
                           },
"admin_delete_banner_files":
{ Args: { "p_banner_id": string }; Returns: (string)[]
                           },
"admin_delete_brand":
{ Args: { "p_brand_id": string }; Returns: string
                           },
"admin_delete_category":
{ Args: { "p_category_id": string }; Returns: undefined
                           },
"admin_delete_coupon":
{ Args: { "p_coupon_id": string }; Returns: undefined
                           },
"admin_delete_courier_location_mapping":
{ Args: { "p_id": string }; Returns: undefined
                           },
"admin_delete_courier_rate_card":
{ Args: { "p_id": string }; Returns: undefined
                           },
"admin_delete_media":
{ Args: { "p_id": string }; Returns: (string)[]
                           },
"admin_delete_menu_item":
{ Args: { "p_id": string }; Returns: undefined
                           },
"admin_delete_onboarding_campaign":
{ Args: { "p_campaign_id": string }; Returns: undefined
                           },
"admin_delete_onboarding_slide":
{ Args: { "p_slide_id": string }; Returns: undefined
                           },
"admin_delete_popup":
{ Args: { "p_popup_id": string }; Returns: string
                           },
"admin_delete_product":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"admin_delete_product_image":
{ Args: { "p_image_id": string }; Returns: string
                           },
"admin_delete_product_video":
{ Args: { "p_video_id": string }; Returns: string
                           },
"admin_delete_shopping_zone":
{ Args: { "p_zone_id": string }; Returns: Json
                           },
"admin_delete_variant":
{ Args: { "p_variant_id": string }; Returns: boolean
                           },
"admin_download_export_job":
{ Args: { "p_id": string }; Returns: {
              "content_type": string,"file": string,"file_name": string,"format": string,"kind": string,"row_count": number
            }[]
                           },
"admin_duplicate_campaign":
{ Args: { "p_campaign_id": string }; Returns: Json
                           },
"admin_finish_shipment_booking":
{ Args: { "p_charge_minor": number,"p_consignment_id": string,"p_error": string,"p_outcome": string,"p_provider_status": string,"p_shipment_id": string,"p_tracking_code": string,"p_tracking_url": string }; Returns: Json
                           },
"admin_get_campaign":
{ Args: { "p_campaign_id": string }; Returns: Json
                           },
"admin_get_checkout":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"admin_get_coupon":
{ Args: { "p_coupon_id": string }; Returns: Json
                           },
"admin_get_customer":
{ Args: { "p_id": string }; Returns: {
              "created_at": string,"email": string,"full_name": string,"id": string,"last_order_at": string,"order_count": number,"phone": string,"status": Database["public"]['Enums']["profile_status"]
            }[]
                           },
"admin_get_export_job":
{ Args: { "p_id": string }; Returns: Json
                           },
"admin_get_onboarding":
{ Args: { "p_campaign_id": string }; Returns: Json
                           },
"admin_get_popup":
{ Args: { "p_popup_id": string }; Returns: Json
                           },
"admin_get_refund":
{ Args: { "p_refund_id": string }; Returns: Json
                           },
"admin_get_return":
{ Args: { "p_return_id": string }; Returns: Json
                           },
"admin_get_shipment":
{ Args: { "p_shipment_id": string }; Returns: Json
                           },
"admin_homepage":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_attributes":
{ Args: Record<PropertyKey, never>; Returns: {
              "id": string,"is_active": boolean,"kind": string,"name": string,"position": number,"slug": string,"values": Json
            }[]
                           },
"admin_list_broadcasts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_campaigns":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_scope"?: string,"p_search"?: string,"p_state"?: string }; Returns: Json
                           },
"admin_list_checkouts":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_status"?: string }; Returns: {
              "coupon_code": string,"customer_name": string,"id": string,"item_count": number,"last_activity_at": string,"order_number": string,"started_at": string,"status": Database["public"]['Enums']["checkout_status"],"total_count": number
            }[]
                           },
"admin_list_coupons":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_search"?: string,"p_state"?: string }; Returns: Json
                           },
"admin_list_courier_settlements":
{ Args: { "p_include_mock": boolean,"p_limit": number,"p_offset": number,"p_provider": string }; Returns: Json
                           },
"admin_list_customers":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_status"?: Database["public"]['Enums']["profile_status"] }; Returns: {
              "created_at": string,"email": string,"full_name": string,"id": string,"last_order_at": string,"order_count": number,"phone": string,"status": Database["public"]['Enums']["profile_status"],"total_count": number
            }[]
                           },
"admin_list_export_jobs":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"admin_list_media":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_q"?: string }; Returns: {
              "asset": Json,"total_count": number
            }[]
                           },
"admin_list_menu_items":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_onboarding":
{ Args: Record<PropertyKey, never>; Returns: {
              "active_slide_count": number,"audience": string,"ends_at": string,"frequency": string,"id": string,"internal_name": string,"is_active": boolean,"kind": string,"repeat_days": number,"slide_count": number,"slide_seconds": number,"starts_at": string,"updated_at": string
            }[]
                           },
"admin_list_popups":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_product_reviews":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_product_search"?: string,"p_status"?: string }; Returns: Json
                           },
"admin_list_refunds":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_status"?: string }; Returns: {
              "amount_minor": number,"completed_at": string,"customer_name": string,"id": string,"method": Database["public"]['Enums']["refund_method"],"order_number": string,"reason": string,"requested_at": string,"status": Database["public"]['Enums']["refund_status"],"total_count": number
            }[]
                           },
"admin_list_returns":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query"?: string,"p_status"?: string }; Returns: {
              "customer_name": string,"decided_at": string,"id": string,"item_count": number,"order_number": string,"reason": string,"refundable_minor": number,"requested_at": string,"status": Database["public"]['Enums']["return_status"],"total_count": number
            }[]
                           },
"admin_list_reviewers":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"full_name": string,"id": string,"open_reviews": number
            }[]
                           },
"admin_list_roles":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_shipments":
{ Args: { "p_from": string,"p_include_mock": boolean,"p_kind": string,"p_limit": number,"p_offset": number,"p_provider": string,"p_query": string,"p_status": Database["public"]['Enums']["shipment_status"],"p_to": string }; Returns: Json
                           },
"admin_list_shopping_zones":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_query"?: string,"p_sort"?: string,"p_status"?: string }; Returns: Json
                           },
"admin_list_site_pages":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_staff":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"full_name": string,"granted_at": string,"id": string,"invitation_pending": boolean,"overrides": Json,"permissions": Json,"role": Database["public"]['Enums']["app_role"],"status": Database["public"]['Enums']["profile_status"]
            }[]
                           },
"admin_order_coupons":
{ Args: { "p_order_numbers": (string)[] }; Returns: Json
                           },
"admin_order_courier_context":
{ Args: { "p_order_number": string }; Returns: Json
                           },
"admin_order_document":
{ Args: { "p_kind": string,"p_order_number": string }; Returns: Json
                           },
"admin_order_geography":
{ Args: { "p_district"?: string,"p_division"?: string,"p_from": string,"p_metric"?: string,"p_status"?: string,"p_to": string }; Returns: Json
                           },
"admin_order_notes":
{ Args: { "p_order_number": string }; Returns: Json
                           },
"admin_order_shipment_states":
{ Args: { "p_order_numbers": (string)[] }; Returns: Json
                           },
"admin_order_shipments":
{ Args: { "p_order_number": string }; Returns: Json
                           },
"admin_prepare_invitation_resend":
{ Args: { "p_user_id": string }; Returns: string
                           },
"admin_preview_campaign":
{ Args: { "p_brand_ids"?: (string)[],"p_category_ids"?: (string)[],"p_discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"p_discount_value": number,"p_max_discount_minor"?: number,"p_page"?: number,"p_page_size"?: number,"p_priority"?: number,"p_product_ids"?: (string)[],"p_scope": Database["public"]['Enums']["campaign_scope"] }; Returns: Json
                           },
"admin_preview_onboarding":
{ Args: { "p_campaign_id": string }; Returns: Json
                           },
"admin_product_tags":
{ Args: { "p_product_id": string }; Returns: (string)[]
                           },
"admin_product_variants":
{ Args: { "p_product_id": string }; Returns: {
              "attribute_value_ids": (string)[],"compare_at_price_minor": number,"id": string,"image_url": string,"is_active": boolean,"label": string,"position": number,"price_minor": number,"sku": string,"stock_quantity": number
            }[]
                           },
"admin_product_zones":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"admin_record_cod_adjustment":
{ Args: { "p_amount_minor": number,"p_note": string,"p_shipment_id": string }; Returns: undefined
                           },
"admin_record_cod_collected":
{ Args: { "p_amount_minor": number,"p_evidence_ref": string,"p_note": string,"p_shipment_id": string }; Returns: undefined
                           },
"admin_record_cod_collection":
{ Args: { "p_order_number": string }; Returns: Database["public"]['Enums']["payment_status"]
                           },
"admin_record_courier_check":
{ Args: { "p_message": string,"p_mode": string,"p_ok": boolean,"p_provider": string }; Returns: undefined
                           },
"admin_record_courier_quotes":
{ Args: { "p_order_number": string,"p_quotes": Json }; Returns: Json
                           },
"admin_record_courier_settlement":
{ Args: { "p_amount_minor": number,"p_is_mock": boolean,"p_items": Json,"p_note": string,"p_provider": string,"p_received_on": string,"p_reference": string }; Returns: string
                           },
"admin_record_media":
{ Args: { "p_alt": string,"p_bytes": number,"p_content_type": string,"p_height": number,"p_id": string,"p_original_name": string,"p_width": number }; Returns: Json
                           },
"admin_record_portal_booking":
{ Args: { "p_booking_key": string,"p_charge_minor": number,"p_consignment_id": string,"p_is_mock": boolean,"p_note": string,"p_order_number": string,"p_provider": string,"p_recommended_provider": string,"p_return_id": string,"p_selection_reason": string,"p_tracking_code": string,"p_weight_grams": number }; Returns: Json
                           },
"admin_record_recovery_attempt":
{ Args: { "p_channel": string,"p_note"?: string,"p_session_id": string }; Returns: Json
                           },
"admin_record_shipment_event":
{ Args: { "p_dedupe_key": string,"p_note": string,"p_occurred_at": string,"p_provider_status": string,"p_shipment_id": string,"p_source": string,"p_status": Database["public"]['Enums']["shipment_status"] }; Returns: Json
                           },
"admin_reorder_banners":
{ Args: { "p_category_id": string,"p_ids": (string)[],"p_placement": Database["public"]['Enums']["banner_placement"] }; Returns: undefined
                           },
"admin_reorder_categories":
{ Args: { "p_ids": (string)[],"p_parent_id": string }; Returns: undefined
                           },
"admin_reorder_menu":
{ Args: { "p_ids": (string)[],"p_menu": string }; Returns: Json
                           },
"admin_reorder_onboarding_slides":
{ Args: { "p_campaign_id": string,"p_slide_ids": (string)[] }; Returns: undefined
                           },
"admin_reorder_product_images":
{ Args: { "p_image_ids": (string)[],"p_product_id": string }; Returns: undefined
                           },
"admin_reorder_product_videos":
{ Args: { "p_product_id": string,"p_video_ids": (string)[] }; Returns: undefined
                           },
"admin_reply_to_review":
{ Args: { "p_body": string,"p_review_id": string }; Returns: Json
                           },
"admin_report":
{ Args: { "p_filters": Json,"p_kind": string,"p_limit"?: number,"p_offset"?: number,"p_with_summary"?: boolean }; Returns: Json
                           },
"admin_request_refund":
{ Args: { "p_amount_minor": number,"p_method"?: Database["public"]['Enums']["refund_method"],"p_order_number": string,"p_reason": string,"p_return_id"?: string }; Returns: string
                           },
"admin_request_shipment_sync":
{ Args: { "p_shipment_id": string }; Returns: undefined
                           },
"admin_resolve_shipment_booking":
{ Args: { "p_consignment_id": string,"p_note": string,"p_outcome": string,"p_shipment_id": string,"p_tracking_code": string }; Returns: Json
                           },
"admin_restock_return":
{ Args: { "p_note"?: string,"p_return_id": string }; Returns: number
                           },
"admin_return_shipments":
{ Args: { "p_return_id": string }; Returns: Json
                           },
"admin_review_images":
{ Args: { "p_review_ids": (string)[] }; Returns: Json
                           },
"admin_revoke_recovery_link":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"admin_sales_overview":
{ Args: { "p_days"?: number }; Returns: Json
                           },
"admin_save_attribute":
{ Args: { "p_attribute_id": string,"p_is_active": boolean,"p_kind"?: string,"p_name": string,"p_position": number,"p_slug": string }; Returns: string
                           },
"admin_save_attribute_value":
{ Args: { "p_attribute_id": string,"p_position": number,"p_slug": string,"p_swatch_hex"?: string,"p_value": string,"p_value_id": string }; Returns: string
                           },
"admin_save_banner":
{ Args: { "p_banner_id": string,"p_category_id": string,"p_cta_href": string,"p_cta_label": string,"p_ends_at": string,"p_image_alt"?: string,"p_is_active": boolean,"p_placement": Database["public"]['Enums']["banner_placement"],"p_sort_order": number,"p_starts_at": string,"p_subtitle": string,"p_title": string }; Returns: string
                           },
"admin_save_brand":
{ Args: { "p_brand_id": string,"p_description": string,"p_is_active": boolean,"p_name": string,"p_slug": string }; Returns: string
                           },
"admin_save_campaign":
{ Args: { "p_banner_image_key"?: string,"p_brand_ids"?: (string)[],"p_campaign_id": string,"p_category_ids"?: (string)[],"p_coupon_policy"?: Database["public"]['Enums']["campaign_coupon_policy"],"p_customer_title": string,"p_discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"p_discount_value": number,"p_ends_at"?: string,"p_expected_version"?: number,"p_internal_notes"?: string,"p_is_visible"?: boolean,"p_max_discount_minor"?: number,"p_name": string,"p_priority"?: number,"p_product_ids"?: (string)[],"p_scope": Database["public"]['Enums']["campaign_scope"],"p_starts_at"?: string }; Returns: Json
                           },
"admin_save_category":
{ Args: { "p_category_id": string,"p_description": string,"p_is_active": boolean,"p_name": string,"p_slug": string,"p_sort_order": number }; Returns: string
                           },
"admin_save_category_placement":
{ Args: { "p_category_id": string,"p_is_featured": boolean,"p_parent_id": string }; Returns: string
                           },
"admin_save_category_seo":
{ Args: { "p_canonical_path"?: string,"p_category_id": string,"p_no_index"?: boolean,"p_og_description"?: string,"p_og_image_key"?: string,"p_og_title"?: string,"p_seo_description"?: string,"p_seo_title"?: string }; Returns: undefined
                           },
"admin_save_coupon":
{ Args: { "p_code": string,"p_coupon_id": string,"p_description"?: string,"p_ends_at"?: string,"p_is_active"?: boolean,"p_kind": string,"p_max_discount_minor"?: number,"p_min_order_minor"?: number,"p_per_customer_limit"?: number,"p_starts_at"?: string,"p_total_limit"?: number,"p_value": number }; Returns: string
                           },
"admin_save_coupon_targeting":
{ Args: { "p_audience": string,"p_category_ids": (string)[],"p_collect_limit": number,"p_coupon_id": string,"p_customer_ids"?: (string)[],"p_is_voucher": boolean,"p_product_ids": (string)[],"p_scope": string,"p_title": string }; Returns: undefined
                           },
"admin_save_courier_api_base_url":
{ Args: { "p_provider": string,"p_url": string }; Returns: undefined
                           },
"admin_save_courier_location_mapping":
{ Args: { "p_area": string,"p_destination": Json,"p_district": string,"p_label": string,"p_provider": string }; Returns: undefined
                           },
"admin_save_courier_operations":
{ Args: { "p_booking_enabled": boolean,"p_confirmation": string,"p_http_timeout_ms": number,"p_mode": string,"p_tracking_sync_enabled": boolean,"p_tracking_sync_interval_seconds": number }; Returns: undefined
                           },
"admin_save_courier_provider":
{ Args: { "p_cod_fee_bp": number,"p_is_enabled": boolean,"p_provider": string,"p_return_charge_minor": number,"p_settings": Json }; Returns: undefined
                           },
"admin_save_courier_rate_card":
{ Args: { "p_charge_minor": number,"p_id": string,"p_is_active": boolean,"p_provider": string,"p_weight_up_to_grams": number,"p_zone": Database["public"]['Enums']["delivery_zone"] }; Returns: string
                           },
"admin_save_courier_settings":
{ Args: { "p_default_parcel_weight_grams": number,"p_min_history_sample": number,"p_preferred_provider": string,"p_quote_validity_minutes": number }; Returns: undefined
                           },
"admin_save_homepage":
{ Args: { "p_sections": Json }; Returns: Json
                           },
"admin_save_insight_thresholds":
{ Args: { "p_high_spend_threshold_minor": number,"p_inactive_days": number,"p_repeat_order_threshold": number }; Returns: Json
                           },
"admin_save_menu_item":
{ Args: { "p_href": string,"p_id": string,"p_is_active": boolean,"p_label": string,"p_menu": string }; Returns: Json
                           },
"admin_save_onboarding_campaign":
{ Args: { "p_campaign_id": string,"p_payload": Json }; Returns: string
                           },
"admin_save_onboarding_slide":
{ Args: { "p_campaign_id": string,"p_payload": Json,"p_slide_id": string }; Returns: Json
                           },
"admin_save_popup":
{ Args: { "p_payload": Json,"p_popup_id": string }; Returns: string
                           },
"admin_save_product_seo":
{ Args: { "p_canonical_path"?: string,"p_no_index"?: boolean,"p_og_description"?: string,"p_og_image_key"?: string,"p_og_title"?: string,"p_product_id": string,"p_seo_description"?: string,"p_seo_title"?: string }; Returns: undefined
                           },
"admin_save_shopping_zone":
{ Args: { "p_audience"?: string,"p_banner_alt"?: string,"p_description"?: string,"p_display_order"?: number,"p_is_active"?: boolean,"p_name": string,"p_seo_description"?: string,"p_seo_title"?: string,"p_slug": string,"p_zone_id": string }; Returns: string
                           },
"admin_save_site_page":
{ Args: { "p_body": string,"p_is_published": boolean,"p_seo_description"?: string,"p_seo_title"?: string,"p_slug": string,"p_title": string }; Returns: Json
                           },
"admin_save_store_profile":
{ Args: { "p_address_area"?: string,"p_address_district"?: string,"p_address_line"?: string,"p_business_hours"?: string,"p_contact_email"?: string,"p_contact_phone"?: string,"p_default_seo_description"?: string,"p_default_seo_title"?: string,"p_description"?: string,"p_display_name": string,"p_extras": Json,"p_logo_key"?: string,"p_og_image_key"?: string,"p_social_facebook"?: string,"p_social_instagram"?: string,"p_social_youtube"?: string,"p_support_email"?: string,"p_support_phone"?: string,"p_tagline"?: string }; Returns: undefined
                           } |
{ Args: { "p_address_area"?: string,"p_address_district"?: string,"p_address_line"?: string,"p_business_hours"?: string,"p_contact_email"?: string,"p_contact_phone"?: string,"p_default_seo_description"?: string,"p_default_seo_title"?: string,"p_description"?: string,"p_display_name": string,"p_logo_key"?: string,"p_og_image_key"?: string,"p_social_facebook"?: string,"p_social_instagram"?: string,"p_social_youtube"?: string,"p_support_email"?: string,"p_support_phone"?: string,"p_tagline"?: string }; Returns: undefined
                           },
"admin_save_store_settings":
{ Args: { "p_cart_inactivity_minutes": number,"p_return_window_days": number }; Returns: Json
                           } |
{ Args: { "p_cart_inactivity_minutes": number,"p_cod_enabled"?: boolean,"p_high_spend_threshold_minor": number,"p_inactive_days": number,"p_repeat_order_threshold": number,"p_return_window_days": number }; Returns: Json
                           },
"admin_save_variant":
{ Args: { "p_attribute_value_ids": (string)[],"p_compare_at_price_minor": number,"p_image_url": string,"p_is_active": boolean,"p_position": number,"p_price_minor": number,"p_product_id": string,"p_sku": string,"p_variant_id": string }; Returns: string
                           },
"admin_seo_overview":
{ Args: { "p_query"?: string }; Returns: {
              "canonical_path": string,"id": string,"is_public": boolean,"kind": string,"missing_description": boolean,"missing_title": boolean,"name": string,"no_index": boolean,"og_description": string,"og_image_key": string,"og_title": string,"seo_description": string,"seo_title": string,"slug": string,"updated_at": string
            }[]
                           },
"admin_set_account_status":
{ Args: { "p_reason"?: string,"p_status": Database["public"]['Enums']["profile_status"],"p_target": string }; Returns: Database["public"]['Enums']["profile_status"]
                           },
"admin_set_banner_image":
{ Args: { "p_banner_id": string,"p_image_key": string }; Returns: string
                           },
"admin_set_banner_mobile_image":
{ Args: { "p_banner_id": string,"p_image_key": string }; Returns: string
                           },
"admin_set_brand_banner":
{ Args: { "p_banner_key": string,"p_brand_id": string }; Returns: string
                           },
"admin_set_brand_logo":
{ Args: { "p_brand_id": string,"p_logo_key": string }; Returns: string
                           },
"admin_set_campaign_status":
{ Args: { "p_campaign_id": string,"p_expected_version"?: number,"p_status": Database["public"]['Enums']["campaign_status"] }; Returns: Json
                           },
"admin_set_category_banner":
{ Args: { "p_banner_key": string,"p_category_id": string }; Returns: string
                           },
"admin_set_category_image":
{ Args: { "p_category_id": string,"p_image_key": string }; Returns: undefined
                           },
"admin_set_category_zones":
{ Args: { "p_category_id": string,"p_zone_ids": (string)[] }; Returns: number
                           },
"admin_set_cod_state":
{ Args: { "p_note": string,"p_shipment_id": string,"p_state": string }; Returns: undefined
                           },
"admin_set_coupon_active":
{ Args: { "p_coupon_id": string,"p_is_active": boolean }; Returns: undefined
                           },
"admin_set_courier_credential":
{ Args: { "p_field": string,"p_provider": string,"p_value": string }; Returns: undefined
                           },
"admin_set_courier_live_verified":
{ Args: { "p_confirmation": string,"p_provider": string,"p_verified": boolean }; Returns: undefined
                           },
"admin_set_delivery_charge":
{ Args: { "p_amount_minor": number,"p_zone": Database["public"]['Enums']["delivery_zone"] }; Returns: undefined
                           },
"admin_set_onboarding_active":
{ Args: { "p_active": boolean,"p_campaign_id": string }; Returns: undefined
                           },
"admin_set_order_archived":
{ Args: { "p_archive": boolean,"p_order_number": string,"p_reason"?: string }; Returns: undefined
                           },
"admin_set_permission":
{ Args: { "p_effect"?: Database["public"]['Enums']["permission_effect"],"p_permission": string,"p_target": string }; Returns: undefined
                           },
"admin_set_popup_active":
{ Args: { "p_active": boolean,"p_popup_id": string }; Returns: undefined
                           },
"admin_set_popup_image":
{ Args: { "p_image_bytes": number,"p_image_format": string,"p_image_height": number,"p_image_key": string,"p_image_kind": string,"p_image_width": number,"p_popup_id": string }; Returns: string
                           },
"admin_set_product_brand":
{ Args: { "p_brand_id": string,"p_product_id": string }; Returns: undefined
                           },
"admin_set_product_review_status":
{ Args: { "p_note"?: string,"p_review_id": string,"p_status": string }; Returns: undefined
                           },
"admin_set_product_status":
{ Args: { "p_product_id": string,"p_status": Database["public"]['Enums']["product_status"] }; Returns: Database["public"]['Enums']["product_status"]
                           },
"admin_set_product_zones":
{ Args: { "p_product_id": string,"p_zone_ids": (string)[] }; Returns: number
                           },
"admin_set_recovery_state":
{ Args: { "p_session_id": string,"p_state": string }; Returns: Json
                           },
"admin_set_sales_target":
{ Args: { "p_target_minor": number }; Returns: Json
                           },
"admin_set_shopping_zone_active":
{ Args: { "p_is_active": boolean,"p_zone_id": string }; Returns: undefined
                           },
"admin_set_shopping_zone_banner":
{ Args: { "p_banner_alt"?: string,"p_banner_key": string,"p_zone_id": string }; Returns: string
                           },
"admin_set_shopping_zone_categories":
{ Args: { "p_category_ids": (string)[],"p_zone_id": string }; Returns: number
                           },
"admin_set_shopping_zone_mobile_banner":
{ Args: { "p_banner_key": string,"p_zone_id": string }; Returns: string
                           },
"admin_set_shopping_zone_products":
{ Args: { "p_product_ids": (string)[],"p_zone_id": string }; Returns: number
                           },
"admin_set_variant_active":
{ Args: { "p_is_active": boolean,"p_variant_id": string }; Returns: boolean
                           },
"admin_set_variant_stock":
{ Args: { "p_note": string,"p_stock": number,"p_variant_id": string }; Returns: number
                           },
"admin_shopping_zone":
{ Args: { "p_zone_id": string }; Returns: Json
                           },
"admin_slug_availability":
{ Args: { "p_exclude_id"?: string,"p_kind": string,"p_slug": string }; Returns: Json
                           },
"admin_store_profile":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_store_settings":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_update_media_alt":
{ Args: { "p_alt": string,"p_id": string }; Returns: Json
                           },
"admin_update_order_status":
{ Args: { "p_note"?: string,"p_order_number": string,"p_status": Database["public"]['Enums']["order_status"] }; Returns: Database["public"]['Enums']["order_status"]
                           },
"admin_update_product":
{ Args: { "p_category_id": string,"p_compare_at_price_minor": number,"p_description": string,"p_is_featured": boolean,"p_max_order_quantity": number,"p_name": string,"p_price_minor": number,"p_product_id": string,"p_slug": string,"p_summary": string }; Returns: undefined
                           } |
{ Args: { "p_category_id": string,"p_compare_at_price_minor": number,"p_description": string,"p_is_featured": boolean,"p_max_order_quantity": number,"p_name": string,"p_price_minor": number,"p_product_id": string,"p_replace_size_chart": boolean,"p_size_chart": Json,"p_slug": string,"p_summary": string,"p_tags": (string)[] }; Returns: undefined
                           },
"admin_update_product_image":
{ Args: { "p_alt_text": string,"p_image_id": string }; Returns: undefined
                           },
"archive_chat_message_template":
{ Args: { "p_id": string }; Returns: undefined
                           },
"assign_chat_conversation":
{ Args: { "p_assignee_id": string,"p_conversation_id": string,"p_note"?: string }; Returns: Json
                           },
"assign_moderation_task":
{ Args: { "p_moderator": string,"p_task_id": string }; Returns: undefined
                           },
"assign_user_role":
{ Args: { "p_actor_id": string,"p_role": Database["public"]['Enums']["app_role"],"p_target_id": string }; Returns: {
              "granted_at": string,
"granted_by": string | null,
"role": Database["public"]['Enums']["app_role"],
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "user_roles"
        isOneToOne: true
        isSetofReturn: false
      } },
"begin_chat_attachment":
{ Args: { "p_byte_size": number,"p_content_type": string,"p_conversation_id": string,"p_duration_ms"?: number,"p_file_name": string,"p_height"?: number,"p_object_key": string,"p_width"?: number }; Returns: Json
                           },
"begin_password_reset":
{ Args: { "p_code_hash": string,"p_email": string,"p_ttl"?: string }; Returns: boolean
                           },
"begin_registration":
{ Args: { "p_code_hash": string,"p_email": string,"p_full_name": string,"p_password_hash": string,"p_phone": string,"p_ttl"?: string }; Returns: string
                           },
"bootstrap_owner":
{ Args: { "p_email": string }; Returns: string
                           },
"campaign_discount_minor":
{ Args: { "p_kind": Database["public"]['Enums']["campaign_discount_kind"],"p_max_discount_minor": number,"p_price_minor": number,"p_value": number }; Returns: number
                           },
"can_read_customer_profile":
{ Args: { "p_id": string }; Returns: boolean
                           },
"cancel_my_order":
{ Args: { "p_order_number": string,"p_reason"?: string }; Returns: Json
                           },
"cancel_my_return":
{ Args: { "p_return_id": string }; Returns: Database["public"]['Enums']["return_status"]
                           },
"cancel_password_reset":
{ Args: { "p_email": string }; Returns: undefined
                           },
"cancel_registration":
{ Args: { "p_email": string }; Returns: undefined
                           },
"cart_clear":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"cart_remove_item":
{ Args: { "p_product_id": string,"p_variant_id"?: string }; Returns: string
                           },
"cart_set_item":
{ Args: { "p_product_id": string,"p_quantity": number,"p_variant_id": string }; Returns: string
                           },
"cart_snapshot":
{ Args: { "p_cart_id": string }; Returns: {
              "id": string,"last_activity_at": string,"lines": Json,"status": Database["public"]['Enums']["cart_status"]
            }[]
                           },
"catalog_brand_products":
{ Args: { "p_brand_slug": string,"p_limit"?: number,"p_offset"?: number,"p_sort"?: string }; Returns: {
              "category_name": string,"category_slug": string,"compare_at_price_minor": number,"id": string,"is_featured": boolean,"max_order_quantity": number,"name": string,"price_minor": number,"published_at": string,"sku": string,"slug": string,"stock_quantity": number,"summary": string,"total_count": number
            }[]
                           },
"catalog_campaigns":
{ Args: { "p_category_id"?: string }; Returns: {
              "banner_image_key": string,"campaign_id": string,"discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"discount_value": number,"ends_at": string,"max_discount_minor": number,"product_count": number,"scope": Database["public"]['Enums']["campaign_scope"],"title": string
            }[]
                           },
"catalog_categories":
{ Args: Record<PropertyKey, never>; Returns: {
              "description": string,"name": string,"product_count": number,"slug": string
            }[]
                           },
"catalog_category_tree":
{ Args: Record<PropertyKey, never>; Returns: {
              "depth": number,"description": string,"image_key": string,"is_featured": boolean,"name": string,"parent_slug": string,"product_count": number,"slug": string,"sort_order": number
            }[]
                           },
"catalog_product":
{ Args: { "p_slug": string }; Returns: {
              "brand_id": string,"campaign_discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"campaign_discount_value": number,"campaign_ends_at": string,"campaign_id": string,"campaign_title": string,"category_name": string,"category_slug": string,"compare_at_price_minor": number,"description": string,"id": string,"is_featured": boolean,"max_order_quantity": number,"name": string,"price_minor": number,"published_at": string,"size_chart": Json,"sku": string,"slug": string,"stock_quantity": number,"summary": string
            }[]
                           },
"catalog_product_colors":
{ Args: { "p_product_ids": (string)[] }; Returns: {
              "position": number,"product_id": string,"swatch_hex": string,"value": string,"value_slug": string
            }[]
                           },
"catalog_product_reviews":
{ Args: { "p_page"?: number,"p_page_size"?: number,"p_product_slug": string }; Returns: Json
                           },
"catalog_product_variants":
{ Args: { "p_slug": string }; Returns: {
              "compare_at_price_minor": number,"image_url": string,"max_order_quantity": number,"options": Json,"position": number,"price_minor": number,"sku": string,"stock_quantity": number,"variant_id": string
            }[]
                           },
"catalog_products":
{ Args: { "p_branch_slugs"?: (string)[],"p_brand_slug"?: string,"p_category_slug"?: string,"p_color_slugs"?: (string)[],"p_in_stock"?: boolean,"p_limit"?: number,"p_max_price_minor"?: number,"p_min_price_minor"?: number,"p_offset"?: number,"p_query"?: string,"p_size_slugs"?: (string)[],"p_sort"?: string,"p_zone_slug"?: string }; Returns: {
              "campaign_discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"campaign_discount_value": number,"campaign_ends_at": string,"campaign_id": string,"campaign_title": string,"category_name": string,"category_slug": string,"compare_at_price_minor": number,"id": string,"is_featured": boolean,"max_order_quantity": number,"name": string,"price_minor": number,"published_at": string,"sku": string,"slug": string,"stock_quantity": number,"summary": string,"total_count": number
            }[]
                           },
"catalog_shopping_zone":
{ Args: { "p_slug": string }; Returns: Json
                           },
"catalog_shopping_zones":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"catalog_sold_counts":
{ Args: { "p_product_ids": (string)[] }; Returns: {
              "product_id": string,"sold": number
            }[]
                           },
"catalog_variant_facets":
{ Args: { "p_branch_slugs"?: (string)[],"p_brand_slug"?: string,"p_category_slug"?: string,"p_color_slugs"?: (string)[],"p_in_stock"?: boolean,"p_max_price_minor"?: number,"p_min_price_minor"?: number,"p_query"?: string,"p_size_slugs"?: (string)[],"p_zone_slug"?: string }; Returns: Json
                           },
"catalog_variant_product_ids":
{ Args: { "p_color_slugs"?: (string)[],"p_size_slugs"?: (string)[] }; Returns: string
                           },
"chat_analytics":
{ Args: { "p_from"?: string,"p_to"?: string }; Returns: Json
                           },
"chat_assistant_facts":
{ Args: { "p_conversation_id": string,"p_customer_id": string,"p_order_number"?: string }; Returns: Json
                           },
"chat_assistant_reply":
{ Args: { "p_body": string,"p_conversation_id": string,"p_customer_id": string,"p_metadata"?: Json }; Returns: Json
                           },
"chat_attachment_media":
{ Args: { "p_attachment_id": string }; Returns: {
              "attachment_id": string,"byte_size": number,"content_type": string,"conversation_id": string,"file_name": string,"message_id": string,"object_key": string
            }[]
                           },
"chat_attachments":
{ Args: { "p_conversation_id": string }; Returns: {
              "byte_size": number,"content_type": string,"created_at": string,"duration_ms": number,"file_name": string,"height": number,"id": string,"message_id": string,"object_key": string,"width": number
            }[]
                           },
"chat_automation_rules":
{ Args: Record<PropertyKey, never>; Returns: {
              "actions": Json,"conditions": Json,"cooldown_seconds": number,"created_at": string,"description": string,"id": string,"is_active": boolean,"last_run_at": string,"name": string,"position": number,"run_count": number,"stop_processing": boolean,"trigger": Database["public"]['Enums']["chat_automation_trigger"],"updated_at": string
            }[]
                           },
"chat_automation_runs":
{ Args: { "p_limit"?: number,"p_offset"?: number }; Returns: {
              "actions_taken": Json,"conversation_id": string,"created_at": string,"error": string,"id": string,"rule_id": string,"rule_name": string,"status": Database["public"]['Enums']["chat_automation_run_status"],"total_count": number,"trigger": Database["public"]['Enums']["chat_automation_trigger"]
            }[]
                           },
"chat_can_access":
{ Args: { "p_conversation_id": string }; Returns: boolean
                           },
"chat_conversation":
{ Args: { "p_conversation_id": string }; Returns: Json
                           },
"chat_internal_notes":
{ Args: { "p_before_seq"?: number,"p_conversation_id": string,"p_limit"?: number }; Returns: {
              "author_id": string,"author_name": string,"body": string,"created_at": string,"id": string,"seq": number
            }[]
                           },
"chat_message_feedback":
{ Args: { "p_conversation_id": string }; Returns: {
              "comment": string,"created_at": string,"customer_name": string,"id": string,"message_id": string,"updated_at": string,"verdict": Database["public"]['Enums']["chat_feedback_verdict"]
            }[]
                           },
"chat_message_reaction_summary":
{ Args: { "p_conversation_id": string }; Returns: {
              "emoji": string,"message_id": string,"mine": boolean,"reaction_count": number
            }[]
                           },
"chat_message_summaries":
{ Args: { "p_conversation_id": string,"p_message_ids": (string)[] }; Returns: {
              "body": string,"created_at": string,"deleted": boolean,"has_attachment": boolean,"id": string,"kind": Database["public"]['Enums']["chat_message_kind"],"sender_id": string,"sender_name": string,"sender_role": Database["public"]['Enums']["chat_participant_role"],"seq": number
            }[]
                           },
"chat_message_templates":
{ Args: { "p_include_archived"?: boolean }; Returns: {
              "body": string,"category": Database["public"]['Enums']["chat_template_category"],"created_at": string,"description": string,"id": string,"is_active": boolean,"locale": Database["public"]['Enums']["chat_template_locale"],"name": string,"updated_at": string,"usage_count": number,"variables": (string)[]
            }[]
                           },
"chat_messages":
{ Args: { "p_before_seq"?: number,"p_conversation_id": string,"p_limit"?: number }; Returns: {
              "body": string,"created_at": string,"edited_at": string,"id": string,"kind": Database["public"]['Enums']["chat_message_kind"],"metadata": Json,"reply_to_id": string,"sender_id": string,"sender_name": string,"sender_role": Database["public"]['Enums']["chat_participant_role"],"seq": number
            }[]
                           },
"chat_my_message_feedback":
{ Args: { "p_conversation_id": string }; Returns: {
              "message_id": string,"verdict": Database["public"]['Enums']["chat_feedback_verdict"]
            }[]
                           },
"chat_pinned_messages":
{ Args: { "p_conversation_id": string }; Returns: {
              "attachment_duration_ms": number,"attachment_id": string,"attachment_name": string,"attachment_type": string,"body": string,"id": string,"pinned_at": string,"pinned_by_name": string,"sender_name": string
            }[]
                           },
"chat_report_queue":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_status"?: Database["public"]['Enums']["chat_report_status"] }; Returns: {
              "action_taken": string,"conversation_id": string,"conversation_kind": Database["public"]['Enums']["chat_conversation_type"],"conversation_subject": string,"created_at": string,"details": string,"id": string,"message_body": string,"message_created_at": string,"message_id": string,"message_sender_name": string,"reason": Database["public"]['Enums']["chat_report_reason"],"reporter_id": string,"reporter_name": string,"resolved_at": string,"status": Database["public"]['Enums']["chat_report_status"],"total_count": number
            }[]
                           },
"chat_support_queue":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_priority"?: Database["public"]['Enums']["chat_priority"],"p_scope"?: string,"p_search"?: string,"p_sort"?: string,"p_status"?: Database["public"]['Enums']["chat_conversation_status"] }; Returns: {
              "assignee_id": string,"assignee_name": string,"created_at": string,"customer_email": string,"customer_id": string,"customer_name": string,"id": string,"kind": Database["public"]['Enums']["chat_conversation_type"],"last_message_at": string,"last_message_preview": string,"last_message_sender_id": string,"latest_seq": number,"message_count": number,"order_id": string,"order_number": string,"priority": Database["public"]['Enums']["chat_priority"],"product_id": string,"product_name": string,"status": Database["public"]['Enums']["chat_conversation_status"],"subject": string,"total_count": number,"unread_count": number,"updated_at": string
            }[]
                           },
"chat_tags":
{ Args: Record<PropertyKey, never>; Returns: {
              "conversation_count": number,"description": string,"id": string,"is_active": boolean,"label": string,"slug": string
            }[]
                           },
"chat_team_members":
{ Args: Record<PropertyKey, never>; Returns: {
              "can_moderate": boolean,"can_support": boolean,"can_use_internal": boolean,"email": string,"full_name": string,"open_count": number,"pending_count": number,"resolved_recent_count": number,"role": string,"user_id": string
            }[]
                           },
"checkout_activity":
{ Args: { "p_session_id": string }; Returns: undefined
                           },
"checkout_converted":
{ Args: { "p_order_number": string }; Returns: undefined
                           },
"checkout_recovery_preview":
{ Args: { "p_token": string }; Returns: Json
                           },
"checkout_recovery_restore":
{ Args: { "p_token": string }; Returns: Json
                           },
"checkout_session":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"checkout_start":
{ Args: { "p_address_id"?: string,"p_coupon_code"?: string }; Returns: string
                           },
"claim_account_email":
{ Args: { "p_id": string }; Returns: {
              "email": string,"full_name": string,"id": string,"kind": string
            }[]
                           },
"claim_announcement_deliveries":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number }; Returns: {
              "attempts": number,"body": string,"id": string,"image_key": string,"kind": string,"product_name": string,"product_slug": string,"title": string,"user_id": string
            }[]
                           },
"claim_customer_emails":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number }; Returns: {
              "attempts": number,"event_status": string,"id": string,"kind": string,"order_id": string,"order_number": string,"refund_id": string,"return_request_id": string,"shipment_id": string,"user_id": string
            }[]
                           },
"claim_notifications":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number }; Returns: {
              "attempts": number,"id": string,"kind": string,"order_number": string,"shipment_status": Database["public"]['Enums']["shipment_status"],"to_status": Database["public"]['Enums']["order_status"],"user_id": string
            }[]
                           },
"clear_login_failures":
{ Args: { "p_user": string }; Returns: undefined
                           },
"clear_my_avatar":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"collect_voucher":
{ Args: { "p_coupon_id": string }; Returns: Json
                           },
"complete_onboarding":
{ Args: { "p_campaign_id": string }; Returns: undefined
                           },
"complete_password_reset":
{ Args: { "p_code_hash": string,"p_email": string,"p_password_hash": string }; Returns: string
                           },
"complete_registration":
{ Args: { "p_code_hash": string,"p_email": string }; Returns: string
                           },
"consume_email_code":
{ Args: { "p_code_hash": string,"p_email": string,"p_purpose": Database["public"]['Enums']["auth_code_purpose"] }; Returns: string
                           },
"consume_invitation":
{ Args: { "p_token_hash": string }; Returns: string
                           },
"create_session":
{ Args: { "p_access_ttl": string,"p_ip"?: string,"p_refresh_hash": string,"p_refresh_ttl": string,"p_secret_hash": string,"p_user": string,"p_user_agent"?: string }; Returns: {
              "expires_at": string,"family_id": string,"refresh_expires_at": string,"session_id": string
            }[]
                           },
"customer_unread_notification_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"decide_chat_report":
{ Args: { "p_action_taken"?: string,"p_note"?: string,"p_report_id": string,"p_status": Database["public"]['Enums']["chat_report_status"] }; Returns: Json
                           },
"decide_moderation_task":
{ Args: { "p_decision": Database["public"]['Enums']["moderation_task_status"],"p_note"?: string,"p_task_id": string }; Returns: Database["public"]['Enums']["moderation_task_status"]
                           },
"delete_chat_automation_rule":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_chat_message":
{ Args: { "p_message_id": string }; Returns: undefined
                           },
"delete_chat_saved_reply":
{ Args: { "p_id": string }; Returns: undefined
                           },
"deliverable_device_tokens":
{ Args: { "p_user_id"?: string }; Returns: {
              "id": string,"platform": Database["public"]['Enums']["device_platform"],"token": string,"user_id": string
            }[]
                           },
"discard_chat_attachment":
{ Args: { "p_id": string }; Returns: undefined
                           },
"edit_my_review":
{ Args: { "p_body": string,"p_rating": number,"p_review_id": string,"p_title"?: string }; Returns: undefined
                           },
"export_claim_job":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_by": string,"filters": Json,"format": string,"id": string,"kind": string
            }[]
                           },
"export_expire_jobs":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"export_fail_job":
{ Args: { "p_error": string,"p_id": string }; Returns: undefined
                           },
"export_finish_job":
{ Args: { "p_content_type": string,"p_file": string,"p_file_name": string,"p_id": string,"p_row_count": number }; Returns: undefined
                           },
"export_job_progress":
{ Args: { "p_id": string,"p_progress": number }; Returns: undefined
                           },
"finish_account_email":
{ Args: { "p_error"?: string,"p_id": string,"p_sent": boolean }; Returns: undefined
                           },
"finish_announcement_delivery":
{ Args: { "p_error"?: string,"p_id": string,"p_outcome": string,"p_retry_seconds"?: number }; Returns: undefined
                           },
"finish_customer_email":
{ Args: { "p_error"?: string,"p_id": string,"p_outcome": string,"p_retry_seconds"?: number }; Returns: undefined
                           },
"finish_notification":
{ Args: { "p_error"?: string,"p_id": string,"p_outcome": string,"p_retry_seconds"?: number }; Returns: string
                           },
"guest_cart_clear":
{ Args: { "p_token": string }; Returns: undefined
                           },
"guest_cart_set_item":
{ Args: { "p_product_id": string,"p_quantity": number,"p_token": string,"p_variant_id": string }; Returns: string
                           },
"guest_cart_snapshot":
{ Args: { "p_token": string }; Returns: {
              "id": string,"last_activity_at": string,"lines": Json,"status": Database["public"]['Enums']["cart_status"]
            }[]
                           },
"has_permission":
{ Args: { "p_permission": string }; Returns: boolean
                           },
"invalidate_device_tokens":
{ Args: { "p_ids": (string)[] }; Returns: number
                           },
"issue_email_code":
{ Args: { "p_code_hash": string,"p_email": string,"p_purpose": Database["public"]['Enums']["auth_code_purpose"],"p_ttl"?: string }; Returns: undefined
                           },
"issue_invitation":
{ Args: { "p_created_by"?: string,"p_token_hash": string,"p_ttl"?: string,"p_user": string }; Returns: undefined
                           },
"login_lookup":
{ Args: { "p_email": string }; Returns: {
              "email_verified_at": string,"failed_login_count": number,"id": string,"locked_until": string,"password_hash": string,"status": Database["public"]['Enums']["profile_status"]
            }[]
                           },
"mark_all_customer_notifications_read":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"mark_all_staff_notifications_read":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"mark_chat_delivered":
{ Args: { "p_conversation_id": string,"p_seq": number }; Returns: undefined
                           },
"mark_chat_read":
{ Args: { "p_conversation_id": string,"p_seq": number }; Returns: number
                           },
"mark_customer_notification_read":
{ Args: { "p_id": string }; Returns: undefined
                           },
"mark_staff_notification_read":
{ Args: { "p_id": string }; Returns: undefined
                           },
"merge_guest_cart":
{ Args: { "p_token": string }; Returns: string
                           },
"my_access":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_avatar_key":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_cart":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_chat_conversations":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_scope"?: string,"p_search"?: string,"p_status"?: Database["public"]['Enums']["chat_conversation_status"] }; Returns: {
              "assignee_id": string,"assignee_name": string,"created_at": string,"customer_email": string,"customer_id": string,"customer_name": string,"id": string,"kind": Database["public"]['Enums']["chat_conversation_type"],"last_message_at": string,"last_message_preview": string,"last_message_sender_id": string,"latest_seq": number,"message_count": number,"order_id": string,"order_number": string,"priority": Database["public"]['Enums']["chat_priority"],"product_id": string,"product_name": string,"status": Database["public"]['Enums']["chat_conversation_status"],"subject": string,"total_count": number,"unread_count": number,"updated_at": string
            }[]
                           },
"my_chat_saved_replies":
{ Args: Record<PropertyKey, never>; Returns: {
              "body": string,"created_at": string,"id": string,"is_active": boolean,"shortcut": string,"title": string,"updated_at": string,"usage_count": number,"visibility": Database["public"]['Enums']["chat_saved_reply_visibility"]
            }[]
                           },
"my_customer_notifications":
{ Args: { "p_kind"?: string,"p_limit"?: number,"p_offset"?: number }; Returns: {
              "action_path": string,"body": string,"created_at": string,"entity_id": string,"entity_type": string,"id": string,"kind": Database["public"]['Enums']["customer_notification_kind"],"read_at": string,"title": string,"total_count": number
            }[]
                           },
"my_internal_channels":
{ Args: { "p_limit"?: number,"p_offset"?: number }; Returns: {
              "department": string,"employee_count": number,"id": string,"kind": Database["public"]['Enums']["chat_conversation_type"],"last_message_at": string,"last_message_preview": string,"status": Database["public"]['Enums']["chat_conversation_status"],"subject": string,"total_count": number,"unread_count": number
            }[]
                           },
"my_notification_preferences":
{ Args: Record<PropertyKey, never>; Returns: {
              "in_app": boolean,"order_updates": boolean,"payment_updates": boolean,"promotions": boolean,"refund_updates": boolean,"return_updates": boolean,"updated_at": string
            }[]
                           },
"my_order_refunds":
{ Args: { "p_order_number": string }; Returns: {
              "amount_minor": number,"completed_at": string,"id": string,"method": Database["public"]['Enums']["refund_method"],"reason": string,"reference": string,"requested_at": string,"status": Database["public"]['Enums']["refund_status"]
            }[]
                           },
"my_order_shipments":
{ Args: { "p_order_number": string }; Returns: Json
                           },
"my_product_review":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"my_return":
{ Args: { "p_return_id": string }; Returns: Json
                           },
"my_returns":
{ Args: Record<PropertyKey, never>; Returns: {
              "decided_at": string,"decision_note": string,"id": string,"item_count": number,"order_number": string,"reason": string,"refundable_minor": number,"requested_at": string,"status": Database["public"]['Enums']["return_status"]
            }[]
                           },
"my_staff_notifications":
{ Args: { "p_limit"?: number,"p_offset"?: number }; Returns: {
              "action_path": string,"body": string,"created_at": string,"entity_id": string,"entity_type": string,"id": string,"kind": Database["public"]['Enums']["staff_notification_kind"],"read_at": string,"title": string,"total_count": number
            }[]
                           },
"my_unread_chat_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_unread_notification_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_vouchers":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_wishlist":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"notification_allowed":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"pin_chat_message":
{ Args: { "p_message_id": string }; Returns: undefined
                           },
"place_cod_order":
{ Args: { "p_address_id": string,"p_coupon_code"?: string,"p_expected_total_minor"?: number,"p_idempotency_key": string,"p_items": Json,"p_note"?: string }; Returns: Json
                           },
"post_chat_message":
{ Args: { "p_attachment_ids"?: (string)[],"p_body": string,"p_client_message_id": string,"p_conversation_id": string,"p_reply_to_id"?: string }; Returns: Json
                           },
"preview_chat_automation_rule":
{ Args: { "p_conversation_id": string,"p_rule_id": string }; Returns: Json
                           },
"product_campaigns":
{ Args: { "p_product_ids": (string)[] }; Returns: {
              "campaign_id": string,"campaign_scope": Database["public"]['Enums']["campaign_scope"],"campaign_title": string,"coupon_policy": Database["public"]['Enums']["campaign_coupon_policy"],"discount_kind": Database["public"]['Enums']["campaign_discount_kind"],"discount_value": number,"ends_at": string,"is_visible": boolean,"max_discount_minor": number,"priority": number,"product_id": string
            }[]
                           },
"product_count":
{ Args: { "p_brand": Omit<Database["public"]['Tables']["brands"]['Row'], Database["public"]['Tables']["brands"]['ComputedFields']> }; Returns: number
                           } |
{ Args: { "p_category": Omit<Database["public"]['Tables']["categories"]['Row'], Database["public"]['Tables']["categories"]['ComputedFields']> }; Returns: number
                           },
"product_in_zone":
{ Args: { "p_category_id": string,"p_product_id": string,"p_zone_slug": string }; Returns: boolean
                           },
"provision_account":
{ Args: { "p_email": string,"p_email_verified"?: boolean,"p_full_name"?: string,"p_id": string,"p_password_hash"?: string,"p_phone"?: string }; Returns: string
                           },
"public_category_seo":
{ Args: { "p_slug": string }; Returns: Json
                           },
"public_homepage":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"public_navigation":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"public_onboarding":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"public_popup":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"public_product_seo":
{ Args: { "p_slug": string }; Returns: Json
                           },
"public_site_page":
{ Args: { "p_slug": string }; Returns: Json
                           },
"public_sitemap_entries":
{ Args: Record<PropertyKey, never>; Returns: {
              "kind": string,"last_modified": string,"slug": string
            }[]
                           },
"public_store_profile":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"queue_welcome_email":
{ Args: { "p_user": string }; Returns: undefined
                           },
"quote_cart":
{ Args: { "p_address_id"?: string,"p_items": Json }; Returns: Json
                           },
"quote_cart_with_coupon":
{ Args: { "p_address_id": string,"p_coupon_code": string,"p_items": Json }; Returns: Json
                           },
"record_login_failure":
{ Args: { "p_lock_after"?: number,"p_user": string }; Returns: undefined
                           },
"register_device_token":
{ Args: { "p_app_version"?: string,"p_platform": Database["public"]['Enums']["device_platform"],"p_token": string }; Returns: string
                           },
"reissue_verification_code":
{ Args: { "p_code_hash": string,"p_email": string,"p_ttl"?: string }; Returns: boolean
                           },
"remove_review_image":
{ Args: { "p_image_id": string }; Returns: Json
                           },
"render_chat_template":
{ Args: { "p_conversation_id": string,"p_template_id": string }; Returns: Json
                           },
"report_chat_message":
{ Args: { "p_details"?: string,"p_message_id": string,"p_reason": Database["public"]['Enums']["chat_report_reason"] }; Returns: Json
                           },
"request_return":
{ Args: { "p_description"?: string,"p_items": Json,"p_order_number": string,"p_reason": string }; Returns: string
                           },
"resolve_session":
{ Args: { "p_secret_hash": string }; Returns: {
              "expires_at": string,"session_id": string,"user_id": string
            }[]
                           },
"review_vote_summaries":
{ Args: { "p_review_ids": (string)[] }; Returns: {
              "helpful_count": number,"not_helpful_count": number,"review_id": string,"viewer_vote": string
            }[]
                           },
"revoke_all_sessions":
{ Args: { "p_user": string }; Returns: undefined
                           },
"revoke_session":
{ Args: { "p_secret_hash": string }; Returns: undefined
                           },
"rotate_session":
{ Args: { "p_access_ttl": string,"p_ip"?: string,"p_new_refresh_hash": string,"p_refresh_hash": string,"p_refresh_ttl": string,"p_secret_hash": string,"p_user_agent"?: string }; Returns: {
              "expires_at": string,"refresh_expires_at": string,"session_id": string,"user_id": string
            }[]
                           },
"run_due_chat_automation_jobs":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"save_chat_automation_rule":
{ Args: { "p_actions": Json,"p_conditions": Json,"p_cooldown_seconds"?: number,"p_description"?: string,"p_id": string,"p_is_active"?: boolean,"p_name": string,"p_position"?: number,"p_stop_processing"?: boolean,"p_trigger": Database["public"]['Enums']["chat_automation_trigger"] }; Returns: Json
                           },
"save_chat_message_template":
{ Args: { "p_body": string,"p_category": Database["public"]['Enums']["chat_template_category"],"p_description"?: string,"p_id": string,"p_is_active"?: boolean,"p_locale": Database["public"]['Enums']["chat_template_locale"],"p_name": string }; Returns: Json
                           },
"save_chat_saved_reply":
{ Args: { "p_body": string,"p_id": string,"p_is_active"?: boolean,"p_shortcut"?: string,"p_title": string,"p_visibility": Database["public"]['Enums']["chat_saved_reply_visibility"] }; Returns: Json
                           },
"save_chat_tag":
{ Args: { "p_description"?: string,"p_id": string,"p_is_active"?: boolean,"p_label": string,"p_slug": string }; Returns: Json
                           },
"save_my_notification_preferences":
{ Args: { "p_preferences": Json }; Returns: {
              "in_app": boolean,"order_updates": boolean,"payment_updates": boolean,"promotions": boolean,"refund_updates": boolean,"return_updates": boolean,"updated_at": string
            }[]
                           },
"search_chat_messages":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "body": string,"conversation_id": string,"conversation_subject": string,"created_at": string,"message_id": string,"sender_name": string
            }[]
                           },
"send_chat_message":
{ Args: { "p_body": string,"p_client_message_id": string,"p_conversation_id": string,"p_reply_to_id"?: string }; Returns: {
              "body": string,"created_at": string,"duplicate": boolean,"id": string,"kind": Database["public"]['Enums']["chat_message_kind"],"metadata": Json,"reply_to_id": string,"sender_id": string,"sender_name": string,"sender_role": Database["public"]['Enums']["chat_participant_role"],"seq": number,"unread_count": number
            }[]
                           },
"service_claim_courier_webhook_retries":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,"consignment_id": string,"event_type": string,"id": string,"merchant_ref": string,"payload": Json,"provider": string
            }[]
                           },
"service_claim_shipment_sync":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number }; Returns: {
              "consignment_id": string,"id": string,"is_mock": boolean,"merchant_ref": string,"provider": string,"status": Database["public"]['Enums']["shipment_status"],"sync_attempts": number,"tracking_code": string
            }[]
                           },
"service_courier_credentials":
{ Args: { "p_provider": string }; Returns: Json
                           },
"service_courier_runtime":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"service_find_shipment":
{ Args: { "p_consignment_id": string,"p_merchant_ref": string,"p_provider": string }; Returns: string
                           },
"service_finish_courier_webhook":
{ Args: { "p_error": string,"p_id": string,"p_shipment_id": string,"p_status": string }; Returns: undefined
                           },
"service_finish_shipment_sync":
{ Args: { "p_error": string,"p_next_in_seconds": number,"p_ok": boolean,"p_shipment_id": string }; Returns: undefined
                           },
"service_record_shipment_event":
{ Args: { "p_dedupe_key": string,"p_occurred_at": string,"p_provider_status": string,"p_shipment_id": string,"p_source": string,"p_status": Database["public"]['Enums']["shipment_status"] }; Returns: Json
                           },
"service_shipment_booking_payload":
{ Args: { "p_shipment_id": string }; Returns: Json
                           },
"service_store_courier_webhook":
{ Args: { "p_consignment_id": string,"p_dedupe_key": string,"p_event_type": string,"p_merchant_ref": string,"p_payload": Json,"p_provider": string,"p_signature_ok": boolean }; Returns: Json
                           },
"set_chat_automation_rule_active":
{ Args: { "p_id": string,"p_is_active": boolean }; Returns: undefined
                           },
"set_chat_conversation_priority":
{ Args: { "p_conversation_id": string,"p_priority": Database["public"]['Enums']["chat_priority"] }; Returns: Json
                           },
"set_chat_conversation_status":
{ Args: { "p_conversation_id": string,"p_status": Database["public"]['Enums']["chat_conversation_status"] }; Returns: Json
                           },
"set_chat_conversation_tags":
{ Args: { "p_conversation_id": string,"p_tag_ids": (string)[] }; Returns: Json
                           },
"set_device_announcements":
{ Args: { "p_enabled": boolean,"p_token": string }; Returns: boolean
                           },
"set_my_avatar":
{ Args: { "p_key": string }; Returns: string
                           },
"set_password":
{ Args: { "p_hash": string,"p_user": string }; Returns: undefined
                           },
"start_chat_conversation":
{ Args: { "p_body"?: string,"p_kind": Database["public"]['Enums']["chat_conversation_type"],"p_order_number"?: string,"p_participants"?: (string)[],"p_product_id"?: string,"p_subject"?: string }; Returns: Json
                           },
"start_guest_cart":
{ Args: { "p_token": string }; Returns: string
                           },
"start_internal_chat":
{ Args: { "p_body": string,"p_department"?: string,"p_kind": Database["public"]['Enums']["chat_conversation_type"],"p_participants": (string)[],"p_subject": string }; Returns: Json
                           },
"submit_chat_csat":
{ Args: { "p_comment"?: string,"p_conversation_id": string,"p_rating": number }; Returns: Json
                           },
"submit_chat_message_feedback":
{ Args: { "p_comment"?: string,"p_message_id": string,"p_verdict": Database["public"]['Enums']["chat_feedback_verdict"] }; Returns: Json
                           },
"submit_product_for_review":
{ Args: { "p_product_id": string }; Returns: string
                           },
"submit_product_review":
{ Args: { "p_body": string,"p_product_id": string,"p_rating": number,"p_title"?: string }; Returns: string
                           },
"toggle_chat_message_reaction":
{ Args: { "p_emoji": string,"p_message_id": string }; Returns: Json
                           },
"unpin_chat_message":
{ Args: { "p_message_id": string }; Returns: undefined
                           },
"unregister_device_token":
{ Args: { "p_token": string }; Returns: boolean
                           },
"vote_product_review":
{ Args: { "p_helpful"?: boolean,"p_review_id": string }; Returns: Json
                           },
"voucher_center":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"wishlist_add":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"wishlist_merge":
{ Args: { "p_slugs": (string)[] }; Returns: Json
                           },
"wishlist_remove":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"withdraw_moderation_task":
{ Args: { "p_task_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "app_role": "super_admin"|"admin"|"staff"|"moderator"|"customer","auth_code_purpose": "verify_email"|"reset_password","banner_placement": "home_hero"|"home_secondary"|"category","campaign_coupon_policy": "stackable"|"blocked","campaign_discount_kind": "percent"|"fixed","campaign_scope": "products"|"categories"|"brands"|"storewide","campaign_status": "draft"|"scheduled"|"active"|"paused"|"ended"|"archived","cart_status": "active"|"checkout"|"converted"|"expired","chat_attachment_status": "pending"|"attached"|"discarded","chat_automation_job_status": "pending"|"running"|"done"|"failed","chat_automation_run_status": "applied"|"skipped"|"failed","chat_automation_trigger": "conversation_created"|"message_received"|"conversation_resolved"|"conversation_reopened"|"priority_changed"|"assignee_changed"|"order_status_changed"|"return_status_changed"|"refund_status_changed"|"csat_received","chat_conversation_status": "open"|"pending"|"resolved"|"closed","chat_conversation_type": "customer_support"|"order_support"|"internal_direct"|"internal_group"|"moderation","chat_feedback_verdict": "helpful"|"not_helpful","chat_message_kind": "text"|"system"|"order_event"|"automated","chat_participant_role": "customer"|"staff"|"moderator"|"system","chat_priority": "low"|"normal"|"high"|"urgent","chat_report_reason": "spam"|"abuse"|"personal_information"|"other","chat_report_status": "open"|"reviewing"|"dismissed"|"actioned","chat_saved_reply_visibility": "personal"|"shared","chat_template_category": "greeting"|"order_update"|"shipping"|"returns"|"payment"|"closing"|"internal"|"other","chat_template_locale": "en"|"bn","checkout_recovery_state": "open"|"contacted"|"dismissed","checkout_status": "started"|"incomplete"|"converted"|"expired","customer_notification_kind": "order_update"|"payment_update"|"return_update"|"refund_update"|"shipment_update","delivery_zone": "inside_dhaka"|"outside_dhaka","device_platform": "android"|"ios","inventory_reason": "initial_stock"|"order_placed"|"order_cancelled"|"adjustment"|"stock_set","moderation_event_kind": "submitted"|"assigned"|"approved"|"rejected"|"changes_requested"|"withdrawn","moderation_status": "not_submitted"|"pending"|"approved"|"changes_requested"|"rejected","moderation_task_status": "pending"|"approved"|"rejected"|"changes_requested"|"withdrawn","notification_status": "pending"|"sending"|"sent"|"failed"|"skipped","order_actor": "customer"|"staff"|"system","order_status": "pending"|"confirmed"|"processing"|"shipped"|"delivered"|"cancelled","payment_method": "cod","payment_status": "pending"|"collected"|"cancelled","permission_effect": "grant"|"deny","product_status": "draft"|"active"|"archived","profile_status": "active"|"suspended","refund_method": "cod_manual"|"bank_transfer","refund_status": "requested"|"approved"|"completed"|"rejected"|"cancelled","return_status": "requested"|"approved"|"rejected"|"received"|"completed"|"cancelled","shipment_status": "draft"|"quoted"|"booking_pending"|"booking_failed"|"booked"|"pickup_pending"|"picked_up"|"in_transit"|"on_hold"|"out_for_delivery"|"delivered"|"partially_delivered"|"delivery_failed"|"cancelled"|"return_initiated"|"returned"|"unknown","staff_notification_kind": "order_new"|"stock_low"|"return_new"|"refund_action"|"moderation_pending"|"chat_message"|"chat_escalation"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["super_admin", "admin", "staff", "moderator", "customer"],"auth_code_purpose": ["verify_email", "reset_password"],"banner_placement": ["home_hero", "home_secondary", "category"],"campaign_coupon_policy": ["stackable", "blocked"],"campaign_discount_kind": ["percent", "fixed"],"campaign_scope": ["products", "categories", "brands", "storewide"],"campaign_status": ["draft", "scheduled", "active", "paused", "ended", "archived"],"cart_status": ["active", "checkout", "converted", "expired"],"chat_attachment_status": ["pending", "attached", "discarded"],"chat_automation_job_status": ["pending", "running", "done", "failed"],"chat_automation_run_status": ["applied", "skipped", "failed"],"chat_automation_trigger": ["conversation_created", "message_received", "conversation_resolved", "conversation_reopened", "priority_changed", "assignee_changed", "order_status_changed", "return_status_changed", "refund_status_changed", "csat_received"],"chat_conversation_status": ["open", "pending", "resolved", "closed"],"chat_conversation_type": ["customer_support", "order_support", "internal_direct", "internal_group", "moderation"],"chat_feedback_verdict": ["helpful", "not_helpful"],"chat_message_kind": ["text", "system", "order_event", "automated"],"chat_participant_role": ["customer", "staff", "moderator", "system"],"chat_priority": ["low", "normal", "high", "urgent"],"chat_report_reason": ["spam", "abuse", "personal_information", "other"],"chat_report_status": ["open", "reviewing", "dismissed", "actioned"],"chat_saved_reply_visibility": ["personal", "shared"],"chat_template_category": ["greeting", "order_update", "shipping", "returns", "payment", "closing", "internal", "other"],"chat_template_locale": ["en", "bn"],"checkout_recovery_state": ["open", "contacted", "dismissed"],"checkout_status": ["started", "incomplete", "converted", "expired"],"customer_notification_kind": ["order_update", "payment_update", "return_update", "refund_update", "shipment_update"],"delivery_zone": ["inside_dhaka", "outside_dhaka"],"device_platform": ["android", "ios"],"inventory_reason": ["initial_stock", "order_placed", "order_cancelled", "adjustment", "stock_set"],"moderation_event_kind": ["submitted", "assigned", "approved", "rejected", "changes_requested", "withdrawn"],"moderation_status": ["not_submitted", "pending", "approved", "changes_requested", "rejected"],"moderation_task_status": ["pending", "approved", "rejected", "changes_requested", "withdrawn"],"notification_status": ["pending", "sending", "sent", "failed", "skipped"],"order_actor": ["customer", "staff", "system"],"order_status": ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"],"payment_method": ["cod"],"payment_status": ["pending", "collected", "cancelled"],"permission_effect": ["grant", "deny"],"product_status": ["draft", "active", "archived"],"profile_status": ["active", "suspended"],"refund_method": ["cod_manual", "bank_transfer"],"refund_status": ["requested", "approved", "completed", "rejected", "cancelled"],"return_status": ["requested", "approved", "rejected", "received", "completed", "cancelled"],"shipment_status": ["draft", "quoted", "booking_pending", "booking_failed", "booked", "pickup_pending", "picked_up", "in_transit", "on_hold", "out_for_delivery", "delivered", "partially_delivered", "delivery_failed", "cancelled", "return_initiated", "returned", "unknown"],"staff_notification_kind": ["order_new", "stock_low", "return_new", "refund_action", "moderation_pending", "chat_message", "chat_escalation"]
          }
        }
} as const
