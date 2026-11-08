ALTER TABLE little_worlds.agent_credentials DROP CONSTRAINT agent_credentials_role_check;
ALTER TABLE little_worlds.agent_credentials ADD CHECK(role IN ('caretaker','narrator','operator'));
CREATE TABLE little_worlds.items(world_id uuid NOT NULL REFERENCES little_worlds.worlds,id text NOT NULL,PRIMARY KEY(world_id,id));
CREATE TABLE little_worlds.quests(world_id uuid NOT NULL REFERENCES little_worlds.worlds,id text NOT NULL,definition jsonb NOT NULL,PRIMARY KEY(world_id,id));
CREATE TABLE little_worlds.narrative_settings(world_id uuid PRIMARY KEY REFERENCES little_worlds.worlds,settings jsonb NOT NULL);
CREATE TABLE little_worlds.quest_instances(
 world_id uuid NOT NULL,id text NOT NULL,owner_id text NOT NULL,stage integer NOT NULL CHECK(stage BETWEEN 0 AND 4),status text NOT NULL CHECK(status IN ('active','completed')),
 clues jsonb NOT NULL CHECK(jsonb_typeof(clues)='array'),started_at double precision NOT NULL,completed_at double precision,
 PRIMARY KEY(world_id,id),FOREIGN KEY(world_id,id) REFERENCES little_worlds.quests(world_id,id),FOREIGN KEY(world_id,owner_id) REFERENCES little_worlds.creatures(world_id,id),
 CHECK((status='active' AND stage<4 AND completed_at IS NULL) OR (status='completed' AND stage=4 AND completed_at IS NOT NULL))
);
CREATE TABLE little_worlds.story_threads(world_id uuid NOT NULL,quest_id text NOT NULL,status text NOT NULL CHECK(status IN ('unresolved','resolved')),PRIMARY KEY(world_id,quest_id),FOREIGN KEY(world_id,quest_id) REFERENCES little_worlds.quest_instances(world_id,id));
CREATE TABLE little_worlds.event_proposals(
 world_id uuid NOT NULL REFERENCES little_worlds.worlds,id uuid NOT NULL DEFAULT gen_random_uuid(),actor_id text NOT NULL,request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
 fingerprint text NOT NULL,input jsonb NOT NULL,status text NOT NULL CHECK(status IN ('pending','accepted','rejected')),code text,message text,
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,reviewed_by text,applied_virtual_time double precision,
 PRIMARY KEY(world_id,id),UNIQUE(world_id,actor_id,request_id),FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.actors(world_id,id),FOREIGN KEY(world_id,reviewed_by) REFERENCES little_worlds.actors(world_id,id),
 CHECK((status='pending' AND decided_at IS NULL AND applied_virtual_time IS NULL) OR (status='rejected' AND decided_at IS NOT NULL AND applied_virtual_time IS NULL) OR (status='accepted' AND decided_at IS NOT NULL AND applied_virtual_time IS NOT NULL))
);
CREATE INDEX proposal_fingerprint ON little_worlds.event_proposals(world_id,fingerprint) WHERE status IN ('accepted','pending');
CREATE UNIQUE INDEX one_pending_proposal ON little_worlds.event_proposals(world_id) WHERE status='pending';
CREATE TABLE little_worlds.proposal_decisions(world_id uuid NOT NULL,proposal_id uuid NOT NULL,actor_id text NOT NULL,status text NOT NULL,code text,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(world_id,proposal_id),FOREIGN KEY(world_id,proposal_id) REFERENCES little_worlds.event_proposals(world_id,id),FOREIGN KEY(world_id,actor_id) REFERENCES little_worlds.actors(world_id,id));
CREATE TRIGGER immutable_decisions BEFORE UPDATE OR DELETE ON little_worlds.proposal_decisions FOR EACH ROW EXECUTE FUNCTION little_worlds.reject_history_change();
CREATE TABLE little_worlds.ai_daily_usage(world_id uuid NOT NULL REFERENCES little_worlds.worlds,day date NOT NULL,requests integer NOT NULL CHECK(requests>=0),reserved_tokens integer NOT NULL CHECK(reserved_tokens>=0),PRIMARY KEY(world_id,day));
CREATE TABLE little_worlds.ai_usage(
 world_id uuid NOT NULL REFERENCES little_worlds.worlds,id uuid NOT NULL DEFAULT gen_random_uuid(),workflow_id text NOT NULL,attempt integer NOT NULL CHECK(attempt BETWEEN 0 AND 1),model text NOT NULL,
 status text NOT NULL CHECK(status IN ('reserved','ok','error')),reserved_tokens integer NOT NULL CHECK(reserved_tokens>0),actual_tokens integer CHECK(actual_tokens>=0),error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(world_id,id),UNIQUE(world_id,workflow_id,attempt)
);
ALTER TABLE little_worlds.event_journal DROP CONSTRAINT event_journal_check;
ALTER TABLE little_worlds.event_journal ADD COLUMN proposal_id uuid;
ALTER TABLE little_worlds.event_journal ADD FOREIGN KEY(world_id,proposal_id) REFERENCES little_worlds.event_proposals(world_id,id);
ALTER TABLE little_worlds.event_journal ADD CHECK(
 (source='simulation' AND tick_request_id IS NOT NULL AND tick_request_id=correlation_id AND action_request_id IS NULL AND initiating_actor_id IS NULL AND proposal_id IS NULL)
 OR (source='caretaker' AND action_request_id IS NOT NULL AND action_request_id=correlation_id AND initiating_actor_id IS NOT NULL AND tick_request_id IS NULL AND proposal_id IS NULL)
 OR (source='narrator' AND proposal_id IS NOT NULL AND correlation_id=proposal_id::text AND tick_request_id IS NULL AND action_request_id IS NULL AND initiating_actor_id IS NOT NULL));
CREATE FUNCTION little_worlds.seed_narrative() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,little_worlds AS $$
 BEGIN
 INSERT INTO little_worlds.items SELECT NEW.world_id,id FROM unnest(ARRAY['berries','seeds','glowing_seed','seed_charm']) id;
 INSERT INTO little_worlds.quests VALUES(NEW.world_id,'mystery_of_the_seed','{"title":"The Glowing Seed","stages":["investigate_discovery","visit_pond","plant_garden","tend_garden"],"reward":"seed_charm"}');
 INSERT INTO little_worlds.narrative_settings VALUES(NEW.world_id,'{"manualApproval":true,"minGap":86400000,"earliestDiscovery":86400000,"maxPerDay":1,"dailyRequests":2,"dailyTokens":12000}');
 INSERT INTO little_worlds.actors(world_id,id,kind) VALUES(NEW.world_id,'local-narrator','narrator'),(NEW.world_id,'local-operator','operator');
 RETURN NEW;
 END;
$$;
REVOKE ALL ON FUNCTION little_worlds.seed_narrative() FROM PUBLIC;
CREATE TRIGGER seed_narrative AFTER INSERT ON little_worlds.worlds FOR EACH ROW EXECUTE FUNCTION little_worlds.seed_narrative();
-- Backfill by invoking the same fixed definitions for existing worlds.
INSERT INTO little_worlds.items SELECT world_id,id FROM little_worlds.worlds CROSS JOIN unnest(ARRAY['berries','seeds','glowing_seed','seed_charm']) id;
INSERT INTO little_worlds.quests SELECT world_id,'mystery_of_the_seed','{"title":"The Glowing Seed","stages":["investigate_discovery","visit_pond","plant_garden","tend_garden"],"reward":"seed_charm"}'::jsonb FROM little_worlds.worlds;
INSERT INTO little_worlds.narrative_settings SELECT world_id,'{"manualApproval":true,"minGap":86400000,"earliestDiscovery":86400000,"maxPerDay":1,"dailyRequests":2,"dailyTokens":12000}'::jsonb FROM little_worlds.worlds;
INSERT INTO little_worlds.actors(world_id,id,kind) SELECT world_id,'local-narrator','narrator' FROM little_worlds.worlds;
INSERT INTO little_worlds.actors(world_id,id,kind) SELECT world_id,'local-operator','operator' FROM little_worlds.worlds;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['items','quests','narrative_settings','quest_instances','story_threads','event_proposals','proposal_decisions','ai_daily_usage','ai_usage'] LOOP
 EXECUTE format('ALTER TABLE little_worlds.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY server_access ON little_worlds.%I TO little_worlds_runtime USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT ON little_worlds.%I TO little_worlds_runtime',t);
 END LOOP;
END $$;
GRANT INSERT ON little_worlds.quest_instances,little_worlds.story_threads,little_worlds.event_proposals,little_worlds.proposal_decisions,little_worlds.ai_daily_usage,little_worlds.ai_usage TO little_worlds_runtime;
GRANT UPDATE ON little_worlds.quest_instances,little_worlds.story_threads,little_worlds.ai_daily_usage,little_worlds.ai_usage TO little_worlds_runtime;
GRANT UPDATE(status,code,message,decided_at,reviewed_by,applied_virtual_time) ON little_worlds.event_proposals TO little_worlds_runtime;
CREATE FUNCTION little_worlds.final_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF OLD.status<>'pending' THEN RAISE EXCEPTION 'Proposal decision is final'; END IF; RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION little_worlds.final_proposal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION little_worlds.final_proposal() TO little_worlds_runtime;
CREATE TRIGGER final_proposal BEFORE UPDATE OR DELETE ON little_worlds.event_proposals FOR EACH ROW EXECUTE FUNCTION little_worlds.final_proposal();
