ALTER TABLE "combatant" ADD COLUMN "done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "encounter" ADD COLUMN "phase_id" text;