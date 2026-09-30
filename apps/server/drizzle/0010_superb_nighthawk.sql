CREATE TABLE `data_source` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `data_source_user_idx` ON `data_source` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_source_user_kind_name_idx` ON `data_source` (`user_id`,`kind`,`name`);