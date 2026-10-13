CREATE TABLE "actor" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text DEFAULT '' NOT NULL,
	"subtype" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"temporary" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"ruleset_version_id" uuid,
	"member_count" integer
);
--> statement-breakpoint
CREATE TABLE "actor_choice" (
	"actor_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"option_key" text NOT NULL,
	CONSTRAINT "actor_choice_actor_id_step_id_ordinal_pk" PRIMARY KEY("actor_id","step_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "actor_condition" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"stacks" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"expires_on" text DEFAULT 'manual' NOT NULL,
	"expires_after" integer
);
--> statement-breakpoint
CREATE TABLE "actor_field" (
	"actor_id" uuid NOT NULL,
	"field_id" text NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"int_value" integer,
	"text_value" text,
	"ref_key" text,
	CONSTRAINT "actor_field_actor_id_field_id_ordinal_pk" PRIMARY KEY("actor_id","field_id","ordinal"),
	CONSTRAINT "actor_field_one_value" CHECK (num_nonnulls("actor_field"."int_value", "actor_field"."text_value", "actor_field"."ref_key") = 1)
);
--> statement-breakpoint
CREATE TABLE "actor_link" (
	"actor_id" uuid NOT NULL,
	"related_actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "actor_link_actor_id_related_actor_id_kind_pk" PRIMARY KEY("actor_id","related_actor_id","kind")
);
--> statement-breakpoint
CREATE TABLE "actor_resource" (
	"actor_id" uuid NOT NULL,
	"resource_id" text NOT NULL,
	"value" integer NOT NULL,
	"max_override" integer,
	CONSTRAINT "actor_resource_actor_id_resource_id_pk" PRIMARY KEY("actor_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "admin_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"campaign_id" uuid,
	"campaign_name" text,
	"target_user_id" text,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"role" text NOT NULL,
	"actor_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"locked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code_hash" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"actor_id" uuid,
	"allow_guests" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codeHash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_campaignId_userId_unique" UNIQUE("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "membership_character" (
	"membership_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	CONSTRAINT "membership_character_membership_id_actor_id_pk" PRIMARY KEY("membership_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "ownership_transfer" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"to_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"ruleset_version_id" uuid,
	"next_session_at" timestamp with time zone,
	"next_session_place" text DEFAULT '' NOT NULL,
	"state_version" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"recap" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"type" text NOT NULL,
	"action_id" uuid,
	"seat_user_id" text,
	"undone_by" uuid,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"gm_notes" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'gm' NOT NULL,
	"audience_mode" text DEFAULT 'all' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codex_reveal" (
	"entry_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	CONSTRAINT "codex_reveal_entry_id_actor_id_pk" PRIMARY KEY("entry_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_pack" (
	"campaign_id" uuid NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_pack_campaign_id_pack_version_id_pk" PRIMARY KEY("campaign_id","pack_version_id")
);
--> statement-breakpoint
CREATE TABLE "pack" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"license" text NOT NULL,
	"attribution" text,
	"hidden_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_ownerUserId_slug_unique" UNIQUE("owner_user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "pack_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"level" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"visibility" text NOT NULL,
	"cite" text,
	"content_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "pack_entry_packVersionId_key_unique" UNIQUE("pack_version_id","key")
);
--> statement-breakpoint
CREATE TABLE "pack_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pack_id" uuid NOT NULL,
	"version" text NOT NULL,
	"hash" text NOT NULL,
	"ruleset_version_id" uuid NOT NULL,
	"ruleset_range" text NOT NULL,
	"sources" jsonb NOT NULL,
	"entry_count" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_pool" (
	"campaign_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"resource_id" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "resource_pool_campaign_id_scope_resource_id_pk" PRIMARY KEY("campaign_id","scope","resource_id")
);
--> statement-breakpoint
CREATE TABLE "ruleset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ruleset_ownerUserId_slug_unique" UNIQUE("owner_user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "ruleset_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ruleset_id" uuid NOT NULL,
	"version" text NOT NULL,
	"hash" text NOT NULL,
	"extends_version_id" uuid,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ruleset_version_rulesetId_version_unique" UNIQUE("ruleset_id","version")
);
--> statement-breakpoint
CREATE TABLE "test_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"test_id" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"hide_target" boolean NOT NULL,
	"show_outcome" boolean NOT NULL,
	"revealed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_call_target" (
	"call_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"modifier" integer NOT NULL,
	"target" integer NOT NULL,
	CONSTRAINT "test_call_target_call_id_actor_id_pk" PRIMARY KEY("call_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "test_report" (
	"call_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"advantage" text NOT NULL,
	"faces" integer[],
	"natural" integer,
	"total" integer NOT NULL,
	"outcome" text NOT NULL,
	"reported_by_user_id" text,
	"reported_by_role" text NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_report_call_id_actor_id_pk" PRIMARY KEY("call_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_ruleset_version_id_ruleset_version_id_fk" FOREIGN KEY ("ruleset_version_id") REFERENCES "public"."ruleset_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_choice" ADD CONSTRAINT "actor_choice_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_condition" ADD CONSTRAINT "actor_condition_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_field" ADD CONSTRAINT "actor_field_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_link" ADD CONSTRAINT "actor_link_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_link" ADD CONSTRAINT "actor_link_related_actor_id_actor_id_fk" FOREIGN KEY ("related_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_resource" ADD CONSTRAINT "actor_resource_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_character" ADD CONSTRAINT "membership_character_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_character" ADD CONSTRAINT "membership_character_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfer" ADD CONSTRAINT "ownership_transfer_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfer" ADD CONSTRAINT "ownership_transfer_to_user_id_app_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_ruleset_version_id_ruleset_version_id_fk" FOREIGN KEY ("ruleset_version_id") REFERENCES "public"."ruleset_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_undone_by_session_event_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."session_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_entry" ADD CONSTRAINT "codex_entry_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_reveal" ADD CONSTRAINT "codex_reveal_entry_id_codex_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."codex_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_reveal" ADD CONSTRAINT "codex_reveal_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_pack" ADD CONSTRAINT "campaign_pack_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_pack" ADD CONSTRAINT "campaign_pack_pack_version_id_pack_version_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack" ADD CONSTRAINT "pack_ruleset_id_ruleset_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."ruleset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_entry" ADD CONSTRAINT "pack_entry_pack_version_id_pack_version_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_version" ADD CONSTRAINT "pack_version_pack_id_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_version" ADD CONSTRAINT "pack_version_ruleset_version_id_ruleset_version_id_fk" FOREIGN KEY ("ruleset_version_id") REFERENCES "public"."ruleset_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_pool" ADD CONSTRAINT "resource_pool_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_version" ADD CONSTRAINT "ruleset_version_ruleset_id_ruleset_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."ruleset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_version" ADD CONSTRAINT "ruleset_version_extends_version_id_ruleset_version_id_fk" FOREIGN KEY ("extends_version_id") REFERENCES "public"."ruleset_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_call" ADD CONSTRAINT "test_call_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_call" ADD CONSTRAINT "test_call_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_call_target" ADD CONSTRAINT "test_call_target_call_id_test_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."test_call"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_call_target" ADD CONSTRAINT "test_call_target_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_report" ADD CONSTRAINT "test_report_call_id_actor_id_test_call_target_call_id_actor_id_fk" FOREIGN KEY ("call_id","actor_id") REFERENCES "public"."test_call_target"("call_id","actor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actor_campaign_id_kind_index" ON "actor" USING btree ("campaign_id","kind");--> statement-breakpoint
CREATE INDEX "admin_event_created_at_index" ON "admin_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_event_campaign_id_created_at_index" ON "session_event" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "session_event_campaign_id_undone_by_created_at_index" ON "session_event" USING btree ("campaign_id","undone_by","created_at");--> statement-breakpoint
CREATE INDEX "session_event_action_id_index" ON "session_event" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "codex_entry_campaign_id_kind_index" ON "codex_entry" USING btree ("campaign_id","kind");--> statement-breakpoint
CREATE INDEX "pack_entry_pack_version_id_type_index" ON "pack_entry" USING btree ("pack_version_id","type");--> statement-breakpoint
CREATE INDEX "pack_entry_name_trgm" ON "pack_entry" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pack_version_pack_id_created_at_index" ON "pack_version" USING btree ("pack_id","created_at");--> statement-breakpoint
CREATE INDEX "test_call_campaign_id_status_created_at_index" ON "test_call" USING btree ("campaign_id","status","created_at");