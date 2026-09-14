begin;

alter table public.capture_sessions
  drop constraint capture_sessions_workspace_id_ai_run_id_fkey,
  add constraint capture_sessions_workspace_id_ai_run_id_fkey
    foreign key (workspace_id, ai_run_id)
    references public.ai_runs(workspace_id, id)
    on delete set null (ai_run_id);

alter table public.source_assets
  drop constraint source_assets_workspace_id_capture_session_id_fkey,
  add constraint source_assets_workspace_id_capture_session_id_fkey
    foreign key (workspace_id, capture_session_id)
    references public.capture_sessions(workspace_id, id)
    on delete set null (capture_session_id);

alter table public.interactions
  drop constraint interactions_workspace_id_event_id_fkey,
  add constraint interactions_workspace_id_event_id_fkey
    foreign key (workspace_id, event_id)
    references public.events(workspace_id, id)
    on delete set null (event_id);

alter table public.memory_statements
  drop constraint memory_statements_workspace_id_interaction_id_fkey,
  add constraint memory_statements_workspace_id_interaction_id_fkey
    foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete set null (interaction_id);

alter table public.action_items
  drop constraint action_items_workspace_id_interaction_id_fkey,
  add constraint action_items_workspace_id_interaction_id_fkey
    foreign key (workspace_id, interaction_id)
    references public.interactions(workspace_id, id)
    on delete set null (interaction_id);

alter table public.provenance_records
  drop constraint provenance_records_workspace_id_source_asset_id_fkey,
  add constraint provenance_records_workspace_id_source_asset_id_fkey
    foreign key (workspace_id, source_asset_id)
    references public.source_assets(workspace_id, id)
    on delete set null (source_asset_id),
  drop constraint provenance_records_workspace_id_ai_run_id_fkey,
  add constraint provenance_records_workspace_id_ai_run_id_fkey
    foreign key (workspace_id, ai_run_id)
    references public.ai_runs(workspace_id, id)
    on delete set null (ai_run_id);

alter table public.query_evidence
  drop constraint query_evidence_workspace_id_memory_statement_id_fkey,
  add constraint query_evidence_workspace_id_memory_statement_id_fkey
    foreign key (workspace_id, memory_statement_id)
    references public.memory_statements(workspace_id, id)
    on delete set null (memory_statement_id),
  drop constraint query_evidence_workspace_id_memory_document_id_fkey,
  add constraint query_evidence_workspace_id_memory_document_id_fkey
    foreign key (workspace_id, memory_document_id)
    references public.memory_documents(workspace_id, id)
    on delete set null (memory_document_id);

alter table public.feedback
  drop constraint feedback_workspace_id_query_id_fkey,
  add constraint feedback_workspace_id_query_id_fkey
    foreign key (workspace_id, query_id)
    references public.queries(workspace_id, id)
    on delete set null (query_id);

commit;
