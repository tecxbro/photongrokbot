-- Durable work revisions; the original inbox event and task binding never move.
ALTER TABLE batches ADD COLUMN input_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE batches ADD COLUMN acknowledged_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE batches ADD COLUMN claimed_revision INTEGER;
UPDATE batches SET acknowledged_revision=CASE WHEN state='completed' THEN 1 ELSE 0 END,
  claimed_revision=CASE WHEN state IN ('claimed','delegated') THEN 1 END;
CREATE TABLE batch_revisions (
  batch_id TEXT NOT NULL REFERENCES batches(id), revision INTEGER NOT NULL,
  reason TEXT NOT NULL, source_key TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  created_at INTEGER NOT NULL, PRIMARY KEY(batch_id,revision), UNIQUE(batch_id,source_key)
);
INSERT INTO batch_revisions
SELECT b.id,1,'inbound','inbound',json_object(
  'messages',json(COALESCE((SELECT json_group_array(json(record)) FROM
    (SELECT i.record FROM batch_events be JOIN inbox i ON i.id=be.event_id WHERE be.batch_id=b.id ORDER BY be.ordinal)),'[]')),
  'media',json(COALESCE((SELECT json_group_array(json_object('id',m.id,'eventId',m.event_id,'reference',json(m.reference),'state',m.state,'attempts',m.attempts)) FROM media_jobs m JOIN batch_events be ON be.event_id=m.event_id WHERE be.batch_id=b.id),'[]')),
  'originalSources',json(COALESCE((SELECT json_group_array(json_object('eventId',i.id,'messageId',i.provider_id)) FROM batch_events be JOIN inbox i ON i.id=be.event_id WHERE be.batch_id=b.id),'[]')),
  'sources',json(COALESCE((SELECT json_group_array(json_object('eventId',i.id,'messageId',i.provider_id)) FROM batch_events be JOIN inbox i ON i.id=be.event_id WHERE be.batch_id=b.id),'[]'))
),b.formed_at FROM batches b;
ALTER TABLE media_jobs ADD COLUMN result_hash TEXT;
ALTER TABLE tasks ADD COLUMN current_input_revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE task_inputs (
  task_id TEXT NOT NULL REFERENCES tasks(id), input_revision INTEGER NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id), work_revision INTEGER NOT NULL,
  correlation_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, receipt TEXT,
  result_work_revision INTEGER, PRIMARY KEY(task_id,input_revision), UNIQUE(task_id,batch_id,work_revision)
);
INSERT INTO task_inputs(task_id,input_revision,batch_id,work_revision,correlation_id,state,receipt)
SELECT id,1,batch_id,1,'cor-'||lower(hex(randomblob(16))),state,json_extract(binding,'$.receipt') FROM tasks;
CREATE INDEX task_inputs_batch ON task_inputs(batch_id,work_revision);
CREATE TABLE task_results (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, input_revision INTEGER NOT NULL,
  digest TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), created_at INTEGER NOT NULL,
  UNIQUE(task_id,input_revision), FOREIGN KEY(task_id,input_revision) REFERENCES task_inputs(task_id,input_revision)
);
-- Rebuild only the identity index. All operation IDs and child/provider records survive.
CREATE TABLE operations_v2 (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, line_id TEXT NOT NULL, purpose TEXT NOT NULL,
  action_key TEXT NOT NULL, payload_hash TEXT NOT NULL, batch_id TEXT REFERENCES batches(id),
  task_id TEXT REFERENCES tasks(id), created_at INTEGER NOT NULL, scope TEXT NOT NULL,
  input_revision INTEGER, task_input_revision INTEGER,
  UNIQUE(space_id,line_id,scope,purpose,action_key)
);
INSERT INTO operations_v2
SELECT o.*,
  CASE
    WHEN purpose='onboarding' THEN 'installation:'||(SELECT installation_id FROM instance WHERE singleton=1)
    WHEN EXISTS(SELECT 1 FROM metadata m WHERE m.kind='task-card-operation' AND json_extract(m.value,'$.operationId')=o.id)
      THEN 'card:'||(SELECT key FROM metadata m WHERE m.kind='task-card-operation' AND json_extract(m.value,'$.operationId')=o.id LIMIT 1)
    WHEN batch_id IS NOT NULL AND action_key LIKE 'cards:'||batch_id||':%'
      THEN 'options:'||batch_id||':1:'||substr(action_key,length('cards:'||batch_id||':')+1)
    WHEN task_id IS NOT NULL THEN 'task:'||task_id||':input:1'
    WHEN batch_id IS NOT NULL THEN 'work:'||batch_id||':1'
    ELSE 'legacy:'||id END,
  CASE WHEN batch_id IS NOT NULL THEN 1 END, CASE WHEN task_id IS NOT NULL THEN 1 END
FROM operations o;
DROP TABLE operations;
ALTER TABLE operations_v2 RENAME TO operations;
CREATE INDEX operations_conversation ON operations(space_id,line_id,purpose);
CREATE INDEX operations_batch ON operations(batch_id,purpose);
UPDATE instance SET schema_version=2 WHERE singleton=1;
