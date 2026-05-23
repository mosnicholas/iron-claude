CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"bucket" varchar(64) DEFAULT 'progress-photos' NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"caption" text,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_channel" varchar(16) DEFAULT 'telegram' NOT NULL,
	"source_message_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_user_taken_idx" ON "photos" USING btree ("user_id","taken_at");