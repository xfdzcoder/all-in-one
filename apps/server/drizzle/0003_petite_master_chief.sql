CREATE TABLE `feed_read` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_key` text NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_read_user_id_idx` ON `feed_read` (`user_id`);--> statement-breakpoint
CREATE INDEX `feed_read_user_item_idx` ON `feed_read` (`user_id`,`item_key`);--> statement-breakpoint
CREATE TABLE `feed_source` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_source_user_id_idx` ON `feed_source` (`user_id`);