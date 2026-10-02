DROP INDEX `feed_read_user_item_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `feed_read_user_item_idx` ON `feed_read` (`user_id`,`item_key`);