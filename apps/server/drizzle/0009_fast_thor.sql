CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tag_user_id_idx` ON `tag` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_user_name_idx` ON `tag` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `tag_target` (
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`tag_id`, `target_type`, `target_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tag_target_user_idx` ON `tag_target` (`user_id`);--> statement-breakpoint
CREATE INDEX `tag_target_target_idx` ON `tag_target` (`target_type`,`target_id`);