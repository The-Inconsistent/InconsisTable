CREATE TABLE "api_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"op_sid" text NOT NULL,
	"roles" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_link" (
	"iss" text NOT NULL,
	"sub" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_link_iss_sub_pk" PRIMARY KEY("iss","sub"),
	CONSTRAINT "identity_link_userId_iss_unique" UNIQUE("user_id","iss")
);
--> statement-breakpoint
CREATE TABLE "logout_jti" (
	"jti" text PRIMARY KEY NOT NULL,
	"exp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_tx" (
	"handle_hash" text PRIMARY KEY NOT NULL,
	"transaction" jsonb NOT NULL,
	"device_user_id" text,
	"return_to" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_session" ADD CONSTRAINT "api_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link" ADD CONSTRAINT "identity_link_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_tx" ADD CONSTRAINT "oidc_tx_device_user_id_app_user_id_fk" FOREIGN KEY ("device_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_session_op_sid_index" ON "api_session" USING btree ("op_sid");--> statement-breakpoint
CREATE INDEX "api_session_user_id_index" ON "api_session" USING btree ("user_id");