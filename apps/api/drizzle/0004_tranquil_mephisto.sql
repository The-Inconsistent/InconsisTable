CREATE TABLE "session_result" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"encounter_id" uuid NOT NULL,
	"actor_id" uuid,
	"name" text NOT NULL,
	"score" integer NOT NULL,
	"tiebreaks" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"place" integer,
	"outcome" text,
	"ended_early" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_result" ADD CONSTRAINT "session_result_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_result" ADD CONSTRAINT "session_result_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_result" ADD CONSTRAINT "session_result_encounter_id_encounter_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_result" ADD CONSTRAINT "session_result_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_result_campaign_id_created_at_index" ON "session_result" USING btree ("campaign_id","created_at");