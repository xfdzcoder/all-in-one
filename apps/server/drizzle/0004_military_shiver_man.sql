CREATE TABLE `plugin` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`manifest_json` text NOT NULL,
	`dir` text NOT NULL,
	`status` text DEFAULT 'installed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_type_unique` ON `plugin` (`type`);--> statement-breakpoint
CREATE INDEX `plugin_user_id_idx` ON `plugin` (`user_id`);