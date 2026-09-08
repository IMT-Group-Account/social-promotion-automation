-- Drafts never enter the queue. Approval and scheduling happen in one transaction.
ALTER TABLE posts ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE posts ADD COLUMN platform_bodies jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(platform_bodies) = 'object');

CREATE OR REPLACE FUNCTION create_social_publish_queue_outbox()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'waiting' AND EXISTS (SELECT 1 FROM posts WHERE id = NEW.post_id AND status = 'scheduled') THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = NEW.status AND OLD.scheduled_at = NEW.scheduled_at THEN RETURN NEW; END IF;
    END IF;
    INSERT INTO social_publish_queue_outbox (publish_job_id, scheduled_at, queue_job_id)
    VALUES (NEW.id, NEW.scheduled_at, 'publish-' || NEW.id::text || '-' || gen_random_uuid()::text)
    ON CONFLICT (publish_job_id) DO UPDATE SET scheduled_at = EXCLUDED.scheduled_at,
      queue_job_id = EXCLUDED.queue_job_id, enqueued_at = NULL, dispatch_lease_expires_at = NULL,
      dispatch_attempt_count = 0, last_dispatch_error = NULL, updated_at = now();
  ELSIF NEW.status = 'cancelled' THEN
    DELETE FROM social_publish_queue_outbox WHERE publish_job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER social_publish_jobs_enqueue_outbox_trigger ON social_publish_jobs;
CREATE TRIGGER social_publish_jobs_enqueue_outbox_trigger
AFTER INSERT OR UPDATE OF status, scheduled_at ON social_publish_jobs
FOR EACH ROW EXECUTE FUNCTION create_social_publish_queue_outbox();
DELETE FROM social_publish_queue_outbox o USING social_publish_jobs j, posts p
WHERE o.publish_job_id = j.id AND j.post_id = p.id AND (p.status = 'draft' OR j.status = 'cancelled');
CREATE INDEX posts_owner_schedule_idx ON posts(owner_id, scheduled_at DESC, id);
