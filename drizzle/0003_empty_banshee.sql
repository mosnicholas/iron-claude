CREATE TABLE "stripe_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"created_epoch" integer NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_last_event_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "stripe_events_type_idx" ON "stripe_events" USING btree ("type");