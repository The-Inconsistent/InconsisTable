-- P2 group A: quest status, scenes under adventures, links between entries, planned Tests (docs/p2-plan.md).
ALTER TABLE "codex_entry" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "codex_entry" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "codex_entry" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "codex_entry" ADD COLUMN "planned_tests" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "codex_entry" SET "status" = 'open' WHERE "kind" = 'quest';--> statement-breakpoint
-- No ON DELETE action: the check runs at the end of the statement, so deleting a room still removes an adventure with
-- its scenes, while deleting an adventure alone that still has scenes is refused.
ALTER TABLE "codex_entry" ADD CONSTRAINT "codex_entry_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "codex_entry"("id");--> statement-breakpoint
ALTER TABLE "codex_entry" ADD CONSTRAINT "codex_entry_status_check" CHECK (("kind" = 'quest' AND "status" IN ('open', 'done', 'failed')) OR ("kind" <> 'quest' AND "status" IS NULL));--> statement-breakpoint
ALTER TABLE "codex_entry" ADD CONSTRAINT "codex_entry_parent_check" CHECK ("parent_id" IS NULL OR "kind" = 'scene');--> statement-breakpoint
ALTER TABLE "codex_entry" ADD CONSTRAINT "codex_entry_planned_tests_check" CHECK (cardinality("planned_tests") <= 10 AND ("kind" = 'scene' OR cardinality("planned_tests") = 0));--> statement-breakpoint
CREATE INDEX "codex_entry_parent_id_index" ON "codex_entry" USING btree ("parent_id");--> statement-breakpoint
CREATE TABLE "codex_link" (
	"entry_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "codex_link_entry_id_target_id_pk" PRIMARY KEY("entry_id","target_id")
);--> statement-breakpoint
ALTER TABLE "codex_link" ADD CONSTRAINT "codex_link_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "codex_entry"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "codex_link" ADD CONSTRAINT "codex_link_target_id_fk" FOREIGN KEY ("target_id") REFERENCES "codex_entry"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "codex_link_target_id_index" ON "codex_link" USING btree ("target_id");
