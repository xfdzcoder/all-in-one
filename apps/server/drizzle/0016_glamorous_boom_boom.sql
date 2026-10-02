CREATE TABLE `mail_read` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_key` text NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_read_user_id_idx` ON `mail_read` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_read_user_item_idx` ON `mail_read` (`user_id`,`item_key`);